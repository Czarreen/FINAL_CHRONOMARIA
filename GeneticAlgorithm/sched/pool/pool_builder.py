"""
Step 2: Initial Pooling.

Groups SCHEDULED SchedulingEntity objects by the room(s) they currently
occupy. EMPTY and Saturday entities are returned as 'unassigned' for
later handling (Steps 5 and manual review).
"""

from typing import Dict, FrozenSet, List, Set, Tuple

from sched.models.room import RoomType
from sched.pool.pool import Pool, SchedulingEntity
from sched.pool.room_types import RoomTypeRegistry


def _resolve_pool_room_type(room_keys: FrozenSet[str], registry: RoomTypeRegistry) -> RoomType:
    types = {registry.type_of(k) for k in room_keys}
    if RoomType.LABORATORY in types:
        return RoomType.LABORATORY
    if RoomType.LECTURE in types:
        return RoomType.LECTURE
    return RoomType.UNKNOWN


def ensure_all_room_pools(
    pools: List[Pool],
    registry: RoomTypeRegistry,
    active_room_keys: Set[str],
) -> List[Pool]:
    """
    Ensure a pool exists for every active single room, even rooms not yet
    used by any scheduled entity. Returns an extended pool list.
    """
    existing_keys: Set[FrozenSet[str]] = {p.room_keys for p in pools}
    for room_key in sorted(active_room_keys):
        fk = frozenset({room_key})
        if fk in existing_keys:
            continue
        building = registry.building_of(room_key)
        rt = registry.type_of(room_key)
        pools.append(Pool(
            pool_id=room_key,
            room_keys=fk,
            building=building,
            room_type=rt,
            is_dual_room=False,
        ))
        existing_keys.add(fk)
    return pools


def build_pools(
    entities: List[SchedulingEntity],
    registry: RoomTypeRegistry,
    active_room_keys: Set[str],
) -> Tuple[List[Pool], List[SchedulingEntity]]:
    """
    Assign each SCHEDULED entity to a Pool keyed by its room(s).
    Returns (pools, unassigned).

    unassigned contains:
    - EMPTY entities (state=EMPTY)
    - Saturday entities (is_saturday_entity())
    - Entities whose rooms are not in active_room_keys
    - Entities with manual_review_reason already set
    """
    pool_map: Dict[FrozenSet[str], Pool] = {}
    unassigned: List[SchedulingEntity] = []

    for entity in entities:
        # Already flagged for manual review → skip pooling
        if entity.manual_review_reason is not None:
            unassigned.append(entity)
            continue

        # Saturday entities → manual review path
        if entity.is_saturday_entity():
            if entity.manual_review_reason is None:
                entity.manual_review_reason = "saturday_explicit"
            unassigned.append(entity)
            continue

        # Empty entities → deferred to Step 5
        if not entity.current_room_keys:
            unassigned.append(entity)
            continue

        # Intersect with known active rooms
        valid_keys = frozenset(entity.current_room_keys & active_room_keys)
        if not valid_keys:
            # Room not in registry → flag for review
            entity.manual_review_reason = "unknown_room"
            unassigned.append(entity)
            continue

        # Mixed-type dual room → flag for review
        if len(valid_keys) > 1:
            types = {registry.type_of(k) for k in valid_keys}
            has_lab = RoomType.LABORATORY in types
            has_lec = RoomType.LECTURE in types or RoomType.UNKNOWN in types
            if has_lab and has_lec:
                entity.manual_review_reason = "mixed_type_dual_room"
                unassigned.append(entity)
                continue

        if valid_keys not in pool_map:
            sorted_keys = sorted(valid_keys)
            pool_id = "_".join(sorted_keys)
            building = registry.building_of(sorted_keys[0])
            rt = _resolve_pool_room_type(valid_keys, registry)
            pool_map[valid_keys] = Pool(
                pool_id=pool_id,
                room_keys=valid_keys,
                building=building,
                room_type=rt,
                is_dual_room=len(valid_keys) > 1,
            )

        pool_map[valid_keys].entities.append(entity)

    return list(pool_map.values()), unassigned
