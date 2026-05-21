"""
Custom crossover and mutation operators.

Section-aware crossover: swap ALL genes for a section as a unit to preserve
intra-section coherence (same pattern, balanced daily load).

LOCKED subjects are not in the chromosome. Resolved baseline is read-only.
"""

import random
from typing import List, Tuple, Dict

from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.common import Gene, SCHED_PATTERNS, section_key, subject_duration, valid_starts, pick_rooms, SCHED_START_MIN


def crossover_two_point_grouped(
    ind1: List[Gene],
    ind2: List[Gene],
    subjects: List[Subject],
    rng: random.Random,
    section_indices: Dict[str, List[int]] = None,
) -> Tuple[List[Gene], List[Gene]]:
    """
    Section-aware crossover. Swaps ALL genes for each section as a unit.
    Returns two children. Does not modify ind1/ind2 in place.
    """
    if section_indices is None:
        section_indices = {}
        for i, s in enumerate(subjects):
            section_indices.setdefault(section_key(s), []).append(i)

    child1 = list(ind1)
    child2 = list(ind2)

    for indices in section_indices.values():
        if rng.random() < 0.5:
            for idx in indices:
                child1[idx], child2[idx] = child2[idx], child1[idx]

    return child1, child2


def mutate_reschedule(
    individual: List[Gene],
    subjects: List[Subject],
    rooms: List[Room],
    rng: random.Random,
    mutation_rate: float = 0.07,
) -> List[Gene]:
    """
    Per-gene mutation. Four mutation types (chosen uniformly):
      0: flip pattern (MTH ↔ TF)
      1: nudge start time ±1-3 slots
      2: pick new day1 room
      3: pick new day2 room
    Returns a new list (does not mutate individual in place).
    """
    result = list(individual)
    for i in range(len(result)):
        if rng.random() > mutation_rate:
            continue
        pat, start, r1, r2 = result[i]
        s       = subjects[i]
        mut_type = rng.randint(0, 3)

        if mut_type == 0:
            pat = 1 - pat
        elif mut_type == 1:
            duration = subject_duration(s)
            starts   = valid_starts(duration)
            if starts:
                cur_i = starts.index(start) if start in starts else 0
                delta = rng.choice([-3, -2, -1, 1, 2, 3])
                new_i = max(0, min(len(starts) - 1, cur_i + delta))
                start = starts[new_i]
        elif mut_type == 2:
            new_r1, _ = pick_rooms(s, rooms, rng)
            r1 = new_r1
        else:
            _, new_r2 = pick_rooms(s, rooms, rng)
            r2 = new_r2

        result[i] = (pat, start, r1, r2)
    return result
