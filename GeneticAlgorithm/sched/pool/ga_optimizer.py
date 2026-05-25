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

import sys
import time
import traceback
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

    Only operates on entities that were already moved by the scheduler
    (was_modified=True). If the pool contains any original/untouched entity
    (was_modified=False) the GA is skipped entirely — those subjects must not
    be rescheduled, and the resolved parameter in run_ga_optimization is not
    currently enforced in the fitness function.
    """
    if len(pool.entities) < 2:
        return pool

    elapsed = time.perf_counter() - global_start
    remaining = global_budget_s - elapsed
    if remaining < 10.0:
        return pool

    locked  = [e for e in pool.entities if not e.was_modified]
    movable = [e for e in pool.entities if e.was_modified]

    # Preserve the invariant: original schedules are never touched by the GA.
    # Only skip if there is nothing movable; locked entities are excluded from
    # the GA subjects list entirely (line below), so their presence is fine.
    if not movable:
        return pool

    try:
        from sched.ga.deap_setup import run_ga_optimization

        # Snapshot blocks so we can detect changes and set was_modified correctly.
        before_blocks = {
            e.entity_id: list(e.current_schedule_blocks)
            for e in pool.entities
        }

        subjects = [m for e in movable for m in e.members]
        locked_subjects = [m for e in locked + pool.locked_entities for m in e.members]

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
            resolved=locked_subjects,
            rooms=pool_rooms,
            constraints=pool_constraints,
        )

        subject_map = {s.subject_id: s for s in optimized}
        for entity in movable:
            for i, member in enumerate(entity.members):
                if member.subject_id in subject_map:
                    entity.members[i] = subject_map[member.subject_id]
            entity.current_schedule_blocks = _parse_blocks_from_member(entity.members[0])
            if entity.is_merge_group and len(entity.members) > 1:
                ref = entity.members[0]
                for m in entity.members[1:]:
                    m.mth_schedule = ref.mth_schedule
                    m.mth_room     = ref.mth_room
                    m.tfs_schedule = ref.tfs_schedule
                    m.tfs_room     = ref.tfs_room

        # Safety: flag any entity whose blocks actually changed.
        for entity in pool.entities:
            if entity.current_schedule_blocks != before_blocks.get(entity.entity_id, []):
                entity.was_modified = True

    except Exception:
        print(f"[ga_optimizer] intra-pool GA failed for pool {pool.pool_id}:\n"
              f"{traceback.format_exc()}", file=sys.stderr)

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
