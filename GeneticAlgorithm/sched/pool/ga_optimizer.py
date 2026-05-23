"""
Steps 6+7: GA Optimization.

Step 6 (intra-pool GA): For each pool with >= 2 entities, run a short GA
pass to improve soft-objective quality without disturbing the hard-constraint-
satisfying placement established by Steps 3-5.

Step 7 (global soft-objective GA): Currently a stub returning pools unchanged.
Activated when time budget permits after Step 6.

Delegates to the existing run_ga_optimization() in sched/ga/deap_setup.py
via the existing chromosome representation.
"""

import time
from typing import List

from sched.models.room import Room
from sched.models.schedule import ParsedSchedule, DayPattern
from sched.pool.pool import Pool, SchedulingEntity


def _parse_blocks_from_member(member):
    """Re-parse schedule blocks from a Subject's current fields."""
    blocks = []
    for slot_schedule, pattern_enum in (
        (member.mth_schedule, DayPattern.MTH),
        (member.tfs_schedule, DayPattern.TFS),
    ):
        if not slot_schedule:
            continue
        try:
            parsed = ParsedSchedule.parse(slot_schedule.strip(), pattern_enum)
            blocks.extend(parsed.blocks)
        except Exception:
            pass
    return blocks


def run_intra_pool_ga(
    pool: Pool,
    rooms: List[Room],
    constraints: dict,
    global_start: float,
    global_budget_s: float,
) -> Pool:
    """
    Run a short intra-pool GA to improve soft objectives within the pool.
    Skips if < 2 entities or < 10 seconds of global budget remain.
    """
    if len(pool.entities) < 2:
        return pool

    elapsed = time.perf_counter() - global_start
    remaining = global_budget_s - elapsed
    if remaining < 10.0:
        return pool

    try:
        from sched.ga.deap_setup import run_ga_optimization

        subjects = [m for e in pool.entities for m in e.members]

        pool_rooms = [r for r in rooms if str(r.room_id) in pool.room_keys]
        if not pool_rooms:
            pool_rooms = rooms

        per_pool_budget = min(remaining - 5.0, float(constraints.get('max_runtime_seconds', 45.0)) / 4)
        if per_pool_budget < 5.0:
            return pool

        pool_constraints = dict(constraints)
        pool_constraints['max_runtime_seconds'] = per_pool_budget
        pool_constraints['population_size'] = min(
            int(constraints.get('population_size', 120)), 30
        )

        optimized = run_ga_optimization(
            pending=subjects,
            resolved=[],
            rooms=pool_rooms,
            constraints=pool_constraints,
        )

        subject_map = {s.subject_id: s for s in optimized}
        for entity in pool.entities:
            for i, member in enumerate(entity.members):
                if member.subject_id in subject_map:
                    entity.members[i] = subject_map[member.subject_id]
            entity.current_schedule_blocks = _parse_blocks_from_member(entity.members[0])

    except Exception:
        pass

    return pool


def run_global_ga(
    pools: List[Pool],
    rooms: List[Room],
    constraints: dict,
    global_start: float,
    global_budget_s: float,
) -> List[Pool]:
    """
    Step 7: Global soft-objective GA.
    Currently a stub — returns pools unchanged.
    Full implementation can be added when time budget consistently permits.
    """
    remaining = global_budget_s - (time.perf_counter() - global_start)
    if remaining < 5.0:
        return pools
    return pools
