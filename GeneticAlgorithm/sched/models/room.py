"""
Room models.

Rooms can be compound (e.g., "E301/E401" means a lab uses both rooms
simultaneously). The detector must treat these as occupying ALL listed
rooms during the scheduled time.

Imports:
    from pydantic import BaseModel
    from typing import Set, Optional, List
"""

from pydantic import BaseModel
from typing import Set, Optional


class Room(BaseModel):
    """A single physical room."""
    room_id: str           # e.g., "E301", "AP202", "Gym", "TC 1"
    capacity: Optional[int] = None
    # TODO: any other fields the existing Rooms table has -- confirm with Node side


class RoomAssignment(BaseModel):
    """
    A room assignment for one schedule slot. May reference multiple rooms
    (compound assignment like "E301/E401").
    """
    raw: str                  # original CSV string, preserved for debugging
    room_ids: Set[str]        # parsed set: {"E301", "E401"}

    # TODO: classmethod `parse(raw: str) -> RoomAssignment`
    #       splits on "/" and trims whitespace
    #       handles None/empty string -> empty set
    # TODO: method `conflicts_with(other: RoomAssignment) -> bool`
    #       True iff intersection of room_ids is non-empty
