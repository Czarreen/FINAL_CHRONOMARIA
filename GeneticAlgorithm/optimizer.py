"""Chronomaria GA microservice for faculty loading."""

from __future__ import annotations

import json
import math
import os
import random
import re
import time
from hashlib import sha1
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple


DAY_ALIASES = {
    "M": "MON",
    "MON": "MON",
    "MONDAY": "MON",
    "T": "TUE",
    "TU": "TUE",
    "TUE": "TUE",
    "TUESDAY": "TUE",
    "W": "WED",
    "WED": "WED",
    "WEDNESDAY": "WED",
    "TH": "THU",
    "THU": "THU",
    "THURSDAY": "THU",
    "F": "FRI",
    "FRI": "FRI",
    "FRIDAY": "FRI",
    "SAT": "SAT",
    "SATURDAY": "SAT",
    "S": "SAT",
}


def normalize_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalize_upper(value: Any) -> str:
    return normalize_text(value).upper()


def to_number(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(num) or math.isinf(num):
        return None
    return num


def split_tokens(value: Any) -> List[str]:
    return [t.strip() for t in re.split(r"[,;/|]+", normalize_text(value)) if t.strip()]


def extract_keywords(value: Any) -> Set[str]:
    out: Set[str] = set()
    for token in split_tokens(value):
        for part in re.split(r"\s+", token):
            clean = re.sub(r"[^A-Za-z0-9]", "", part).upper()
            if len(clean) >= 2:
                out.add(clean)
    return out


def parse_time_range(schedule_text: Any) -> Optional[Dict[str, int]]:
    text = normalize_upper(schedule_text).replace(".", " ")
    match = re.search(
        r"(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    def parse_minutes(token: str, is_end: bool) -> Optional[int]:
        cleaned = normalize_upper(token).replace(" ", "")
        tm = re.match(r"^(\d{1,2})(?::(\d{2}))?(AM|PM)?$", cleaned, flags=re.IGNORECASE)
        if not tm:
            return None
        hour = int(tm.group(1))
        minute = int(tm.group(2) or "0")
        meridiem = (tm.group(3) or "").upper() or None
        if meridiem == "AM":
            if hour == 12:
                hour = 0
        elif meridiem == "PM":
            if hour != 12:
                hour += 12
        elif not is_end and hour < 7:
            hour += 12
        return hour * 60 + minute

    start = parse_minutes(match.group(1), False)
    end = parse_minutes(match.group(2), True)
    if start is None or end is None or end <= start:
        return None

    # Enforce time boundaries: earliest start 7:30 AM (450), latest end 8:00 PM (1200)
    EARLIEST_START = 7 * 60 + 30  # 450
    LATEST_END = 20 * 60           # 1200
    if start < EARLIEST_START or end > LATEST_END:
        return None

    return {"start": start, "end": end, "duration": end - start}


def parse_days_from_text(schedule_text: Any, group: str) -> Set[str]:
    text = normalize_upper(schedule_text)
    compact = re.sub(r"[^A-Z]", " ", text)
    parts = [p for p in compact.split() if p]
    days: Set[str] = set()

    for part in parts:
        if part in DAY_ALIASES:
            days.add(DAY_ALIASES[part])
            continue
        if part == "MTH":
            days.update({"MON", "THU"})
        elif part in ("TF", "TFS"):  # TFS is legacy alias; TF is the automated pattern (Tue/Fri only)
            days.update({"TUE", "FRI"})
        else:
            if "MON" in part:
                days.add("MON")
            if "TH" in part:
                days.add("THU")
            if "TUE" in part:
                days.add("TUE")
            if "FRI" in part:
                days.add("FRI")
            # SAT is user-defined only — not added to automated day sets

    if not days:
        if group == "MTH":
            return {"MON", "THU"}
        if group in ("TF", "TFS"):  # TFS is legacy alias
            return {"TUE", "FRI"}
    return days


_AUTOMATED_DAYS: Set[str] = {"MON", "TUE", "THU", "FRI"}  # Wednesday excluded; SAT is user-defined


def is_sat_only_blocks(blocks: List[Dict[str, Any]]) -> bool:
    """Returns True if all blocks only contain SAT (user-defined; skip from automated GA)."""
    if not blocks:
        return False
    return all(not (set(b.get("days", [])) & _AUTOMATED_DAYS) for b in blocks)


def build_schedule_blocks(offering: Dict[str, Any]) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    for group in ("mth", "tfs"):
        schedule_text = normalize_text(offering.get(f"{group}_schedule"))
        if not schedule_text:
            continue
        tr = parse_time_range(schedule_text)
        if not tr:
            continue
        group_upper = group.upper()
        blocks.append(
            {
                "group": group_upper,
                "days": sorted(parse_days_from_text(schedule_text, group_upper)),
                "start": tr["start"],
                "end": tr["end"],
                "duration": tr["duration"],
                "room_id": to_number(offering.get(f"{group}_room_id")),
            }
        )
    return blocks


def overlaps(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return a["start"] < b["end"] and b["start"] < a["end"]


def normalize_role(role: Any) -> str:
    txt = normalize_upper(role)
    if txt.startswith("FT"):
        return "FT"
    if txt.startswith("PT"):
        return "PT"
    return txt or "UNKNOWN"


def _sec_key(subject: Dict[str, Any]) -> str:
    """Composite dept_id|section key so same section names across departments stay separate."""
    dept = str(int(to_number(subject.get("department_id")) or 0))
    sec  = normalize_upper(subject.get("section") or "")
    return f"{dept}|{sec}"


def _build_pre_occupied(
    reserved_slots: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Convert reserved_slots (preserved subjects) into pre-occupied room/section entries.

    Returns a dict with:
      "room_entries":    [(room_idx, day, start, end), ...]
      "section_entries": [(sec_key,  day, start, end), ...]
    """
    room_id_to_idx: Dict[str, int] = {
        str(r.get("room_id")): idx
        for idx, r in enumerate(rooms)
        if r.get("room_id") is not None
    }
    MTH_DAYS = ("MON", "THU")
    TF_DAYS  = ("TUE", "FRI")
    room_entries: List[tuple] = []
    section_entries: List[tuple] = []

    for slot in reserved_slots:
        dept = str(int(to_number(slot.get("department_id")) or 0))
        sec  = normalize_upper(slot.get("section") or "")
        sec_key = f"{dept}|{sec}"

        for sched_field, room_field, default_days in [
            ("mth_schedule", "mth_room_id", MTH_DAYS),
            ("tfs_schedule", "tfs_room_id", TF_DAYS),
        ]:
            sched       = slot.get(sched_field)
            room_id_str = str(slot.get(room_field) or "")
            if not sched or not room_id_str:
                continue
            parsed = parse_time_range(sched)
            if not parsed:
                continue
            start, end = parsed["start"], parsed["end"]
            # Support slash-separated room IDs (e.g. "3/5" = lec room on day1, lab room on day2).
            # A single ID occupies both days; two IDs map first→day1, second→day2.
            sub_ids = [x.strip() for x in room_id_str.split("/") if x.strip()]
            for i, sub_id in enumerate(sub_ids):
                room_idx = room_id_to_idx.get(sub_id)
                days_for_room = list(default_days) if len(sub_ids) == 1 else (
                    [default_days[i]] if i < len(default_days) else []
                )
                for day in days_for_room:
                    if room_idx is not None:
                        room_entries.append((room_idx, day, start, end))
            for day in default_days:
                section_entries.append((sec_key, day, start, end))

    return {"room_entries": room_entries, "section_entries": section_entries}


def build_offering_key(offering: Dict[str, Any]) -> str:
    return "|".join(
        [
            str(int(to_number(offering.get("department_id")) or 0)),
            normalize_upper(offering.get("code")),
            normalize_upper(offering.get("course_no")),
            normalize_upper(offering.get("section")),
        ]
    )


def build_subject_index(subjects: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    idx: Dict[str, Dict[str, Any]] = {}
    for subject in subjects:
        key = "|".join(
            [
                str(int(to_number(subject.get("department_id")) or 0)),
                normalize_upper(subject.get("subject_code")),
                normalize_upper(subject.get("subject_course_no")),
                normalize_upper(subject.get("subject_section")),
            ]
        )
        idx.setdefault(key, subject)
    return idx


def match_specialization_score(faculty: Dict[str, Any], offering: Dict[str, Any], matched_subject: Optional[Dict[str, Any]]) -> float:
    spec_raw = normalize_upper(faculty.get("faculty_specialization"))
    if not spec_raw:
        return 0.0
    src = spec_raw
    tgt = " ".join(
        filter(
            None,
            [
                normalize_upper(offering.get("code")),
                normalize_upper(offering.get("course_no")),
                normalize_upper(offering.get("descriptive_title")),
                normalize_upper(matched_subject.get("subject_descriptive_title")) if matched_subject else "",
                normalize_upper(matched_subject.get("subject_code")) if matched_subject else "",
            ],
        )
    )
    score = float(len(extract_keywords(src).intersection(extract_keywords(tgt))) * 10)
    if normalize_upper(offering.get("descriptive_title")) in src:
        score += 24.0
    if normalize_upper(offering.get("code")) in src:
        score += 16.0
    if normalize_upper(offering.get("course_no")) in src:
        score += 14.0
    return score


def faculty_has_conflict(existing: Sequence[Dict[str, Any]], candidate: Sequence[Dict[str, Any]]) -> bool:
    for left in existing:
        ldays = set(left.get("days", []))
        for right in candidate:
            if not ldays.intersection(set(right.get("days", []))):
                continue
            if overlaps(left, right):
                return True
    return False


def consecutive_minutes_for_day(blocks: Sequence[Dict[str, Any]], day: str) -> float:
    day_blocks = sorted([b for b in blocks if day in set(b.get("days", []))], key=lambda x: x["start"])
    if not day_blocks:
        return 0.0
    merged: List[Tuple[int, int]] = []
    for b in day_blocks:
        s, e = int(b["start"]), int(b["end"])
        if not merged or s > merged[-1][1]:
            merged.append((s, e))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
    return max(float(e - s) for s, e in merged)


def count_preparations(assignments: Sequence[Dict[str, Any]]) -> int:
    return len({f"{normalize_upper(a['offering'].get('code'))}|{normalize_upper(a['offering'].get('course_no'))}" for a in assignments})


def build_department_count_map(raw: Any) -> Dict[int, int]:
    out: Dict[int, int] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        dept = to_number(key)
        count = to_number(value)
        if dept is None:
            continue
        out[int(dept)] = int(count or 0)
    return out


def is_cross_department_no_spec_allowed(
    offering_department_id: Optional[float],
    faculty_department_id: Optional[float],
    department_faculty_counts: Dict[int, int],
) -> bool:
    """Cross-department without specialization is allowed only for the IT->CS zero-faculty exception."""
    off_dept = int(offering_department_id or 0)
    fac_dept = int(faculty_department_id or 0)
    if off_dept == fac_dept:
        return True
    # One-way exception only: IT -> CS when CS has zero faculty records.
    cs_dept = 11
    it_dept = 6  # Information Technology (dept 7 is Library Information Science)
    cs_faculty_count = int(department_faculty_counts.get(cs_dept, 0))
    return off_dept == cs_dept and fac_dept == it_dept and cs_faculty_count == 0


def build_initial_candidate(faculties, offerings, subject_index, rng, department_faculty_counts):
    loads = {i: 0.0 for i in range(len(faculties))}
    blocks = {i: [] for i in range(len(faculties))}
    preps = {i: set() for i in range(len(faculties))}
    chosen: Dict[int, int] = {}

    ordering = sorted(
        enumerate(offerings),
        key=lambda x: -((to_number(x[1].get("units")) or to_number(x[1].get("lec_hrs")) or 0.0)),
    )

    for oi, offering in ordering:
        off_blocks = build_schedule_blocks(offering)
        # Skip SAT-only offerings — Saturday is user-defined, not automated
        if is_sat_only_blocks(off_blocks):
            chosen[oi] = -1
            continue
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        subject = subject_index.get(build_offering_key(offering))

        # ── Two-pass candidate selection ─────────────────────────────────
        # Pass A: any faculty from any department with a specialization match.
        #         Units enforced. FT preferred over PT.
        # Pass B: same-department faculty only (no specialization required).
        #         Units enforced. FT preferred over PT.
        # Pass C: cross-department no-spec fallback (IT->CS zero-faculty only).
        # First non-empty pass wins.

        def _hard_eligible(fi_: int) -> bool:
            fac_ = faculties[fi_]
            max_u = max(0.0, to_number(fac_.get("faculty_max_units")) or 0.0)
            if max_u > 0 and loads[fi_] + units > max_u:
                return False
            if faculty_has_conflict(blocks[fi_], off_blocks):
                return False
            if any(consecutive_minutes_for_day(blocks[fi_] + off_blocks, d) > 240.0
                   for d in ("MON", "TUE", "WED", "THU", "FRI", "SAT")):
                return False
            prep_key_ = f"{normalize_upper(offering.get('code'))}|{normalize_upper(offering.get('course_no'))}"
            if len(set(preps[fi_]) | {prep_key_}) > 4:
                return False
            return True

        def _score(fi_: int, spec_: float, dept_match_: bool) -> float:
            role_ = normalize_role(faculties[fi_].get("faculty_role"))
            s = spec_ * (1.0 if dept_match_ else 0.65)
            s += 120.0 if role_ == "FT" else 45.0 if role_ == "PT" else 0.0
            s -= loads[fi_] * 0.7
            return s + rng.random() * 0.001

        candidates: List[Tuple[float, int]] = []

        # Pass A — specialization match, any department
        for fi, faculty in enumerate(faculties):
            if not _hard_eligible(fi):
                continue
            spec = match_specialization_score(faculty, offering, subject)
            if spec > 0.0:
                candidates.append((_score(fi, spec, to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))), fi))

        # Pass B — same department, no specialization needed
        if not candidates:
            for fi, faculty in enumerate(faculties):
                if to_number(faculty.get("department_id")) != to_number(offering.get("department_id")):
                    continue
                if not _hard_eligible(fi):
                    continue
                spec = match_specialization_score(faculty, offering, subject)
                candidates.append((_score(fi, spec, True), fi))

        # Pass C — cross-department no-spec fallback (IT->CS zero-faculty only)
        if not candidates:
            for fi, faculty in enumerate(faculties):
                if not is_cross_department_no_spec_allowed(
                    to_number(offering.get("department_id")),
                    to_number(faculty.get("department_id")),
                    department_faculty_counts,
                ):
                    continue
                if to_number(faculty.get("department_id")) == to_number(offering.get("department_id")):
                    continue  # already covered in Pass B
                if not _hard_eligible(fi):
                    continue
                spec = match_specialization_score(faculty, offering, subject)
                candidates.append((_score(fi, spec, False), fi))

        fi = sorted(candidates, key=lambda x: (-x[0], x[1]))[0][1] if candidates else -1
        if fi < 0:
            chosen[oi] = -1
            continue
        chosen[oi] = fi
        loads[fi] += units
        blocks[fi].extend(off_blocks)
        preps[fi].add(f"{normalize_upper(offering.get('code'))}|{normalize_upper(offering.get('course_no'))}")

    return [chosen.get(i, -1) for i in range(len(offerings))]


def summarize_candidate(candidate, faculties, offerings, subject_index, department_faculty_counts, department_available_faculty_counts):
    assignments = []
    loads = {}
    faculty_assignments = {}
    faculty_blocks = {}
    room_day_blocks = {}
    conflicts = []
    unassigned = []
    unresolved_details = []

    for oi, fi in enumerate(candidate):
        offering = offerings[oi]
        if fi < 0 or fi >= len(faculties):
            unassigned.append(offering)
            off_dept = int(to_number(offering.get("department_id")) or 0)
            total_faculty = int(department_faculty_counts.get(off_dept, 0))
            available_faculty = int(department_available_faculty_counts.get(off_dept, 0))

            # Check if the IT->CS cross-dept fallback was attempted
            cs_dept_id = 11
            it_dept_id = 6
            pass_c_attempted = (
                off_dept == cs_dept_id
                and total_faculty == 0
                and int(department_faculty_counts.get(it_dept_id, 0)) > 0
            )

            if total_faculty == 0 and pass_c_attempted:
                reason = "No CS faculty found. IT→CS fallback was attempted but all IT faculty were ineligible (unit limit, prep limit, or schedule conflict)."
            elif total_faculty == 0:
                reason = "No faculty records found for this department."
            elif available_faculty == 0:
                reason = "All faculty units in this department are fully used."
            else:
                reason = "No eligible faculty matched specialization, department rules, and load constraints."

            recommendations: List[str] = []
            if total_faculty == 0 and pass_c_attempted:
                recommendations.append("IT faculty exist but are fully loaded or have schedule conflicts with this subject.")
                recommendations.append("Reduce IT faculty loads or adjust this subject's schedule to allow IT→CS fallback.")
            elif total_faculty == 0:
                recommendations.append("Add faculty records for this department before rerunning GA.")
                recommendations.append("If needed, assign specialization-matched faculty from other departments.")
            elif available_faculty == 0:
                recommendations.append("All department faculty are at max units. Add faculty or reduce current loads.")
                recommendations.append("Optionally review cross-department candidates manually based on specialization.")
            else:
                recommendations.append("Review specialization tags and faculty max units for this subject.")

            unresolved_details.append(
                {
                    "offering_id": offering.get("id"),
                    "code": offering.get("code"),
                    "course_no": offering.get("course_no"),
                    "section": offering.get("section"),
                    "department_id": offering.get("department_id"),
                    "descriptive_title": offering.get("descriptive_title"),
                    "reason": reason,
                    "recommendations": recommendations,
                }
            )
            continue
        faculty = faculties[fi]

        b = build_schedule_blocks(offering)
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        fid = int(to_number(faculty.get("faculty_id")) or 0)

        item = {"faculty": faculty, "offering": offering, "matched_subject": subject_index.get(build_offering_key(offering)), "schedule_blocks": b}
        assignments.append(item)
        loads[fid] = loads.get(fid, 0.0) + units
        faculty_assignments.setdefault(fid, []).append(item)
        faculty_blocks.setdefault(fid, []).extend(b)

        for blk in b:
            room_id = int(to_number(blk.get("room_id")) or 0)
            for day in blk.get("days", []):
                room_day_blocks.setdefault(f"{day}|{room_id}", []).append({"start": blk["start"], "end": blk["end"]})

    hard_penalty = 0.0
    soft_penalty = 0.0
    soft_bonus = 0.0
    avg_units = sum(loads.values()) / max(1, len(faculties))

    if unassigned:
        hard_penalty += 180.0 * len(unassigned)

    for k, blks in room_day_blocks.items():
        ordered = sorted(blks, key=lambda x: x["start"])
        for i in range(1, len(ordered)):
            if overlaps(ordered[i - 1], ordered[i]):
                hard_penalty += 80.0
                conflicts.append({"type": "room_conflict", "id": k, "problem": f"Room overlap at {k}"})

    load_rows = []
    free_rows = []

    for faculty in faculties:
        fid = int(to_number(faculty.get("faculty_id")) or 0)
        assigned = faculty_assignments.get(fid, [])
        blks = faculty_blocks.get(fid, [])
        total = loads.get(fid, 0.0)
        max_units = to_number(faculty.get("faculty_max_units")) or 0.0
        role = normalize_role(faculty.get("faculty_role"))

        if max_units > 0 and total > max_units:
            hard_penalty += (total - max_units) * 120.0
            conflicts.append({"type": "overload", "faculty_id": fid, "problem": "Exceeded max units"})

        prep_count = count_preparations(assigned)
        if prep_count > 4:
            hard_penalty += (prep_count - 4) * 100.0
            conflicts.append({"type": "preparations", "faculty_id": fid, "problem": "More than 4 preparations"})

        if role == "FT":
            soft_penalty -= 9.0
        elif role == "PT":
            soft_penalty += 4.0

        for it in assigned:
            off = it["offering"]
            spec_score = match_specialization_score(faculty, off, it.get("matched_subject"))
            is_spec_match = spec_score > 0.0
            dept_match = to_number(faculty.get("department_id")) == to_number(off.get("department_id"))

            if dept_match and is_spec_match:
                soft_bonus += 12.0
            elif dept_match:
                soft_bonus += 7.0
            elif is_spec_match:
                soft_bonus += 4.0
            else:
                soft_bonus += 1.0

            soft_penalty -= spec_score * (0.22 if dept_match else 0.1)

        for day in ("MON", "TUE", "WED", "THU", "FRI", "SAT"):
            day_blocks = sorted([x for x in blks if day in set(x.get("days", []))], key=lambda x: x["start"])
            for i in range(1, len(day_blocks)):
                if overlaps(day_blocks[i - 1], day_blocks[i]):
                    hard_penalty += 90.0
                    conflicts.append({"type": "time_conflict", "faculty_id": fid, "problem": f"Overlap on {day}"})
            if consecutive_minutes_for_day(day_blocks, day) > 240.0:
                hard_penalty += 70.0
                conflicts.append({"type": "consecutive_limit", "faculty_id": fid, "problem": f">4h consecutive on {day}"})

        soft_penalty += (total - avg_units) ** 2 * 0.35
        free = max(0.0, max_units - total)
        row = {
            "faculty_id": fid,
            "faculty_name": faculty.get("faculty_name"),
            "faculty_role": faculty.get("faculty_role"),
            "department_id": faculty.get("department_id"),
            "total_units": round(total, 2),
            "max_units": round(max_units, 2),
            "free_units": round(free, 2),
            "class_count": len(assigned),
            "preparations": prep_count,
            "imbalance_score": round(abs(total - avg_units), 2),
        }
        load_rows.append(row)
        if free > 0:
            free_rows.append(row)

    hard = max(0.0, 100.0 - hard_penalty)
    soft = max(0.0, min(100.0, 100.0 - soft_penalty + soft_bonus))
    overall = max(0.0, min(100.0, hard * 0.72 + soft * 0.28))

    return {
        "assignments": assignments,
        "fitness_overall": round(overall, 2),
        "fitness_hard": round(hard, 2),
        "fitness_soft": round(soft, 2),
        "report": {
            "summary": f"Generated {len(assignments)} assignment(s) from {len(offerings)} offering(s).",
            "faculty_load_balance": load_rows,
            "faculty_free_units": free_rows,
            "unassigned_subjects": [f"{normalize_text(o.get('code'))}-{normalize_text(o.get('course_no'))}-Sec{normalize_text(o.get('section'))}" for o in unassigned],
            "unresolved_offerings": unresolved_details,
            "hard_violations": [c for c in conflicts if c["type"] in {"room_conflict", "time_conflict", "overload", "department_mismatch", "consecutive_limit", "preparations", "forbidden_cross_department"}],
            "soft_penalties": [],
            "schedule_fragmentation": {"faculty_with_scattered_schedule": [r["faculty_id"] for r in load_rows if r["class_count"] >= 3 and r["imbalance_score"] > 2]},
            "explainability": [f"{a['faculty'].get('faculty_name')}: {normalize_text(a['offering'].get('code'))} {normalize_text(a['offering'].get('descriptive_title'))}" for a in assignments[:16]],
            "conflicts": conflicts,
        },
    }


def mutate(candidate: Sequence[int], faculty_count: int, rng: random.Random, mutation_rate: float) -> List[int]:
    out = list(candidate)
    for i in range(len(out)):
        if rng.random() < mutation_rate:
            out[i] = rng.randrange(-1, max(1, faculty_count))
    return out


def crossover(a: Sequence[int], b: Sequence[int], rng: random.Random) -> List[int]:
    return [a[i] if rng.random() < 0.5 else b[i] for i in range(len(a))]


def run_ga(payload: Dict[str, Any]) -> Dict[str, Any]:
    started = time.perf_counter()
    constraints = payload.get("constraints", {}) or {}
    seed = int(to_number(constraints.get("random_seed")) or 123)
    population_size = max(6, int(to_number(constraints.get("population_size")) or 72))
    max_generations = max(1, int(to_number(constraints.get("max_generations")) or 120))
    mutation_rate = min(0.9, max(0.001, float(to_number(constraints.get("mutation_rate")) or 0.12)))
    max_runtime_seconds = max(1.0, float(to_number(constraints.get("max_runtime_seconds")) or 20.0))

    faculties = list(payload.get("faculty", []))
    offerings = list(payload.get("offerings", []))
    all_subjects = list(payload.get("subjects", []))
    # Only consider subjects explicitly marked ACTIVE for assignment
    active_subjects = [s for s in all_subjects if normalize_upper(s.get("subject_status")) == "ACTIVE"]
    inactive_subjects_list = [
        {
            "code": s.get("subject_code"),
            "title": s.get("subject_descriptive_title"),
            "curr_id": s.get("curr_id"),
        }
        for s in all_subjects
        if normalize_upper(s.get("subject_status")) != "ACTIVE"
    ]
    subject_index = build_subject_index(active_subjects)
    department_faculty_counts = build_department_count_map(payload.get("department_faculty_counts"))
    department_available_faculty_counts = build_department_count_map(payload.get("department_available_faculty_counts"))

    # Fallback for callers that do not provide counts.
    if not department_faculty_counts:
        for faculty in faculties:
            dept = int(to_number(faculty.get("department_id")) or 0)
            if dept <= 0:
                continue
            department_faculty_counts[dept] = department_faculty_counts.get(dept, 0) + 1
    if not department_available_faculty_counts:
        for faculty in faculties:
            dept = int(to_number(faculty.get("department_id")) or 0)
            if dept <= 0:
                continue
            department_available_faculty_counts[dept] = department_available_faculty_counts.get(dept, 0) + 1

    rng = random.Random(seed)

    if not faculties or not offerings:
        return {
            "assignments": [],
            "fitness_overall": 0.0,
            "fitness_hard": 0.0,
            "fitness_soft": 0.0,
            "generations": 0,
            "runtime_ms": int((time.perf_counter() - started) * 1000),
            "report": {
                "summary": "No faculty or course offerings were provided.",
                "faculty_load_balance": [],
                "faculty_free_units": [],
                "hard_violations": [],
                "soft_penalties": [],
                "schedule_fragmentation": {"faculty_with_scattered_schedule": []},
                "unassigned_subjects": [],
                "explainability": [],
                "conflicts": [],
                "inactive_subjects": inactive_subjects_list,
            },
            "run_id": payload.get("run_id") or "empty",
        }

    population = [build_initial_candidate(faculties, offerings, subject_index, rng, department_faculty_counts)]
    while len(population) < population_size:
        base = build_initial_candidate(faculties, offerings, subject_index, rng, department_faculty_counts)
        population.append(mutate(base, len(faculties), rng, min(0.35, mutation_rate * 1.6)))

    best = population[0]
    best_summary = summarize_candidate(
        best,
        faculties,
        offerings,
        subject_index,
        department_faculty_counts,
        department_available_faculty_counts,
    )
    best_score = best_summary["fitness_overall"]
    generation = 0
    stagnation = 0

    while generation < max_generations and (time.perf_counter() - started) < max_runtime_seconds:
        scored = []
        for cand in population:
            summary = summarize_candidate(
                cand,
                faculties,
                offerings,
                subject_index,
                department_faculty_counts,
                department_available_faculty_counts,
            )
            scored.append((summary["fitness_overall"], list(cand), summary))
        scored.sort(key=lambda x: (-x[0], x[1]))

        top_score, top_cand, top_summary = scored[0]
        if top_score > best_score:
            best_score = top_score
            best = top_cand
            best_summary = top_summary
            stagnation = 0
        else:
            stagnation += 1
        if stagnation >= 20:
            break

        elites = [c for _, c, _ in scored[: max(2, population_size // 6)]]
        next_pop = [list(c) for c in elites]
        while len(next_pop) < population_size:
            pa = rng.choice(elites)
            pb = rng.choice(elites)
            child = crossover(pa, pb, rng)
            child = mutate(child, len(faculties), rng, mutation_rate)
            next_pop.append(child)

        population = next_pop
        generation += 1

    result = summarize_candidate(
        best,
        faculties,
        offerings,
        subject_index,
        department_faculty_counts,
        department_available_faculty_counts,
    )
    result["generations"] = generation + 1
    result["runtime_ms"] = int((time.perf_counter() - started) * 1000)
    result["run_id"] = payload.get("run_id") or sha1(
        json.dumps({"seed": seed, "best": best, "count": len(offerings)}, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    result["constraints"] = {
        "population_size": population_size,
        "max_generations": max_generations,
        "mutation_rate": mutation_rate,
        "max_runtime_seconds": max_runtime_seconds,
        "random_seed": seed,
        "dry_run": bool(constraints.get("dry_run")),
    }
    # Attach list of inactive/skipped subjects for visibility in the GA report
    result.setdefault("report", {})["inactive_subjects"] = inactive_subjects_list
    return result


# ============================================================
# AUTOMATIC SCHEDULE GA
# Assigns time slots + rooms to subjects (MTH / TF patterns).
# Saturday is excluded from automation (user-defined only).
# ============================================================

SCHED_PATTERNS: List[Tuple[str, List[str]]] = [
    ("MTH", ["MON", "THU"]),
    ("TF",  ["TUE", "FRI"]),
]
SCHED_START_MIN = 7 * 60 + 30   # 450 — 7:30 AM
SCHED_END_MIN   = 20 * 60        # 1200 — 8:00 PM
SCHED_SLOT_STEP = 30             # 30-minute search increments


def sched_format_time(minutes: int) -> str:
    h24 = minutes // 60
    mm  = minutes % 60
    h12 = h24 % 12 or 12
    return f"{h12}:{mm:02d}"


def sched_duration(subject: Dict[str, Any]) -> int:
    """Per-day duration in minutes — total hours split equally over 2 days (S-H8/S-H12)."""
    lec   = to_number(subject.get("lec_hrs"))  or 0.0
    lab   = to_number(subject.get("lab_hrs"))  or 0.0
    total = lec + lab
    raw   = round((total / 2.0) * 60)
    return max(30, raw)


def sched_valid_starts(duration: int) -> List[int]:
    """All 30-min-boundary start times where start+duration ≤ SCHED_END_MIN."""
    return list(range(SCHED_START_MIN, SCHED_END_MIN - duration + 1, SCHED_SLOT_STEP))


def sched_is_lab_room(room: Dict[str, Any]) -> bool:
    return "LAB" in normalize_upper(room.get("room_type") or "")


def sched_needs_lab(subject: Dict[str, Any]) -> bool:
    return (to_number(subject.get("lab_hrs")) or 0.0) > 0.0


def sched_has_lec_and_lab(subject: Dict[str, Any]) -> bool:
    """True if subject has BOTH lecture AND laboratory hours > 0."""
    return (
        (to_number(subject.get("lec_hrs")) or 0.0) > 0.0
        and (to_number(subject.get("lab_hrs")) or 0.0) > 0.0
    )


# ---------------------------------------------------------------------------
# GYM exclusivity helpers
# ---------------------------------------------------------------------------

_PATHFIT_RE: re.Pattern = re.compile(r"path\s*fit", re.IGNORECASE)
_GYM_RE:     re.Pattern = re.compile(r"gym",        re.IGNORECASE)

#: PATH FIT classes from the same department allowed to share one GYM slot.
GYM_MAX_OVERLAP = 3


def is_pathfit_subject(subject: Dict[str, Any]) -> bool:
    """True when course_no contains 'PATH FIT' (case-insensitive, spaces/punctuation ignored)."""
    course_no = normalize_text(subject.get("course_no") or subject.get("subject_course_no"))
    return bool(_PATHFIT_RE.search(course_no))


def is_gym_room(room: Dict[str, Any]) -> bool:
    """True when room_name contains 'GYM' (case-insensitive)."""
    return bool(_GYM_RE.search(normalize_text(room.get("room_name") or "")))


# Gene = (pattern_idx: int, start_min: int, day1_room_idx: int, day2_room_idx: int)
# day1_room_idx = room assigned on the FIRST day of the pattern  (MON for MTH, TUE for TF)
# day2_room_idx = room assigned on the SECOND day of the pattern (THU for MTH, FRI for TF)
# R-H4: day1_room_idx == day2_room_idx → subject uses one room for both lec+lab (valid).
# S-S7: day1_room_idx != day2_room_idx → lecture room on day 1, lab room on day 2.
def _sched_pick_rooms(
    subject: Dict[str, Any], rooms: List[Dict[str, Any]], rng: random.Random
) -> Tuple[int, int]:
    """Return (day1_room_idx, day2_room_idx).

    GYM exclusivity:
    - PATH FIT subjects are confined to GYM rooms only (same room both days).
    - All other subjects must never be assigned to a GYM room.
    S-S7: non-PATH FIT subjects with both lec+lab hours prefer a lecture room
    on day 1 and a lab room on day 2. Single-type subjects use the same room
    on both days. R-H4: same room for both days is always valid.
    """
    if is_pathfit_subject(subject):
        # PATH FIT: GYM rooms only
        gym_pool = [i for i, r in enumerate(rooms) if is_gym_room(r)]
        pool = gym_pool if gym_pool else list(range(len(rooms)))
        r = rng.choice(pool)
        return (r, r)

    # Non-PATH FIT: exclude all GYM rooms
    lec_pool = [i for i, r in enumerate(rooms) if not sched_is_lab_room(r) and not is_gym_room(r)]
    lab_pool = [i for i, r in enumerate(rooms) if sched_is_lab_room(r) and not is_gym_room(r)]
    any_pool = [i for i in range(len(rooms)) if not is_gym_room(rooms[i])]
    if not any_pool:
        any_pool = list(range(len(rooms)))  # last-resort fallback

    if sched_has_lec_and_lab(subject):
        # S-S7: lecture room on day 1, lab room on day 2
        r1 = rng.choice(lec_pool) if lec_pool else rng.choice(any_pool)
        r2 = rng.choice(lab_pool) if lab_pool else rng.choice(any_pool)
    elif sched_needs_lab(subject):
        r = rng.choice(lab_pool) if lab_pool else rng.choice(any_pool)
        r1 = r2 = r
    else:
        r = rng.choice(lec_pool) if lec_pool else rng.choice(any_pool)
        r1 = r2 = r
    return (r1, r2)


def sched_random_gene(
    subject: Dict[str, Any],
    rooms: List[Dict[str, Any]],
    section_pattern_counts: Dict[str, Dict[int, int]],
    rng: random.Random,
) -> Tuple[int, int, int, int]:
    duration = sched_duration(subject)
    starts   = sched_valid_starts(duration)
    start    = rng.choice(starts) if starts else SCHED_START_MIN
    section  = _sec_key(subject)
    mth_c    = section_pattern_counts.get(section, {}).get(0, 0)
    tf_c     = section_pattern_counts.get(section, {}).get(1, 0)
    pat      = 0 if mth_c <= tf_c else 1          # balance MTH/TF per section (S-S11)
    r1, r2   = _sched_pick_rooms(subject, rooms, rng)
    return (pat, start, r1, r2)


def sched_init_random(
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    rng: random.Random,
) -> List[Tuple[int, int, int, int]]:
    spc: Dict[str, Dict[int, int]] = {}
    genes: List[Tuple[int, int, int, int]] = []
    for s in subjects:
        g   = sched_random_gene(s, rooms, spc, rng)
        sec = _sec_key(s)
        if sec not in spc:
            spc[sec] = {0: 0, 1: 0}
        spc[sec][g[0]] = spc[sec].get(g[0], 0) + 1
        genes.append(g)
    return genes


def sched_init_greedy(
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    rng: random.Random,
    pre_occ: Optional[Dict[str, Any]] = None,
) -> List[Tuple[int, int, int, int]]:
    """First-fit greedy chromosome satisfying all hard constraints (used as seed individual).

    S-S7: subjects with both lec+lab hours are assigned a lecture room on day 1
    and a lab room on day 2 of the pattern when possible.
    R-H4: same room for both days is always a valid fallback.
    """
    # room_slots[room_idx][day] = [(start, end), ...]
    room_slots: Dict[int, Dict[str, List[Tuple[int, int]]]] = {
        i: {d: [] for d in ("MON", "TUE", "THU", "FRI")} for i in range(len(rooms))
    }
    section_slots: Dict[str, Dict[str, List[Tuple[int, int]]]] = {}

    # Pre-populate slots from preserved (reserved) subjects so GA schedules around them
    if pre_occ:
        for room_idx, day, start, end in pre_occ.get("room_entries", []):
            if 0 <= room_idx < len(rooms):
                room_slots[room_idx].setdefault(day, []).append((start, end))
        for sec_key, day, start, end in pre_occ.get("section_entries", []):
            section_slots.setdefault(sec_key, {d: [] for d in ("MON", "TUE", "THU", "FRI")})[day].append((start, end))
    section_pattern_counts: Dict[str, Dict[int, int]] = {}
    gene_map: Dict[int, Tuple[int, int, int, int]] = {}

    lec_room_idxs = [i for i, r in enumerate(rooms) if not sched_is_lab_room(r)]
    lab_room_idxs = [i for i, r in enumerate(rooms) if sched_is_lab_room(r)]
    all_room_idxs = list(range(len(rooms)))

    # GYM exclusivity pools
    gym_room_idxs     = [i for i in all_room_idxs if is_gym_room(rooms[i])]
    gym_room_idxs_set = set(gym_room_idxs)
    non_gym_lec_idxs  = [i for i in lec_room_idxs if i not in gym_room_idxs_set]
    non_gym_lab_idxs  = [i for i in lab_room_idxs if i not in gym_room_idxs_set]
    non_gym_all_idxs  = [i for i in all_room_idxs if i not in gym_room_idxs_set]
    # Per-dept GYM slot tracker: gym_dept_slots[room_idx][day][dept_id] = [(start, end)]
    gym_dept_slots: Dict[int, Dict[str, Dict[int, List[Tuple[int, int]]]]] = {}

    def room_load(i: int) -> int:
        return sum(len(v) for v in room_slots[i].values())

    def sorted_by_load(pool: List[int]) -> List[int]:
        return sorted(pool, key=room_load)

    # Longer-duration subjects are harder to place — process them first
    ordered = sorted(enumerate(subjects), key=lambda x: -sched_duration(x[1]))

    for orig_idx, s in ordered:
        duration = sched_duration(s)
        starts   = sched_valid_starts(duration)
        section  = _sec_key(s)

        if section not in section_slots:
            section_slots[section] = {d: [] for d in ("MON", "TUE", "THU", "FRI")}
        if section not in section_pattern_counts:
            section_pattern_counts[section] = {0: 0, 1: 0}

        mth_c     = section_pattern_counts[section][0]
        tf_c      = section_pattern_counts[section][1]
        pat_order = [0, 1] if mth_c <= tf_c else [1, 0]   # balance MTH/TF (S-S11)

        has_both  = sched_has_lec_and_lab(s)
        needs_lab = sched_needs_lab(s)
        pathfit   = is_pathfit_subject(s)
        dept_id   = int(to_number(s.get("department_id")) or 0)

        assigned = False
        for pat_idx in pat_order:
            _, days = SCHED_PATTERNS[pat_idx]
            day1, day2 = days[0], days[1]

            # Build ordered (day1_room, day2_room) pairs to try.
            # GYM-EX: PATH FIT → GYM rooms only; non-PATH FIT → no GYM rooms.
            # S-S7: prefer (lecture_room, lab_room) for subjects with both types.
            # R-H4: same room for both days is always a valid fallback.
            if pathfit:
                pool = sorted_by_load(gym_room_idxs) if gym_room_idxs else sorted_by_load(all_room_idxs)
                pairs: List[Tuple[int, int]] = [(r, r) for r in pool]
            elif has_both:
                sl = sorted_by_load(non_gym_lec_idxs)[:4]
                sb = sorted_by_load(non_gym_lab_idxs)[:4]
                # Preferred: different rooms (lecture on day1, lab on day2)
                pairs = [
                    (r1, r2) for r1 in sl for r2 in sb if r1 != r2
                ]
                # R-H4 fallback: same room for both days
                seen = set(pairs)
                for r in sorted_by_load(non_gym_all_idxs or all_room_idxs):
                    if (r, r) not in seen:
                        pairs.append((r, r))
                        seen.add((r, r))
            elif needs_lab:
                pool = sorted_by_load(non_gym_lab_idxs) or sorted_by_load(non_gym_all_idxs or all_room_idxs)
                pairs = [(r, r) for r in pool]
            else:
                pool = sorted_by_load(non_gym_lec_idxs) or sorted_by_load(non_gym_all_idxs or all_room_idxs)
                pairs = [(r, r) for r in pool]

            for r1_idx, r2_idx in pairs:
                for start in starts:
                    end = start + duration
                    ok  = True

                    # R-H1 / GYM-EX overlap check
                    if pathfit and r1_idx in gym_room_idxs_set:
                        # GYM room: allow up to GYM_MAX_OVERLAP per dept on each day
                        d1_cnt = sum(
                            1 for rs, re in gym_dept_slots.get(r1_idx, {}).get(day1, {}).get(dept_id, [])
                            if start < re and end > rs
                        )
                        if d1_cnt >= GYM_MAX_OVERLAP:
                            ok = False
                        if ok:
                            d2_cnt = sum(
                                1 for rs, re in gym_dept_slots.get(r2_idx, {}).get(day2, {}).get(dept_id, [])
                                if start < re and end > rs
                            )
                            if d2_cnt >= GYM_MAX_OVERLAP:
                                ok = False
                    else:
                        # Standard binary no-overlap check
                        for rs, re in room_slots[r1_idx].get(day1, []):
                            if start < re and end > rs:
                                ok = False
                                break
                        if not ok:
                            continue
                        for rs, re in room_slots[r2_idx].get(day2, []):
                            if start < re and end > rs:
                                ok = False
                                break
                    if not ok:
                        continue

                    # S-H11: no section overlap (hard only — no 30-min buffer in greedy)
                    for day in days:
                        for ss, se in section_slots[section][day]:
                            if start < se and end > ss:
                                ok = False
                                break
                        if not ok:
                            break
                    if not ok:
                        continue

                    # S-S6: max 10 hrs total per day per section
                    for day in days:
                        total_day = sum(e - s_ for s_, e in section_slots[section][day])
                        if total_day + duration > 600:
                            ok = False
                            break
                    if not ok:
                        continue

                    # Assign — block day1_room on day1, day2_room on day2
                    room_slots[r1_idx][day1].append((start, end))
                    room_slots[r2_idx][day2].append((start, end))
                    # GYM-EX: update per-dept GYM tracker
                    if pathfit:
                        gym_dept_slots.setdefault(r1_idx, {}).setdefault(day1, {}).setdefault(dept_id, []).append((start, end))
                        if r1_idx != r2_idx or day1 != day2:
                            gym_dept_slots.setdefault(r2_idx, {}).setdefault(day2, {}).setdefault(dept_id, []).append((start, end))
                    for day in days:
                        section_slots[section][day].append((start, end))
                    section_pattern_counts[section][pat_idx] += 1
                    gene_map[orig_idx] = (pat_idx, start, r1_idx, r2_idx)
                    assigned = True
                    break
                if assigned:
                    break
            if assigned:
                break

        if not assigned:
            # Last resort: exhaustive search — any room, any pattern, ignoring room-type
            # preference (R-H2/S-S7) but still enforcing R-H1, GYM-EX, and S-H11.
            fb_duration = sched_duration(s)
            fb_starts   = sched_valid_starts(fb_duration)
            # Respect GYM exclusivity: PATH FIT → GYM rooms; others → non-GYM rooms
            fb_room_pool = (
                sorted_by_load(gym_room_idxs) if pathfit and gym_room_idxs
                else sorted_by_load(non_gym_all_idxs) if not pathfit and non_gym_all_idxs
                else sorted_by_load(all_room_idxs)
            )
            for fb_pat in [0, 1]:
                if assigned:
                    break
                _, fb_days = SCHED_PATTERNS[fb_pat]
                fb_day1, fb_day2 = fb_days[0], fb_days[1]
                for fb_start in fb_starts:
                    fb_end = fb_start + fb_duration
                    for fb_r in fb_room_pool:
                        ok = True
                        if pathfit and fb_r in gym_room_idxs_set:
                            # GYM room: allow up to GYM_MAX_OVERLAP per dept
                            d1_cnt = sum(
                                1 for rs, re in gym_dept_slots.get(fb_r, {}).get(fb_day1, {}).get(dept_id, [])
                                if fb_start < re and fb_end > rs
                            )
                            if d1_cnt >= GYM_MAX_OVERLAP:
                                ok = False
                            if ok:
                                d2_cnt = sum(
                                    1 for rs, re in gym_dept_slots.get(fb_r, {}).get(fb_day2, {}).get(dept_id, [])
                                    if fb_start < re and fb_end > rs
                                )
                                if d2_cnt >= GYM_MAX_OVERLAP:
                                    ok = False
                        else:
                            for rs, re in room_slots[fb_r][fb_day1]:
                                if fb_start < re and fb_end > rs:
                                    ok = False
                                    break
                            if not ok:
                                continue
                            for rs, re in room_slots[fb_r][fb_day2]:
                                if fb_start < re and fb_end > rs:
                                    ok = False
                                    break
                        if not ok:
                            continue
                        for fb_day in fb_days:
                            for ss, se in section_slots[section][fb_day]:
                                if fb_start < se and fb_end > ss:
                                    ok = False
                                    break
                            if not ok:
                                break
                        if not ok:
                            continue
                        # S-S6: also enforce daily load limit in exhaustive fallback
                        for fb_day in fb_days:
                            total_day = sum(e - s_ for s_, e in section_slots[section][fb_day])
                            if total_day + fb_duration > 600:
                                ok = False
                                break
                        if not ok:
                            continue
                        # Clean slot found — assign
                        room_slots[fb_r][fb_day1].append((fb_start, fb_end))
                        room_slots[fb_r][fb_day2].append((fb_start, fb_end))
                        if pathfit:
                            gym_dept_slots.setdefault(fb_r, {}).setdefault(fb_day1, {}).setdefault(dept_id, []).append((fb_start, fb_end))
                            if fb_day1 != fb_day2:
                                gym_dept_slots.setdefault(fb_r, {}).setdefault(fb_day2, {}).setdefault(dept_id, []).append((fb_start, fb_end))
                        for fb_day in fb_days:
                            section_slots[section][fb_day].append((fb_start, fb_end))
                        section_pattern_counts[section][fb_pat] = (
                            section_pattern_counts[section].get(fb_pat, 0) + 1
                        )
                        gene_map[orig_idx] = (fb_pat, fb_start, fb_r, fb_r)
                        assigned = True
                        break
                    if assigned:
                        break

        if not assigned:
            # Truly over-subscribed — minimal-damage random placement (will be flagged
            # as a hard violation and the GA will try to repair it via mutation).
            gene = sched_random_gene(s, rooms, section_pattern_counts, rng)
            gene_map[orig_idx] = gene
            rp_idx, rp_start, rp_r1, rp_r2 = gene
            rp_dur  = sched_duration(s)
            rp_end  = rp_start + rp_dur
            _, rp_days = SCHED_PATTERNS[rp_idx]
            rp_day1, rp_day2 = rp_days[0], rp_days[1]
            room_slots[rp_r1][rp_day1].append((rp_start, rp_end))
            room_slots[rp_r2][rp_day2].append((rp_start, rp_end))
            for day in rp_days:
                section_slots[section][day].append((rp_start, rp_end))
            section_pattern_counts[section][rp_idx] = (
                section_pattern_counts[section].get(rp_idx, 0) + 1
            )

    return [gene_map.get(i, (0, SCHED_START_MIN, 0, 0)) for i in range(len(subjects))]


def sched_evaluate(
    chromosome: List[Tuple[int, int, int, int]],
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    pre_occ: Optional[Dict[str, Any]] = None,
) -> Tuple[float, float, float]:
    """
    Evaluate a chromosome. Gene = (pattern_idx, start_min, day1_room_idx, day2_room_idx).
    Returns (overall 0–100, hard_score 0–100, soft_score 0–100).
    Implements: R-H1, R-H2, R-H3, R-H4, R-S1, S-H4, S-H5, S-H11,
                S-S1, S-S4, S-S5, S-S6, S-S7, S-S10, S-S11.
    """
    n = max(1, len(subjects))
    hard_violation_subs: set = set()   # distinct subject indices with ANY hard violation
    section_day_overload = 0           # S-S6 hard: section-day >10 hrs (bounded, separate)
    soft_penalty = 0.0

    # room_day_slots["{room_idx}|{day}"] = [(start, end, si), ...]  si=-1 for reserved
    room_day_slots: Dict[str, List[Tuple[int, int, int]]]    = {}
    # gym_room_day_slots: same key format, stores (start, end, si, dept_id) for GYM rooms
    gym_room_day_slots: Dict[str, List[Tuple[int, int, int, int]]] = {}
    section_day_slots: Dict[str, List[Tuple[int, int, int]]] = {}
    section_pattern_counts: Dict[str, Dict[int, int]]        = {}
    room_usage: Dict[int, int]                               = {}
    curr_day_count: Dict[str, int]                           = {}

    # Pre-populate from preserved subjects (si=-1 marks reserved — excluded from violation sets)
    if pre_occ:
        for room_idx, day, start, end in pre_occ.get("room_entries", []):
            room_day_slots.setdefault(f"{room_idx}|{day}", []).append((start, end, -1))
        for sec_key, day, start, end in pre_occ.get("section_entries", []):
            section_day_slots.setdefault(f"{sec_key}|{day}", []).append((start, end, -1))

    for si, gene in enumerate(chromosome):
        pat_idx, start, day1_room_idx, day2_room_idx = gene
        s         = subjects[si]
        duration  = sched_duration(s)
        end       = start + duration
        _, days   = SCHED_PATTERNS[pat_idx]
        day1, day2 = days[0], days[1]
        section   = _sec_key(s)
        curr_id   = int(to_number(s.get("curr_id")) or 0)
        same_room = (day1_room_idx == day2_room_idx)

        # S-H4 / S-H5: time bounds — hard (1 violation per subject)
        if start < SCHED_START_MIN or end > SCHED_END_MIN:
            hard_violation_subs.add(si)

        # --- Room validity and type checks (R-H2, R-H3, R-H4, S-S7) ---
        day1_room = rooms[day1_room_idx] if 0 <= day1_room_idx < len(rooms) else None
        day2_room = rooms[day2_room_idx] if 0 <= day2_room_idx < len(rooms) else None

        pathfit_s = is_pathfit_subject(s)
        dept_id_s = int(to_number(s.get("department_id")) or 0)

        if day1_room is None or day2_room is None:
            hard_violation_subs.add(si)
        else:
            has_both  = sched_has_lec_and_lab(s)
            needs_lab = sched_needs_lab(s)
            d1_is_lab = sched_is_lab_room(day1_room)
            d2_is_lab = sched_is_lab_room(day2_room)
            d1_is_gym = is_gym_room(day1_room)
            d2_is_gym = is_gym_room(day2_room)

            if has_both:
                # S-S7: day1 = lecture room, day2 = lab room.
                # R-H4: same room for both days is explicitly allowed — no penalty.
                if not same_room:
                    if d1_is_lab:      # lecture scheduled in lab room on day 1
                        soft_penalty += 1.0
                    if not d2_is_lab:  # lab scheduled in lecture room on day 2
                        soft_penalty += 1.0
            elif needs_lab:
                # R-H2 / S-H7: lab-only subject must use lab rooms
                if not d1_is_lab:
                    soft_penalty += 2.0
                if not same_room and not d2_is_lab:
                    soft_penalty += 2.0
            else:
                # R-H3: lecture-only subject in lab room = overflow (allowed but penalised)
                if d1_is_lab:
                    soft_penalty += 0.5
                if not same_room and d2_is_lab:
                    soft_penalty += 0.5

            # GYM-EX: hard constraint — PATH FIT ↔ GYM rooms exclusively
            if pathfit_s:
                if not d1_is_gym or not d2_is_gym:
                    hard_violation_subs.add(si)   # PATH FIT assigned to non-GYM room
            else:
                if d1_is_gym or d2_is_gym:
                    hard_violation_subs.add(si)   # non-PATH FIT assigned to GYM room

            # Track GYM slots separately for per-dept overlap evaluation (R-GYM)
            if d1_is_gym:
                gym_room_day_slots.setdefault(f"{day1_room_idx}|{day1}", []).append(
                    (start, end, si, dept_id_s)
                )
            if d2_is_gym and (day2_room_idx != day1_room_idx or day2 != day1):
                gym_room_day_slots.setdefault(f"{day2_room_idx}|{day2}", []).append(
                    (start, end, si, dept_id_s)
                )

        room_usage[day1_room_idx] = room_usage.get(day1_room_idx, 0) + 1
        if not same_room:
            room_usage[day2_room_idx] = room_usage.get(day2_room_idx, 0) + 1

        # S-S1: prefer 7:30AM — max 1.0 pts per subject when placed at 8:00PM
        time_span = max(1, SCHED_END_MIN - SCHED_START_MIN - duration)
        soft_penalty += (start - SCHED_START_MIN) / time_span * 1.0

        # Track per-room-per-day slots: day1 uses day1_room, day2 uses day2_room
        room_day_slots.setdefault(f"{day1_room_idx}|{day1}", []).append((start, end, si))
        room_day_slots.setdefault(f"{day2_room_idx}|{day2}", []).append((start, end, si))

        for day in days:
            section_day_slots.setdefault(f"{section}|{day}", []).append((start, end, si))
            curr_day_count[f"{curr_id}|{day}"] = curr_day_count.get(f"{curr_id}|{day}", 0) + 1

        if section not in section_pattern_counts:
            section_pattern_counts[section] = {0: 0, 1: 0}
        section_pattern_counts[section][pat_idx] = (
            section_pattern_counts[section].get(pat_idx, 0) + 1
        )

    # R-H1: room conflicts for non-GYM rooms — sweep-line to catch ALL overlaps,
    # including non-adjacent pairs (e.g. a long slot A overlapping short B and later C).
    # GYM rooms are handled separately by R-GYM below.
    for rk, slots in room_day_slots.items():
        ri_str = rk.split("|")[0]
        ri_int = int(ri_str) if ri_str.isdigit() else -1
        if 0 <= ri_int < len(rooms) and is_gym_room(rooms[ri_int]):
            continue  # GYM room conflicts handled in R-GYM
        events: List[Tuple[int, int, int]] = []
        for s_, e_, si_ in slots:
            events.append((s_,  1, si_))   # slot opens
            events.append((e_, -1, si_))   # slot closes
        # Sort: closes (-1) before opens (+1) at the same timestamp so touching
        # intervals (end == next start) are not counted as overlapping.
        events.sort(key=lambda x: (x[0], x[1]))
        active: Set[int] = set()
        for _t, delta, si_ in events:
            if delta == 1:
                active.add(si_)
                if len(active) > 1:
                    # All currently open slots overlap — mark GA-scheduled ones.
                    for asi in active:
                        if asi >= 0:
                            hard_violation_subs.add(asi)
            else:
                active.discard(si_)

    # R-GYM: GYM rooms allow up to GYM_MAX_OVERLAP PATH FIT classes per dept per slot.
    # Excess simultaneous subjects (per dept) are hard violations.
    for slots in gym_room_day_slots.values():
        dept_slots_map: Dict[int, List[Tuple[int, int, int]]] = {}
        for s_, e_, si_, dept_id_ in slots:
            dept_slots_map.setdefault(dept_id_, []).append((s_, e_, si_))
        for dept_si_list in dept_slots_map.values():
            # Sweep-line: closes (-1) sort before opens (+1) at equal timestamps
            # so touching intervals (end == start) are not counted as overlapping.
            events: List[Tuple[int, int, int]] = []
            for s_, e_, si_ in dept_si_list:
                events.append((s_,  1, si_))   # open
                events.append((e_, -1, si_))   # close
            events.sort(key=lambda x: (x[0], x[1]))
            active: Set[int] = set()
            for _t, delta, si_ in events:
                if delta == 1:
                    active.add(si_)
                    if len(active) > GYM_MAX_OVERLAP:
                        for asi in active:
                            hard_violation_subs.add(asi)
                else:
                    active.discard(si_)

    # S-H11: section conflicts — hard.
    # S-S4: <30-min break between section classes — soft (0.5/pair).
    # S-S5: >5 consecutive hours without a break — soft (1.0/run violation).
    for slots in section_day_slots.values():
        ss = sorted(slots, key=lambda x: x[0])
        if not ss:
            continue
        run_start = ss[0][0]
        run_end   = ss[0][1]
        for i in range(1, len(ss)):
            ps, pe, _ = ss[i - 1]
            cs, ce, _ = ss[i]
            if cs < pe:
                # S-H11: hard overlap — only flag GA-scheduled subjects (si >= 0)
                if ss[i][2] >= 0:
                    hard_violation_subs.add(ss[i][2])
                if ss[i - 1][2] >= 0:
                    hard_violation_subs.add(ss[i - 1][2])
                run_end = max(run_end, ce)
            else:
                gap = cs - pe
                if gap < 30:
                    # S-S4: break is less than 30 minutes
                    soft_penalty += 0.5
                    run_end = ce  # still consecutive (gap < 30 → same run)
                else:
                    # Genuine break: evaluate the completed run for S-S5
                    if (run_end - run_start) > 5 * 60:  # > 300 minutes
                        soft_penalty += 1.0
                    run_start = cs
                    run_end   = ce
        # Check the final run for S-S5
        if (run_end - run_start) > 5 * 60:
            soft_penalty += 1.0

    # S-S6: daily load — hard if > 10 hrs, soft if 8–10 hrs (0.5 per section-day)
    # Counted separately (bounded by sections × days, typically small).
    for slots in section_day_slots.values():
        total_min = sum(e - s_ for s_, e, _ in slots)
        if total_min > 10 * 60:
            section_day_overload += 1
        elif total_min > 8 * 60:
            soft_penalty += 0.5

    # R-S1: even room distribution — soft using mean absolute deviation
    if room_usage and len(room_usage) > 1:
        avg = sum(room_usage.values()) / len(room_usage)
        if avg > 0:
            mad = sum(abs(c - avg) for c in room_usage.values()) / len(room_usage)
            soft_penalty += (mad / avg) * len(room_usage) * 0.2

    # S-S11: MTH/TF balance per section — 0.2 pts per unit of imbalance
    for counts in section_pattern_counts.values():
        total_sec = counts.get(0, 0) + counts.get(1, 0)
        if total_sec > 1:
            soft_penalty += abs(counts.get(0, 0) - counts.get(1, 0)) * 0.2

    # S-S10: curriculum spread — 0.1 pts per subject over 3 per curriculum-day
    for cnt in curr_day_count.values():
        if cnt > 3:
            soft_penalty += (cnt - 3) * 0.1

    hard_violations = len(hard_violation_subs) + section_day_overload
    hard_score = max(0.0, 100.0 * (1.0 - hard_violations / n))
    soft_score = max(0.0, 100.0 - soft_penalty / n * 5.0)
    overall    = max(0.0, min(100.0, hard_score * 0.75 + soft_score * 0.25))
    return overall, hard_score, soft_score


def sched_mutate(
    chromosome: List[Tuple[int, int, int, int]],
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    rng: random.Random,
    mutation_rate: float,
) -> List[Tuple[int, int, int, int]]:
    result = list(chromosome)
    for i in range(len(result)):
        if rng.random() > mutation_rate:
            continue
        pat, start, r1, r2 = result[i]
        s        = subjects[i]
        mut_type = rng.randint(0, 3)

        if mut_type == 0:
            pat = 1 - pat                               # flip pattern
        elif mut_type == 1:
            duration = sched_duration(s)
            starts   = sched_valid_starts(duration)
            if starts:
                cur_i  = starts.index(start) if start in starts else 0
                delta  = rng.choice([-3, -2, -1, 1, 2, 3])
                new_i  = max(0, min(len(starts) - 1, cur_i + delta))
                start  = starts[new_i]
        elif mut_type == 2:
            new_r1, _ = _sched_pick_rooms(s, rooms, rng)  # mutate day1 room
            r1 = new_r1
        else:
            _, new_r2 = _sched_pick_rooms(s, rooms, rng)  # mutate day2 room
            r2 = new_r2

        result[i] = (pat, start, r1, r2)
    return result


def sched_crossover(
    a: List[Tuple[int, int, int, int]],
    b: List[Tuple[int, int, int, int]],
    subjects: List[Dict[str, Any]],
    rng: random.Random,
) -> List[Tuple[int, int, int, int]]:
    """Section-aware crossover: swap ALL genes for each section as a unit.

    Gene-by-gene uniform crossover creates S-H11 section conflicts by mixing
    time slots from two parents within the same section.  Swapping whole sections
    preserves intra-section coherence (same pattern, balanced daily load) while
    still combining solutions across sections.
    """
    # Group subject indices by section
    section_indices: Dict[str, List[int]] = {}
    for i, s in enumerate(subjects):
        sec = _sec_key(s)
        section_indices.setdefault(sec, []).append(i)

    child = list(a)  # start as clone of parent A
    for indices in section_indices.values():
        if rng.random() < 0.5:
            for idx in indices:
                child[idx] = b[idx]  # take entire section from parent B
    return child


def sched_chromosome_to_assignments(
    chromosome: List[Tuple[int, int, int, int]],
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Convert a chromosome to assignment dicts.

    R-H4 / S-S7: when day1_room == day2_room the room_id is stored as a single
    integer string (e.g. "3"). When they differ (lecture on day 1, lab on day 2)
    the room_id is stored as slash-separated integers (e.g. "3/5"), which the DB
    constraint allows: ^[0-9]+(/[0-9]+)*$.
    """
    result: List[Dict[str, Any]] = []
    for si, gene in enumerate(chromosome):
        pat_idx, start, day1_room_idx, day2_room_idx = gene
        s         = subjects[si]
        duration  = sched_duration(s)
        end       = start + duration
        pat_name, _ = SCHED_PATTERNS[pat_idx]
        same_room = (day1_room_idx == day2_room_idx)

        day1_room = rooms[day1_room_idx] if 0 <= day1_room_idx < len(rooms) else None
        day2_room = rooms[day2_room_idx] if 0 <= day2_room_idx < len(rooms) else None

        day1_room_id   = day1_room["room_id"] if day1_room else None
        day2_room_id   = day2_room["room_id"] if day2_room else None
        day1_room_name = normalize_text(day1_room.get("room_name")) if day1_room else ""
        day2_room_name = normalize_text(day2_room.get("room_name")) if day2_room else ""

        if same_room or day1_room_id == day2_room_id:
            # R-H4: single room for both days
            encoded_room_id   = str(day1_room_id) if day1_room_id is not None else None
            encoded_room_name = day1_room_name
        else:
            # S-S7: different rooms — slash-separated (lecture_room/lab_room)
            ids = [str(day1_room_id), str(day2_room_id)]
            encoded_room_id   = "/".join(x for x in ids if x and x != "None") or None
            names = [day1_room_name, day2_room_name]
            encoded_room_name = " / ".join(x for x in names if x).strip(" /")

        sched_txt = f"{sched_format_time(start)}-{sched_format_time(end)}"

        row: Dict[str, Any] = {
            "subject_id":        to_number(s.get("subject_id")),
            "source_subject_id": to_number(s.get("subject_id")),
            "curr_id":           to_number(s.get("curr_id")),
            "code":              normalize_text(s.get("code") or s.get("subject_code")),
            "course_no":         normalize_text(s.get("course_no") or s.get("subject_course_no")),
            "department_id":     to_number(s.get("department_id")),
            "section":           normalize_text(s.get("section") or s.get("subject_section")),
            "descriptive_title": normalize_text(s.get("descriptive_title") or s.get("subject_descriptive_title")),
            "units":             to_number(s.get("units") or s.get("subject_units")),
            "lec_hrs":           to_number(s.get("lec_hrs")),
            "lab_hrs":           to_number(s.get("lab_hrs")),
            "merged":            False,
        }
        if pat_name == "MTH":
            row["mth_schedule"]  = sched_txt
            row["mth_room_id"]   = encoded_room_id
            row["mth_room_name"] = encoded_room_name
            row["tfs_schedule"]  = None
            row["tfs_room_id"]   = None
            row["tfs_room_name"] = None
        else:
            row["tfs_schedule"]  = sched_txt
            row["tfs_room_id"]   = encoded_room_id
            row["tfs_room_name"] = encoded_room_name
            row["mth_schedule"]  = None
            row["mth_room_id"]   = None
            row["mth_room_name"] = None
        result.append(row)
    return result


def sched_build_conflict_report(
    chromosome: List[Tuple[int, int, int, int]],
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    pre_occ: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Build a list of room and section conflicts from the best chromosome.

    Tracks per-day rooms correctly: day1_room_idx on day1, day2_room_idx on day2.
    pre_occ entries are seeded with label "_reserved_" so conflicts between new
    GA assignments and preserved subjects are detected consistently with sched_evaluate.
    """
    conflicts: List[Dict[str, Any]] = []
    # Non-GYM rooms: standard slot tracking
    room_day: Dict[str, List[Tuple[int, int, str]]]    = {}
    # GYM rooms: per-dept tracking with (start, end, label, dept_id)
    gym_room_day_dept: Dict[str, List[Tuple[int, int, str, int]]] = {}
    section_day: Dict[str, List[Tuple[int, int, str]]] = {}

    # Pre-populate from reserved (preserved) subjects using the same pre_occ structure
    # as sched_evaluate so the conflict report is consistent with the fitness function.
    if pre_occ:
        for room_idx, day, start, end in pre_occ.get("room_entries", []):
            room_day.setdefault(f"{room_idx}|{day}", []).append((start, end, "_reserved_"))
        for sec_key, day, start, end in pre_occ.get("section_entries", []):
            section_day.setdefault(f"{sec_key}|{day}", []).append((start, end, "_reserved_"))

    for si, gene in enumerate(chromosome):
        pat_idx, start, day1_room_idx, day2_room_idx = gene
        s        = subjects[si]
        duration = sched_duration(s)
        end      = start + duration
        _, days  = SCHED_PATTERNS[pat_idx]
        day1, day2 = days[0], days[1]
        sec_name  = normalize_upper(s.get("section") or "")
        section   = _sec_key(s)
        label     = f"{s.get('code','?')}-{s.get('course_no','?')}-{sec_name}"
        pathfit_s = is_pathfit_subject(s)
        dept_id_s = int(to_number(s.get("department_id")) or 0)

        day1_room = rooms[day1_room_idx] if 0 <= day1_room_idx < len(rooms) else None
        day2_room = rooms[day2_room_idx] if 0 <= day2_room_idx < len(rooms) else None

        # GYM-EX: report assignments that violate the exclusivity rule
        if day1_room is not None:
            d1_is_gym = is_gym_room(day1_room)
            if pathfit_s and not d1_is_gym:
                conflicts.append({
                    "type": "gym_exclusivity",
                    "subject": label,
                    "room": day1_room.get("room_name", "?"),
                    "problem": f"PATH FIT subject {label} assigned to non-GYM room on day1",
                })
            elif not pathfit_s and d1_is_gym:
                conflicts.append({
                    "type": "gym_exclusivity",
                    "subject": label,
                    "room": day1_room.get("room_name", "?"),
                    "problem": f"Non-PATH FIT subject {label} assigned to GYM room on day1",
                })
        if day2_room is not None and day2_room_idx != day1_room_idx:
            d2_is_gym = is_gym_room(day2_room)
            if pathfit_s and not d2_is_gym:
                conflicts.append({
                    "type": "gym_exclusivity",
                    "subject": label,
                    "room": day2_room.get("room_name", "?"),
                    "problem": f"PATH FIT subject {label} assigned to non-GYM room on day2",
                })
            elif not pathfit_s and d2_is_gym:
                conflicts.append({
                    "type": "gym_exclusivity",
                    "subject": label,
                    "room": day2_room.get("room_name", "?"),
                    "problem": f"Non-PATH FIT subject {label} assigned to GYM room on day2",
                })

        # Track per-day rooms (GYM vs. non-GYM separately)
        d1_gym = day1_room is not None and is_gym_room(day1_room)
        d2_gym = day2_room is not None and is_gym_room(day2_room)
        if d1_gym:
            gym_room_day_dept.setdefault(f"{day1_room_idx}|{day1}|{dept_id_s}", []).append(
                (start, end, label, dept_id_s)
            )
        else:
            room_day.setdefault(f"{day1_room_idx}|{day1}", []).append((start, end, label))
        if d2_gym:
            gym_room_day_dept.setdefault(f"{day2_room_idx}|{day2}|{dept_id_s}", []).append(
                (start, end, label, dept_id_s)
            )
        else:
            room_day.setdefault(f"{day2_room_idx}|{day2}", []).append((start, end, label))
        for day in days:
            section_day.setdefault(f"{section}|{day}", []).append((start, end, label))

    # Standard room conflict for non-GYM rooms — sweep-line to catch all overlaps.
    for rk, slots in room_day.items():
        ri, day = rk.split("|", 1)
        rn = rooms[int(ri)].get("room_name", "?") if int(ri) < len(rooms) else "?"
        evts_r: List[Tuple[int, int, str]] = []
        for s_, e_, lbl_ in slots:
            evts_r.append((s_,  1, lbl_))
            evts_r.append((e_, -1, lbl_))
        evts_r.sort(key=lambda x: (x[0], x[1]))
        act_r_lbl: Set[str] = set()
        for _t, delta, lbl_ in evts_r:
            if delta == 1:
                act_r_lbl.add(lbl_)
                if len(act_r_lbl) > 1:
                    conflicts.append({
                        "type": "room_conflict", "day": day, "room": rn,
                        "subjects": sorted(act_r_lbl),
                        "problem": f"Room overlap in {rn} on {day}: {', '.join(sorted(act_r_lbl))}",
                    })
            else:
                act_r_lbl.discard(lbl_)

    # GYM room conflict: per-dept sweep-line — report when > GYM_MAX_OVERLAP overlap
    for rk, slots in gym_room_day_dept.items():
        parts = rk.split("|")
        ri_int = int(parts[0]) if parts[0].isdigit() else -1
        day    = parts[1]
        rn     = rooms[ri_int].get("room_name", "?") if 0 <= ri_int < len(rooms) else "?"
        evts = [(s_, 1, lbl_) for s_, e_, lbl_, _ in slots] + [(e_, -1, lbl_) for s_, e_, lbl_, _ in slots]
        evts.sort(key=lambda x: (x[0], x[1]))
        act_labels: List[str] = []
        for _t, delta, lbl_ in evts:
            if delta == 1:
                act_labels.append(lbl_)
                if len(act_labels) > GYM_MAX_OVERLAP:
                    conflicts.append({
                        "type": "gym_capacity",
                        "day": day,
                        "room": rn,
                        "subjects": list(act_labels),
                        "problem": (
                            f"GYM room {rn} has {len(act_labels)} overlapping PATH FIT classes "
                            f"on {day} (limit {GYM_MAX_OVERLAP} per department)"
                        ),
                    })
            else:
                if lbl_ in act_labels:
                    act_labels.remove(lbl_)

    for sk, slots in section_day.items():
        sec, day = sk.rsplit("|", 1)
        evts_s: List[Tuple[int, int, str]] = []
        for s_, e_, lbl_ in slots:
            evts_s.append((s_,  1, lbl_))
            evts_s.append((e_, -1, lbl_))
        evts_s.sort(key=lambda x: (x[0], x[1]))
        act_s_lbl: Set[str] = set()
        for _t, delta, lbl_ in evts_s:
            if delta == 1:
                act_s_lbl.add(lbl_)
                if len(act_s_lbl) > 1:
                    conflicts.append({
                        "type": "section_conflict", "day": day, "section": sec,
                        "subjects": sorted(act_s_lbl),
                        "problem": f"Section overlap on {day}: {', '.join(sorted(act_s_lbl))}",
                    })
            else:
                act_s_lbl.discard(lbl_)

    # S-S6: section-day total exceeds 10-hour hard limit
    for sk, slots in section_day.items():
        total_min = sum(e - s_ for s_, e, _ in slots)
        if total_min > 10 * 60:
            sec, day = sk.rsplit("|", 1)
            all_labels = [x[2] for x in sorted(slots, key=lambda x: x[0])]
            conflicts.append({
                "type": "section_overload",
                "day": day,
                "section": sec,
                "total_hours": round(total_min / 60, 1),
                "subjects": all_labels,
                "problem": (
                    f"Section {sec} exceeds 10-hr daily limit on {day}: "
                    f"{round(total_min / 60, 1)} hrs scheduled"
                ),
            })

    return conflicts


def sched_local_repair(
    chromosome: List[Tuple[int, int, int, int]],
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    rng: random.Random,
    max_passes: int = 5,
    time_limit_s: float = 10.0,
    pre_occ: Optional[Dict[str, Any]] = None,
) -> List[Tuple[int, int, int, int]]:
    """Post-GA local repair: iteratively re-place conflicted subjects greedily.

    For each pass:
      1. Detect which subject indices participate in any room or section conflict.
      2. Remove those subjects from the slot-tracking state.
      3. Re-place each conflicted subject by searching ALL rooms × patterns × starts
         for the first conflict-free slot.
    Repeats until fully resolved or max_passes / time_limit reached.
    """
    repair_start = time.perf_counter()
    chrom    = list(chromosome)
    n_rooms  = len(rooms)
    all_ridxs = list(range(n_rooms))
    # GYM-EX: pre-compute room sets
    gym_ridxs_set = {i for i in all_ridxs if is_gym_room(rooms[i])}
    gym_ridxs     = sorted(gym_ridxs_set)
    non_gym_ridxs = [i for i in all_ridxs if i not in gym_ridxs_set]

    for _pass in range(max_passes):
        if time.perf_counter() - repair_start >= time_limit_s:
            break

        # ── Step 1: detect conflicted subjects ─────────────────────────────
        viol_subs: set = set()
        # Non-GYM room conflicts: standard pair-overlap check  (si=-1 for reserved)
        room_day_slots: Dict[str, List[Tuple[int, int, int]]] = {}
        # GYM room conflicts: per-dept sweep-line (allows up to GYM_MAX_OVERLAP per dept)
        gym_room_dept_day_slots: Dict[str, List[Tuple[int, int, int]]] = {}
        sec_day_slots:  Dict[str, List[Tuple[int, int, int]]] = {}

        # Pre-populate Step 1 tracking with reserved slots (si=-1)
        if pre_occ:
            for room_idx, day, start, end in pre_occ.get("room_entries", []):
                room_day_slots.setdefault(f"{room_idx}|{day}", []).append((start, end, -1))
            for sec_key, day, start, end in pre_occ.get("section_entries", []):
                sec_day_slots.setdefault(f"{sec_key}|{day}", []).append((start, end, -1))

        for si, gene in enumerate(chrom):
            pat_idx, start, r1, r2 = gene
            s        = subjects[si]
            duration = sched_duration(s)
            end      = start + duration
            _, days  = SCHED_PATTERNS[pat_idx]
            day1, day2 = days[0], days[1]
            section  = _sec_key(s)
            dept_id  = int(to_number(s.get("department_id")) or 0)
            if r1 in gym_ridxs_set:
                gym_room_dept_day_slots.setdefault(f"{r1}|{day1}|{dept_id}", []).append((start, end, si))
            else:
                room_day_slots.setdefault(f"{r1}|{day1}", []).append((start, end, si))
            if r2 in gym_ridxs_set:
                gym_room_dept_day_slots.setdefault(f"{r2}|{day2}|{dept_id}", []).append((start, end, si))
            else:
                room_day_slots.setdefault(f"{r2}|{day2}", []).append((start, end, si))
            for day in days:
                sec_day_slots.setdefault(f"{section}|{day}", []).append((start, end, si))

        for slots in room_day_slots.values():
            evts: List[Tuple[int, int, int]] = []
            for s_, e_, si_ in slots:
                evts.append((s_,  1, si_))
                evts.append((e_, -1, si_))
            evts.sort(key=lambda x: (x[0], x[1]))
            act_r: Set[int] = set()
            for _t, delta, si_ in evts:
                if delta == 1:
                    act_r.add(si_)
                    if len(act_r) > 1:
                        for asi in act_r:
                            if asi >= 0:
                                viol_subs.add(asi)
                else:
                    act_r.discard(si_)

        # GYM: sweep-line per (room, day, dept) — flag subjects over GYM_MAX_OVERLAP
        for gym_slots in gym_room_dept_day_slots.values():
            evts = [(s_, 1, si_) for s_, e_, si_ in gym_slots] + [(e_, -1, si_) for s_, e_, si_ in gym_slots]
            evts.sort(key=lambda x: (x[0], x[1]))
            act: set = set()
            for _t, delta, si_ in evts:
                if delta == 1:
                    act.add(si_)
                    if len(act) > GYM_MAX_OVERLAP:
                        for asi in act:
                            viol_subs.add(asi)
                else:
                    act.discard(si_)

        for slots in sec_day_slots.values():
            ss = sorted(slots, key=lambda x: x[0])
            for i in range(1, len(ss)):
                if ss[i][0] < ss[i - 1][1]:
                    if ss[i][2] >= 0:
                        viol_subs.add(ss[i][2])
                    if ss[i - 1][2] >= 0:
                        viol_subs.add(ss[i - 1][2])

        # S-S6: detect section-day overloads — evict shortest GA subjects from overloaded days
        for slots in sec_day_slots.values():
            total_min = sum(e - s_ for s_, e, _ in slots)
            if total_min > 600:
                # Evict shortest GA-schedulable subjects (skip reserved si=-1)
                sorted_by_dur = sorted(
                    [x for x in slots if x[2] >= 0], key=lambda x: x[1] - x[0]
                )
                excess = total_min - 600
                for s_, e, si in sorted_by_dur:
                    if excess <= 0:
                        break
                    viol_subs.add(si)
                    excess -= (e - s_)

        if not viol_subs:
            break   # fully repaired

        # ── Step 2: rebuild tracking WITHOUT conflicted subjects ────────────
        room_track: Dict[int, Dict[str, List[Tuple[int, int]]]] = {}
        sec_track:  Dict[str, Dict[str, List[Tuple[int, int]]]] = {}
        # GYM per-dept tracker for PATH FIT subjects
        gym_dept_track: Dict[int, Dict[str, Dict[int, List[Tuple[int, int]]]]] = {}

        # Seed Step 2 tracking with reserved slots so repair candidates avoid them
        if pre_occ:
            for room_idx, day, start, end in pre_occ.get("room_entries", []):
                room_track.setdefault(room_idx, {}).setdefault(day, []).append((start, end))
            for sec_key, day, start, end in pre_occ.get("section_entries", []):
                sec_track.setdefault(sec_key, {}).setdefault(day, []).append((start, end))

        for si, gene in enumerate(chrom):
            if si in viol_subs:
                continue
            pat_idx, start, r1, r2 = gene
            s        = subjects[si]
            duration = sched_duration(s)
            end      = start + duration
            _, days  = SCHED_PATTERNS[pat_idx]
            day1, day2 = days[0], days[1]
            section  = _sec_key(s)
            dept_id  = int(to_number(s.get("department_id")) or 0)
            pathfit  = is_pathfit_subject(s)
            room_track.setdefault(r1, {}).setdefault(day1, []).append((start, end))
            room_track.setdefault(r2, {}).setdefault(day2, []).append((start, end))
            if pathfit:
                if r1 in gym_ridxs_set:
                    gym_dept_track.setdefault(r1, {}).setdefault(day1, {}).setdefault(dept_id, []).append((start, end))
                if r2 in gym_ridxs_set and (r1 != r2 or day1 != day2):
                    gym_dept_track.setdefault(r2, {}).setdefault(day2, {}).setdefault(dept_id, []).append((start, end))
            for day in days:
                sec_track.setdefault(section, {}).setdefault(day, []).append((start, end))

        # ── Step 3: re-place each conflicted subject greedily ──────────────
        to_place = list(viol_subs)
        rng.shuffle(to_place)
        for si in to_place:
            s        = subjects[si]
            section  = _sec_key(s)
            duration = sched_duration(s)
            starts   = sched_valid_starts(duration)
            pathfit  = is_pathfit_subject(s)
            dept_id  = int(to_number(s.get("department_id")) or 0)
            placed   = False
            # GYM-EX: restrict room candidates by subject type
            if pathfit:
                valid_ridxs = gym_ridxs if gym_ridxs else all_ridxs
            else:
                valid_ridxs = non_gym_ridxs if non_gym_ridxs else all_ridxs
            room_order = rng.sample(valid_ridxs, len(valid_ridxs))
            for pat_idx in rng.sample([0, 1], 2):        # random pattern order
                if placed: break
                _, days = SCHED_PATTERNS[pat_idx]
                day1, day2 = days[0], days[1]
                for start in starts:
                    if placed: break
                    end = start + duration
                    for r in room_order:
                        ok = True
                        # GYM-EX: per-dept overlap check for GYM rooms
                        if pathfit and r in gym_ridxs_set:
                            d1_cnt = sum(
                                1 for rs, re in gym_dept_track.get(r, {}).get(day1, {}).get(dept_id, [])
                                if start < re and end > rs
                            )
                            if d1_cnt >= GYM_MAX_OVERLAP:
                                ok = False
                            if ok:
                                d2_cnt = sum(
                                    1 for rs, re in gym_dept_track.get(r, {}).get(day2, {}).get(dept_id, [])
                                    if start < re and end > rs
                                )
                                if d2_cnt >= GYM_MAX_OVERLAP:
                                    ok = False
                        else:
                            for rs, re in room_track.get(r, {}).get(day1, []):
                                if start < re and end > rs: ok = False; break
                            if not ok: continue
                            for rs, re in room_track.get(r, {}).get(day2, []):
                                if start < re and end > rs: ok = False; break
                        if not ok: continue
                        for day in days:
                            for ss, se in sec_track.get(section, {}).get(day, []):
                                if start < se and end > ss: ok = False; break
                            if not ok: break
                        if not ok: continue
                        # S-S6: enforce daily load limit during repair re-placement
                        for day in days:
                            total_day = sum(e_ - s_ for s_, e_ in sec_track.get(section, {}).get(day, []))
                            if total_day + duration > 600: ok = False; break
                        if not ok: continue
                        # Valid same-room slot found
                        room_track.setdefault(r, {}).setdefault(day1, []).append((start, end))
                        room_track.setdefault(r, {}).setdefault(day2, []).append((start, end))
                        if pathfit and r in gym_ridxs_set:
                            gym_dept_track.setdefault(r, {}).setdefault(day1, {}).setdefault(dept_id, []).append((start, end))
                            if day1 != day2:
                                gym_dept_track.setdefault(r, {}).setdefault(day2, {}).setdefault(dept_id, []).append((start, end))
                        for day in days:
                            sec_track.setdefault(section, {}).setdefault(day, []).append((start, end))
                        chrom[si] = (pat_idx, start, r, r)
                        placed = True
                        break

            # For lec+lab subjects that couldn't be placed with a single room,
            # try a lecture-room-on-day1 / lab-room-on-day2 split placement.
            if not placed and not pathfit and sched_has_lec_and_lab(s):
                lec_ridxs = [r for r in valid_ridxs if not sched_is_lab_room(rooms[r])]
                lab_ridxs = [r for r in valid_ridxs if sched_is_lab_room(rooms[r])]
                rng.shuffle(lec_ridxs)
                rng.shuffle(lab_ridxs)
                for pat_idx in rng.sample([0, 1], 2):
                    if placed: break
                    _, days = SCHED_PATTERNS[pat_idx]
                    day1, day2 = days[0], days[1]
                    for start in starts:
                        if placed: break
                        end = start + duration
                        # Section + daily-load check is the same for all room pairs
                        sec_ok = True
                        for day in days:
                            for ss, se in sec_track.get(section, {}).get(day, []):
                                if start < se and end > ss: sec_ok = False; break
                            if not sec_ok: break
                            if sum(e_ - s_ for s_, e_ in sec_track.get(section, {}).get(day, [])) + duration > 600:
                                sec_ok = False; break
                        if not sec_ok: continue
                        for r1 in lec_ridxs:
                            if placed: break
                            if any(start < re and end > rs for rs, re in room_track.get(r1, {}).get(day1, [])):
                                continue
                            for r2 in lab_ridxs:
                                if r1 == r2: continue
                                if any(start < re and end > rs for rs, re in room_track.get(r2, {}).get(day2, [])):
                                    continue
                                # Valid split-room slot found
                                room_track.setdefault(r1, {}).setdefault(day1, []).append((start, end))
                                room_track.setdefault(r2, {}).setdefault(day2, []).append((start, end))
                                for day in days:
                                    sec_track.setdefault(section, {}).setdefault(day, []).append((start, end))
                                chrom[si] = (pat_idx, start, r1, r2)
                                placed = True
                                break

    return chrom


def run_schedule_ga(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Main entry point for the automatic schedule GA."""
    started     = time.perf_counter()
    constraints = payload.get("constraints", {}) or {}
    seed           = int(to_number(constraints.get("random_seed"))         or 42)
    pop_size       = max(8,  int(to_number(constraints.get("population_size"))    or 120))
    max_gen        = max(1,  int(to_number(constraints.get("max_generations"))    or 250))
    mut_rate       = min(0.9, max(0.01, float(to_number(constraints.get("mutation_rate"))    or 0.07)))
    crossover_rate = min(1.0, max(0.0,  float(to_number(constraints.get("crossover_rate"))  or 0.85)))
    max_secs       = max(1.0, float(to_number(constraints.get("max_runtime_seconds"))        or 45.0))

    subjects  = list(payload.get("subjects", []))
    all_rooms = list(payload.get("rooms",    []))
    rooms     = [r for r in all_rooms if normalize_upper(r.get("room_status")) != "INACTIVE"]

    if not subjects or not rooms:
        return {
            "assignments": [], "unresolved": [],
            "fitness_overall": 0.0, "fitness_hard": 0.0, "fitness_soft": 0.0,
            "generations": 0, "runtime_ms": 0,
            "report": {"summary": "No subjects or active rooms provided.", "conflicts": []},
        }

    reserved_slots = list(payload.get("reserved_slots", []) or [])
    pre_occ = _build_pre_occupied(reserved_slots, rooms) if reserved_slots else None
    if pre_occ:
        print(
            f"[GA-DIAG] reserved_slots={len(reserved_slots)} "
            f"room_entries={len(pre_occ['room_entries'])} "
            f"section_entries={len(pre_occ['section_entries'])}",
            flush=True,
        )

    rng = random.Random(seed)

    # ── Section capacity triage ───────────────────────────────────────────────
    # Each section can hold at most 10 hrs (600 min) per pattern day × 2 patterns
    # = 1200 min total.  Subjects that exceed this budget for their section are
    # deferred to the "unresolved" list so the GA can achieve near-100% hard fitness
    # on the schedulable subset instead of failing on all of them.
    # Priority within a section: higher units first → higher total_hrs first.
    deferred_subjects: List[Dict[str, Any]] = []
    if subjects:
        section_indices: Dict[str, List[int]] = {}
        for i, s in enumerate(subjects):
            sec = _sec_key(s)
            section_indices.setdefault(sec, []).append(i)

        schedulable_mask = [True] * len(subjects)
        DAILY_BUDGET = 600  # 10 hours in minutes (S-S6 hard limit)
        for sec, idxs in section_indices.items():
            # Sort: higher units → higher hours → shorter duration (easier to fit last)
            sorted_idxs = sorted(
                idxs,
                key=lambda i: (
                    # Non-general subjects first (0), general subjects last (1)
                    1 if subjects[i].get("is_general") else 0,
                    -(subjects[i].get("units") or 0),
                    -(subjects[i].get("total_hrs") or 0),
                    sched_duration(subjects[i]),
                ),
            )
            budget_mth = DAILY_BUDGET
            budget_tf  = DAILY_BUDGET
            for i in sorted_idxs:
                dur = sched_duration(subjects[i])
                if budget_mth >= dur:
                    budget_mth -= dur
                elif budget_tf >= dur:
                    budget_tf -= dur
                else:
                    schedulable_mask[i] = False

        deferred_subjects = [subjects[i] for i in range(len(subjects)) if not schedulable_mask[i]]
        subjects          = [subjects[i] for i in range(len(subjects)) if schedulable_mask[i]]
        print(
            f"[GA-DIAG] triage: schedulable={len(subjects)}/"
            f"{len(subjects)+len(deferred_subjects)} deferred={len(deferred_subjects)}",
            flush=True,
        )

    # Seed population: one greedy start + random fill.
    # Multiple greedy starts were tested but the init overhead cut into the GA time budget.
    population: List[List[Tuple[int, int, int, int]]] = [sched_init_greedy(subjects, rooms, rng, pre_occ=pre_occ)]
    while len(population) < pop_size:
        population.append(sched_init_random(subjects, rooms, rng))

    best       = population[0]
    best_score, best_hard, best_soft = sched_evaluate(best, subjects, rooms, pre_occ=pre_occ)
    generation = 0
    stagnation = 0

    # ── Diagnostic: log greedy seed quality ──────────────────────────────────
    greedy_score, greedy_hard, greedy_soft = best_score, best_hard, best_soft
    print(f"[GA-DIAG] subjects={len(subjects)} rooms={len(rooms)} "
          f"greedy_score={greedy_score:.1f}% (hard={greedy_hard:.1f}% soft={greedy_soft:.1f}%)",
          flush=True)

    while generation < max_gen and (time.perf_counter() - started) < max_secs:
        scored = [(sched_evaluate(c, subjects, rooms, pre_occ=pre_occ), c) for c in population]
        scored.sort(key=lambda x: -x[0][0])
        top_score, top_hard, top_soft = scored[0][0]
        top_chrom = scored[0][1]

        if top_score > best_score:
            best_score, best_hard, best_soft, best = top_score, top_hard, top_soft, top_chrom
            stagnation = 0
        else:
            stagnation += 1

        if stagnation >= 40 or best_score >= 99.5:   # 40 (was 60) — leave time for repair
            break

        elite_n  = max(3, pop_size // 4)          # 25% elitism (was 20%)
        elites   = [c for _, c in scored[:elite_n]]
        next_pop = [list(c) for c in elites]
        while len(next_pop) < pop_size:
            pa    = rng.choice(elites)
            if rng.random() < crossover_rate:     # crossover_rate controls blend vs. clone
                pb    = rng.choice(elites)
                child = sched_crossover(pa, pb, subjects, rng)
            else:
                child = list(pa)                  # clone elite directly (no crossover)
            child = sched_mutate(child, subjects, rooms, rng, mut_rate)
            next_pop.append(child)

        population = next_pop
        generation += 1

    # ── Post-GA local repair ──────────────────────────────────────────────────
    # Re-place subjects that are still in hard conflict (room or section overlap).
    # The repair greedily re-slots each conflicted subject against the fixed
    # non-conflicted ones, iterating up to 5 passes or until conflict-free.
    print(f"[GA-DIAG] after GA: gen={generation} best={best_score:.1f}% "
          f"(hard={best_hard:.1f}% soft={best_soft:.1f}%) stagnation={stagnation}",
          flush=True)
    time_remaining = max_secs - (time.perf_counter() - started)
    if time_remaining > 2.0:
        repair_budget = min(time_remaining - 1.0, 12.0)  # up to 12 s for repair
        repaired = sched_local_repair(best, subjects, rooms, rng,
                                      max_passes=5, time_limit_s=repair_budget,
                                      pre_occ=pre_occ)
        rep_score, rep_hard, rep_soft = sched_evaluate(repaired, subjects, rooms, pre_occ=pre_occ)
        print(f"[GA-DIAG] after repair: score={rep_score:.1f}% "
              f"(hard={rep_hard:.1f}% soft={rep_soft:.1f}%) improved={rep_score > best_score}",
              flush=True)
        if rep_hard > best_hard or (rep_hard == best_hard and rep_score > best_score):
            best, best_score, best_hard, best_soft = repaired, rep_score, rep_hard, rep_soft
    else:
        print(f"[GA-DIAG] repair skipped (time_remaining={time_remaining:.1f}s)", flush=True)

    assignments = sched_chromosome_to_assignments(best, subjects, rooms)
    conflicts   = sched_build_conflict_report(best, subjects, rooms, pre_occ=pre_occ)
    # sched_evaluate already returns (overall, hard_score, soft_score) all in 0–100
    overall, hard_score, soft_score = best_score, best_hard, best_soft

    # Build unresolved list from deferred (over-capacity) subjects
    unresolved = [
        {
            "subject_id":       s.get("subject_id"),
            "code":             s.get("code"),
            "course_no":        s.get("course_no"),
            "section":          s.get("section"),
            "descriptive_title": s.get("descriptive_title"),
            "units":            s.get("units"),
            "reason":           (
                "Section daily load exceeds 10-hour limit — "
                "subject deferred for manual scheduling"
            ),
        }
        for s in deferred_subjects
    ]

    # Final validation: any subjects still in hard conflict are moved to unresolved
    # so callers are never given a schedule that contains room or section violations.
    if conflicts:
        # Build label→subject lookup (label = code-course_no-section, same as conflict report)
        label_to_subject: Dict[str, Dict[str, Any]] = {}
        for s in subjects:
            lbl = (
                f"{normalize_upper(s.get('code') or '')}"
                f"-{normalize_upper(s.get('course_no') or '')}"
                f"-{normalize_upper(s.get('section') or '')}"
            )
            label_to_subject[lbl] = s

        conflicted_labels: Set[str] = set()
        for c in conflicts:
            for lbl in c.get("subjects", []):
                if isinstance(lbl, str):
                    conflicted_labels.add(lbl)

        if conflicted_labels:
            # Build subject_id→assignment map for fast lookup
            sid_to_assignment: Dict[Any, Dict[str, Any]] = {
                to_number(a.get("subject_id")): a for a in assignments
            }
            conflict_sids: Set[Any] = set()
            for lbl in conflicted_labels:
                s = label_to_subject.get(lbl)
                if s:
                    conflict_sids.add(to_number(s.get("subject_id")))

            conflict_unresolved = [
                {
                    "subject_id":        s.get("subject_id"),
                    "code":              s.get("code"),
                    "course_no":         s.get("course_no"),
                    "section":           s.get("section"),
                    "descriptive_title": s.get("descriptive_title"),
                    "units":             s.get("units"),
                    "reason":            "Unresolved room or section conflict — no valid slot found after repair",
                }
                for lbl in conflicted_labels
                for s in [label_to_subject.get(lbl)]
                if s is not None
            ]
            unresolved.extend(conflict_unresolved)
            assignments = [a for a in assignments if to_number(a.get("subject_id")) not in conflict_sids]
            print(
                f"[GA-DIAG] final validation: {len(conflict_sids)} conflicted subject(s) moved to unresolved",
                flush=True,
            )

    return {
        "assignments":     assignments,
        "unresolved":      unresolved,
        "fitness_overall": round(overall, 2),
        "fitness_hard":    round(hard_score, 2),
        "fitness_soft":    round(soft_score, 2),
        "generations":     generation + 1,
        "runtime_ms":      int((time.perf_counter() - started) * 1000),
        "run_id":          sha1(
            json.dumps({"seed": seed, "n": len(subjects)}, sort_keys=True).encode()
        ).hexdigest()[:16],
        "constraints":     constraints,
        "report": {
            "summary":        (
                f"GA scheduled {len(assignments)} subject(s) over {generation + 1} generation(s). "
                f"Fitness: {round(overall, 1)}%  |  Hard: {round(hard_score, 1)}%  |  Soft: {round(soft_score, 1)}%"
            ),
            "conflicts":      conflicts,
            "conflict_count": len(conflicts),
        },
    }


# ============================================================
# HTTP HANDLER
# ============================================================

class GaHandler(BaseHTTPRequestHandler):
    server_version = "ChronoMariaGA/2.0"

    def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in {"", "/health"}:
            self._write_json(200, {"status": "ok", "service": "genetic-algorithm"})
            return
        self._write_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.rstrip("/")
        if path not in {"/generate", "/generate-schedule"}:
            self._write_json(404, {"error": "Not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else b"{}"

        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            self._write_json(400, {"error": f"Invalid JSON payload: {exc.msg}"})
            return

        try:
            if path == "/generate-schedule":
                result = run_schedule_ga(payload)
            else:
                result = run_ga(payload)
            self._write_json(200, result)
        except Exception as exc:  # pragma: no cover
            self._write_json(500, {"error": str(exc)})

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        print(f"[genetic-algorithm] {fmt % args}")


def main() -> None:
    host = os.getenv("GA_HOST", "0.0.0.0")
    port = int(os.getenv("GA_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), GaHandler)
    print(f"[genetic-algorithm] listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
