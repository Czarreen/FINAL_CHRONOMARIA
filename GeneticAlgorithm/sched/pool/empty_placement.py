"""
Step 5: Empty-Field Subject Placement (two-phase).

Phase 1: Lab-requiring entities first (more constrained; Lab rooms are scarcer).
Phase 2: Lecture-only entities after (prefer Lecture rooms, Lab as fallback).

Within each phase, entities are sorted by priority (units > lab_hrs > lec_hrs > code).
Each entity is placed against the current state of all pools (incremental).
"""

import re
import time
from typing import List, Optional, Set, Tuple

from sched.conflict.intervals import SCHED_START_MIN, overlaps
from sched.models.room import RoomType
from sched.models.schedule import Day, TimeBlock
from sched.pool.department_rooms import preferred_buildings
from sched.pool.pool import Pool, SchedulingEntity
from sched.pool.room_types import RoomTypeRegistry

SLOT_STEP = 30
SCHED_END_PLACEMENT = 20 * 60  # 8:00 PM
LUNCH_START_MIN     = 12 * 60  # 12:00 PM
LUNCH_END_MIN       = 13 * 60  #  1:00 PM

_PATHFIT_RE = re.compile(r'path\s*fit', re.IGNORECASE)


def _is_pathfit_entity(entity: SchedulingEntity) -> bool:
    return any(_PATHFIT_RE.search(m.course_no or '') for m in entity.members)


def _candidate_starts(duration: int) -> List[int]:
    starts = []
    t = SCHED_START_MIN
    while t + duration <= SCHED_END_PLACEMENT:
        if t < LUNCH_END_MIN and t + duration > LUNCH_START_MIN:
            t = LUNCH_END_MIN
            continue
        starts.append(t)
        t += SLOT_STEP
    return starts


def _make_blocks(start: int, duration: int, pattern: str) -> List[TimeBlock]:
    end = start + duration
    days = [Day.MON, Day.THU] if pattern == "MTh" else [Day.TUE, Day.FRI]
    return [TimeBlock(day=d, start_minutes=start, end_minutes=end) for d in days]


def _schedule_str(start: int, duration: int) -> str:
    s_h, s_m = divmod(start, 60)
    e_h, e_m = divmod(start + duration, 60)
    s_mer = "AM" if s_h < 12 else "PM"
    e_mer = "AM" if e_h < 12 else "PM"
    return f"{s_h % 12 or 12}:{s_m:02d} {s_mer}-{e_h % 12 or 12}:{e_m:02d} {e_mer}"


def _effective_duration(entity: SchedulingEntity) -> int:
    """Use actual block width → raw string parse → hours formula (last resort)."""
    if entity.current_schedule_blocks:
        b = entity.current_schedule_blocks[0]
        return max(30, b.end_minutes - b.start_minutes)
    for m in entity.members:
        for sched in (m.mth_schedule, m.tfs_schedule):
            if not sched:
                continue
            match = re.search(r'(\d{1,2}:\d{2})-(\d{1,2}:\d{2})', sched)
            if match:
                def _to_min(ts: str) -> int:
                    h, mn = ts.split(':')
                    return int(h) * 60 + int(mn)
                dur = _to_min(match.group(2)) - _to_min(match.group(1))
                if dur > 0:
                    return max(30, dur)
    return max(30, round((entity.total_lab_hrs + entity.total_lec_hrs) / 2.0 * 60))


def _time_free_in_pool(pool: Pool, blocks: List[TimeBlock]) -> bool:
    for existing_entity in pool.entities + pool.locked_entities:
        for eb in existing_entity.current_schedule_blocks:
            for nb in blocks:
                if eb.day == nb.day and overlaps(
                    eb.start_minutes, eb.end_minutes,
                    nb.start_minutes, nb.end_minutes,
                ):
                    return False
    return True


def _priority_key_lab(entity: SchedulingEntity):
    code = entity.members[0].code or entity.members[0].course_no or ""
    return (-entity.total_units, -entity.total_lab_hrs, -entity.total_lec_hrs, code)


def _priority_key_lec(entity: SchedulingEntity):
    code = entity.members[0].code or entity.members[0].course_no or ""
    return (-entity.total_units, -entity.total_lec_hrs, code)


def _filter_gym(
    pools: List[Pool],
    registry: RoomTypeRegistry,
    is_pathfit: bool,
) -> List[Pool]:
    """Enforce the gym/Pathfit exclusivity rule: only Pathfit subjects use gym rooms."""
    result = []
    for pool in pools:
        pool_is_gym = any(registry.is_gym(k) for k in pool.room_keys)
        if pool_is_gym and not is_pathfit:
            continue
        if not pool_is_gym and is_pathfit:
            continue
        result.append(pool)
    return result


def _ordered_pools_for(
    entity: SchedulingEntity,
    pools: List[Pool],
    requires_lab: bool,
    registry: Optional[RoomTypeRegistry] = None,
) -> List[Pool]:
    """
    Returns candidate pools ordered by affinity (dept primary, dept fallback, rest).
    Lab entities: Lab-only pools. Lecture entities: Lecture first, then Lab.
    Gym pools are reserved exclusively for Pathfit subjects.
    """
    dept_pref = preferred_buildings(entity.department_id)
    is_pathfit = _is_pathfit_entity(entity)

    primary: List[Pool] = []
    fallback: List[Pool] = []
    other: List[Pool] = []

    for pool in pools:
        if requires_lab and pool.room_type != RoomType.LABORATORY:
            continue
        if pool.building in dept_pref[:1]:
            primary.append(pool)
        elif pool.building in dept_pref[1:]:
            fallback.append(pool)
        else:
            other.append(pool)

    if not requires_lab:
        lec = [p for p in primary + fallback + other if p.room_type != RoomType.LABORATORY]
        lab = [p for p in primary + fallback + other if p.room_type == RoomType.LABORATORY]
        ordered = lec + lab
    else:
        ordered = primary + fallback + other

    if registry is not None:
        ordered = _filter_gym(ordered, registry, is_pathfit)

    return ordered


def _try_place(
    entity: SchedulingEntity,
    pools: List[Pool],
    pattern: str,
    deadline: float,
    registry: Optional[RoomTypeRegistry] = None,
) -> bool:
    duration = _effective_duration(entity)
    ordered = _ordered_pools_for(entity, pools, entity.requires_lab_room, registry=registry)

    for pool in ordered:
        if time.perf_counter() > deadline:
            return False
        for start in _candidate_starts(duration):
            blocks = _make_blocks(start, duration, pattern)
            if _time_free_in_pool(pool, blocks):
                room_str = pool.pool_id.replace("_", "/") if pool.is_dual_room else pool.pool_id
                sched_str = _schedule_str(start, duration)
                entity.current_schedule_blocks = blocks
                entity.current_room_keys = set(pool.room_keys)
                entity.current_day_pattern = pattern
                entity.was_modified = True
                for member in entity.members:
                    if pattern == "MTh":
                        member.mth_schedule = sched_str
                        member.mth_room = room_str
                    else:
                        member.tfs_schedule = sched_str
                        member.tfs_room = room_str
                pool.entities.append(entity)
                return True
    return False


def _place_entity(
    entity: SchedulingEntity,
    pools: List[Pool],
    global_start: float,
    global_budget_s: float,
    per_entity_s: float = 5.0,
    registry: Optional[RoomTypeRegistry] = None,
) -> bool:
    remaining = global_budget_s - (time.perf_counter() - global_start)
    if remaining < 1.0:
        return False
    deadline = time.perf_counter() + min(per_entity_s, remaining - 0.5)

    for pattern in ["MTh", "TFS"]:
        if _try_place(entity, pools, pattern, deadline, registry=registry):
            return True
    return False


def place_empty_entities(
    unassigned: List[SchedulingEntity],
    pools: List[Pool],
    registry: RoomTypeRegistry,
    global_start: float,
    global_budget_s: float,
) -> Tuple[List[Pool], List[SchedulingEntity], List[SchedulingEntity]]:
    """
    Phase 1: place lab-requiring entities into Lab pools.
    Phase 2: place lecture-only entities into Lecture pools (Lab fallback allowed).

    Returns (updated_pools, newly_placed, still_empty).
    still_empty entities are sent to manual_review by the caller.
    """
    placed: List[SchedulingEntity] = []
    still_empty: List[SchedulingEntity] = []

    # Entities already flagged for manual review pass through
    pre_flagged = [e for e in unassigned if e.manual_review_reason is not None]
    to_place = [e for e in unassigned if e.manual_review_reason is None]

    still_empty.extend(pre_flagged)

    # Phase 1: lab entities
    lab_entities = sorted(
        [e for e in to_place if e.requires_lab_room],
        key=_priority_key_lab,
    )
    for entity in lab_entities:
        if _place_entity(entity, pools, global_start, global_budget_s, registry=registry):
            placed.append(entity)
        else:
            entity.manual_review_reason = "lab_subject_placement_exhausted"
            still_empty.append(entity)

    # Phase 2: lecture entities (after all lab entities are resolved)
    lec_entities = sorted(
        [e for e in to_place if not e.requires_lab_room],
        key=_priority_key_lec,
    )
    for entity in lec_entities:
        if _place_entity(entity, pools, global_start, global_budget_s, registry=registry):
            placed.append(entity)
        else:
            entity.manual_review_reason = "lecture_subject_placement_exhausted"
            still_empty.append(entity)

    return pools, placed, still_empty
