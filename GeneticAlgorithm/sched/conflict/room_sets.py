"""
Room ID set expansion for compound rooms.

"E301/E401" -> {"E301", "E401"}

Imports:
    from typing import Set, Optional
"""

from typing import Set, Optional


# TODO: function `expand_room_string(s: Optional[str]) -> Set[str]`
#       None or "" -> set()
#       "E301" -> {"E301"}
#       "E301/E401" -> {"E301", "E401"}
#       Strips whitespace, normalizes case if needed.

# TODO: function `rooms_conflict(a: Optional[str], b: Optional[str]) -> bool`
#       Returns True iff expand_room_string(a) & expand_room_string(b) is non-empty.
