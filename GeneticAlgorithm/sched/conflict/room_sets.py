"""
Room ID set expansion for compound rooms.

"E301/E401" -> {"E301", "E401"}
"""

from typing import Set, Optional


def expand_room_string(s: Optional[str]) -> Set[str]:
    """
    Split a room string on "/" and return the set of room IDs.

    None or "" -> set()
    "E301"      -> {"E301"}
    "E301/E401" -> {"E301", "E401"}
    "1200/1195" -> {"1200", "1195"}
    """
    if not s:
        return set()
    return {part.strip() for part in s.split('/') if part.strip()}


def rooms_conflict(a: Optional[str], b: Optional[str]) -> bool:
    """Return True iff a and b share at least one room ID."""
    return bool(expand_room_string(a) & expand_room_string(b))
