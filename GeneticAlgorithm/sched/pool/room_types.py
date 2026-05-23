"""
RoomTypeRegistry — single authority for room type lookups throughout the pipeline.

Classification rule: "LAB" in raw.upper() -> LABORATORY, else LECTURE/UNKNOWN.
This matches the existing is_lab_room() check in sched/ga/common.py.
"""

from typing import Dict, List, Optional, Set

from sched.models.room import Room, RoomType


class RoomTypeRegistry:
    def __init__(self, rooms: List[Room]) -> None:
        self._map: Dict[str, RoomType] = {}
        for room in rooms:
            key = str(room.room_id).strip()
            self._map[key] = self._classify(room.room_type)

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

    def type_of(self, room_key: str) -> RoomType:
        return self._map.get(str(room_key).strip(), RoomType.UNKNOWN)

    def is_lab(self, room_key: str) -> bool:
        return self.type_of(room_key) == RoomType.LABORATORY

    def is_lecture(self, room_key: str) -> bool:
        return self.type_of(room_key) in (RoomType.LECTURE, RoomType.UNKNOWN)

    def rooms_of_type(self, rt: RoomType) -> Set[str]:
        return {k for k, v in self._map.items() if v == rt}

    def all_keys(self) -> Set[str]:
        return set(self._map.keys())

    def lab_keys(self) -> Set[str]:
        return self.rooms_of_type(RoomType.LABORATORY)

    def lecture_keys(self) -> Set[str]:
        return {k for k, v in self._map.items() if v in (RoomType.LECTURE, RoomType.UNKNOWN)}
