"""
Room models.

Rooms can be compound (e.g., "E301/E401" means a lab uses both rooms
simultaneously). The detector must treat these as occupying ALL listed
rooms during the scheduled time.
"""

from pydantic import BaseModel
from typing import Set, Optional

from sched.conflict.room_sets import expand_room_string


class Room(BaseModel):
    """A single physical room."""
    room_id: str
    room_name: Optional[str] = None
    room_type: Optional[str] = None
    capacity: Optional[int] = None
    room_status: Optional[str] = None


class RoomAssignment(BaseModel):
    """
    A room assignment for one schedule slot. May reference multiple rooms
    (compound assignment like "E301/E401").
    """
    raw: str
    room_ids: Set[str]

    @classmethod
    def parse(cls, raw: str) -> 'RoomAssignment':
        """
        Parse a room string into a RoomAssignment.

        "E301"      -> room_ids={"E301"}
        "E301/E401" -> room_ids={"E301", "E401"}
        ""          -> room_ids=set()
        """
        return cls(raw=raw or '', room_ids=expand_room_string(raw))

    def conflicts_with(self, other: 'RoomAssignment') -> bool:
        return bool(self.room_ids & other.room_ids)
