"""
Step 3: Intra-Pool Conflict Resolution.

Within each pool, detects conflicting entities and displaces the
lower-priority entity to pool.conflicted_entities for migration in Step 4.
"""

from typing import List, Optional, Tuple

from sched.conflict.detector import check_conflict
from sched.pool.pool import Pool, SchedulingEntity
from sched.pool.priority import priority_key


def _entities_conflict(ea: SchedulingEntity, eb: SchedulingEntity) -> bool:
    """True if any member-pair across two entities produces a hard conflict."""
    for ma in ea.members:
        for mb in eb.members:
            if ma.subject_id == mb.subject_id:
                continue
            report, _ = check_conflict(ma, mb)
            if report is not None:
                return True
    return False


def resolve_pool_conflicts(pool: Pool) -> Pool:
    """
    Detect and resolve all intra-pool conflicts.
    Lower-priority entities in each conflict pair move to
    pool.conflicted_entities. Repeats until no conflicts remain.

    Cap: max_rounds = len(pool.entities) + 1 to prevent infinite loops.
    """
    max_rounds = len(pool.entities) + 1

    for _ in range(max_rounds):
        conflict_pair = _find_first_conflict(pool.entities)
        if conflict_pair is None:
            break
        ea, eb = conflict_pair
        loser = eb if priority_key(ea) >= priority_key(eb) else ea
        pool.entities.remove(loser)
        pool.conflicted_entities.append(loser)

    return pool


def _find_first_conflict(
    entities: List[SchedulingEntity],
) -> Optional[Tuple[SchedulingEntity, SchedulingEntity]]:
    for i in range(len(entities)):
        for j in range(i + 1, len(entities)):
            ea, eb = entities[i], entities[j]
            if _entities_conflict(ea, eb):
                return ea, eb
    return None
