"""
Warm-start heuristic initialization.

Greedy chromosome satisfies all hard constraints (used as seed individual).
Subjects sorted by duration descending — harder to place first.
"""

import random
from typing import List, Tuple, Dict

from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.common import (
    Gene, SCHED_PATTERNS, SCHED_START_MIN, GYM_MAX_OVERLAP,
    subject_duration, valid_starts, section_key,
    is_lab_room, is_gym_room, is_pathfit, has_lec_and_lab, needs_lab,
    pick_rooms,
)


def _random_gene(
    s: Subject,
    rooms: List[Room],
    sec_pattern_counts: Dict[str, Dict[int, int]],
    rng: random.Random,
) -> Gene:
    duration = subject_duration(s)
    starts   = valid_starts(duration)
    start    = rng.choice(starts) if starts else SCHED_START_MIN
    sec      = section_key(s)
    mth_c    = sec_pattern_counts.get(sec, {}).get(0, 0)
    tf_c     = sec_pattern_counts.get(sec, {}).get(1, 0)
    pat      = 0 if mth_c <= tf_c else 1
    r1, r2   = pick_rooms(s, rooms, rng)
    return (pat, start, r1, r2)


def random_chromosome(
    subjects: List[Subject],
    rooms: List[Room],
    rng: random.Random,
) -> List[Gene]:
    """Random chromosome — balances MTH/TF per section."""
    spc: Dict[str, Dict[int, int]] = {}
    genes: List[Gene] = []
    for s in subjects:
        g   = _random_gene(s, rooms, spc, rng)
        sec = section_key(s)
        if sec not in spc:
            spc[sec] = {0: 0, 1: 0}
        spc[sec][g[0]] = spc[sec].get(g[0], 0) + 1
        genes.append(g)
    return genes


def greedy_chromosome(
    subjects: List[Subject],
    rooms: List[Room],
    rng: random.Random,
) -> List[Gene]:
    """First-fit greedy chromosome satisfying all hard constraints."""
    n_rooms = len(rooms)
    if n_rooms == 0:
        return [(0, SCHED_START_MIN, 0, 0)] * len(subjects)

    room_slots: Dict[int, Dict[str, List[Tuple[int, int]]]] = {
        i: {d: [] for d in ("MON", "TUE", "THU", "FRI")} for i in range(n_rooms)
    }
    section_slots: Dict[str, Dict[str, List[Tuple[int, int]]]] = {}
    sec_pattern_counts: Dict[str, Dict[int, int]] = {}
    gene_map: Dict[int, Gene] = {}
    gym_dept_slots: Dict[int, Dict[str, Dict[str, List[Tuple[int, int]]]]] = {}

    lec_idxs  = [i for i, r in enumerate(rooms) if not is_lab_room(r) and not is_gym_room(r)]
    lab_idxs  = [i for i, r in enumerate(rooms) if is_lab_room(r) and not is_gym_room(r)]
    gym_idxs  = [i for i, r in enumerate(rooms) if is_gym_room(r)]
    gym_set   = set(gym_idxs)
    non_gym   = [i for i in range(n_rooms) if i not in gym_set]
    non_gym_lec = [i for i in lec_idxs if i not in gym_set]
    non_gym_lab = [i for i in lab_idxs if i not in gym_set]
    all_idxs  = list(range(n_rooms))

    def room_load(i: int) -> int:
        return sum(len(v) for v in room_slots[i].values())

    def by_load(pool: List[int]) -> List[int]:
        return sorted(pool, key=room_load)

    ordered = sorted(enumerate(subjects), key=lambda x: -subject_duration(x[1]))

    for orig_idx, s in ordered:
        duration  = subject_duration(s)
        starts    = valid_starts(duration)
        sec       = section_key(s)
        dept_id   = str(s.department_id or "")
        pathfit   = is_pathfit(s)
        has_both  = has_lec_and_lab(s)
        lab_only  = needs_lab(s)

        section_slots.setdefault(sec, {d: [] for d in ("MON", "TUE", "THU", "FRI")})
        sec_pattern_counts.setdefault(sec, {0: 0, 1: 0})

        mth_c = sec_pattern_counts[sec][0]
        tf_c  = sec_pattern_counts[sec][1]
        pat_order = [0, 1] if mth_c <= tf_c else [1, 0]

        assigned = False

        for pat_idx in pat_order:
            if assigned:
                break
            _, days = SCHED_PATTERNS[pat_idx]
            day1, day2 = days[0], days[1]

            if pathfit:
                pairs = [(r, r) for r in by_load(gym_idxs) or by_load(all_idxs)]
            elif has_both:
                sl = by_load(non_gym_lec)[:4]
                sb = by_load(non_gym_lab)[:4]
                pairs = [(r1, r2) for r1 in sl for r2 in sb if r1 != r2]
                seen = set(pairs)
                for r in by_load(non_gym or all_idxs):
                    if (r, r) not in seen:
                        pairs.append((r, r))
                        seen.add((r, r))
            elif lab_only:
                pairs = [(r, r) for r in (by_load(non_gym_lab) or by_load(non_gym or all_idxs))]
            else:
                pairs = [(r, r) for r in (by_load(non_gym_lec) or by_load(non_gym or all_idxs))]

            for r1_idx, r2_idx in pairs:
                if assigned:
                    break
                for start in starts:
                    end = start + duration
                    ok  = True

                    if pathfit and r1_idx in gym_set:
                        for d, ri in ((day1, r1_idx), (day2, r2_idx)):
                            cnt = sum(
                                1 for rs, re in gym_dept_slots.get(ri, {}).get(d, {}).get(dept_id, [])
                                if start < re and end > rs
                            )
                            if cnt >= GYM_MAX_OVERLAP:
                                ok = False
                                break
                    else:
                        for rs, re in room_slots[r1_idx].get(day1, []):
                            if start < re and end > rs:
                                ok = False
                                break
                        if ok:
                            for rs, re in room_slots[r2_idx].get(day2, []):
                                if start < re and end > rs:
                                    ok = False
                                    break

                    if not ok:
                        continue

                    for day in days:
                        for ss, se in section_slots[sec][day]:
                            if start < se and end > ss:
                                ok = False
                                break
                        if not ok:
                            break

                    if not ok:
                        continue

                    for day in days:
                        if sum(e - s_ for s_, e in section_slots[sec][day]) + duration > 600:
                            ok = False
                            break

                    if not ok:
                        continue

                    room_slots[r1_idx][day1].append((start, end))
                    room_slots[r2_idx][day2].append((start, end))
                    if pathfit:
                        gym_dept_slots.setdefault(r1_idx, {}).setdefault(day1, {}).setdefault(dept_id, []).append((start, end))
                        if r1_idx != r2_idx or day1 != day2:
                            gym_dept_slots.setdefault(r2_idx, {}).setdefault(day2, {}).setdefault(dept_id, []).append((start, end))
                    for day in days:
                        section_slots[sec][day].append((start, end))
                    sec_pattern_counts[sec][pat_idx] += 1
                    gene_map[orig_idx] = (pat_idx, start, r1_idx, r2_idx)
                    assigned = True
                    break

        if not assigned:
            fb_pool = (
                by_load(gym_idxs) if pathfit and gym_idxs
                else by_load(non_gym) if non_gym
                else by_load(all_idxs)
            )
            for fb_pat in [0, 1]:
                if assigned:
                    break
                _, fb_days = SCHED_PATTERNS[fb_pat]
                fb_day1, fb_day2 = fb_days[0], fb_days[1]
                for fb_start in starts:
                    fb_end = fb_start + duration
                    for fb_r in fb_pool:
                        ok = True
                        if pathfit and fb_r in gym_set:
                            for d in (fb_day1, fb_day2):
                                cnt = sum(
                                    1 for rs, re in gym_dept_slots.get(fb_r, {}).get(d, {}).get(dept_id, [])
                                    if fb_start < re and fb_end > rs
                                )
                                if cnt >= GYM_MAX_OVERLAP:
                                    ok = False
                                    break
                        else:
                            for rs, re in room_slots[fb_r][fb_day1]:
                                if fb_start < re and fb_end > rs:
                                    ok = False
                                    break
                            if ok:
                                for rs, re in room_slots[fb_r][fb_day2]:
                                    if fb_start < re and fb_end > rs:
                                        ok = False
                                        break
                        if not ok:
                            continue
                        for fb_day in fb_days:
                            for ss, se in section_slots[sec][fb_day]:
                                if fb_start < se and fb_end > ss:
                                    ok = False
                                    break
                            if not ok:
                                break
                        if not ok:
                            continue
                        for fb_day in fb_days:
                            if sum(e - s_ for s_, e in section_slots[sec][fb_day]) + duration > 600:
                                ok = False
                                break
                        if not ok:
                            continue
                        room_slots[fb_r][fb_day1].append((fb_start, fb_end))
                        room_slots[fb_r][fb_day2].append((fb_start, fb_end))
                        if pathfit:
                            gym_dept_slots.setdefault(fb_r, {}).setdefault(fb_day1, {}).setdefault(dept_id, []).append((fb_start, fb_end))
                            if fb_day1 != fb_day2:
                                gym_dept_slots.setdefault(fb_r, {}).setdefault(fb_day2, {}).setdefault(dept_id, []).append((fb_start, fb_end))
                        for fb_day in fb_days:
                            section_slots[sec][fb_day].append((fb_start, fb_end))
                        sec_pattern_counts[sec][fb_pat] = sec_pattern_counts[sec].get(fb_pat, 0) + 1
                        gene_map[orig_idx] = (fb_pat, fb_start, fb_r, fb_r)
                        assigned = True
                        break
                    if assigned:
                        break

        if not assigned:
            g = _random_gene(s, rooms, sec_pattern_counts, rng)
            gene_map[orig_idx] = g
            rp_idx, rp_start, rp_r1, rp_r2 = g
            rp_end = rp_start + duration
            _, rp_days = SCHED_PATTERNS[rp_idx]
            room_slots[rp_r1][rp_days[0]].append((rp_start, rp_end))
            room_slots[rp_r2][rp_days[1]].append((rp_start, rp_end))
            for day in rp_days:
                section_slots[sec][day].append((rp_start, rp_end))
            sec_pattern_counts[sec][rp_idx] = sec_pattern_counts[sec].get(rp_idx, 0) + 1

    return [gene_map.get(i, (0, SCHED_START_MIN, 0, 0)) for i in range(len(subjects))]


def seeded_population(
    subjects: List[Subject],
    rooms: List[Room],
    rng: random.Random,
    pop_size: int = 120,
) -> List[List[Gene]]:
    """Build initial population: one greedy seed + random fill."""
    if not subjects or not rooms:
        return [random_chromosome(subjects, rooms, rng) for _ in range(max(1, pop_size))]
    pop: List[List[Gene]] = [greedy_chromosome(subjects, rooms, rng)]
    while len(pop) < pop_size:
        pop.append(random_chromosome(subjects, rooms, rng))
    return pop
