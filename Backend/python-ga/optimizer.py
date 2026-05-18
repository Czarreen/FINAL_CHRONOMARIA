"""Chronomaria faculty loading GA service."""

from __future__ import annotations

import json
import math
import os
import random
import re
import time
from hashlib import sha1
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Sequence, Tuple


def normalize_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalize_upper(value: Any) -> str:
    return normalize_text(value).upper()


def to_number(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def split_tokens(value: Any) -> List[str]:
    return [token.strip() for token in re.split(r"[,;/|]+", normalize_text(value)) if token.strip()]


DAY_ALIASES = {
    "M": "MON",
    "MON": "MON",
    "MONDAY": "MON",
    "T": "TUE",
    "TU": "TUE",
    "TUE": "TUE",
    "TUES": "TUE",
    "TUESDAY": "TUE",
    "TH": "THU",
    "THU": "THU",
    "THUR": "THU",
    "THURS": "THU",
    "THURSDAY": "THU",
    "F": "FRI",
    "FRI": "FRI",
    "FRIDAY": "FRI",
    "SAT": "SAT",
    "SATURDAY": "SAT",
    "S": "SAT",
}

AUTOMATED_DAYS = ("MON", "TUE", "THU", "FRI")


def extract_keywords(value: Any) -> List[str]:
    keywords: List[str] = []
    for token in split_tokens(value):
        for part in re.split(r"\s+", token):
            cleaned = re.sub(r"[^A-Za-z0-9]", "", part).upper()
            if len(cleaned) >= 2:
                keywords.append(cleaned)
    return keywords


def parse_time_range(schedule_text: Any) -> Optional[Dict[str, int]]:
    text = normalize_upper(schedule_text).replace(".", " ")
    match = re.search(
        r"(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    def parse_minutes(token: str, is_end: bool = False) -> Optional[int]:
        cleaned = normalize_upper(token).replace(" ", "")
        time_match = re.match(r"^(\d{1,2})(?::(\d{2}))?(AM|PM)?$", cleaned, flags=re.IGNORECASE)
        if not time_match:
            return None

        hour = int(time_match.group(1))
        minute = int(time_match.group(2) or "0")
        meridiem = (time_match.group(3) or "").upper() or None

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

    return {"start": start, "end": end, "duration": end - start}


def parse_days_from_schedule(schedule_text: Any, group: str) -> List[str]:
    text = normalize_upper(schedule_text)
    compact = re.sub(r"[^A-Z]", " ", text).strip()
    parts = compact.split() if compact else []
    days: List[str] = []

    def add_day(day: str) -> None:
        if day not in days:
            days.append(day)

    for part in parts:
        if part in DAY_ALIASES:
            add_day(DAY_ALIASES[part])
            continue
        if part == "MTH":
            add_day("MON")
            add_day("THU")
            continue
        if part in ("TF", "TFS"):
            add_day("TUE")
            add_day("FRI")
            continue
        if "MON" in part:
            add_day("MON")
        if "TH" in part:
            add_day("THU")
        if "TUE" in part:
            add_day("TUE")
        if "FRI" in part:
            add_day("FRI")

    if not days:
        if group == "MTH":
            days = ["MON", "THU"]
        elif group in ("TFS", "TF"):
            days = ["TUE", "FRI"]

    return days


def build_schedule_blocks(offering: Dict[str, Any]) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    for group in ("mth", "tfs"):
        schedule_text = normalize_text(offering.get(f"{group}_schedule"))
        if not schedule_text:
            continue
        parsed = parse_time_range(schedule_text)
        if not parsed:
            continue
        group_name = group.upper()
        days = parse_days_from_schedule(schedule_text, group_name)
        blocks.append({"group": group_name, "days": days, "schedule_text": schedule_text, **parsed})
    return blocks


def overlaps(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    return left["start"] < right["end"] and right["start"] < left["end"]


def blocks_overlap_with_days(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    left_days = set(left.get("days", []))
    right_days = set(right.get("days", []))
    if not left_days.intersection(right_days):
        return False
    return overlaps(left, right)


def faculty_has_conflict(existing: Sequence[Dict[str, Any]], candidate: Sequence[Dict[str, Any]]) -> bool:
    for left in existing:
        for right in candidate:
            if blocks_overlap_with_days(left, right):
                return True
    return False


def consecutive_minutes_for_day(blocks: Sequence[Dict[str, Any]], day: str) -> float:
    day_blocks = sorted([b for b in blocks if day in set(b.get("days", []))], key=lambda b: b["start"])
    if not day_blocks:
        return 0.0

    max_run = 0.0
    current_run = 0.0
    previous: Optional[Dict[str, Any]] = None
    for block in day_blocks:
        if previous is None:
            current_run = float(block.get("duration", 0.0))
        else:
            gap = max(0.0, float(block["start"]) - float(previous["end"]))
            if gap < 30.0:
                current_run += float(block.get("duration", 0.0))
            else:
                max_run = max(max_run, current_run)
                current_run = float(block.get("duration", 0.0))
        previous = block

    return max(max_run, current_run)


def daily_minutes(blocks: Sequence[Dict[str, Any]]) -> Dict[str, float]:
    totals: Dict[str, float] = {day: 0.0 for day in AUTOMATED_DAYS}
    for day in AUTOMATED_DAYS:
        day_blocks = sorted([b for b in blocks if day in set(b.get("days", []))], key=lambda b: b["start"])
        merged: List[Tuple[float, float]] = []
        for b in day_blocks:
            start = float(b["start"])
            end = float(b["end"])
            if not merged or start >= merged[-1][1]:
                merged.append((start, end))
            else:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        totals[day] = sum(end - start for start, end in merged)
    return totals


def normalize_role(role: Any) -> str:
    role_text = normalize_upper(role)
    if role_text.startswith("FT"):
        return "FT"
    if role_text.startswith("PT"):
        return "PT"
    return role_text or "UNKNOWN"


def build_subject_index(subjects: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    for subject in subjects:
        key = "|".join(
            [
                str(int(to_number(subject.get("department_id")) or 0)),
                normalize_upper(subject.get("subject_code")),
                normalize_upper(subject.get("subject_course_no")),
                normalize_upper(subject.get("subject_section")),
            ]
        )
        index.setdefault(key, subject)
    return index


def build_offering_key(offering: Dict[str, Any]) -> str:
    return "|".join(
        [
            str(int(to_number(offering.get("department_id")) or 0)),
            normalize_upper(offering.get("code")),
            normalize_upper(offering.get("course_no")),
            normalize_upper(offering.get("section")),
        ]
    )

def match_specialization_score(faculty: Dict[str, Any], offering: Dict[str, Any], matched_subject: Optional[Dict[str, Any]]) -> float:
    source_text = " ".join(
        filter(
            None,
            [
                normalize_upper(faculty.get("faculty_specialization")),
                normalize_upper(faculty.get("faculty_role")),
                normalize_upper(faculty.get("department_name")),
            ],
        )
    )
    offering_text = " ".join(
        filter(
            None,
            [
                normalize_upper(offering.get("code")),
                normalize_upper(offering.get("course_no")),
                normalize_upper(offering.get("descriptive_title")),
                normalize_upper(matched_subject.get("subject_descriptive_title")) if matched_subject else "",
                normalize_upper(matched_subject.get("subject_code")) if matched_subject else "",
                normalize_upper(matched_subject.get("subject_course_no")) if matched_subject else "",
            ],
        )
    )

    source_tokens = set(extract_keywords(source_text))
    offering_tokens = set(extract_keywords(offering_text))

    score = 0.0
    for token in offering_tokens:
        if token in source_tokens:
            score += 8.0

    if normalize_upper(offering.get("descriptive_title")) and normalize_upper(offering.get("descriptive_title")) in source_text:
        score += 25.0

    if normalize_upper(offering.get("code")) and normalize_upper(offering.get("code")) in source_text:
        score += 20.0

    if normalize_upper(offering.get("course_no")) and normalize_upper(offering.get("course_no")) in source_text:
        score += 15.0

    return score


def prep_key(offering: Dict[str, Any]) -> str:
    return f"{normalize_upper(offering.get('code'))}|{normalize_upper(offering.get('course_no'))}"


def count_preparations(assignments: Sequence[Dict[str, Any]]) -> int:
    return len({prep_key(assignment["offering"]) for assignment in assignments if assignment.get("offering")})


def is_specialization_match(specialization_score: float) -> bool:
    return specialization_score > 0.0


def score_offering_difficulty(offering: Dict[str, Any], faculties: Sequence[Dict[str, Any]], subject_index: Dict[str, Dict[str, Any]]) -> float:
    matched_subject = subject_index.get(build_offering_key(offering))
    matches = 0
    for faculty in faculties:
        dept_match = to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))
        specialization_score = match_specialization_score(faculty, offering, matched_subject)
        if dept_match or specialization_score > 0:
            matches += 1
    return 1000.0 - matches * 90.0 - (to_number(offering.get("units")) or 0.0) * 10.0


def choose_best_faculty(
    offering: Dict[str, Any],
    faculties: Sequence[Dict[str, Any]],
    loads: Dict[int, float],
    subject_index: Dict[str, Dict[str, Any]],
    rng: random.Random,
    current_assignments: Optional[Dict[int, List[Dict[str, Any]]]] = None,
) -> Optional[int]:
    matched_subject = subject_index.get(build_offering_key(offering))
    base_candidates: List[Dict[str, Any]] = []
    offering_blocks = build_schedule_blocks(offering)
    candidate_prep = prep_key(offering)

    for index, faculty in enumerate(faculties):
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        current_load = loads.get(index, 0.0)
        max_units = to_number(faculty.get("faculty_max_units"))
        if max_units is None:
            max_units = 0.0
        # Hard filter: faculty with zero or negative capacity are not eligible
        if max_units <= 0.0:
            continue
        projected_units = current_load + units
        dept_match = to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))
        role = normalize_role(faculty.get("faculty_role"))
        specialization_score = match_specialization_score(faculty, offering, matched_subject)
        status = normalize_upper(faculty.get("faculty_status"))

        # Hard filter: inactive or would exceed faculty_max_units
        if status != "ACTIVE":
            continue
        if projected_units > max_units:
            continue

        # Hard constraint checks based on current assignments:
        assignments_for_faculty = (current_assignments or {}).get(index, [])
        # F-H8: preparations must not exceed 4
        prep_set = {prep_key(a["offering"]) for a in assignments_for_faculty if a.get("offering")}
        prep_set.add(candidate_prep)
        new_prep = len(prep_set)
        if new_prep > 4:
            continue

        existing_blocks: List[Dict[str, Any]] = []
        for a in assignments_for_faculty:
            existing_blocks.extend(build_schedule_blocks(a.get("offering") if isinstance(a, dict) and a.get("offering") else a))

        # F-H1: strict no double-booking.
        if faculty_has_conflict(existing_blocks, offering_blocks):
            continue

        combined_blocks = [*existing_blocks, *offering_blocks]

        # F-H7: strict max 4 consecutive hours per day.
        if any(consecutive_minutes_for_day(combined_blocks, day) > 240.0 for day in AUTOMATED_DAYS):
            continue

        # F-S3: keep daily teaching within 8-10 hour guidance (hard cap at 10h).
        day_totals = daily_minutes(combined_blocks)
        if any(total > 600.0 for total in day_totals.values()):
            continue

        base_candidates.append(
            {
                "index": index,
                "role": role,
                "dept_match": dept_match,
                "specialization_score": specialization_score,
                "projected_units": projected_units,
                "max_units": max_units,
                "current_load": current_load,
                "day_totals": day_totals,
                "combined_blocks": combined_blocks,
            }
        )

    if not base_candidates:
        return None

    # Priority 1 — specialization match wins.
    specialized = [candidate for candidate in base_candidates if is_specialization_match(candidate["specialization_score"])]
    priority_pool = specialized if specialized else base_candidates

    # Priority 2 — same department first.
    same_department = [candidate for candidate in priority_pool if candidate["dept_match"]]
    if same_department:
        priority_pool = same_department
    elif not specialized:
        # Priority 3 fallback for non-specialized cross-department is recommendation-only.
        return None

    # Priority 4 — full-time first at each stage.
    full_time = [candidate for candidate in priority_pool if candidate["role"] == "FT"]
    if full_time:
        priority_pool = full_time

    def candidate_soft_score(candidate: Dict[str, Any]) -> float:
        score = 0.0
        projected_units = float(candidate["projected_units"])
        max_units = float(candidate["max_units"])
        current_load = float(candidate["current_load"])
        specialization_score = float(candidate["specialization_score"])
        day_totals = candidate["day_totals"]
        combined_blocks = candidate["combined_blocks"]

        # F-S1: prioritize earlier schedules near 7:30 AM.
        earliest_start = min((float(block["start"]) for block in combined_blocks), default=450.0)
        score -= max(0.0, earliest_start - 450.0) * 0.02

        # F-S2/F-S4: reward workable breaks and compact schedules.
        for day in AUTOMATED_DAYS:
            day_blocks = sorted([b for b in combined_blocks if day in set(b.get("days", []))], key=lambda b: b["start"])
            for idx in range(1, len(day_blocks)):
                gap = max(0.0, float(day_blocks[idx]["start"]) - float(day_blocks[idx - 1]["end"]))
                if 0.0 < gap < 30.0:
                    score -= 8.0
                elif gap > 30.0:
                    score -= gap / 20.0

        # F-S7: distribute load across days.
        daily_values = [float(day_totals[day]) for day in AUTOMATED_DAYS]
        mean_daily = sum(daily_values) / max(1, len(daily_values))
        variance = sum((value - mean_daily) ** 2 for value in daily_values) / max(1, len(daily_values))
        score -= variance / 6000.0

        # F-S3: discourage loads above 8h/day even if <=10h hard cap.
        score -= sum(max(0.0, value - 480.0) for value in daily_values) * 0.04

        # F-S8/F-S9/F-S10 signals.
        score += 1.5 if candidate["role"] == "FT" else 0.0
        score += (projected_units / max_units) * 2.0 if max_units > 0 else 0.0
        score -= current_load * 0.03
        score += specialization_score * 0.06
        if candidate["dept_match"]:
            score += 0.8

        return score

    scored = [(candidate["index"], candidate_soft_score(candidate)) for candidate in priority_pool]
    scored.sort(key=lambda pair: (-pair[1], pair[0], rng.random()))
    return scored[0][0]


def build_recommended_candidates(
    offering: Dict[str, Any],
    faculties: Sequence[Dict[str, Any]],
    loads: Dict[int, float],
    subject_index: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    matched_subject = subject_index.get(build_offering_key(offering))
    candidates: List[Tuple[float, Dict[str, Any]]] = []

    for index, faculty in enumerate(faculties):
        if normalize_upper(faculty.get("faculty_status")) != "ACTIVE":
            continue
        max_units = max(1.0, to_number(faculty.get("faculty_max_units")) or 1.0)
        current = loads.get(index, 0.0)
        available = max(0.0, max_units - current)
        if available <= 0:
            continue
        specialization = match_specialization_score(faculty, offering, matched_subject)
        same_dept = to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))
        rec_score = specialization + (18.0 if same_dept else 4.0) + (available * 0.8)
        candidates.append(
            (
                rec_score,
                {
                    "faculty_id": faculty.get("faculty_id"),
                    "faculty_name": faculty.get("faculty_name"),
                    "department_id": faculty.get("department_id"),
                    "department_name": faculty.get("department_name"),
                    "faculty_role": faculty.get("faculty_role"),
                    "available_units": round(available, 2),
                    "specialization_score": round(specialization, 2),
                    "same_department": same_dept,
                },
            )
        )

    candidates.sort(key=lambda item: -item[0])
    return [item[1] for item in candidates[:5]]


def build_initial_candidate(
    faculties: Sequence[Dict[str, Any]],
    offerings: Sequence[Dict[str, Any]],
    subject_index: Dict[str, Dict[str, Any]],
    rng: random.Random,
    initial_loads: Optional[Dict[int, float]] = None,
) -> Tuple[List[int], List[Dict[str, Any]]]:
    loads: Dict[int, float] = {}
    if initial_loads:
        # copy initial loads (keys are faculty indices)
        loads.update({int(k): float(v) for k, v in initial_loads.items()})
    assignments: List[int] = [-1 for _ in offerings]
    unassigned: List[Dict[str, Any]] = []

    ordering = sorted(
        (
            (index, offering, score_offering_difficulty(offering, faculties, subject_index))
            for index, offering in enumerate(offerings)
        ),
        key=lambda entry: (-entry[2], entry[0]),
    )

    # maintain assignment lists per faculty to enforce prep/consecutive rules
    faculty_assignments: Dict[int, List[Dict[str, Any]]] = {}

    for index, offering, _difficulty in ordering:
        offering_blocks = build_schedule_blocks(offering)
        has_automated_days = any(set(block.get("days", [])).intersection(set(AUTOMATED_DAYS)) for block in offering_blocks)
        if offering_blocks and not has_automated_days:
            unassigned.append(
                {
                    "offering_id": offering.get("id"),
                    "code": offering.get("code"),
                    "course_no": offering.get("course_no"),
                    "section": offering.get("section"),
                    "descriptive_title": offering.get("descriptive_title"),
                    "reason": "Saturday-only schedules are user-defined and excluded from automated faculty loading.",
                    "recommended_candidates": [],
                }
            )
            continue

        faculty_index = choose_best_faculty(offering, faculties, loads, subject_index, rng, current_assignments=faculty_assignments)
        if faculty_index is None:
            unassigned.append(
                {
                    "offering_id": offering.get("id"),
                    "code": offering.get("code"),
                    "course_no": offering.get("course_no"),
                    "section": offering.get("section"),
                    "descriptive_title": offering.get("descriptive_title"),
                    "reason": "No eligible faculty after specialization/department/role/units checks.",
                    "recommended_candidates": build_recommended_candidates(offering, faculties, loads, subject_index),
                }
            )
            continue

        assignments[index] = faculty_index
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        loads[faculty_index] = loads.get(faculty_index, 0.0) + units
        # record assignment for hard checks
        faculty_assignments.setdefault(faculty_index, []).append({"offering": offering})

    return assignments, unassigned


def mutate(candidate: Sequence[int], faculties: Sequence[Dict[str, Any]], offerings: Sequence[Dict[str, Any]], subject_index: Dict[str, Dict[str, Any]], rng: random.Random, mutation_rate: float) -> List[int]:
    next_candidate = list(candidate)
    loads: Dict[int, float] = {}

    # build loads and faculty assignments from existing candidate
    faculty_assignments: Dict[int, List[Dict[str, Any]]] = {}
    for index, faculty_index in enumerate(next_candidate):
        units = to_number(offerings[index].get("units")) or to_number(offerings[index].get("lec_hrs")) or 0.0
        if faculty_index is None or faculty_index < 0:
            continue
        loads[faculty_index] = loads.get(faculty_index, 0.0) + units
        faculty_assignments.setdefault(faculty_index, []).append({"offering": offerings[index]})

    for index, offering in enumerate(offerings):
        if rng.random() > mutation_rate:
            continue
        current = next_candidate[index]
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        if current is not None and current >= 0:
            loads[current] = max(0.0, loads.get(current, 0.0) - units)
            if current in faculty_assignments:
                faculty_assignments[current] = [
                    item for item in faculty_assignments[current]
                    if item.get("offering") is not offerings[index]
                ]
        replacement = choose_best_faculty(offering, faculties, loads, subject_index, rng, current_assignments=faculty_assignments)
        next_candidate[index] = replacement if replacement is not None else -1
        # update loads and assignments maps
        if replacement is not None:
            loads[replacement] = loads.get(replacement, 0.0) + units
            faculty_assignments.setdefault(replacement, []).append({"offering": offering})

    return next_candidate


def crossover(parent_a: Sequence[int], parent_b: Sequence[int], rng: random.Random) -> List[int]:
    return [parent_a[index] if rng.random() < 0.5 else parent_b[index] for index in range(len(parent_a))]


def create_rng(seed: Any) -> random.Random:
    return random.Random(int(to_number(seed) or 1))


def summarize_candidate(candidate: Sequence[int], faculties: Sequence[Dict[str, Any]], offerings: Sequence[Dict[str, Any]], subject_index: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    assignments: List[Dict[str, Any]] = []
    unassigned_subjects: List[Dict[str, Any]] = []
    for offering_index, faculty_index in enumerate(candidate):
        offering = offerings[offering_index]
        if faculty_index is None or faculty_index < 0 or faculty_index >= len(faculties):
            unassigned_subjects.append(
                {
                    "offering_id": offering.get("id"),
                    "code": offering.get("code"),
                    "course_no": offering.get("course_no"),
                    "section": offering.get("section"),
                    "descriptive_title": offering.get("descriptive_title"),
                    "reason": "No assigned faculty.",
                }
            )
            continue
        faculty = faculties[faculty_index]
        assignments.append(
            {
                "faculty": faculty,
                "offering": offering,
                "matched_subject": subject_index.get(build_offering_key(offering)),
                "schedule_blocks": build_schedule_blocks(offering),
            }
        )

    loads: Dict[int, float] = {}
    faculty_assignments: Dict[int, List[Dict[str, Any]]] = {}
    block_map: Dict[int, List[Dict[str, Any]]] = {}
    all_units = 0.0

    for assignment in assignments:
        faculty_id = int(to_number(assignment["faculty"].get("faculty_id")) or 0)
        units = to_number(assignment["offering"].get("units")) or to_number(assignment["offering"].get("lec_hrs")) or 0.0
        all_units += units
        loads[faculty_id] = loads.get(faculty_id, 0.0) + units
        faculty_assignments.setdefault(faculty_id, []).append(assignment)
        block_map.setdefault(faculty_id, []).extend(assignment["schedule_blocks"])

    hard_penalty = 0.0
    soft_penalty = 0.0
    conflicts: List[Dict[str, Any]] = []
    fragmented_faculty: List[int] = []
    average_load = all_units / max(1, len(faculties))

    for faculty in faculties:
        faculty_id = int(to_number(faculty.get("faculty_id")) or 0)
        total_units = loads.get(faculty_id, 0.0)
        max_units = to_number(faculty.get("faculty_max_units")) or 0.0
        assignments_for_faculty = faculty_assignments.get(faculty_id, [])

        if total_units > max_units > 0:
          hard_penalty += (total_units - max_units) * 24.0
          conflicts.append({"type": "overload", "faculty_id": faculty_id, "problem": f"Faculty exceeds max units by {total_units - max_units:.2f}"})

        if normalize_role(faculty.get("faculty_role")) == "FT":
            soft_penalty -= 4.0
        elif normalize_role(faculty.get("faculty_role")) == "PT":
            soft_penalty += 4.0

        if assignments_for_faculty:
            dept_matches = sum(
                to_number(item["offering"].get("units")) or 0.0
                for item in assignments_for_faculty
                if to_number(item["offering"].get("department_id")) == to_number(faculty.get("department_id"))
            )
            if total_units > 0:
                dept_ratio = dept_matches / total_units
                if dept_ratio < 0.75:
                    soft_penalty += (0.75 - dept_ratio) * 35.0

        diff = total_units - average_load
        soft_penalty += diff * diff * 0.35

        prep_count = count_preparations(assignments_for_faculty)
        if prep_count > 4:
            # Hard violation: too many preparations
            hard_penalty += (prep_count - 4) * 120.0
            conflicts.append({"type": "preparations", "faculty_id": faculty_id, "problem": f"Faculty has {prep_count} preparations (exceeds 4)"})

        blocks = block_map.get(faculty_id, [])
        if len(blocks) >= 1:
            day_totals = daily_minutes(blocks)
            daily_values = [day_totals[day] for day in AUTOMATED_DAYS]

            # Hard conflict checks per day.
            for day in AUTOMATED_DAYS:
                day_blocks = sorted([b for b in blocks if day in set(b.get("days", []))], key=lambda b: b["start"])
                for idx in range(1, len(day_blocks)):
                    if overlaps(day_blocks[idx - 1], day_blocks[idx]):
                        hard_penalty += 40.0
                        conflicts.append({"type": "time_conflict", "faculty_id": faculty_id, "problem": f"Faculty has overlapping schedule blocks on {day}"})

                max_consecutive = consecutive_minutes_for_day(blocks, day)
                if max_consecutive > 240.0:
                    hard_penalty += (max_consecutive - 240.0) * 10.0
                    conflicts.append({"type": "consecutive_hours", "faculty_id": faculty_id, "problem": f"Faculty has {max_consecutive/60:.2f} consecutive teaching hours (>4) on {day}"})

            # F-S2/F-S4: gap penalties and schedule fragmentation.
            gap_total = 0.0
            gap_count = 0
            for day in AUTOMATED_DAYS:
                day_blocks = sorted([b for b in blocks if day in set(b.get("days", []))], key=lambda b: b["start"])
                for idx in range(1, len(day_blocks)):
                    gap = max(0.0, float(day_blocks[idx]["start"]) - float(day_blocks[idx - 1]["end"]))
                    gap_total += gap
                    gap_count += 1
                    if 0.0 < gap < 30.0:
                        soft_penalty += 8.0

            avg_gap = gap_total / max(1, gap_count)
            if avg_gap > 30.0:
                soft_penalty += avg_gap / 8.0
                fragmented_faculty.append(faculty_id)

            # F-S3: discourage exceeding 8 hours/day (soft) and 10 hours/day (strong soft).
            for value in daily_values:
                if value > 480.0:
                    soft_penalty += (value - 480.0) / 10.0
                if value > 600.0:
                    soft_penalty += (value - 600.0) / 4.0

            # F-S7: day-balance preference.
            mean_daily = sum(daily_values) / max(1, len(daily_values))
            variance = sum((value - mean_daily) ** 2 for value in daily_values) / max(1, len(daily_values))
            soft_penalty += variance / 5000.0

        if max_units > 0:
            utilization = total_units / max_units if max_units else 0.0
            if 0.8 <= utilization <= 1.0:
                soft_penalty -= 12.0
            elif utilization < 0.5:
                soft_penalty += (0.5 - utilization) * 18.0
            elif utilization > 1.0:
                hard_penalty += (utilization - 1.0) * 70.0

        for item in assignments_for_faculty:
            offering = item["offering"]
            matched_subject = item["matched_subject"]
            specialization_score = match_specialization_score(faculty, offering, matched_subject)
            soft_penalty -= specialization_score
            if to_number(faculty.get("department_id")) != to_number(offering.get("department_id")):
                soft_penalty += 22.0
                conflicts.append({"type": "department_mismatch", "faculty_id": faculty_id, "offering_id": offering.get("id"), "problem": "Faculty department does not match course offering department"})

    # F-S10: keep loads fair within each department.
    dept_loads: Dict[int, List[float]] = {}
    for faculty in faculties:
        dept_id = int(to_number(faculty.get("department_id")) or 0)
        faculty_id = int(to_number(faculty.get("faculty_id")) or 0)
        dept_loads.setdefault(dept_id, []).append(loads.get(faculty_id, 0.0))

    for load_values in dept_loads.values():
        if len(load_values) < 2:
            continue
        mean_load = sum(load_values) / len(load_values)
        variance = sum((value - mean_load) ** 2 for value in load_values) / len(load_values)
        soft_penalty += variance * 0.15

    if unassigned_subjects:
        hard_penalty += len(unassigned_subjects) * 140.0

    assignment_count = max(1, len(assignments) + len(unassigned_subjects))
    normalized_hard_penalty = hard_penalty / assignment_count
    normalized_soft_penalty = soft_penalty / assignment_count
    hard_score = max(0.0, 100.0 - normalized_hard_penalty)
    soft_score = max(0.0, 100.0 - normalized_soft_penalty)
    overall = max(0.0, min(100.0, hard_score * 0.68 + soft_score * 0.32))

    faculty_load_balance: List[Dict[str, Any]] = []
    faculty_free_units: List[Dict[str, Any]] = []
    for faculty in faculties:
        faculty_id = int(to_number(faculty.get("faculty_id")) or 0)
        total_units = loads.get(faculty_id, 0.0)
        max_units = to_number(faculty.get("faculty_max_units")) or 0.0
        class_count = len(faculty_assignments.get(faculty_id, []))
        free_units = max(0.0, max_units - total_units)
        row = {
            "faculty_id": faculty_id,
            "faculty_name": faculty.get("faculty_name"),
            "faculty_role": faculty.get("faculty_role"),
            "department_id": faculty.get("department_id"),
            "department_name": faculty.get("department_name"),
            "total_units": round(total_units, 2),
            "max_units": round(max_units, 2),
            "free_units": round(free_units, 2),
            "class_count": class_count,
            "imbalance_score": round(abs(total_units - average_load), 2),
        }
        faculty_load_balance.append(row)
        if free_units > 0:
            faculty_free_units.append(row)

    explainability = [
        f"{assignment['faculty'].get('faculty_name') or f'Faculty #{assignment['faculty'].get('faculty_id')}'}: {normalize_text(assignment['offering'].get('code'))} {normalize_text(assignment['offering'].get('descriptive_title'))} ({normalize_text(assignment['offering'].get('units'))} units)."
        for assignment in assignments[:12]
    ]

    return {
        "assignments": assignments,
        "fitness_overall": round(overall, 2),
        "fitness_hard": round(hard_score, 2),
        "fitness_soft": round(soft_score, 2),
        "report": {
            "summary": f"Generated {len(assignments)} faculty loading assignment(s); {len(unassigned_subjects)} unassigned.",
            "faculty_load_balance": faculty_load_balance,
            "faculty_free_units": faculty_free_units,
            "unassigned_subjects": unassigned_subjects,
            "hard_violations": [item for item in conflicts if item["type"] in {"time_conflict", "room_conflict", "overload", "department_mismatch"}],
            "soft_penalties": [],
            "schedule_fragmentation": {"faculty_with_scattered_schedule": fragmented_faculty},
            "explainability": explainability,
            "conflicts": conflicts,
            "load_imbalance_score": round(sum((loads.get(int(to_number(f.get('faculty_id')) or 0), 0.0) - average_load) ** 2 for f in faculties), 2),
            "fitness_summary": {
                "assignment_count": assignment_count,
                "normalized_hard_penalty": round(normalized_hard_penalty, 2),
                "normalized_soft_penalty": round(normalized_soft_penalty, 2),
            },
        },
    }


def run_ga(payload: Dict[str, Any]) -> Dict[str, Any]:
    started_at = time.perf_counter()
    seed = payload.get("constraints", {}).get("random_seed", 123)
    population_size = int(payload.get("constraints", {}).get("population_size", 72))
    max_generations = int(payload.get("constraints", {}).get("max_generations", 120))
    mutation_rate = float(payload.get("constraints", {}).get("mutation_rate", 0.12))
    max_runtime_seconds = float(payload.get("constraints", {}).get("max_runtime_seconds", 20))

    faculties = list(payload.get("faculty", []))
    offerings = list(payload.get("offerings", []))
    all_subjects = list(payload.get("subjects", []))
    existing_loads_rows = list(payload.get("faculty_loading", []))
    # Only consider subjects explicitly marked ACTIVE for assignment
    active_subjects = [s for s in all_subjects if normalize_upper(s.get("subject_status")) == "ACTIVE"]
    # Record inactive subjects for reporting (code, title, curriculum id)
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
    rng = create_rng(seed)

    if not faculties or not offerings:
        return {
            "assignments": [],
            "fitness_overall": 0.0,
            "fitness_hard": 0.0,
            "fitness_soft": 0.0,
            "generations": 0,
            "runtime_ms": int((time.perf_counter() - started_at) * 1000),
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
                "load_imbalance_score": 0.0,
                "inactive_subjects": inactive_subjects_list,
            },
            "run_id": payload.get("run_id") or "empty",
        }

    # Map faculty_id to index for initial loads
    faculty_id_to_index: Dict[int, int] = {}
    for idx, f in enumerate(faculties):
        fid = int(to_number(f.get("faculty_id")) or 0)
        faculty_id_to_index[fid] = idx

    active_subject_units_by_key: Dict[str, float] = {}
    for subject in active_subjects:
        key = "|".join(
            [
                str(int(to_number(subject.get("department_id")) or 0)),
                normalize_upper(subject.get("subject_code")),
                normalize_upper(subject.get("subject_course_no")),
                normalize_upper(subject.get("subject_section")),
            ]
        )
        active_subject_units_by_key[key] = to_number(subject.get("subject_units")) or 0.0

    initial_loads_by_index: Dict[int, float] = {}
    for row in existing_loads_rows:
        fid = int(to_number(row.get("faculty_id")) or 0)
        row_key = "|".join(
            [
                str(int(to_number(row.get("department_id")) or 0)),
                normalize_upper(row.get("code")),
                normalize_upper(row.get("course_no")),
                normalize_upper(row.get("section")),
            ]
        )
        if row_key not in active_subject_units_by_key:
            continue

        units = active_subject_units_by_key.get(row_key, to_number(row.get("units")) or 0.0)
        idx = faculty_id_to_index.get(fid)
        if idx is None:
            continue
        initial_loads_by_index[idx] = initial_loads_by_index.get(idx, 0.0) + units

    # PRE-1 / PRE-2 strict filtering applied once before GA loop.
    filtered_faculties: List[Dict[str, Any]] = []
    remapped_initial_loads: Dict[int, float] = {}
    for old_idx, faculty in enumerate(faculties):
        status = normalize_upper(faculty.get("faculty_status"))
        max_units = to_number(faculty.get("faculty_max_units")) or 0.0
        assigned_units = initial_loads_by_index.get(old_idx, 0.0)
        available_units = max_units - assigned_units

        if status != "ACTIVE":
            continue
        if max_units <= 0.0:
            continue
        if available_units <= 0.0:
            continue

        new_idx = len(filtered_faculties)
        filtered_faculties.append({**faculty, "available_units": available_units, "already_assigned_units": assigned_units})
        remapped_initial_loads[new_idx] = assigned_units

    faculties = filtered_faculties
    initial_loads_by_index = remapped_initial_loads

    if not faculties:
        return {
            "assignments": [],
            "fitness_overall": 0.0,
            "fitness_hard": 0.0,
            "fitness_soft": 0.0,
            "generations": 0,
            "runtime_ms": int((time.perf_counter() - started_at) * 1000),
            "report": {
                "summary": "No eligible active faculty with available units.",
                "faculty_load_balance": [],
                "faculty_free_units": [],
                "hard_violations": [],
                "soft_penalties": [],
                "schedule_fragmentation": {"faculty_with_scattered_schedule": []},
                "unassigned_subjects": [],
                "explainability": [],
                "conflicts": [],
                "load_imbalance_score": 0.0,
                "inactive_subjects": inactive_subjects_list,
            },
            "run_id": payload.get("run_id") or "empty",
        }

    # Build initial population using initial loads
    assignments0, _ = build_initial_candidate(faculties, offerings, subject_index, rng, initial_loads=initial_loads_by_index)
    population: List[List[int]] = [assignments0]
    while len(population) < max(6, population_size):
        variant_assignments, _ = build_initial_candidate(faculties, offerings, subject_index, rng, initial_loads=initial_loads_by_index)
        population.append(mutate(variant_assignments, faculties, offerings, subject_index, rng, min(0.35, mutation_rate * 1.6)))

    best_candidate = population[0]
    best_result = summarize_candidate(best_candidate, faculties, offerings, subject_index)
    best_score = best_result["fitness_overall"]
    stagnant_generations = 0
    generation = 0

    while generation < max_generations:
        if (time.perf_counter() - started_at) >= max_runtime_seconds:
            break

        scored_population: List[Tuple[float, List[int], Dict[str, Any]]] = []
        for candidate in population:
            summary = summarize_candidate(candidate, faculties, offerings, subject_index)
            scored_population.append((summary["fitness_overall"], list(candidate), summary))

        scored_population.sort(key=lambda entry: (-entry[0], entry[1]))
        top_score, top_candidate, top_result = scored_population[0]

        if top_score > best_score:
            best_score = top_score
            best_candidate = top_candidate
            best_result = top_result
            stagnant_generations = 0
        else:
            stagnant_generations += 1

        if stagnant_generations >= 20:
            break

        elite_count = max(2, population_size // 6)
        elites = [candidate for _score, candidate, _summary in scored_population[:elite_count]]
        next_population = [list(candidate) for candidate in elites]

        while len(next_population) < population_size:
            parent_a = rng.choice(elites)
            parent_b = rng.choice(elites)
            child = crossover(parent_a, parent_b, rng)
            child = mutate(child, faculties, offerings, subject_index, rng, mutation_rate)
            next_population.append(child)

        population = next_population
        generation += 1

    final_result = summarize_candidate(best_candidate, faculties, offerings, subject_index)
    final_result["generations"] = generation + 1
    final_result["runtime_ms"] = int((time.perf_counter() - started_at) * 1000)
    final_result["run_id"] = payload.get("run_id") or sha1(
        json.dumps({"payload": payload, "best": best_candidate}, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]
    final_result["constraints"] = {
        "population_size": population_size,
        "max_generations": max_generations,
        "mutation_rate": mutation_rate,
        "max_runtime_seconds": max_runtime_seconds,
        "random_seed": seed,
        "dry_run": bool(payload.get("constraints", {}).get("dry_run")),
    }
    # Attach list of inactive/skipped subjects for visibility in the GA report
    final_result.setdefault("report", {})["inactive_subjects"] = inactive_subjects_list
    return final_result


# ─── Schedule GA (room + time-slot assignment) ────────────────────────────────

_SCHED_START = 7 * 60 + 30   # 7:30 AM in minutes
_SCHED_END   = 20 * 60        # 8:00 PM in minutes
_SCHED_STEP  = 30
_MTH_DAYS    = ("MON", "THU")
_TFS_DAYS    = ("TUE", "FRI")


def _norm_room_ref(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", normalize_upper(str(value or "")))


def _subject_slot_key(s: Dict[str, Any]) -> Optional[str]:
    mth_s = normalize_upper(s.get("mth_schedule") or s.get("existing_mth_schedule") or "")
    tfs_s = normalize_upper(s.get("tfs_schedule") or s.get("existing_tfs_schedule") or "")
    mth_r = _norm_room_ref(
        s.get("mth_room_id") or s.get("existing_mth_room_id") or
        s.get("mth_room") or s.get("raw_mth_room") or ""
    )
    tfs_r = _norm_room_ref(
        s.get("tfs_room_id") or s.get("existing_tfs_room_id") or
        s.get("tfs_room") or s.get("raw_tfs_room") or ""
    )
    if not (mth_s or tfs_s) or not (mth_r or tfs_r):
        return None
    return f"{mth_s}|||{tfs_s}|||{mth_r}|||{tfs_r}"


def _detect_schedule_merge_groups(subjects: List[Dict[str, Any]]) -> Dict[int, int]:
    """
    Group incoming subjects by physical slot key (schedule + room).
    Any N>=2 subjects sharing the same slot are a merge group.
    Returns {non-rep subject_id: rep subject_id} — extras that should not be scheduled.
    """
    slot_map: Dict[str, List[Dict[str, Any]]] = {}
    for s in subjects:
        key = _subject_slot_key(s)
        if key is None:
            continue
        slot_map.setdefault(key, []).append(s)

    merged: Dict[int, int] = {}
    for group in slot_map.values():
        if len(group) < 2:
            continue
        group_sorted = sorted(group, key=lambda s: int(to_number(s.get("subject_id")) or 0))
        rep_id = int(to_number(group_sorted[0].get("subject_id")) or 0)
        for s in group_sorted[1:]:
            sid = int(to_number(s.get("subject_id")) or 0)
            merged[sid] = rep_id
    return merged


def _duration_minutes(subject: Dict[str, Any]) -> int:
    lec = to_number(subject.get("lec_hrs")) or 0.0
    lab = to_number(subject.get("lab_hrs")) or 0.0
    per_day = (lec + lab) / 2.0
    raw = max(30, round(per_day * 60))
    return int(((raw + _SCHED_STEP - 1) // _SCHED_STEP) * _SCHED_STEP)


def _fmt_time(minutes: int) -> str:
    hh12 = (minutes // 60) % 12 or 12
    mm = minutes % 60
    return f"{hh12}:{mm:02d}"


def _sched_text(start: int, end: int) -> str:
    return f"{_fmt_time(start)}-{_fmt_time(end)}"


def _build_reserved_maps(reserved_slots: List[Dict[str, Any]]) -> Tuple[Dict[str, List[Tuple[int, int]]], Dict[str, List[Tuple[int, int]]]]:
    room_map: Dict[str, List[Tuple[int, int]]] = {}
    sect_map: Dict[str, List[Tuple[int, int]]] = {}
    for slot in reserved_slots:
        section = normalize_upper(slot.get("section") or "")
        for pat, days in (("mth", _MTH_DAYS), ("tfs", _TFS_DAYS)):
            sched = slot.get(f"{pat}_schedule") or ""
            room_id = str(slot.get(f"{pat}_room_id") or "")
            if not sched or not room_id:
                continue
            parsed = parse_time_range(sched)
            if not parsed:
                continue
            block: Tuple[int, int] = (parsed["start"], parsed["end"])
            for day in days:
                room_map.setdefault(f"{room_id}|{day}", []).append(block)
                if section:
                    sect_map.setdefault(f"{section}|{day}", []).append(block)
    return room_map, sect_map


def _overlaps_any(start: int, end: int, blocks: List[Tuple[int, int]]) -> bool:
    return any(start < be and bs < end for bs, be in blocks)


# Gene: (room_idx, start_minutes, pattern)  pattern 0=MTH 1=TFS
_Gene = Tuple[int, int, int]
_Chrom = List[Optional[_Gene]]


def _score_chrom(
    chrom: _Chrom,
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    res_room: Dict[str, List[Tuple[int, int]]],
    res_sect: Dict[str, List[Tuple[int, int]]],
) -> float:
    hard = 0.0
    local_room: Dict[str, List[Tuple[int, int]]] = {}
    local_sect: Dict[str, List[Tuple[int, int]]] = {}

    for i, gene in enumerate(chrom):
        if gene is None or gene[0] >= len(rooms):
            hard += 200.0
            continue
        room_idx, start, pattern = gene
        room_id = str(rooms[room_idx].get("room_id") or "")
        dur = _duration_minutes(subjects[i])
        end = start + dur
        if end > _SCHED_END:
            hard += 50.0
            continue
        days = _MTH_DAYS if pattern == 0 else _TFS_DAYS
        section = normalize_upper(subjects[i].get("section") or "")
        for day in days:
            rk = f"{room_id}|{day}"
            sk = f"{section}|{day}"
            if _overlaps_any(start, end, res_room.get(rk, [])) or _overlaps_any(start, end, local_room.get(rk, [])):
                hard += 100.0
            if section and (_overlaps_any(start, end, res_sect.get(sk, [])) or _overlaps_any(start, end, local_sect.get(sk, []))):
                hard += 60.0
            local_room.setdefault(rk, []).append((start, end))
            if section:
                local_sect.setdefault(sk, []).append((start, end))

    return max(0.0, 100.0 - hard / max(1, len(chrom)))


def _greedy_chrom(
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    res_room: Dict[str, List[Tuple[int, int]]],
    res_sect: Dict[str, List[Tuple[int, int]]],
    rng: random.Random,
) -> _Chrom:
    chrom: _Chrom = []
    local_room: Dict[str, List[Tuple[int, int]]] = {}
    local_sect: Dict[str, List[Tuple[int, int]]] = {}

    room_order = list(range(len(rooms)))
    rng.shuffle(room_order)

    for subject in subjects:
        dur = _duration_minutes(subject)
        section = normalize_upper(subject.get("section") or "")
        pref_str = normalize_upper(subject.get("preferred_pattern") or "")
        patterns = [0, 1] if pref_str not in ("TFS", "TF") else [1, 0]

        gene: Optional[_Gene] = None
        for pattern in patterns:
            days = _MTH_DAYS if pattern == 0 else _TFS_DAYS
            for ri in room_order:
                if ri >= len(rooms):
                    continue
                room_id = str(rooms[ri].get("room_id") or "")
                for start in range(_SCHED_START, _SCHED_END - dur + 1, _SCHED_STEP):
                    end = start + dur
                    ok = True
                    for day in days:
                        rk = f"{room_id}|{day}"
                        sk = f"{section}|{day}"
                        if _overlaps_any(start, end, res_room.get(rk, [])) or _overlaps_any(start, end, local_room.get(rk, [])):
                            ok = False
                            break
                        if section and (_overlaps_any(start, end, res_sect.get(sk, [])) or _overlaps_any(start, end, local_sect.get(sk, []))):
                            ok = False
                            break
                    if ok:
                        gene = (ri, start, pattern)
                        break
                if gene is not None:
                    break
            if gene is not None:
                break

        if gene is not None:
            ri, start, pattern = gene
            room_id = str(rooms[ri].get("room_id") or "")
            days = _MTH_DAYS if pattern == 0 else _TFS_DAYS
            end = start + dur
            for day in days:
                local_room.setdefault(f"{room_id}|{day}", []).append((start, end))
                if section:
                    local_sect.setdefault(f"{section}|{day}", []).append((start, end))

        chrom.append(gene)
    return chrom


def _mutate_chrom(
    chrom: _Chrom,
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
    rng: random.Random,
    rate: float,
) -> _Chrom:
    new_c = list(chrom)
    for i in range(len(new_c)):
        if rng.random() > rate:
            continue
        if not rooms:
            continue
        subject = subjects[i]
        dur = _duration_minutes(subject)
        max_start = _SCHED_END - dur
        if max_start < _SCHED_START:
            continue
        starts = list(range(_SCHED_START, max_start + 1, _SCHED_STEP))
        if not starts:
            continue
        new_c[i] = (rng.randint(0, len(rooms) - 1), rng.choice(starts), rng.randint(0, 1))
    return new_c


def _crossover_chrom(a: _Chrom, b: _Chrom, rng: random.Random) -> _Chrom:
    return [av if rng.random() < 0.5 else bv for av, bv in zip(a, b)]


def _chrom_to_output(
    chrom: _Chrom,
    subjects: List[Dict[str, Any]],
    rooms: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    assignments: List[Dict[str, Any]] = []
    unresolved: List[Dict[str, Any]] = []
    for i, gene in enumerate(chrom):
        subj = subjects[i]
        if gene is None or gene[0] >= len(rooms):
            unresolved.append({
                "subject_id": subj.get("subject_id"),
                "course_no": subj.get("course_no"),
                "section": subj.get("section"),
                "descriptive_title": subj.get("descriptive_title"),
                "reason": "No conflict-free room/time slot found by GA.",
            })
            continue
        ri, start, pattern = gene
        room = rooms[ri]
        end = start + _duration_minutes(subj)
        sched = _sched_text(start, end)
        room_id_s = str(room.get("room_id") or "")
        row: Dict[str, Any] = {**subj, "source_subject_id": subj.get("subject_id"), "merged": False}
        if pattern == 0:
            row.update(mth_schedule=sched, mth_room_id=room_id_s, mth_room_name=room.get("room_name"),
                       tfs_schedule=None, tfs_room_id=None, tfs_room_name=None)
        else:
            row.update(tfs_schedule=sched, tfs_room_id=room_id_s, tfs_room_name=room.get("room_name"),
                       mth_schedule=None, mth_room_id=None, mth_room_name=None)
        assignments.append(row)
    return assignments, unresolved


def run_schedule_ga(payload: Dict[str, Any]) -> Dict[str, Any]:
    started_at = time.perf_counter()
    subjects_raw = list(payload.get("subjects", []))
    rooms = list(payload.get("rooms", []))
    reserved_slots = list(payload.get("reserved_slots", []))
    constraints = payload.get("constraints", {})

    seed            = constraints.get("random_seed", 42)
    population_size = int(constraints.get("population_size", 80))
    max_generations = int(constraints.get("max_generations", 150))
    mutation_rate   = float(constraints.get("mutation_rate", 0.08))
    max_runtime     = float(constraints.get("max_runtime_seconds", 30))

    rng = create_rng(seed)

    # Detect N>=2 subjects sharing the same physical slot in the incoming list
    merged_to_rep = _detect_schedule_merge_groups(subjects_raw)
    extra_merged  = [s for s in subjects_raw if int(to_number(s.get("subject_id")) or 0) in merged_to_rep]
    to_schedule   = [s for s in subjects_raw if int(to_number(s.get("subject_id")) or 0) not in merged_to_rep]

    empty_report: Dict[str, Any] = {
        "merge_groups_detected": len(set(merged_to_rep.values())),
        "subjects_preserved_as_merged": len(extra_merged),
        "subjects_scheduled_by_ga": 0,
        "conflict_count": 0,
        "conflicts": [],
    }

    if not rooms:
        return {
            "assignments": [], "unresolved": [{"subject_id": s.get("subject_id"), "course_no": s.get("course_no"),
                "section": s.get("section"), "descriptive_title": s.get("descriptive_title"),
                "reason": "No active rooms available."} for s in to_schedule],
            "fitness_overall": 0.0, "fitness_hard": 0.0, "fitness_soft": 0.0,
            "generations": 0, "runtime_ms": int((time.perf_counter() - started_at) * 1000),
            "report": {**empty_report, "summary": "No active rooms provided."},
        }

    res_room, res_sect = _build_reserved_maps(reserved_slots)

    if not to_schedule:
        return {
            "assignments": [], "unresolved": [],
            "fitness_overall": 100.0, "fitness_hard": 100.0, "fitness_soft": 100.0,
            "generations": 0, "runtime_ms": int((time.perf_counter() - started_at) * 1000),
            "report": {**empty_report, "summary": "All subjects preserved as merged groups; no GA scheduling needed."},
        }

    # Build initial population using greedy construction
    population: List[_Chrom] = [_greedy_chrom(to_schedule, rooms, res_room, res_sect, rng)
                                  for _ in range(max(6, population_size))]
    best_chrom = population[0]
    best_score = _score_chrom(best_chrom, to_schedule, rooms, res_room, res_sect)
    stagnant = 0
    generation = 0

    while generation < max_generations:
        if (time.perf_counter() - started_at) >= max_runtime:
            break
        scored = sorted(
            [(_score_chrom(c, to_schedule, rooms, res_room, res_sect), c) for c in population],
            key=lambda x: -x[0],
        )
        top_score, top_chrom = scored[0]
        if top_score > best_score:
            best_score, best_chrom, stagnant = top_score, top_chrom, 0
        else:
            stagnant += 1
        if stagnant >= 25:
            break

        elite_count = max(2, population_size // 5)
        elites = [c for _, c in scored[:elite_count]]
        next_pop: List[_Chrom] = list(elites)
        while len(next_pop) < population_size:
            child = _crossover_chrom(rng.choice(elites), rng.choice(elites), rng)
            child = _mutate_chrom(child, to_schedule, rooms, rng, mutation_rate)
            next_pop.append(child)
        population = next_pop
        generation += 1

    final_score = _score_chrom(best_chrom, to_schedule, rooms, res_room, res_sect)
    assignments, unresolved = _chrom_to_output(best_chrom, to_schedule, rooms)

    return {
        "assignments": assignments,
        "unresolved": unresolved,
        "fitness_overall": round(final_score, 2),
        "fitness_hard": round(final_score, 2),
        "fitness_soft": round(final_score, 2),
        "generations": generation + 1,
        "runtime_ms": int((time.perf_counter() - started_at) * 1000),
        "report": {
            "summary": f"Scheduled {len(assignments)} subject(s); {len(unresolved)} unresolved.",
            "merge_groups_detected": len(set(merged_to_rep.values())),
            "subjects_preserved_as_merged": len(extra_merged),
            "subjects_scheduled_by_ga": len(assignments),
            "conflict_count": len(unresolved),
            "conflicts": [{"type": "unassigned", "subject_id": u.get("subject_id"), "problem": u.get("reason")} for u in unresolved],
        },
    }


class GaHandler(BaseHTTPRequestHandler):
    server_version = "ChronoMariaGA/1.0"

    def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in {"", "/health"}:
            self._write_json(200, {"status": "ok", "service": "python-ga"})
            return
        self._write_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.rstrip("/")
        if path == "/generate":
            runner = run_ga
        elif path == "/generate-schedule":
            runner = run_schedule_ga
        else:
            self._write_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            self._write_json(400, {"error": f"Invalid JSON payload: {exc.msg}"})
            return

        try:
            result = runner(payload)
        except Exception as exc:  # pragma: no cover - surfaced to the caller
            self._write_json(500, {"error": str(exc)})
            return

        self._write_json(200, result)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        print(f"[python-ga] {format % args}")


def main() -> None:
    host = os.getenv("GA_HOST", "0.0.0.0")
    port = int(os.getenv("GA_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), GaHandler)
    print(f"[python-ga] listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
