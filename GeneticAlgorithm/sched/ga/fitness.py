"""
Fitness function with HARD constraint rejection.

Solutions with any hard conflict get float('-inf') fitness and never survive selection.
Direct slot-tracking approach (no schedule string parsing) for performance.
"""

from typing import List, Tuple, Dict, Set

from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.common import (
    Gene, SCHED_PATTERNS, SCHED_START_MIN, SCHED_END_MAX, GYM_MAX_OVERLAP,
    subject_duration, section_key, is_lab_room, is_gym_room, is_pathfit,
    has_lec_and_lab, needs_lab,
)


def _slot_analysis(
    chromosome: List[Gene],
    subjects: List[Subject],
    rooms: List[Room],
    pre_seeded_slots: dict = None,
    pre_seeded_sec_slots: dict = None,
) -> Tuple[int, float]:
    """
    Slot-tracking pass over a chromosome.
    Returns (hard_violation_count, soft_penalty).
    Hard: room overlap (R-H1), section overlap (S-H11), time bounds (S-H4/S-H5), GYM-EX.
    Soft: room-type mismatch, time spread, section pattern balance, load near-overrun.

    pre_seeded_slots: optional dict of already-occupied room slots from locked/original subjects,
    keyed by "room_idx|DAY" with values [(start, end, -1)]. Prevents double-room booking.
    pre_seeded_sec_slots: optional dict of already-occupied section slots, keyed by
    "section_key|DAY" with values [(start, end, -1)]. Prevents double-schedule conflicts.
    """
    n = max(1, len(subjects))
    hard_subs: Set[int] = set()
    section_day_overload = 0
    soft = 0.0

    room_day_slots: Dict[str, List[Tuple[int, int, int]]]         = {}
    if pre_seeded_slots:
        for k, slots in pre_seeded_slots.items():
            room_day_slots[k] = list(slots)
    gym_room_day_slots: Dict[str, List[Tuple[int, int, int, str]]] = {}
    sec_day_slots: Dict[str, List[Tuple[int, int, int]]]          = {}
    if pre_seeded_sec_slots:
        for k, slots in pre_seeded_sec_slots.items():
            sec_day_slots[k] = list(slots)
    sec_pattern_counts: Dict[str, Dict[int, int]]                 = {}
    room_usage: Dict[int, int]                                    = {}
    curr_day_count: Dict[str, int]                                = {}

    for si, gene in enumerate(chromosome):
        pat_idx, start, r1_idx, r2_idx = gene
        s          = subjects[si]
        duration   = subject_duration(s)
        end        = start + duration
        _, days    = SCHED_PATTERNS[pat_idx]
        day1, day2 = days[0], days[1]
        sec        = section_key(s)
        dept_id    = str(s.department_id or "")
        same_room  = (r1_idx == r2_idx)
        curr_id    = str(s.subject_id)

        if start < SCHED_START_MIN or end > SCHED_END_MAX:
            hard_subs.add(si)

        r1 = rooms[r1_idx] if 0 <= r1_idx < len(rooms) else None
        r2 = rooms[r2_idx] if 0 <= r2_idx < len(rooms) else None

        if r1 is None or r2 is None:
            hard_subs.add(si)
        else:
            pathfit_s  = is_pathfit(s)
            has_both   = has_lec_and_lab(s)
            lab_only   = needs_lab(s)
            d1_is_lab  = is_lab_room(r1)
            d2_is_lab  = is_lab_room(r2)
            d1_is_gym  = is_gym_room(r1)
            d2_is_gym  = is_gym_room(r2)

            if has_both and not same_room:
                if d1_is_lab:
                    soft += 1.0
                if not d2_is_lab:
                    soft += 1.0
            elif lab_only:
                if not d1_is_lab:
                    soft += 2.0
                if not same_room and not d2_is_lab:
                    soft += 2.0
            else:
                if d1_is_lab:
                    soft += 0.5
                if not same_room and d2_is_lab:
                    soft += 0.5

            if pathfit_s:
                if not d1_is_gym or not d2_is_gym:
                    hard_subs.add(si)
            else:
                if d1_is_gym or d2_is_gym:
                    hard_subs.add(si)

            if d1_is_gym:
                gym_room_day_slots.setdefault(f"{r1_idx}|{day1}", []).append((start, end, si, dept_id))
            if d2_is_gym and (r2_idx != r1_idx or day2 != day1):
                gym_room_day_slots.setdefault(f"{r2_idx}|{day2}", []).append((start, end, si, dept_id))

        room_usage[r1_idx] = room_usage.get(r1_idx, 0) + 1
        if not same_room:
            room_usage[r2_idx] = room_usage.get(r2_idx, 0) + 1

        time_span = max(1, SCHED_END_MAX - SCHED_START_MIN - duration)
        soft += (start - SCHED_START_MIN) / time_span * 1.0

        room_day_slots.setdefault(f"{r1_idx}|{day1}", []).append((start, end, si))
        room_day_slots.setdefault(f"{r2_idx}|{day2}", []).append((start, end, si))
        for day in days:
            sec_day_slots.setdefault(f"{sec}|{day}", []).append((start, end, si))
            curr_day_count[f"{curr_id}|{day}"] = curr_day_count.get(f"{curr_id}|{day}", 0) + 1

        sec_pattern_counts.setdefault(sec, {0: 0, 1: 0})
        sec_pattern_counts[sec][pat_idx] = sec_pattern_counts[sec].get(pat_idx, 0) + 1

    for rk, slots in room_day_slots.items():
        ri_str = rk.split("|")[0]
        if ri_str.isdigit():
            ri_int = int(ri_str)
            if 0 <= ri_int < len(rooms) and is_gym_room(rooms[ri_int]):
                continue
        ss = sorted(slots, key=lambda x: x[0])
        for i in range(1, len(ss)):
            if ss[i][0] < ss[i - 1][1]:
                if ss[i][2] >= 0:
                    hard_subs.add(ss[i][2])
                if ss[i - 1][2] >= 0:
                    hard_subs.add(ss[i - 1][2])

    for slots_4 in gym_room_day_slots.values():
        dept_map: Dict[str, List[Tuple[int, int, int]]] = {}
        for s_, e_, si_, d_ in slots_4:
            dept_map.setdefault(d_, []).append((s_, e_, si_))
        for dlist in dept_map.values():
            events = [(s_, 1, si_) for s_, e_, si_ in dlist] + [(e_, -1, si_) for s_, e_, si_ in dlist]
            events.sort(key=lambda x: (x[0], x[1]))
            active: Set[int] = set()
            for _t, delta, si_ in events:
                if delta == 1:
                    active.add(si_)
                    if len(active) > GYM_MAX_OVERLAP:
                        hard_subs.update(active)
                else:
                    active.discard(si_)

    for slots in sec_day_slots.values():
        ss = sorted(slots, key=lambda x: x[0])
        if not ss:
            continue
        run_s = ss[0][0]
        run_e = ss[0][1]
        for i in range(1, len(ss)):
            ps, pe, _ = ss[i - 1]
            cs, ce, _ = ss[i]
            if cs < pe:
                if ss[i][2] >= 0:
                    hard_subs.add(ss[i][2])
                if ss[i - 1][2] >= 0:
                    hard_subs.add(ss[i - 1][2])
                run_e = max(run_e, ce)
            else:
                if cs - pe < 30:
                    soft += 0.5
                    run_e = ce
                else:
                    if (run_e - run_s) > 300:
                        soft += 1.0
                    run_s = cs
                    run_e = ce
        if (run_e - run_s) > 300:
            soft += 1.0

    for slots in sec_day_slots.values():
        total = sum(e - s_ for s_, e, si_ in slots if si_ >= 0)
        if total > 600:
            section_day_overload += 1
        elif total > 480:
            soft += 0.5

    if room_usage and len(room_usage) > 1:
        avg = sum(room_usage.values()) / len(room_usage)
        if avg > 0:
            mad = sum(abs(c - avg) for c in room_usage.values()) / len(room_usage)
            soft += (mad / avg) * len(room_usage) * 0.2

    for counts in sec_pattern_counts.values():
        total_sec = counts.get(0, 0) + counts.get(1, 0)
        if total_sec > 1:
            soft += abs(counts.get(0, 0) - counts.get(1, 0)) * 0.2

    for cnt in curr_day_count.values():
        if cnt > 3:
            soft += (cnt - 3) * 0.1

    hard_violations = len(hard_subs) + section_day_overload
    return hard_violations, soft


def count_hard_conflicts(
    chromosome: List[Gene],
    subjects: List[Subject],
    rooms: List[Room],
    pre_seeded_slots: dict = None,
    pre_seeded_sec_slots: dict = None,
) -> int:
    """Return number of subjects with any hard constraint violation."""
    hard, _ = _slot_analysis(chromosome, subjects, rooms, pre_seeded_slots, pre_seeded_sec_slots)
    return hard


def soft_score(
    chromosome: List[Gene],
    subjects: List[Subject],
    rooms: List[Room],
    pre_seeded_slots: dict = None,
    pre_seeded_sec_slots: dict = None,
) -> float:
    """Return soft score (higher is better, lower soft penalty)."""
    _, soft = _slot_analysis(chromosome, subjects, rooms, pre_seeded_slots, pre_seeded_sec_slots)
    n = max(1, len(subjects))
    return max(0.0, 100.0 - soft / n * 5.0)


def evaluate(
    individual: List[Gene],
    subjects: List[Subject],
    rooms: List[Room],
    pre_seeded_slots: dict = None,
    pre_seeded_sec_slots: dict = None,
) -> Tuple[float]:
    """
    DEAP fitness function. Returns (fitness,) tuple.
    Hard conflicts → float('-inf').
    Clean solutions → soft_score value (0-100).
    """
    hard, soft = _slot_analysis(individual, subjects, rooms, pre_seeded_slots, pre_seeded_sec_slots)
    if hard > 0:
        return (float('-inf'),)
    n = max(1, len(subjects))
    return (max(0.0, 100.0 - soft / n * 5.0),)
