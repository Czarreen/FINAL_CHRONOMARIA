"""
Step 4: Conflicted Subjects Migration Cascade.

For each conflicted entity, attempts to find a new (pool, time_slot) without
hard conflicts. Two cascade strategies:

  Lab-requiring entities (requires_lab_room=True):
    Only Laboratory rooms at all stages. Never fall back to Lecture rooms.

  Lecture-only entities (requires_lab_room=False):
    Prefer Lecture rooms within each scope; accept Lab rooms as fallback.

6 stages per entity (applies to both strategies):
  Stage 1: same building, D_orig
  Stage 2: dept fallback buildings, D_orig
  Stage 3: any other building, D_orig
  Stage 4: same building, D_opp
  Stage 5: dept fallback buildings, D_opp
  Stage 6: any other building, D_opp
  -> Manual review if all exhausted

Never targets Saturday slots. 5-second per-entity wall-clock cap.
"""

import re
import time
from typing import Dict, List, Optional, Set, Tuple

from sched.conflict.intervals import SCHED_START_MIN, overlaps
from sched.conflict.detector import check_conflict
from sched.models.room import RoomType
from sched.models.schedule import Day, DayPattern, ParsedSchedule, TimeBlock
from sched.pool.department_rooms import preferred_buildings
from sched.pool.pool import Pool, SchedulingEntity
from sched.pool.room_types import RoomTypeRegistry

# 26 30-minute slots from 7:30 AM to 8:00 PM
SLOT_STEP = 30
SCHED_END_MIGRATION = 20 * 60   # 8:00 PM (no Saturday, so earlier cutoff than SCHED_END_MAX)
LUNCH_START_MIN     = 12 * 60   # 720 - 12:00 PM (lunch window start)
LUNCH_END_MIN       = 13 * 60   # 780 -  1:00 PM (lunch window end)

_MTH_DAYS = {Day.MON, Day.THU}
_TFS_DAYS = {Day.TUE, Day.FRI}

_DAY_TO_PATTERN: Dict[Day, str] = {
    Day.MON: "MTh",
    Day.THU: "MTh",
    Day.TUE: "TFS",
    Day.FRI: "TFS",
}

_SINGLE_SLOT_FALLBACK: Dict[Day, List[Day]] = {
    Day.MON: [Day.MON, Day.THU, Day.TUE, Day.FRI],
    Day.THU: [Day.THU, Day.MON, Day.FRI, Day.TUE],
    Day.TUE: [Day.TUE, Day.FRI, Day.MON, Day.THU],
    Day.FRI: [Day.FRI, Day.TUE, Day.THU, Day.MON],
}

# Room name format: {Building letters}{Floor digit}0{Room digits}  e.g. E103, AP201
_ROOM_NAME_RE = re.compile(r'^([A-Za-z]+)(\d)0(\d+)$')


def _parse_room_name(name: str) -> Tuple[str, int, int]:
    """Return (building, floor, room_num) from a room name like 'E103'."""
    m = _ROOM_NAME_RE.match(name.strip())
    if m:
        return (m.group(1).upper(), int(m.group(2)), int(m.group(3)))
    return ('~', 99, 99)


def _pool_room_sort_key(pool: Pool, registry: RoomTypeRegistry) -> Tuple:
    """Sort key (floor, room_num) so rooms are traversed floor-then-room ascending."""
    if pool.is_dual_room:
        return (99, 99)
    name = registry.name_of(next(iter(pool.room_keys)))
    _, floor, room_num = _parse_room_name(name)
    return (floor, room_num)

_PATHFIT_RE = re.compile(r'path\s*fit', re.IGNORECASE)


def _is_pathfit_entity(entity: SchedulingEntity) -> bool:
    return any(_PATHFIT_RE.search(m.course_no or '') for m in entity.members)


def _candidate_starts(duration: int) -> List[int]:
    starts = []
    t = SCHED_START_MIN
    while t + duration <= SCHED_END_MIGRATION:
        # Skip slots whose start falls inside the lunch break (12:00–13:00).
        # A class that ends at 12:30 (start=10:00) is still allowed; only
        # a class that would START at 12:00-12:59 is deferred to 13:00.
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


def _make_single_day_blocks(start: int, duration: int, day: Day) -> List[TimeBlock]:
    return [TimeBlock(day=day, start_minutes=start, end_minutes=start + duration)]


def _schedule_str(start: int, duration: int) -> str:
    s_h, s_m = divmod(start, 60)
    e_h, e_m = divmod(start + duration, 60)
    return f"{s_h % 12 or 12}:{s_m:02d}-{e_h % 12 or 12}:{e_m:02d}"


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


def _time_free_in_pool(pool: Pool, blocks_to_place: List[TimeBlock]) -> bool:
    """True if placing blocks_to_place into pool causes no conflicts."""
    for entity in pool.entities + pool.locked_entities:
        for existing_block in entity.current_schedule_blocks:
            for new_block in blocks_to_place:
                if existing_block.day == new_block.day:
                    if overlaps(
                        existing_block.start_minutes,
                        existing_block.end_minutes,
                        new_block.start_minutes,
                        new_block.end_minutes,
                    ):
                        return False
    return True


def _apply_placement(
    entity: SchedulingEntity,
    target_pool: Pool,
    blocks: List[TimeBlock],
    pattern: str,
    room_str: str,
) -> None:
    entity.current_schedule_blocks = blocks
    entity.current_room_keys = set(target_pool.room_keys)
    entity.current_day_pattern = pattern
    entity.was_modified = True
    for member in entity.members:
        sched_str = _schedule_str(blocks[0].start_minutes, _effective_duration(entity))
        if pattern == "MTh":
            member.mth_schedule = sched_str
            member.mth_room = room_str
        else:
            member.tfs_schedule = sched_str
            member.tfs_room = room_str
    target_pool.entities.append(entity)


def _try_place_in_pool(
    entity: SchedulingEntity,
    pool: Pool,
    pattern: str,
    deadline: float,
) -> bool:
    """Attempt to place entity in pool on pattern. Returns True if placed."""
    duration = _effective_duration(entity)
    room_str = pool.pool_id.replace("_", "/") if pool.is_dual_room else pool.pool_id

    for start in _candidate_starts(duration):
        if time.perf_counter() > deadline:
            return False
        blocks = _make_blocks(start, duration, pattern)
        if _time_free_in_pool(pool, blocks):
            _apply_placement(entity, pool, blocks, pattern, room_str)
            return True
    return False


def _apply_placement_single_day(
    entity: SchedulingEntity,
    target_pool: Pool,
    blocks: List[TimeBlock],
    pattern: str,
    day: Day,
    room_str: str,
) -> None:
    entity.current_schedule_blocks = blocks
    entity.current_room_keys = set(target_pool.room_keys)
    entity.current_day_pattern = pattern
    entity.was_modified = True
    sched_str = f"{_schedule_str(blocks[0].start_minutes, blocks[0].end_minutes - blocks[0].start_minutes)} {day.value}"
    for member in entity.members:
        if pattern == "MTh":
            member.mth_schedule = sched_str
            member.mth_room = room_str
            member.tfs_schedule = None
            member.tfs_room = None
        else:
            member.tfs_schedule = sched_str
            member.tfs_room = room_str
            member.mth_schedule = None
            member.mth_room = None
    target_pool.entities.append(entity)


def _try_place_single_day_in_pool(
    entity: SchedulingEntity,
    pool: Pool,
    day: Day,
    deadline: float,
) -> bool:
    duration = _effective_duration(entity)
    pattern = _DAY_TO_PATTERN[day]
    room_str = pool.pool_id.replace("_", "/") if pool.is_dual_room else pool.pool_id
    for start in _candidate_starts(duration):
        if time.perf_counter() > deadline:
            return False
        blocks = _make_single_day_blocks(start, duration, day)
        if _time_free_in_pool(pool, blocks):
            _apply_placement_single_day(entity, pool, blocks, pattern, day, room_str)
            return True
    return False


def _buildings_in_pools(pools: List[Pool]) -> Set[str]:
    return {p.building for p in pools}


def _stage_pools_for(
    entity: SchedulingEntity,
    all_pools: List[Pool],
    source_pool: Pool,
    registry: RoomTypeRegistry,
    pattern: str,
) -> List[List[Pool]]:
    """
    Returns 3 ordered groups of candidate pools for stages 1-3 (for one pattern).
    Groups: [same_building_pools, dept_fallback_pools, other_building_pools]
    Room type filtering is applied inside the caller.
    """
    dept_pref = preferred_buildings(entity.department_id)

    same_building: List[Pool] = []
    dept_fallback: List[Pool] = []
    other: List[Pool] = []

    for pool in all_pools:
        if pool.pool_id == source_pool.pool_id:
            continue
        if pool.building == source_pool.building:
            same_building.append(pool)
        elif pool.building in dept_pref:
            dept_fallback.append(pool)
        else:
            other.append(pool)

    # Within each group traverse rooms in ascending floor then room-number order
    # so the scheduler walks E101→E102→E104→E201→E202→... before crossing buildings.
    key = lambda p: _pool_room_sort_key(p, registry)
    same_building.sort(key=key)
    dept_fallback.sort(key=key)
    other.sort(key=key)

    return [same_building, dept_fallback, other]


def _filter_by_type(
    pools: List[Pool],
    requires_lab: bool,
    prefer_lecture: bool = False,
) -> List[Pool]:
    if requires_lab:
        return [p for p in pools if p.room_type == RoomType.LABORATORY]
    if prefer_lecture:
        lec = [p for p in pools if p.room_type != RoomType.LABORATORY]
        lab = [p for p in pools if p.room_type == RoomType.LABORATORY]
        return lec + lab
    return pools


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


def _try_migrate_entity(
    entity: SchedulingEntity,
    all_pools: List[Pool],
    source_pool: Pool,
    registry: RoomTypeRegistry,
    deadline: float,
) -> bool:
    requires_lab = entity.requires_lab_room
    is_pathfit = _is_pathfit_entity(entity)

    # Single-slot path: entity has exactly one TimeBlock (e.g., "7:30-10:00 M").
    # Stay single-slot and search days in the defined priority order.
    if len(entity.current_schedule_blocks) == 1:
        origin_day = entity.current_schedule_blocks[0].day
        fallback_days = _SINGLE_SLOT_FALLBACK.get(
            origin_day, [Day.MON, Day.THU, Day.TUE, Day.FRI]
        )

        # Step 0: same room, same day, different time slot.
        if not time.perf_counter() > deadline:
            if _try_place_single_day_in_pool(entity, source_pool, origin_day, deadline):
                return True

        # Steps 1-N: 6-stage room search per fallback day in priority order.
        for day in fallback_days:
            pattern = _DAY_TO_PATTERN[day]
            groups = _stage_pools_for(entity, all_pools, source_pool, registry, pattern)
            for group in groups:
                if time.perf_counter() > deadline:
                    return False
                candidates = _filter_by_type(group, requires_lab, prefer_lecture=True)
                candidates = _filter_gym(candidates, registry, is_pathfit)
                for pool in candidates:
                    if _try_place_single_day_in_pool(entity, pool, day, deadline):
                        return True
        return False

    # Paired-day path (original logic).
    orig_pattern = entity.current_day_pattern or "MTh"
    opp_pattern = "TFS" if orig_pattern == "MTh" else "MTh"

    # Step 0: try a different time slot within the same room before moving anywhere.
    # _time_free_in_pool checks against pool.entities (which still contains the
    # winner that displaced this entity), so conflicted times are correctly rejected.
    if not time.perf_counter() > deadline:
        if _try_place_in_pool(entity, source_pool, orig_pattern, deadline):
            return True

    # Steps 1-6: migrate to a different room, ordered by proximity.
    for pattern in [orig_pattern, opp_pattern]:
        groups = _stage_pools_for(entity, all_pools, source_pool, registry, pattern)
        for group in groups:
            if time.perf_counter() > deadline:
                return False
            candidates = _filter_by_type(group, requires_lab, prefer_lecture=True)
            candidates = _filter_gym(candidates, registry, is_pathfit)
            for pool in candidates:
                if _try_place_in_pool(entity, pool, pattern, deadline):
                    return True

    return False


def migrate_conflicted_entities(
    pools: List[Pool],
    registry: RoomTypeRegistry,
    max_per_entity_s: float = 5.0,
) -> Tuple[List[Pool], List[SchedulingEntity]]:
    """
    Attempt to place each conflicted entity into a different pool.
    Returns (updated_pools, manual_review_entities).
    """
    manual_review: List[SchedulingEntity] = []

    for pool in pools:
        remaining: List[SchedulingEntity] = []
        for entity in pool.conflicted_entities:
            deadline = time.perf_counter() + max_per_entity_s
            placed = _try_migrate_entity(entity, pools, pool, registry, deadline)
            if not placed:
                entity.manual_review_reason = (
                    "lab_subject_no_lab_room_available"
                    if entity.requires_lab_room
                    else "lecture_subject_no_room_available"
                )
                manual_review.append(entity)
        pool.conflicted_entities = remaining

    return pools, manual_review
