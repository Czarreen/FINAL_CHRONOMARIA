"""Chronomaria faculty loading GA service.

The Node API sends faculty, course offerings, rooms, and subjects to the
`POST /generate` endpoint. This module runs a deterministic genetic algorithm
to assign course offerings to faculty while respecting department, role, load,
and schedule constraints.
"""

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


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def split_tokens(value: Any) -> List[str]:
    return [token.strip() for token in re.split(r"[,;/|]+", normalize_text(value)) if token.strip()]


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


def build_schedule_blocks(offering: Dict[str, Any]) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    for group in ("mth", "tfs"):
        schedule_text = normalize_text(offering.get(f"{group}_schedule"))
        if not schedule_text:
            continue

        parsed = parse_time_range(schedule_text)
        if not parsed:
            continue

        blocks.append(
            {
                "group": group.upper(),
                "schedule_text": schedule_text,
                **parsed,
                "room_id": to_number(offering.get(f"{group}_room_id")),
            }
        )
    return blocks


def overlaps(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    return left["start"] < right["end"] and right["start"] < left["end"]


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


def build_room_lookup(rooms: Sequence[Dict[str, Any]]) -> Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    by_id: Dict[int, Dict[str, Any]] = {}
    by_name: Dict[str, Dict[str, Any]] = {}
    for room in rooms:
        room_id = to_number(room.get("room_id"))
        room_name = re.sub(r"[^A-Z0-9]", "", normalize_upper(room.get("room_name")))
        if room_id is not None:
            by_id[int(room_id)] = room
        if room_name:
            by_name[room_name] = room
    return by_id, by_name


def resolve_room_reference(value: Any, room_lookup: Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]) -> Optional[int]:
    raw = normalize_text(value)
    if not raw:
        return None

    first_token = split_tokens(raw)[0] if split_tokens(raw) else raw
    numeric = to_number(first_token)
    room_by_id, room_by_name = room_lookup

    if numeric is not None and int(numeric) in room_by_id:
        return int(numeric)

    key = re.sub(r"[^A-Z0-9]", "", normalize_upper(first_token))
    room = room_by_name.get(key)
    if room is not None:
        room_id = to_number(room.get("room_id"))
        return int(room_id) if room_id is not None else None

    return None


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


def count_preparations(assignments: Sequence[Dict[str, Any]]) -> int:
    return len({f"{normalize_upper(assignment['offering'].get('code'))}|{normalize_upper(assignment['offering'].get('course_no'))}" for assignment in assignments})


def score_offering_difficulty(offering: Dict[str, Any], faculties: Sequence[Dict[str, Any]], subject_index: Dict[str, Dict[str, Any]]) -> float:
    matched_subject = subject_index.get(build_offering_key(offering))
    matches = 0
    for faculty in faculties:
        dept_match = to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))
        specialization_score = match_specialization_score(faculty, offering, matched_subject)
        if dept_match or specialization_score > 0:
            matches += 1
    return 1000.0 - matches * 90.0 - (to_number(offering.get("units")) or 0.0) * 10.0


def choose_best_faculty(offering: Dict[str, Any], faculties: Sequence[Dict[str, Any]], loads: Dict[int, float], subject_index: Dict[str, Dict[str, Any]], rng: random.Random) -> int:
    matched_subject = subject_index.get(build_offering_key(offering))
    scored: List[Tuple[int, float]] = []

    for index, faculty in enumerate(faculties):
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        current_load = loads.get(index, 0.0)
        max_units = max(1.0, to_number(faculty.get("faculty_max_units")) or 1.0)
        projected = (current_load + units) / max_units
        dept_match = to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))
        role = normalize_role(faculty.get("faculty_role"))
        specialization_score = match_specialization_score(faculty, offering, matched_subject)
        status = normalize_upper(faculty.get("faculty_status"))

        score = 0.0
        score += 120.0 if dept_match else -24.0
        score += specialization_score
        score += 40.0 if role == "FT" else 8.0 if role == "PT" else 0.0
        score += 12.0 if status == "ACTIVE" else -70.0
        score -= max(0.0, projected - 1.0) * 120.0
        score -= max(0.0, current_load / max_units - 0.9) * 35.0
        score -= current_load * 0.7

        scored.append((index, score))

    scored.sort(key=lambda pair: (-pair[1], pair[0], rng.random()))
    return scored[0][0]


def build_initial_candidate(faculties: Sequence[Dict[str, Any]], offerings: Sequence[Dict[str, Any]], subject_index: Dict[str, Dict[str, Any]], rng: random.Random) -> List[int]:
    loads: Dict[int, float] = {}
    assignments = [0 for _ in offerings]

    ordering = sorted(
        (
            (index, offering, score_offering_difficulty(offering, faculties, subject_index))
            for index, offering in enumerate(offerings)
        ),
        key=lambda entry: (-entry[2], entry[0]),
    )

    for index, offering, _difficulty in ordering:
        faculty_index = choose_best_faculty(offering, faculties, loads, subject_index, rng)
        assignments[index] = faculty_index
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        loads[faculty_index] = loads.get(faculty_index, 0.0) + units

    return assignments


def mutate(candidate: Sequence[int], faculties: Sequence[Dict[str, Any]], offerings: Sequence[Dict[str, Any]], subject_index: Dict[str, Dict[str, Any]], rng: random.Random, mutation_rate: float) -> List[int]:
    next_candidate = list(candidate)
    loads: Dict[int, float] = {}

    for index, faculty_index in enumerate(next_candidate):
        units = to_number(offerings[index].get("units")) or to_number(offerings[index].get("lec_hrs")) or 0.0
        loads[faculty_index] = loads.get(faculty_index, 0.0) + units

    for index, offering in enumerate(offerings):
        if rng.random() > mutation_rate:
            continue
        current = next_candidate[index]
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        loads[current] = max(0.0, loads.get(current, 0.0) - units)
        replacement = choose_best_faculty(offering, faculties, loads, subject_index, rng)
        next_candidate[index] = replacement
        loads[replacement] = loads.get(replacement, 0.0) + units

    return next_candidate


def crossover(parent_a: Sequence[int], parent_b: Sequence[int], rng: random.Random) -> List[int]:
    return [parent_a[index] if rng.random() < 0.5 else parent_b[index] for index in range(len(parent_a))]


def create_rng(seed: Any) -> random.Random:
    return random.Random(int(to_number(seed) or 1))


def summarize_candidate(candidate: Sequence[int], faculties: Sequence[Dict[str, Any]], offerings: Sequence[Dict[str, Any]], subject_index: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    assignments: List[Dict[str, Any]] = []
    for offering_index, faculty_index in enumerate(candidate):
        offering = offerings[offering_index]
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
            soft_penalty += (prep_count - 4) * 18.0
            conflicts.append({"type": "preparations", "faculty_id": faculty_id, "problem": f"Faculty has {prep_count} preparations"})

        blocks = sorted(block_map.get(faculty_id, []), key=lambda block: block["start"])
        if len(blocks) >= 2:
            gap_total = 0.0
            block_duration = 0.0
            for idx, block in enumerate(blocks):
                block_duration += block["duration"]
                if idx > 0:
                    gap_total += max(0.0, float(block["start"]) - float(blocks[idx - 1]["end"]))
                    if overlaps(blocks[idx - 1], block):
                        hard_penalty += 35.0
                        conflicts.append({"type": "time_conflict", "faculty_id": faculty_id, "problem": "Faculty has overlapping schedule blocks"})

            avg_gap = gap_total / max(1, len(blocks) - 1)
            if avg_gap > 30:
                soft_penalty += avg_gap / 8.0
                fragmented_faculty.append(faculty_id)
            if block_duration > 240:
                soft_penalty += (block_duration - 240.0) / 6.0

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

    assignment_count = max(1, len(assignments))
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
            "summary": f"Generated {len(assignments)} faculty loading assignment(s).",
            "faculty_load_balance": faculty_load_balance,
            "faculty_free_units": faculty_free_units,
            "unassigned_subjects": [],
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

    population: List[List[int]] = [build_initial_candidate(faculties, offerings, subject_index, rng)]
    while len(population) < max(6, population_size):
        variant = build_initial_candidate(faculties, offerings, subject_index, rng)
        population.append(mutate(variant, faculties, offerings, subject_index, rng, min(0.35, mutation_rate * 1.6)))

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
        if self.path.rstrip("/") != "/generate":
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
            result = run_ga(payload)
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
