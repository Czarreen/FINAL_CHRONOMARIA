"""
Lamarckian repair operator.

Post-GA: iteratively re-place conflicted subjects greedily.
Each pass detects violators, rebuilds slot-tracking without them,
then re-places them in a conflict-free slot.
"""

import time
import random
from typing import List, Tuple, Dict, Set, Optional

from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.common import (
    Gene, SCHED_PATTERNS, GYM_MAX_OVERLAP,
    subject_duration, valid_starts, section_key,
    is_gym_room, is_pathfit,
)


def repair(
    chromosome: List[Gene],
    subjects: List[Subject],
    rooms: List[Room],
    rng: random.Random,
    max_passes: int = 5,
    time_limit_s: float = 10.0,
) -> List[Gene]:
    """
    Iteratively detect conflicted subjects and re-place them greedily.
    Returns a (potentially) repaired chromosome of the same length.
    """
    repair_start = time.perf_counter()
    chrom    = list(chromosome)
    n_rooms  = len(rooms)
    all_ridxs = list(range(n_rooms))
    gym_set   = {i for i in all_ridxs if is_gym_room(rooms[i])}
    gym_ridxs = sorted(gym_set)
    non_gym   = [i for i in all_ridxs if i not in gym_set]

    for _pass in range(max_passes):
        if time.perf_counter() - repair_start >= time_limit_s:
            break

        # Detect violators
        viol: Set[int] = set()
        room_day: Dict[str, List[Tuple[int, int, int]]]          = {}
        gym_day_dept: Dict[str, List[Tuple[int, int, int]]]      = {}
        sec_day: Dict[str, List[Tuple[int, int, int]]]           = {}

        for si, gene in enumerate(chrom):
            pat_idx, start, r1, r2 = gene
            s        = subjects[si]
            duration = subject_duration(s)
            end      = start + duration
            _, days  = SCHED_PATTERNS[pat_idx]
            day1, day2 = days[0], days[1]
            sec      = section_key(s)
            dept_id  = str(s.department_id or "")

            if r1 in gym_set:
                gym_day_dept.setdefault(f"{r1}|{day1}|{dept_id}", []).append((start, end, si))
            else:
                room_day.setdefault(f"{r1}|{day1}", []).append((start, end, si))
            if r2 in gym_set:
                gym_day_dept.setdefault(f"{r2}|{day2}|{dept_id}", []).append((start, end, si))
            else:
                room_day.setdefault(f"{r2}|{day2}", []).append((start, end, si))
            for day in days:
                sec_day.setdefault(f"{sec}|{day}", []).append((start, end, si))

        for slots in room_day.values():
            ss = sorted(slots, key=lambda x: x[0])
            for i in range(1, len(ss)):
                if ss[i][0] < ss[i - 1][1]:
                    viol.add(ss[i][2])
                    viol.add(ss[i - 1][2])

        for slots_d in gym_day_dept.values():
            evts = [(s_, 1, si_) for s_, e_, si_ in slots_d] + [(e_, -1, si_) for s_, e_, si_ in slots_d]
            evts.sort(key=lambda x: (x[0], x[1]))
            act: Set[int] = set()
            for _t, delta, si_ in evts:
                if delta == 1:
                    act.add(si_)
                    if len(act) > GYM_MAX_OVERLAP:
                        viol.update(act)
                else:
                    act.discard(si_)

        for slots in sec_day.values():
            ss = sorted(slots, key=lambda x: x[0])
            for i in range(1, len(ss)):
                if ss[i][0] < ss[i - 1][1]:
                    viol.add(ss[i][2])
                    viol.add(ss[i - 1][2])

        for slots in sec_day.values():
            total = sum(e - s_ for s_, e, _ in slots)
            if total > 600:
                sorted_by_dur = sorted([x for x in slots if x[2] >= 0], key=lambda x: x[1] - x[0])
                excess = total - 600
                for s_, e, si in sorted_by_dur:
                    if excess <= 0:
                        break
                    viol.add(si)
                    excess -= (e - s_)

        if not viol:
            break

        # Rebuild tracking without violators
        room_track: Dict[int, Dict[str, List[Tuple[int, int]]]]           = {}
        sec_track: Dict[str, Dict[str, List[Tuple[int, int]]]]            = {}
        gym_dept_track: Dict[int, Dict[str, Dict[str, List[Tuple[int, int]]]]] = {}

        for si, gene in enumerate(chrom):
            if si in viol:
                continue
            pat_idx, start, r1, r2 = gene
            s        = subjects[si]
            duration = subject_duration(s)
            end      = start + duration
            _, days  = SCHED_PATTERNS[pat_idx]
            day1, day2 = days[0], days[1]
            sec      = section_key(s)
            dept_id  = str(s.department_id or "")
            pathfit  = is_pathfit(s)

            room_track.setdefault(r1, {}).setdefault(day1, []).append((start, end))
            room_track.setdefault(r2, {}).setdefault(day2, []).append((start, end))
            if pathfit:
                if r1 in gym_set:
                    gym_dept_track.setdefault(r1, {}).setdefault(day1, {}).setdefault(dept_id, []).append((start, end))
                if r2 in gym_set and (r1 != r2 or day1 != day2):
                    gym_dept_track.setdefault(r2, {}).setdefault(day2, {}).setdefault(dept_id, []).append((start, end))
            for day in days:
                sec_track.setdefault(sec, {}).setdefault(day, []).append((start, end))

        # Re-place violators
        to_place = list(viol)
        rng.shuffle(to_place)

        for si in to_place:
            s        = subjects[si]
            sec      = section_key(s)
            duration = subject_duration(s)
            starts   = valid_starts(duration)
            pathfit  = is_pathfit(s)
            dept_id  = str(s.department_id or "")
            placed   = False

            valid_ridxs = gym_ridxs if pathfit and gym_ridxs else (non_gym if non_gym else all_ridxs)
            room_order = rng.sample(valid_ridxs, len(valid_ridxs))

            for pat_idx in rng.sample([0, 1], 2):
                if placed:
                    break
                _, days = SCHED_PATTERNS[pat_idx]
                day1, day2 = days[0], days[1]
                for start in starts:
                    if placed:
                        break
                    end = start + duration
                    for r in room_order:
                        ok = True
                        if pathfit and r in gym_set:
                            for d in (day1, day2):
                                cnt = sum(
                                    1 for rs, re in gym_dept_track.get(r, {}).get(d, {}).get(dept_id, [])
                                    if start < re and end > rs
                                )
                                if cnt >= GYM_MAX_OVERLAP:
                                    ok = False
                                    break
                        else:
                            for rs, re in room_track.get(r, {}).get(day1, []):
                                if start < re and end > rs:
                                    ok = False
                                    break
                            if ok:
                                for rs, re in room_track.get(r, {}).get(day2, []):
                                    if start < re and end > rs:
                                        ok = False
                                        break
                        if not ok:
                            continue
                        for day in days:
                            for ss, se in sec_track.get(sec, {}).get(day, []):
                                if start < se and end > ss:
                                    ok = False
                                    break
                            if not ok:
                                break
                        if not ok:
                            continue
                        for day in days:
                            if sum(e_ - s_ for s_, e_ in sec_track.get(sec, {}).get(day, [])) + duration > 600:
                                ok = False
                                break
                        if not ok:
                            continue

                        room_track.setdefault(r, {}).setdefault(day1, []).append((start, end))
                        room_track.setdefault(r, {}).setdefault(day2, []).append((start, end))
                        if pathfit and r in gym_set:
                            gym_dept_track.setdefault(r, {}).setdefault(day1, {}).setdefault(dept_id, []).append((start, end))
                            if day1 != day2:
                                gym_dept_track.setdefault(r, {}).setdefault(day2, {}).setdefault(dept_id, []).append((start, end))
                        for day in days:
                            sec_track.setdefault(sec, {}).setdefault(day, []).append((start, end))
                        chrom[si] = (pat_idx, start, r, r)
                        placed = True
                        break

    return chrom


def find_free_slot(
    s: Subject,
    others: List[Subject],
    rooms: List[Room],
    chromosome_others: List[Gene],
) -> Optional[Gene]:
    """
    Find the first (pat_idx, start, room_idx, room_idx) gene that doesn't
    conflict with the given list of already-placed subjects.
    Returns None if no conflict-free slot is found.
    """
    duration  = subject_duration(s)
    starts    = valid_starts(duration)
    sec       = section_key(s)
    dept_id   = str(s.department_id or "")
    pathfit   = is_pathfit(s)
    n_rooms   = len(rooms)
    gym_set   = {i for i in range(n_rooms) if is_gym_room(rooms[i])}
    gym_ridxs = sorted(gym_set)
    non_gym   = [i for i in range(n_rooms) if i not in gym_set]
    room_cands = gym_ridxs if pathfit and gym_ridxs else (non_gym if non_gym else list(range(n_rooms)))

    # Build slot-tracking from others
    room_track: Dict[int, Dict[str, List[Tuple[int, int]]]] = {}
    sec_track: Dict[str, Dict[str, List[Tuple[int, int]]]] = {}
    for oi, gene in enumerate(chromosome_others):
        pat_idx, start, r1, r2 = gene
        o_s      = others[oi]
        o_dur    = subject_duration(o_s)
        end      = start + o_dur
        _, days  = SCHED_PATTERNS[pat_idx]
        day1, day2 = days[0], days[1]
        o_sec    = section_key(o_s)
        room_track.setdefault(r1, {}).setdefault(day1, []).append((start, end))
        room_track.setdefault(r2, {}).setdefault(day2, []).append((start, end))
        for day in days:
            sec_track.setdefault(o_sec, {}).setdefault(day, []).append((start, end))

    for pat_idx in range(2):
        _, days = SCHED_PATTERNS[pat_idx]
        day1, day2 = days[0], days[1]
        for start in starts:
            end = start + duration
            for r in room_cands:
                ok = True
                for rs, re in room_track.get(r, {}).get(day1, []):
                    if start < re and end > rs:
                        ok = False
                        break
                if ok:
                    for rs, re in room_track.get(r, {}).get(day2, []):
                        if start < re and end > rs:
                            ok = False
                            break
                if not ok:
                    continue
                for day in days:
                    for ss, se in sec_track.get(sec, {}).get(day, []):
                        if start < se and end > ss:
                            ok = False
                            break
                    if not ok:
                        break
                if not ok:
                    continue
                return (pat_idx, start, r, r)
    return None
