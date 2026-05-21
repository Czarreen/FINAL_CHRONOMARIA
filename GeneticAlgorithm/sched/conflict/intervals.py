"""
Time interval parsing and overlap math.

The single source of truth for parsing time strings and checking overlap.
Used by both ParsedSchedule.parse() and the conflict detector.

Imports:
    from typing import Tuple, Optional, List
    import re
"""

import re
from typing import Tuple, List, Optional


# TODO: function `parse_time(s: str) -> int`
#       "9:00" -> 540, "13:30" -> 810, "1:00" -> 60 (AM)
#       NOTE: schedule uses 12-hour-ish format without AM/PM markers.
#       Confirm convention: probably afternoon times are unambiguous from
#       context (1:00 in a "1:00-3:00" range likely means 1 PM since
#       schedules don't span midnight). Document the assumption clearly.

# TODO: function `parse_time_range(s: str) -> Tuple[int, int]`
#       "1:00-2:30" -> (60, 150) -- or with PM assumption: (780, 870)
#       returns (start_minutes, end_minutes)

# TODO: function `overlaps(a_start: int, a_end: int,
#                          b_start: int, b_end: int) -> bool`
#       returns a_start < b_end and b_start < a_end
#       This is THE one and only overlap check used everywhere.

# TODO: function `strip_day_overrides(s: str) -> Tuple[str, List[str]]`
#       Separates time portion from day codes.
#       "1:00-3:00 M" -> ("1:00-3:00", ["M"])
#       "1:30-4:30 F Lab, T Lec" -> ("1:30-4:30", ["F:Lab", "T:Lec"])
#       "7:30-10:30, 11:00-1:00" -> ("7:30-10:30, 11:00-1:00", [])
