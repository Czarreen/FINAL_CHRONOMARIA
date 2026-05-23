"""Chronomaria GA microservice for faculty loading."""

from __future__ import annotations

import sys
# Force UTF-8 line-buffered stdout so print() appears immediately in run.py terminal
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

import functools
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
    # Filter out common stopwords (these should not count as keyword matches)
    STOP_WORDS = {
        "AND",
        "THE",
        "OF",
        "IN",
        "ON",
        "FOR",
        "TO",
        "A",
        "AN",
        "BY",
        "WITH",
        "IS",
        "ARE",
        "FROM",
        "AT",
        "AS",
        "OR",
    }
    out: Set[str] = set()
    for token in split_tokens(value):
        for part in re.split(r"\s+", token):
            clean = re.sub(r"[^A-Za-z0-9]", "", part).upper()
            if len(clean) >= 2 and clean not in STOP_WORDS:
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


def is_sat_only_offering(offering: Dict[str, Any]) -> bool:
    """Text-based SAT detector — intentionally bypasses time-boundary checks.

    build_schedule_blocks() drops blocks whose time is outside [7:30, 20:00], so SAT
    offerings that start at 7:00 AM produce *empty* blocks and is_sat_only_blocks([]) 
    returns False.  This function reads day tokens directly from the raw schedule text
    across BOTH mth_schedule and tfs_schedule, so it correctly catches SAT-only
    offerings regardless of start time or which column stores the schedule.
    """
    all_days: Set[str] = set()
    has_schedule = False
    for group in ("mth", "tfs"):
        text = normalize_text(offering.get(f"{group}_schedule"))
        if not text:
            continue
        has_schedule = True
        all_days.update(parse_days_from_text(text, group.upper()))
    if not has_schedule:
        return False
    # SAT-only when the parsed day tokens are present and consist only of
    # explicit Saturday entries.
    return bool(all_days) and all(d == "SAT" for d in all_days)


def is_wed_only_offering(offering: Dict[str, Any]) -> bool:
    """Return True when an offering's schedule tokens are explicitly WED only.

    We treat Wednesday-only subjects as excluded from automatic faculty-loading
    per the requested policy; this mirrors the Saturday-only handling but is
    explicitly bounded to WED tokens so other non-automated days are not
    inadvertently captured.
    """
    all_days: Set[str] = set()
    has_schedule = False
    for group in ("mth", "tfs"):
        text = normalize_text(offering.get(f"{group}_schedule"))
        if not text:
            continue
        has_schedule = True
        all_days.update(parse_days_from_text(text, group.upper()))
    if not has_schedule:
        return False
    return bool(all_days) and all(d == "WED" for d in all_days)


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


def prep_limit_for_faculty(faculty: Dict[str, Any]) -> int:
    """Dynamic F-H8 cap based on faculty_max_units, bounded by the policy max of 4.

    Rule: cap = min(4, floor(max_units / 3)), with a minimum of 1 for active faculty.
    Examples: 21u -> 4, 15u -> 4, 12u -> 4, 9u -> 3, 6u -> 2.
    """
    max_units = max(0.0, to_number(faculty.get("faculty_max_units")) or 0.0)
    if max_units <= 0:
        return 4
    return max(1, min(4, int(math.floor(max_units / 3.0))))


def faculty_usage_ratio(faculty: Dict[str, Any], current_load: float) -> float:
    """Return current load as a fraction of faculty_max_units for tie-breaking."""
    max_units = max(0.0, to_number(faculty.get("faculty_max_units")) or 0.0)
    if max_units <= 0:
        return float(current_load or 0.0)
    return float(current_load or 0.0) / max_units


@functools.lru_cache(maxsize=2048)
def _sec_key_from_parts(dept_id: float, section: str) -> str:
    return f"{int(dept_id or 0)}|{section.strip().upper()}"


def _sec_key(subject: Dict[str, Any]) -> str:
    """Composite dept_id|section key so same section names across departments stay separate."""
    return _sec_key_from_parts(
        to_number(subject.get("department_id")) or 0,
        subject.get("section") or "",
    )


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
            room_idx = room_id_to_idx.get(room_id_str)
            for day in default_days:
                if room_idx is not None:
                    room_entries.append((room_idx, day, start, end))
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


def match_specialization_score(faculty: Dict[str, Any], offering: Dict[str, Any], matched_subject: Optional[Dict[str, Any]], faculty_preferences: Optional[Dict[str, Any]] = None) -> float:
    # Check explicit faculty subject preferences first
    # Preferences are GLOBAL — any faculty from any department can get the bonus
    if faculty_preferences is not None:
        faculty_id = faculty.get("faculty_id")
        # Use subject_code from matched_subject if available, else fall back to offering.code
        # (offering.code IS the subject_code — they map 1:1 in mapSubjectsToGaOfferings)
        subject_code = (
            normalize_upper(matched_subject.get("subject_code"))
            if matched_subject
            else normalize_upper(offering.get("code") or "")
        )

        if faculty_id is not None and subject_code:
            # Get preferences for this faculty: { [facultyId]: { [subjectTag]: priorityLevel } }
            faculty_prefs = faculty_preferences.get(str(faculty_id), {})
            if subject_code in faculty_prefs:
                priority_level = faculty_prefs[subject_code]
                # Priority 1 (High): +100 bonus
                # Priority 2 (Capable): +50 bonus
                # Priority 3 (Fallback): +15 bonus
                if priority_level == 1:
                    return 100.0
                elif priority_level == 2:
                    return 50.0
                elif priority_level == 3:
                    return 15.0
    
    # Fall back to keyword matching if no explicit preference
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


def _rejection_reason(fi_: int, faculties, loads, blocks, preps_keys, preps_units, units, off_blocks, prep_key_cand):
    """Return a short string explaining why a faculty index is ineligible for an offering."""
    fac_ = faculties[fi_]
    max_u = max(0.0, to_number(fac_.get("faculty_max_units")) or 0.0)
    if max_u > 0 and loads[fi_] + units > max_u:
        return f"max_units_exceeded (has {loads[fi_]:.1f}, adding {units}, cap {max_u})"
    if faculty_has_conflict(blocks[fi_], off_blocks):
        return "time_conflict"
    for d in ("MON", "TUE", "WED", "THU", "FRI", "SAT"):
        if consecutive_minutes_for_day(blocks[fi_] + off_blocks, d) > 240.0:
            return f"consecutive_hours_exceeded_on_{d}"
    # Enforce unit-based prep capacity relative to remaining units
    prep_units_have = float(preps_units.get(fi_, 0.0))
    remaining_capacity = max_u - loads[fi_]
    if max_u > 0 and (prep_units_have + units) > remaining_capacity:
        return f"prep_units_exceeded (has {prep_units_have:.1f}, adding {units}, remaining {remaining_capacity:.1f})"
    # Fallback: if faculty has no max_units set, fall back to count-based prep cap
    prep_limit = prep_limit_for_faculty(fac_)
    if len(set(preps_keys[fi_]) | {prep_key_cand}) > prep_limit:
        return f"prep_limit_exceeded (has {len(preps_keys[fi_])}, cap {prep_limit}: {sorted(preps_keys[fi_])})"
    return "ineligible_unknown"


def build_initial_candidate(faculties, offerings, subject_index, rng, department_faculty_counts, faculty_preferences=None, trace=None):
    loads = {i: 0.0 for i in range(len(faculties))}
    blocks = {i: [] for i in range(len(faculties))}
    preps_keys = {i: set() for i in range(len(faculties))}
    preps_units = {i: 0.0 for i in range(len(faculties))}
    chosen: Dict[int, int] = {}
    if trace is not None:
        trace.setdefault("p1_preassignments", [])
        trace.setdefault("p2p3_reservations", [])
        trace.setdefault("main_loop", [])

    # Build faculty_id -> index lookup for preference pre-assignment
    fid_to_fi: Dict[str, int] = {
        str(int(to_number(f.get("faculty_id")) or 0)): i
        for i, f in enumerate(faculties)
    }

    # ── Pre-assignment pass: honour explicit faculty subject preferences ──
    # Only Priority 1 (High / Primary) faculty are hard pre-assigned here.
    # Priority 2 (Capable) and 3 (Fallback) already receive score bonuses in
    # match_specialization_score (+50 / +15), so the main GA loop will still
    # strongly prefer them — but without locking them in prematurely.
    #
    # Offering-centric approach: for each offering, ALL P1-tagged faculty are
    # considered and the one with the lowest current load wins — eliminating
    # the "first faculty in dict order always wins" bias that caused some P1
    # faculty to never receive their tagged subject.
    if faculty_preferences:
        # Build a map: subject_code → list of faculty indices with P1 tag
        p1_by_code: Dict[str, List[int]] = {}
        for fid_str, tag_map in faculty_preferences.items():
            fi_pref = fid_to_fi.get(fid_str)
            if fi_pref is None:
                continue  # faculty not in GA pool
            for code_tag, priority in tag_map.items():
                if priority == 1:
                    code = normalize_upper(code_tag)
                    p1_by_code.setdefault(code, []).append(fi_pref)

        # Process each subject code's offerings in units-descending order.
        # For each offering, pick the eligible P1 faculty with the lowest load.
        for pref_code, candidate_fis in p1_by_code.items():
            code_offerings = sorted(
                ((oi, o) for oi, o in enumerate(offerings)
                 if oi not in chosen and normalize_upper(o.get("code") or "") == pref_code),
                key=lambda x: -(
                    to_number(x[1].get("units"))
                    or (to_number(x[1].get("lec_hrs")) or 0.0) + (to_number(x[1].get("lab_hrs")) or 0.0)
                    or 0.0
                ),
            )
            for oi, offering in code_offerings:
                off_blocks = build_schedule_blocks(offering)
                units = (
                    to_number(offering.get("units"))
                    or (to_number(offering.get("lec_hrs")) or 0.0) + (to_number(offering.get("lab_hrs")) or 0.0)
                    or 0.0
                )
                # Pick the best eligible P1 faculty using the same priority order
                # as the main loop: same-dept > FT over PT > lowest load.
                # Prep limit is also enforced here for consistency.
                off_dept_id = int(to_number(offering.get("department_id")) or 0)
                prep_key_cand = f"{normalize_upper(offering.get('code'))}|{normalize_upper(offering.get('course_no'))}"
                best_fi: Optional[int] = None
                # (same_dept, is_ft, -load) — higher tuple wins via max()
                best_score: tuple = (-1, False, float("inf"), float("-inf"))
                p1_candidates_trace = []
                for fi_cand in candidate_fis:
                    max_u = max(0.0, to_number(faculties[fi_cand].get("faculty_max_units")) or 0.0)
                    rej = None
                    if max_u > 0 and loads[fi_cand] + units > max_u:
                        rej = f"max_units_exceeded (has {loads[fi_cand]:.1f}, adding {units}, cap {max_u})"
                    elif faculty_has_conflict(blocks[fi_cand], off_blocks):
                        rej = "time_conflict"
                    elif any(consecutive_minutes_for_day(blocks[fi_cand] + off_blocks, d) > 240.0
                             for d in ("MON", "TUE", "WED", "THU", "FRI", "SAT")):
                        rej = "consecutive_hours_exceeded"
                    else:
                        # unit-based prep reservation check (fallback to count-based prep limit)
                        prep_units_have_cand = float(preps_units.get(fi_cand, 0.0))
                        remaining_cap_cand = max_u - loads[fi_cand]
                        if max_u > 0 and (prep_units_have_cand + units) > remaining_cap_cand:
                            rej = f"prep_units_exceeded (has {prep_units_have_cand:.1f}, adding {units}, remaining {remaining_cap_cand:.1f})"
                        else:
                            prep_cap = prep_limit_for_faculty(faculties[fi_cand])
                            if len(set(preps_keys[fi_cand]) | {prep_key_cand}) > prep_cap:
                                rej = f"prep_limit_exceeded (has {len(preps_keys[fi_cand])}, cap {prep_cap}: {sorted(preps_keys[fi_cand])})"
                    fac_dept_id = int(to_number(faculties[fi_cand].get("department_id")) or 0)
                    same_dept = int(fac_dept_id == off_dept_id)
                    is_ft = normalize_role(faculties[fi_cand].get("faculty_role")) == "FT"
                    usage_ratio = faculty_usage_ratio(faculties[fi_cand], loads[fi_cand])
                    cand_score = (same_dept, is_ft, -usage_ratio, -loads[fi_cand])
                    if trace is not None:
                        p1_candidates_trace.append({
                            "fi": fi_cand,
                            "faculty_id": str(int(to_number(faculties[fi_cand].get("faculty_id")) or 0)),
                            "name": faculties[fi_cand].get("faculty_name"),
                            "role": faculties[fi_cand].get("faculty_role"),
                            "dept_id": fac_dept_id,
                            "same_dept": bool(same_dept),
                            "is_ft": is_ft,
                            "load": round(loads[fi_cand], 2),
                            "max_units": max_u,
                            "usage_ratio": round(usage_ratio, 4),
                            "preps_before": sorted(preps_keys[fi_cand]),
                            "score_tuple": list(cand_score),
                            "eligible": rej is None,
                            "rejection": rej,
                        })
                    if rej is not None:
                        continue
                    if cand_score > best_score:
                        best_score = cand_score
                        best_fi = fi_cand
                if best_fi is None:
                    if trace is not None:
                        trace["p1_preassignments"].append({
                            "code": offering.get("code"),
                            "offering_id": offering.get("id"),
                            "section": offering.get("section"),
                            "descriptive_title": offering.get("descriptive_title"),
                            "units": units,
                            "result": "NO_ELIGIBLE_P1_FACULTY",
                            "winner": None,
                            "candidates": p1_candidates_trace,
                        })
                    continue  # no eligible P1 faculty — fall through to main GA loop
                if trace is not None:
                    winner_fac = faculties[best_fi]
                    trace["p1_preassignments"].append({
                        "code": offering.get("code"),
                        "offering_id": offering.get("id"),
                        "section": offering.get("section"),
                        "descriptive_title": offering.get("descriptive_title"),
                        "units": units,
                        "result": "ASSIGNED",
                        "winner": {
                            "fi": best_fi,
                            "faculty_id": str(int(to_number(winner_fac.get("faculty_id")) or 0)),
                            "name": winner_fac.get("faculty_name"),
                            "role": winner_fac.get("faculty_role"),
                            "dept_id": int(to_number(winner_fac.get("department_id")) or 0),
                            "score_tuple": list(best_score),
                            "load_after": round(loads[best_fi] + units, 2),
                        },
                        "candidates": p1_candidates_trace,
                    })
                chosen[oi] = best_fi
                loads[best_fi] += units
                blocks[best_fi].extend(off_blocks)
                # Add prep key and increment prep-units if new
                if prep_key_cand not in preps_keys[best_fi]:
                    preps_keys[best_fi].add(prep_key_cand)
                    # Try to derive units by subject code (fallback to offering units)
                    try:
                        code_only = normalize_upper(offering.get('code'))
                        su = 0.0
                        # subject_index may contain subject entries with subject_units
                        for s in subject_index.values():
                            if normalize_upper(s.get('subject_code')) == code_only:
                                su = to_number(s.get('subject_units')) or 0.0
                                break
                        if not su:
                            su = units
                        preps_units[best_fi] += float(su)
                    except Exception:
                        preps_units[best_fi] += float(units)

    # ── P2/P3 prep slot reservation ──
    # For every P2 or P3 tagged faculty+subject pair, pre-insert the prep key
    # into that faculty's prep set BEFORE the main loop runs.  This prevents
    # the main loop from consuming all 4 prep slots with untagged subjects and
    # then having no room left when the tagged offering is finally processed.
    # When the real offering is assigned in the main loop, its prep key is
    # identical to the reserved key (same code|course_no format), so the set
    # size stays the same — no double-counting occurs.
    if faculty_preferences:
        for fid_str, tag_map in faculty_preferences.items():
            fi_res = fid_to_fi.get(fid_str)
            if fi_res is None:
                continue
            for code_tag, priority in tag_map.items():
                if priority not in (2, 3):
                    continue
                # Reserve prep slots by *units* rather than simple counts.
                # Determine remaining capacity for this faculty.
                fac = faculties[fi_res]
                max_u = max(0.0, to_number(fac.get('faculty_max_units')) or 0.0)
                remaining_capacity = max_u - loads[fi_res] - preps_units[fi_res]
                if max_u > 0 and remaining_capacity <= 0:
                    break
                norm_code = normalize_upper(code_tag)
                # Find any offering with this subject code to derive the course_no
                # for the prep key.  If multiple sections exist, all share the same
                # course_no, so the first match is sufficient.
                for off in offerings:
                    if normalize_upper(off.get("code") or "") == norm_code:
                        prep_key = f"{norm_code}|{normalize_upper(off.get('course_no') or '')}"
                        # compute candidate units
                        cand_units = (
                            to_number(off.get('units'))
                            or (to_number(off.get('lec_hrs')) or 0.0) + (to_number(off.get('lab_hrs')) or 0.0)
                            or 0.0
                        )
                        # Only reserve if it fits remaining capacity
                        if max_u > 0 and cand_units > remaining_capacity:
                            break
                        preps_keys[fi_res].add(prep_key)
                        preps_units[fi_res] += float(cand_units)
                        if trace is not None:
                            fac_r = faculties[fi_res]
                            trace["p2p3_reservations"].append({
                                "faculty_id": fid_str,
                                "name": fac_r.get("faculty_name"),
                                "role": fac_r.get("faculty_role"),
                                "priority": priority,
                                "subject_code": norm_code,
                                "prep_key_reserved": prep_key,
                                "preps_keys_after": sorted(list(preps_keys[fi_res])),
                                "preps_units_after": round(preps_units[fi_res], 2),
                            })
                        break  # one reservation per subject code is enough

    ordering = sorted(
        enumerate(offerings),
        key=lambda x: -(
            to_number(x[1].get("units"))
            or (to_number(x[1].get("lec_hrs")) or 0.0) + (to_number(x[1].get("lab_hrs")) or 0.0)
            or 0.0
        ),
    )

    for oi, offering in ordering:
        if oi in chosen:
            continue  # already handled by preference pre-assignment
        off_blocks = build_schedule_blocks(offering)
        units = (
            to_number(offering.get("units"))
            or (to_number(offering.get("lec_hrs")) or 0.0) + (to_number(offering.get("lab_hrs")) or 0.0)
            or 0.0
        )
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
            # Unit-based prep capacity check
            pref_units_have = float(preps_units.get(fi_, 0.0))
            remaining_capacity_ = max_u - loads[fi_]
            if max_u > 0 and (pref_units_have + units) > remaining_capacity_:
                return False
            # Fallback: count-based cap if no max_units defined
            if max_u <= 0 and len(set(preps_keys[fi_]) | {prep_key_}) > prep_limit_for_faculty(faculties[fi_]):
                return False
            return True

        def _score(fi_: int, spec_: float, dept_match_: bool) -> float:
            role_ = normalize_role(faculties[fi_].get("faculty_role"))
            s = spec_ * (1.0 if dept_match_ else 0.65)
            s += 120.0 if role_ == "FT" else 45.0 if role_ == "PT" else 0.0
            s -= faculty_usage_ratio(faculties[fi_], loads[fi_]) * 80.0
            return s + rng.random() * 0.001

        candidates: List[Tuple[float, int]] = []

        offering_code = normalize_upper(offering.get("code") or "")
        prep_key_main = f"{offering_code}|{normalize_upper(offering.get('course_no') or '')}"

        # Collect tagged faculty_ids for this offering (for trace)
        tagged_fids: Dict[str, int] = {}
        if faculty_preferences:
            for _fid_str, _ftags in faculty_preferences.items():
                if offering_code in _ftags:
                    tagged_fids[_fid_str] = _ftags[offering_code]

        def _explicit_pref_usage_ratio(fi_: int) -> float:
            if not faculty_preferences:
                return 1.0
            fid_str_ = str(int(to_number(faculties[fi_].get("faculty_id")) or 0))
            if offering_code not in faculty_preferences.get(fid_str_, {}):
                return 1.0
            return faculty_usage_ratio(faculties[fi_], loads[fi_])

        # Track per-faculty rejection reasons for trace
        rejection_map: Dict[int, str] = {}  # fi -> reason string

        # Pass A — specialization match, any department
        for fi, faculty in enumerate(faculties):
            fid_str_a = str(int(to_number(faculty.get("faculty_id")) or 0))
            if not _hard_eligible(fi):
                rejection_map[fi] = _rejection_reason(fi, faculties, loads, blocks, preps_keys, preps_units, units, off_blocks, prep_key_main)
                continue
            spec = match_specialization_score(faculty, offering, subject, faculty_preferences)
            if spec > 0.0:
                dept_match = to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))
                has_explicit_pref = faculty_preferences is not None and offering_code in faculty_preferences.get(fid_str_a, {})
                effective_dept_match = dept_match or has_explicit_pref
                candidates.append((_score(fi, spec, effective_dept_match), _explicit_pref_usage_ratio(fi), fi))
            else:
                rejection_map.setdefault(fi, "spec_score_zero_pass_a")

        # Pass B — same department, no specialization needed
        if not candidates:
            for fi, faculty in enumerate(faculties):
                if to_number(faculty.get("department_id")) != to_number(offering.get("department_id")):
                    continue
                if not _hard_eligible(fi):
                    rejection_map[fi] = _rejection_reason(fi, faculties, loads, blocks, preps_keys, preps_units, units, off_blocks, prep_key_main)
                    continue
                spec = match_specialization_score(faculty, offering, subject, faculty_preferences)
                candidates.append((_score(fi, spec, True), _explicit_pref_usage_ratio(fi), fi))

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
                    rejection_map[fi] = _rejection_reason(fi, faculties, loads, blocks, preps_keys, preps_units, units, off_blocks, prep_key_main)
                    continue
                spec = match_specialization_score(faculty, offering, subject, faculty_preferences)
                candidates.append((_score(fi, spec, False), _explicit_pref_usage_ratio(fi), fi))

        sorted_cands = sorted(candidates, key=lambda x: (-x[0], x[1], x[2]))
        fi = sorted_cands[0][2] if sorted_cands else -1

        if trace is not None:
            winner_info = None
            if fi >= 0:
                wf = faculties[fi]
                winner_info = {
                    "fi": fi,
                    "faculty_id": str(int(to_number(wf.get("faculty_id")) or 0)),
                    "name": wf.get("faculty_name"),
                    "role": wf.get("faculty_role"),
                    "dept_id": int(to_number(wf.get("department_id")) or 0),
                    "score": round(sorted_cands[0][0], 4),
                    "usage_ratio": round(sorted_cands[0][1], 4),
                    "load_after": round(loads[fi] + units, 2),
                    "preps_before": sorted(preps_keys[fi]),
                    "preps_units_before": round(preps_units.get(fi, 0.0), 2),
                }
            top3 = [
                {
                    "fi": c[2],
                    "faculty_id": str(int(to_number(faculties[c[2]].get("faculty_id")) or 0)),
                    "name": faculties[c[2]].get("faculty_name"),
                    "role": faculties[c[2]].get("faculty_role"),
                    "score": round(c[0], 4),
                    "usage_ratio": round(c[1], 4),
                }
                for c in sorted_cands[:3]
            ]
            # Build tagged-faculty detail (P2/P3 that were in main loop or failed P1)
            tagged_detail = []
            for tfid, tprio in tagged_fids.items():
                tfi = next(
                    (i for i, f in enumerate(faculties)
                     if str(int(to_number(f.get("faculty_id")) or 0)) == tfid),
                    None,
                )
                if tfi is None:
                    tagged_detail.append({"faculty_id": tfid, "priority": tprio, "status": "NOT_IN_GA_POOL"})
                else:
                    rej = rejection_map.get(tfi)
                    in_cands = any(c[1] == tfi for c in candidates)
                    tagged_detail.append({
                        "faculty_id": tfid,
                        "name": faculties[tfi].get("faculty_name"),
                        "priority": tprio,
                        "fi": tfi,
                        "in_candidates": in_cands,
                        "rejection": rej if not in_cands else None,
                        "load": round(loads[tfi], 2),
                        "max_units": max(0.0, to_number(faculties[tfi].get("faculty_max_units")) or 0.0),
                        "preps": sorted(preps_keys[tfi]),
                        "preps_units": round(preps_units.get(tfi, 0.0), 2),
                    })
            trace["main_loop"].append({
                "code": offering.get("code"),
                "offering_id": offering.get("id"),
                "section": offering.get("section"),
                "descriptive_title": offering.get("descriptive_title"),
                "dept_id": int(to_number(offering.get("department_id")) or 0),
                "units": units,
                "pass_used": "A" if sorted_cands else ("B" if not candidates else "C"),
                "candidate_count": len(candidates),
                "result": "ASSIGNED" if fi >= 0 else "UNASSIGNED",
                "winner": winner_info,
                "top3_candidates": top3,
                "tagged_faculty": tagged_detail if tagged_fids else [],
            })

        if fi < 0:
            chosen[oi] = -1
            continue
        chosen[oi] = fi
        loads[fi] += units
        blocks[fi].extend(off_blocks)
        prep_key_now = f"{normalize_upper(offering.get('code'))}|{normalize_upper(offering.get('course_no'))}"
        if prep_key_now not in preps_keys[fi]:
            preps_keys[fi].add(prep_key_now)
            # increment units for this prep (fallback to offering units)
            try:
                su = 0.0
                code_only = normalize_upper(offering.get('code'))
                for s in subject_index.values():
                    if normalize_upper(s.get('subject_code')) == code_only:
                        su = to_number(s.get('subject_units')) or 0.0
                        break
                if not su:
                    su = units
                preps_units[fi] += float(su)
            except Exception:
                preps_units[fi] += float(units)

    if trace is not None:
        trace["faculty_initial_state"] = [
            {
                "fi": i,
                "faculty_id": str(int(to_number(f.get("faculty_id")) or 0)),
                "name": f.get("faculty_name"),
                "role": f.get("faculty_role"),
                "dept_id": int(to_number(f.get("department_id")) or 0),
                "units_loaded": round(loads[i], 2),
                "max_units": max(0.0, to_number(f.get("faculty_max_units")) or 0.0),
                "prep_count": len(preps_keys[i]),
                "prep_units": round(preps_units[i], 2),
                "preps": sorted(preps_keys[i]),
                "assignments": sum(1 for v in chosen.values() if v == i),
            }
            for i, f in enumerate(faculties)
        ]

    return [chosen.get(i, -1) for i in range(len(offerings))]


def summarize_candidate(candidate, faculties, offerings, subject_index, department_faculty_counts, department_available_faculty_counts, faculty_preferences=None):
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
        units = (
            to_number(offering.get("units"))
            or (to_number(offering.get("lec_hrs")) or 0.0) + (to_number(offering.get("lab_hrs")) or 0.0)
            or 0.0
        )
        fid = int(to_number(faculty.get("faculty_id")) or 0)

        item = {"faculty": faculty, "offering": offering, "matched_subject": subject_index.get(build_offering_key(offering)), "schedule_blocks": b}
        assignments.append(item)
        loads[fid] = loads.get(fid, 0.0) + units
        faculty_assignments.setdefault(fid, []).append(item)
        faculty_blocks.setdefault(fid, []).extend(b)

        for blk in b:
            room_id = int(to_number(blk.get("room_id")) or 0)
            if room_id == 0:
                continue  # no room assigned — skip to avoid false null-room conflicts
            for day in blk.get("days", []):
                room_day_blocks.setdefault(f"{day}|{room_id}", []).append({"start": blk["start"], "end": blk["end"]})

    hard_penalty = 0.0
    soft_penalty = 0.0
    soft_bonus = 0.0
    avg_units = sum(loads.values()) / max(1, len(faculties))

    if unassigned:
        hard_penalty += 180.0 * len(unassigned)

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

        # Compute prep units (sum of unique subject units among assigned offerings)
        prep_units = 0.0
        seen_codes = set()
        for it in assigned:
            code = normalize_upper(it['offering'].get('code'))
            if code in seen_codes:
                continue
            seen_codes.add(code)
            matched = it.get('matched_subject') or {}
            pu = to_number(matched.get('subject_units')) or to_number(it['offering'].get('units')) or 0.0
            prep_units += float(pu)

        if role == "FT":
            soft_penalty -= 9.0
        elif role == "PT":
            soft_penalty += 4.0

        for it in assigned:
            off = it["offering"]
            spec_score = match_specialization_score(faculty, off, it.get("matched_subject"), faculty_preferences)
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
            "usage_ratio": round(faculty_usage_ratio(faculty, total), 4),
            "free_units": round(free, 2),
            "class_count": len(assigned),
            "preparations": count_preparations(assigned),
            "prep_units": round(prep_units, 2),
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
            "hard_violations": [c for c in conflicts if c["type"] in {"time_conflict", "overload", "department_mismatch", "consecutive_limit", "forbidden_cross_department"}],
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
    max_runtime_seconds = max(1.0, float(to_number(constraints.get("max_runtime_seconds")) or 60.0))

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
    faculty_preferences: Optional[Dict[str, Any]] = payload.get("faculty_preferences") or None
    problematic_offerings = list(payload.get("problematic_offerings") or [])

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

    # ── Special-day pre-filter ──────────────────────────────────────────────
    # Certain user-defined day overrides are excluded from automated GA
    # faculty-loading.  Historically only Saturday-only subjects were
    # excluded.  Per configuration/requests we now also treat Wednesday-only
    # offerings as excluded (they will be reported back as unassigned).
    ga_offerings = [o for o in offerings if not (is_sat_only_offering(o) or is_wed_only_offering(o))]
    sat_only_offerings = [o for o in offerings if is_sat_only_offering(o)]
    wed_only_offerings = [o for o in offerings if is_wed_only_offering(o)]

    if not faculties or not ga_offerings:
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

    # ── Debug trace (seed 0 only = first build) ─────────────────────────
    _trace: Dict[str, Any] = {
        "input": {
            "total_offerings": len(offerings),
            "ga_offerings": len(ga_offerings),
            "sat_only_offerings": len(sat_only_offerings),
            "wed_only_offerings": len(wed_only_offerings),
            "problematic_offerings": len(problematic_offerings),
            "faculties": len(faculties),
            "tagged_faculty_count": len(faculty_preferences) if faculty_preferences else 0,
        },
    }
    population = [build_initial_candidate(faculties, ga_offerings, subject_index, rng, department_faculty_counts, faculty_preferences, trace=_trace)]
    while len(population) < population_size:
        base = build_initial_candidate(faculties, ga_offerings, subject_index, rng, department_faculty_counts, faculty_preferences)
        population.append(mutate(base, len(faculties), rng, min(0.35, mutation_rate * 1.6)))

    best = population[0]
    best_summary = summarize_candidate(
        best,
        faculties,
        ga_offerings,
        subject_index,
        department_faculty_counts,
        department_available_faculty_counts,
        faculty_preferences,
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
                ga_offerings,
                subject_index,
                department_faculty_counts,
                department_available_faculty_counts,
                faculty_preferences,
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
        ga_offerings,
        subject_index,
        department_faculty_counts,
        department_available_faculty_counts,
        faculty_preferences,
    )
    result["generations"] = generation + 1
    result["runtime_ms"] = int((time.perf_counter() - started) * 1000)
    # Add special-day counts to report so the frontend knows they were excluded
    result.setdefault("report", {})
    result["report"]["sat_only_count"] = len(sat_only_offerings)
    result["report"]["wed_only_count"] = len(wed_only_offerings)
    result["report"]["summary"] = (
        f"Generated {len(result['assignments'])} assignment(s) from "
        f"{len(ga_offerings)} eligible offering(s). "
        f"{len(sat_only_offerings)} SAT-only and {len(wed_only_offerings)} WED-only offering(s) excluded (always unassigned)."
    )
    result["run_id"] = payload.get("run_id") or sha1(
        json.dumps({"seed": seed, "best": best, "count": len(ga_offerings)}, sort_keys=True).encode("utf-8")
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

    # ── Dump result + detailed debug trace to files ────────────────────────
    try:
        import os as _os
        _base = _os.path.dirname(__file__)

        # ga_last_run.json — full result (assignments, fitness, report)
        _dump_path = _os.path.join(_base, "ga_last_run.json")
        with open(_dump_path, "w", encoding="utf-8") as _f:
            json.dump(result, _f, indent=2, default=str)

        # ga_debug_run.json — detailed trace of initial-candidate decisions
        # Enrich trace with final-result unassigned reasons and tagged-faculty
        # summary from the winning candidate so Copilot can pinpoint issues.
        _assignments_by_code: Dict[str, Any] = {}
        for a in result.get("assignments", []):
            code = normalize_upper(a["offering"].get("code") or "")
            _assignments_by_code.setdefault(code, []).append({
                "offering_id": a["offering"].get("id"),
                "section": a["offering"].get("section"),
                "faculty_id": str(int(to_number(a["faculty"].get("faculty_id")) or 0)),
                "faculty_name": a["faculty"].get("faculty_name"),
                "faculty_role": a["faculty"].get("faculty_role"),
                "faculty_dept_id": int(to_number(a["faculty"].get("department_id")) or 0),
            })
        _unassigned_by_id = {
            u.get("offering_id"): u
            for u in result.get("report", {}).get("unresolved_offerings", [])
        }
        _load_by_fid = {
            row["faculty_id"]: row
            for row in result.get("report", {}).get("faculty_load_balance", [])
        }

        _trace["run_id"] = result.get("run_id")
        _trace["fitness"] = {
            "overall": result.get("fitness_overall"),
            "hard": result.get("fitness_hard"),
            "soft": result.get("fitness_soft"),
            "generations": result.get("generations"),
            "runtime_ms": result.get("runtime_ms"),
        }
        _trace["final_assignments_by_code"] = _assignments_by_code
        _trace["final_unassigned"] = list(_unassigned_by_id.values())
        _trace["final_faculty_loads"] = list(_load_by_fid.values())
        _trace["sat_only_excluded"] = [
            {
                "offering_id": o.get("id"),
                "code": o.get("code"),
                "section": o.get("section"),
                "descriptive_title": o.get("descriptive_title"),
            }
            for o in sat_only_offerings
        ]
        _trace["wed_only_excluded"] = [
            {
                "offering_id": o.get("id"),
                "code": o.get("code"),
                "section": o.get("section"),
                "descriptive_title": o.get("descriptive_title"),
            }
            for o in wed_only_offerings
        ]

        _debug_path = _os.path.join(_base, "ga_debug_run.json")
        with open(_debug_path, "w", encoding="utf-8") as _f:
            json.dump(_trace, _f, indent=2, default=str)

        print(f"[GA] Result  → {_dump_path}", flush=True)
        print(f"[GA] Debug   → {_debug_path}", flush=True)
        print(f"[GA] Summary → {result.get('report', {}).get('summary', '')}", flush=True)
    except Exception as _e:
        print(f"[GA] Warning: could not write debug files: {_e}", flush=True)

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


@functools.lru_cache(maxsize=256)
def _sched_duration_from_hrs(lec_hrs: float, lab_hrs: float) -> int:
    total = lec_hrs + lab_hrs
    raw   = round((total / 2.0) * 60)
    return max(30, raw)


def sched_duration(subject: Dict[str, Any]) -> int:
    """Per-day duration in minutes — total hours split equally over 2 days (S-H8/S-H12)."""
    lec = to_number(subject.get("lec_hrs")) or 0.0
    lab = to_number(subject.get("lab_hrs")) or 0.0
    return _sched_duration_from_hrs(lec, lab)


@functools.lru_cache(maxsize=None)
def sched_valid_starts(duration: int) -> tuple:
    """All 30-min-boundary start times where start+duration ≤ SCHED_END_MIN."""
    return tuple(range(SCHED_START_MIN, SCHED_END_MIN - duration + 1, SCHED_SLOT_STEP))


@functools.lru_cache(maxsize=256)
def _is_lab_room_type(room_type: str) -> bool:
    return "LAB" in normalize_upper(room_type)


def sched_is_lab_room(room: Dict[str, Any]) -> bool:
    return _is_lab_room_type(room.get("room_type") or "")


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


@functools.lru_cache(maxsize=1024)
def _is_pathfit_course_no(course_no: str) -> bool:
    return bool(_PATHFIT_RE.search(normalize_text(course_no)))


def is_pathfit_subject(subject: Dict[str, Any]) -> bool:
    """True when course_no contains 'PATH FIT' (case-insensitive, spaces/punctuation ignored)."""
    course_no = subject.get("course_no") or subject.get("subject_course_no") or ""
    return _is_pathfit_course_no(course_no)


@functools.lru_cache(maxsize=256)
def _is_gym_room_name(room_name: str) -> bool:
    return bool(_GYM_RE.search(normalize_text(room_name)))


def is_gym_room(room: Dict[str, Any]) -> bool:
    """True when room_name contains 'GYM' (case-insensitive)."""
    return _is_gym_room_name(room.get("room_name") or "")


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

    # R-H1: room conflicts for non-GYM rooms — mark both subjects as violators.
    # GYM rooms are handled separately by R-GYM below.
    # Using a set ensures hard_violations <= n regardless of how many pairs conflict.
    for rk, slots in room_day_slots.items():
        ri_str = rk.split("|")[0]
        ri_int = int(ri_str) if ri_str.isdigit() else -1
        if 0 <= ri_int < len(rooms) and is_gym_room(rooms[ri_int]):
            continue  # GYM room conflicts handled in R-GYM
        ss = sorted(slots, key=lambda x: x[0])
        for i in range(1, len(ss)):
            if ss[i][0] < ss[i - 1][1]:
                # Only flag GA-scheduled subjects (si >= 0); si == -1 are reserved slots
                if ss[i][2] >= 0:
                    hard_violation_subs.add(ss[i][2])
                if ss[i - 1][2] >= 0:
                    hard_violation_subs.add(ss[i - 1][2])

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
    section_indices: Optional[Dict[str, List[int]]] = None,
) -> List[Tuple[int, int, int, int]]:
    """Section-aware crossover: swap ALL genes for each section as a unit.

    Gene-by-gene uniform crossover creates S-H11 section conflicts by mixing
    time slots from two parents within the same section.  Swapping whole sections
    preserves intra-section coherence (same pattern, balanced daily load) while
    still combining solutions across sections.

    section_indices may be precomputed once in run_schedule_ga and passed in to
    avoid rebuilding the grouping dict on every crossover call.
    """
    if section_indices is None:
        section_indices = {}
        for i, s in enumerate(subjects):
            section_indices.setdefault(_sec_key(s), []).append(i)

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

    # Standard room conflict for non-GYM rooms
    for rk, slots in room_day.items():
        ss = sorted(slots, key=lambda x: x[0])
        for i in range(1, len(ss)):
            if ss[i][0] < ss[i - 1][1]:
                ri, day = rk.split("|", 1)
                rn = rooms[int(ri)].get("room_name", "?") if int(ri) < len(rooms) else "?"
                conflicts.append({
                    "type": "room_conflict", "day": day, "room": rn,
                    "subjects": [ss[i - 1][2], ss[i][2]],
                    "problem": f"Room overlap on {day}: {ss[i-1][2]} and {ss[i][2]}",
                })

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
        ss = sorted(slots, key=lambda x: x[0])
        for i in range(1, len(ss)):
            if ss[i][0] < ss[i - 1][1]:
                sec, day = sk.rsplit("|", 1)
                conflicts.append({
                    "type": "section_conflict", "day": day, "section": sec,
                    "subjects": [ss[i - 1][2], ss[i][2]],
                    "problem": f"Section overlap on {day}: {ss[i-1][2]} and {ss[i][2]}",
                })

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
            ss = sorted(slots, key=lambda x: x[0])
            for i in range(1, len(ss)):
                if ss[i][0] < ss[i - 1][1]:
                    if ss[i][2] >= 0:
                        viol_subs.add(ss[i][2])
                    if ss[i - 1][2] >= 0:
                        viol_subs.add(ss[i - 1][2])

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
                        # Valid slot found
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

    # ── Pre-flight: extract GENERAL subjects before GA touches anything ──────
    # All general subjects are LOCKED — the GA must not auto-fill or modify them.
    # GENERAL+SCHEDULED → kept in assignments output as-is (visual tag "General").
    # GENERAL+EMPTY → same, but flagged with schedule_missing=True so the
    #   frontend can warn the admin; they stay in the output so they are never
    #   lost when the user later updates the course offering.
    locked_general: List[Dict[str, Any]] = []
    non_general_subjects: List[Dict[str, Any]] = []
    for s in subjects:
        if s.get("is_general"):
            locked_general.append(s)
        else:
            non_general_subjects.append(s)
    subjects = non_general_subjects

    locked_general_assignments: List[Dict[str, Any]] = []
    for s in locked_general:
        mth_sched = s.get("mth_schedule")
        tfs_sched = s.get("tfs_schedule")
        is_empty  = not mth_sched and not tfs_sched
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
            "is_general":        True,
            "mth_schedule":      mth_sched,
            "mth_room_id":       s.get("mth_room_id"),
            "mth_room_name":     normalize_text(s.get("mth_room_name") or ""),
            "tfs_schedule":      tfs_sched,
            "tfs_room_id":       s.get("tfs_room_id"),
            "tfs_room_name":     normalize_text(s.get("tfs_room_name") or ""),
        }
        if is_empty:
            row["schedule_missing"] = True
        locked_general_assignments.append(row)

    if locked_general:
        print(
            f"[GA-DIAG] locked_general={len(locked_general)} "
            f"(empty={sum(1 for s in locked_general if not s.get('mth_schedule') and not s.get('tfs_schedule'))})",
            flush=True,
        )

    # Merge LOCKED general subjects (SCHEDULED only) into pre_occ so the GA
    # treats their time slots and rooms as hard constraints.
    scheduled_locked_assignments = [
        a for a in locked_general_assignments
        if a.get("mth_schedule") or a.get("tfs_schedule")
    ]
    if scheduled_locked_assignments:
        locked_pre_occ = _build_pre_occupied(scheduled_locked_assignments, rooms)
        if pre_occ is None:
            pre_occ = locked_pre_occ
        else:
            pre_occ["room_entries"].extend(locked_pre_occ["room_entries"])
            pre_occ["section_entries"].extend(locked_pre_occ["section_entries"])
        print(
            f"[GA-DIAG] locked_general_constraints={len(scheduled_locked_assignments)} "
            f"added room_entries={len(locked_pre_occ['room_entries'])} "
            f"section_entries={len(locked_pre_occ['section_entries'])}",
            flush=True,
        )

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

    # If all subjects were general (LOCKED), skip the GA entirely.
    if not subjects:
        return {
            "assignments":     locked_general_assignments,
            "unresolved":      [],
            "human_review":    [],
            "fitness_overall": 100.0,
            "fitness_hard":    100.0,
            "fitness_soft":    100.0,
            "generations":     0,
            "runtime_ms":      int((time.perf_counter() - started) * 1000),
            "run_id":          sha1(
                json.dumps({"seed": seed, "n": 0}, sort_keys=True).encode()
            ).hexdigest()[:16],
            "constraints":     constraints,
            "report": {
                "summary":        "All subjects are general (locked) — no GA run needed.",
                "conflicts":      [],
                "conflict_count": 0,
            },
        }

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

    # Precompute section grouping once — subjects never change during the GA loop,
    # so there is no need to rebuild this dict inside every sched_crossover call.
    _sec_indices: Dict[str, List[int]] = {}
    for _ci, _cs in enumerate(subjects):
        _sec_indices.setdefault(_sec_key(_cs), []).append(_ci)

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
                child = sched_crossover(pa, pb, subjects, rng, _sec_indices)
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

    # Final validation: subjects still in hard conflict after repair are moved to
    # unresolved so callers are never given a schedule that contains violations.
    if conflicts:
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
                    "reason_type":       "unresolvable_conflict",
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
        "assignments":     locked_general_assignments + assignments,
        "unresolved":      unresolved,
        "human_review":    [],
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
