"""
Step 3: Intra-Pool Conflict Resolution.

Within each pool, detects conflicting entities and displaces the
lower-priority entity to pool.conflicted_entities for migration in Step 4.
"""

from typing import List, Optional, Set, Tuple

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

    Phase 1: displace any pool.entities entity that conflicts with a locked entity.
             Locked entities are immovable — the pool.entities side always loses.
    Phase 2: resolve remaining intra-pool conflicts by priority.
             Lower-priority entity moves to pool.conflicted_entities for migration.
             Cap: max_rounds = len(pool.entities) + 1 to prevent infinite loops.
    """
    # Phase 1: pool.entities vs pool.locked_entities
    for entity in list(pool.entities):
        for locked in pool.locked_entities:
            if _entities_conflict(entity, locked):
                pool.entities.remove(entity)
                pool.conflicted_entities.append(entity)
                break

    # Phase 2: intra-pool conflicts
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


def _normalize_title(t: str) -> str:
    return " ".join(t.lower().split())


def _entities_conflict_final(ea: SchedulingEntity, eb: SchedulingEntity) -> bool:
    """
    Conflict check for the final scan.

    Uses entity.current_schedule_blocks and entity.current_room_keys, which are
    always set to the final placement state. Deliberately avoids check_conflict /
    Subject.mth_schedule / Subject.mth_room because _apply_placement() in
    migration.py writes only the new pattern's fields and does not clear the old
    opposite-pattern fields, leaving stale room/schedule data on Subject objects
    that would produce false-positive conflicts.

    Same-title pairs are skipped (merge-group co-location, not a conflict).
    """
    if not ea.current_schedule_blocks or not eb.current_schedule_blocks:
        return False
    if not ea.current_room_keys or not eb.current_room_keys:
        return False
    if not (ea.current_room_keys & eb.current_room_keys):
        return False

    titles_a = {_normalize_title(m.descriptive_title) for m in ea.members}
    titles_b = {_normalize_title(m.descriptive_title) for m in eb.members}
    if titles_a & titles_b:
        return False

    for ba in ea.current_schedule_blocks:
        for bb in eb.current_schedule_blocks:
            if (ba.day == bb.day
                    and ba.start_minutes < bb.end_minutes
                    and bb.start_minutes < ba.end_minutes):
                return True
    return False


def detect_final_conflicts(
    entities: List[SchedulingEntity],
) -> List[Tuple[SchedulingEntity, SchedulingEntity]]:
    """Return (loser, winner) pairs for each conflict found in the final placed list."""
    flagged: Set[str] = set()
    result: List[Tuple[SchedulingEntity, SchedulingEntity]] = []
    for i, a in enumerate(entities):
        if a.entity_id in flagged:
            continue
        for b in entities[i + 1:]:
            if b.entity_id in flagged:
                continue
            if _entities_conflict_final(a, b):
                loser, winner = (a, b) if priority_key(a) < priority_key(b) else (b, a)
                if loser.entity_id not in flagged:
                    flagged.add(loser.entity_id)
                    result.append((loser, winner))
    return result


def _find_first_conflict(
    entities: List[SchedulingEntity],
) -> Optional[Tuple[SchedulingEntity, SchedulingEntity]]:
    for i in range(len(entities)):
        for j in range(i + 1, len(entities)):
            ea, eb = entities[i], entities[j]
            if _entities_conflict(ea, eb):
                return ea, eb
    return None
