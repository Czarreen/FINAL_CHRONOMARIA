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
        elif part == "TFS":
            days.update({"TUE", "FRI", "SAT"})
        else:
            if "MON" in part:
                days.add("MON")
            if "TH" in part:
                days.add("THU")
            if "TUE" in part:
                days.add("TUE")
            if "FRI" in part:
                days.add("FRI")
            if "SAT" in part:
                days.add("SAT")

    if not days:
        if group == "MTH":
            return {"MON", "THU"}
        if group == "TFS":
            return {"TUE", "FRI", "SAT"}
    return days


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
    src = " ".join(
        filter(
            None,
            [
                normalize_upper(faculty.get("faculty_specialization")),
                normalize_upper(faculty.get("faculty_name")),
                normalize_upper(faculty.get("department_name")),
            ],
        )
    )
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


def build_initial_candidate(faculties, offerings, subject_index, rng):
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
        units = to_number(offering.get("units")) or to_number(offering.get("lec_hrs")) or 0.0
        subject = subject_index.get(build_offering_key(offering))

        candidates: List[Tuple[float, int]] = []
        for fi, faculty in enumerate(faculties):
            max_units = max(0.0, to_number(faculty.get("faculty_max_units")) or 0.0)
            if max_units > 0 and loads[fi] + units > max_units:
                continue
            if faculty_has_conflict(blocks[fi], off_blocks):
                continue
            if any(consecutive_minutes_for_day(blocks[fi] + off_blocks, d) > 240.0 for d in ("MON", "TUE", "WED", "THU", "FRI", "SAT")):
                continue

            prep_key = f"{normalize_upper(offering.get('code'))}|{normalize_upper(offering.get('course_no'))}"
            if len(set(preps[fi]) | {prep_key}) > 4:
                continue

            dept_match = to_number(faculty.get("department_id")) == to_number(offering.get("department_id"))
            role = normalize_role(faculty.get("faculty_role"))
            spec = match_specialization_score(faculty, offering, subject)

            score = 0.0
            score += 300.0 if dept_match else -220.0
            score += spec
            score += 90.0 if role == "FT" else 30.0 if role == "PT" else 0.0
            score -= loads[fi] * 0.7
            candidates.append((score + rng.random() * 0.001, fi))

        fi = sorted(candidates, key=lambda x: (-x[0], x[1]))[0][1] if candidates else 0
        chosen[oi] = fi
        loads[fi] += units
        blocks[fi].extend(off_blocks)
        preps[fi].add(f"{normalize_upper(offering.get('code'))}|{normalize_upper(offering.get('course_no'))}")

    return [chosen.get(i, 0) for i in range(len(offerings))]


def summarize_candidate(candidate, faculties, offerings, subject_index):
    assignments = []
    loads = {}
    faculty_assignments = {}
    faculty_blocks = {}
    room_day_blocks = {}
    conflicts = []
    unassigned = []

    for oi, fi in enumerate(candidate):
        offering = offerings[oi]
        if fi < 0 or fi >= len(faculties):
            unassigned.append(offering)
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
    avg_units = sum(loads.values()) / max(1, len(faculties))

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
            if to_number(faculty.get("department_id")) != to_number(off.get("department_id")):
                hard_penalty += 50.0
                conflicts.append({"type": "department_mismatch", "faculty_id": fid, "offering_id": off.get("id"), "problem": "Department mismatch"})
            soft_penalty -= match_specialization_score(faculty, off, it.get("matched_subject")) * 0.3

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
    soft = max(0.0, 100.0 - soft_penalty)
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
            "hard_violations": [c for c in conflicts if c["type"] in {"room_conflict", "time_conflict", "overload", "department_mismatch", "consecutive_limit", "preparations"}],
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
            out[i] = rng.randrange(0, max(1, faculty_count))
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
    subjects = list(payload.get("subjects", []))
    subject_index = build_subject_index(subjects)
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
            },
            "run_id": payload.get("run_id") or "empty",
        }

    population = [build_initial_candidate(faculties, offerings, subject_index, rng)]
    while len(population) < population_size:
        base = build_initial_candidate(faculties, offerings, subject_index, rng)
        population.append(mutate(base, len(faculties), rng, min(0.35, mutation_rate * 1.6)))

    best = population[0]
    best_summary = summarize_candidate(best, faculties, offerings, subject_index)
    best_score = best_summary["fitness_overall"]
    generation = 0
    stagnation = 0

    while generation < max_generations and (time.perf_counter() - started) < max_runtime_seconds:
        scored = []
        for cand in population:
            summary = summarize_candidate(cand, faculties, offerings, subject_index)
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

    result = summarize_candidate(best, faculties, offerings, subject_index)
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
    return result


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
        if self.path.rstrip("/") != "/generate":
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
