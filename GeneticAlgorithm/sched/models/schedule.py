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
"""

from pydantic import BaseModel, field_validator, model_validator
from typing import List, Optional
from enum import Enum

from sched.conflict.intervals import overlaps as _overlaps, parse_time_range, strip_day_overrides


class Day(str, Enum):
    MON = "M"
    TUE = "T"
    WED = "W"
    THU = "Th"
    FRI = "F"
    SAT = "Sat"


class DayPattern(str, Enum):
    """The default day pattern based on which column the schedule is in."""
    MTH = "MTh"
    TFS = "TFS"


_PATTERN_DAYS = {
    DayPattern.MTH: [Day.MON, Day.THU],
    DayPattern.TFS: [Day.TUE, Day.FRI],
}

_DAY_ALIAS: dict = {
    "M": Day.MON,
    "MON": Day.MON,
    "MONDAY": Day.MON,
    "T": Day.TUE,
    "TUE": Day.TUE,
    "TUESDAY": Day.TUE,
    "W": Day.WED,
    "WED": Day.WED,
    "WEDNESDAY": Day.WED,
    "TH": Day.THU,
    "THU": Day.THU,
    "THURSDAY": Day.THU,
    "F": Day.FRI,
    "FRI": Day.FRI,
    "FRIDAY": Day.FRI,
    "SAT": Day.SAT,
    "SATURDAY": Day.SAT,
    "S": Day.SAT,
}


def _resolve_day(token: str) -> Optional[Day]:
    return _DAY_ALIAS.get(token.upper().replace(".", ""))


class TimeBlock(BaseModel):
    """One contiguous time range on one specific day."""
    day: Day
    start_minutes: int
    end_minutes: int

    @field_validator('end_minutes')
    @classmethod
    def end_after_start(cls, v: int, info) -> int:
        start = info.data.get('start_minutes', 0)
        if v <= start:
            raise ValueError(f"end_minutes ({v}) must be > start_minutes ({start})")
        return v

    @field_validator('start_minutes')
    @classmethod
    def start_in_range(cls, v: int) -> int:
        if not (0 <= v < 1440):
            raise ValueError(f"start_minutes ({v}) out of range [0, 1440)")
        return v

    @field_validator('end_minutes')
    @classmethod
    def end_in_range(cls, v: int) -> int:
        if not (0 < v <= 1440):
            raise ValueError(f"end_minutes ({v}) out of range (0, 1440]")
        return v

    def overlaps(self, other: 'TimeBlock') -> bool:
        return (
            self.day == other.day
            and _overlaps(self.start_minutes, self.end_minutes,
                          other.start_minutes, other.end_minutes)
        )


class ParsedSchedule(BaseModel):
    """A schedule string fully decomposed into TimeBlocks."""
    raw: str
    default_pattern: DayPattern
    blocks: List[TimeBlock]
    has_override: bool

    @classmethod
    def parse(cls, raw: str, default_pattern: DayPattern) -> 'ParsedSchedule':
        """
        Parse a raw schedule string into a ParsedSchedule.

        Handles all known edge cases including day overrides, split sessions,
        and lab/lec splits across days.
        """
        raw = raw.strip()
        time_portion, day_overrides = strip_day_overrides(raw)
        has_override = bool(day_overrides)

        blocks: List[TimeBlock] = []

        # Parse each comma-separated time range
        time_segments = [t.strip() for t in time_portion.split(',') if t.strip()]

        if day_overrides:
            # Each override maps to the single shared time range
            for override in day_overrides:
                if ':' in override:
                    day_token, _ = override.split(':', 1)
                else:
                    day_token = override
                day = _resolve_day(day_token)
                if day is None:
                    continue
                # Use first time range for all overrides
                if time_segments:
                    try:
                        start, end = parse_time_range(time_segments[0])
                        blocks.append(TimeBlock(day=day, start_minutes=start, end_minutes=end))
                    except ValueError:
                        pass
        else:
            # No overrides: expand to all days in the default pattern
            default_days = _PATTERN_DAYS[default_pattern]
            for time_seg in time_segments:
                try:
                    start, end = parse_time_range(time_seg)
                except ValueError:
                    continue
                for day in default_days:
                    blocks.append(TimeBlock(day=day, start_minutes=start, end_minutes=end))

        return cls(
            raw=raw,
            default_pattern=default_pattern,
            blocks=blocks,
            has_override=has_override,
        )

    def conflicts_with(self, other: 'ParsedSchedule') -> bool:
        """Return True if any block in self overlaps any block in other."""
        for a in self.blocks:
            for b in other.blocks:
                if a.overlaps(b):
                    return True
        return False
