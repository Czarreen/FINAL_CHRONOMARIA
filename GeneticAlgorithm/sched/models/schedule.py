"""
Parsed schedule representations.

Schedule strings in the CSV are messy:
  - "1:00-2:30"                       -- simple, uses default day pattern
  - "1:00-3:00 M"                     -- override: Monday only
  - "1:30-4:30 F Lab, T Lec"          -- split lab/lec across days
  - "1:30-3:00 Sat"                   -- Saturday only
  - "7:30-10:30, 11:00-1:00"          -- split session same day
  - "4:30-6:00 T"                     -- Tuesday only

This module parses raw strings into structured time blocks.

Imports:
    from pydantic import BaseModel
    from typing import List, Optional
    from enum import Enum
"""

from pydantic import BaseModel
from typing import List, Optional
from enum import Enum


class Day(str, Enum):
    MON = "M"
    TUE = "T"
    WED = "W"
    THU = "Th"
    FRI = "F"
    SAT = "Sat"


class DayPattern(str, Enum):
    """The default day pattern based on which column the schedule is in."""
    MTH = "MTh"      # Monday + Thursday
    TFS = "TFS"      # Tuesday + Friday + Saturday


class TimeBlock(BaseModel):
    """One contiguous time range on one specific day."""
    day: Day
    start_minutes: int   # minutes since midnight, e.g., 13:00 = 780
    end_minutes: int

    # TODO: validator: end > start
    # TODO: validator: 0 <= start < 1440 and 0 < end <= 1440
    # TODO: method `overlaps(other: TimeBlock) -> bool`
    #       returns True iff same day AND start < other.end AND other.start < end


class ParsedSchedule(BaseModel):
    """A schedule string fully decomposed into TimeBlocks."""
    raw: str                          # original CSV string, preserved for debugging
    default_pattern: DayPattern       # MTH if from mth_schedule column, else TFS
    blocks: List[TimeBlock]           # all time blocks across all days
    has_override: bool                # True if raw contained day codes like " M", " Sat"

    # TODO: classmethod `parse(raw: str, default_pattern: DayPattern) -> ParsedSchedule`
    #       handles all the edge cases above
    # TODO: method `conflicts_with(other: ParsedSchedule) -> bool`
    #       True if any block overlaps any block of other
