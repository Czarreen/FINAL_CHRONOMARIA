"""
RoomTypeRegistry — single authority for room type lookups throughout the pipeline.

Classification rule: "LAB" in raw.upper() -> LABORATORY, else LECTURE/UNKNOWN.
This matches the existing is_lab_room() check in sched/ga/common.py.
"""

import re
from typing import Dict, List, Optional, Set

from sched.models.room import Room, RoomType

_GYM_RE = re.compile(r'gym', re.IGNORECASE)


class RoomTypeRegistry:
    def __init__(self, rooms: List[Room]) -> None:
        self._map: Dict[str, RoomType] = {}
        self._name_map: Dict[str, str] = {}   # room_id -> room_name
        self._gym_keys: Set[str] = set()
        for room in rooms:
            key = str(room.room_id).strip()
            self._map[key] = self._classify(room.room_type)
            if room.room_name:
                self._name_map[key] = room.room_name
            if _GYM_RE.search(room.room_name or ''):
                self._gym_keys.add(key)

    @staticmethod
    def _classify(raw: Optional[str]) -> RoomType:
        if not raw:
            return RoomType.UNKNOWN
        upper = raw.strip().upper()
        if "LAB" in upper:
            return RoomType.LABORATORY
        if "LEC" in upper or "LECTURE" in upper or "CLASS" in upper:
            return RoomType.LECTURE
        return RoomType.UNKNOWN

    def building_of(self, room_key: str) -> str:
        """Return the building prefix for a room, derived from its name."""
        name = self._name_map.get(str(room_key).strip(), room_key)
        m = re.match(r'^([A-Za-z]+)', name.strip())
        return m.group(1).upper() if m else name.upper()

    def is_gym(self, room_key: str) -> bool:
        return str(room_key).strip() in self._gym_keys

    def gym_keys(self) -> Set[str]:
        return set(self._gym_keys)

    def type_of(self, room_key: str) -> RoomType:
        return self._map.get(str(room_key).strip(), RoomType.UNKNOWN)

    def is_lab(self, room_key: str) -> bool:
        return self.type_of(room_key) == RoomType.LABORATORY

    def is_lecture(self, room_key: str) -> bool:
        return self.type_of(room_key) in (RoomType.LECTURE, RoomType.UNKNOWN)

    def rooms_of_type(self, rt: RoomType) -> Set[str]:
        return {k for k, v in self._map.items() if v == rt}

    def name_of(self, room_key: str) -> str:
        """Return the room name for a key, or the key itself if unknown."""
        return self._name_map.get(str(room_key).strip(), str(room_key).strip())

    def all_keys(self) -> Set[str]:
        return set(self._map.keys())

    def lab_keys(self) -> Set[str]:
        return self.rooms_of_type(RoomType.LABORATORY)

    def lecture_keys(self) -> Set[str]:
        return {k for k, v in self._map.items() if v in (RoomType.LECTURE, RoomType.UNKNOWN)}
