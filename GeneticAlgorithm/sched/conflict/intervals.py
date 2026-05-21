"""
Time interval parsing and overlap math.

The single source of truth for parsing time strings and checking overlap.
Used by both ParsedSchedule.parse() and the conflict detector.

Convention: schedule strings use 12-hour format without AM/PM markers.
PM assumption in parse_time_range: if start_raw < 7:00 (420 min), treat
both endpoints as PM (add 12 hrs). If end would still be <= start after
the start adjustment, also shift end to PM. This fixes the bug where
"1:00-2:30" was parsed as 1:00 AM instead of 1:00 PM.

Schedule bounds: start >= 7:30 AM (450 min), end <= 8:00 PM (1200 min).
"""

import re
from typing import Tuple, List, Optional

SCHED_START_MIN = 7 * 60 + 30   # 450 — 7:30 AM
SCHED_END_MAX   = 20 * 60        # 1200 — 8:00 PM
PM_THRESHOLD    = 7 * 60         # 420 — raw hours < 7:00 treated as PM


def parse_time(s: str) -> int:
    """
    Parse a time token to minutes since midnight.

    When an explicit AM/PM suffix is present it is honoured (12-hour
    conversion applied). Without AM/PM the raw numeric value is returned
    with no adjustment — PM heuristic is handled in parse_time_range.

    "9:00"    -> 540   (raw)
    "13:30"   -> 810   (raw)
    "1:00"    -> 60    (raw, no PM adjustment)
    "1:00 PM" -> 780   (explicit PM suffix honoured)
    "9:00 AM" -> 540
    """
    s = s.strip()
    mer_m = re.search(r'\s*(AM|PM)\s*$', s, flags=re.IGNORECASE)
    meridiem = mer_m.group(1).upper() if mer_m else None
    s_clean = re.sub(r'\s*(AM|PM)\s*$', '', s, flags=re.IGNORECASE).strip()
    m = re.fullmatch(r'(\d{1,2})(?::(\d{2}))?', s_clean)
    if not m:
        raise ValueError(f"Cannot parse time: {s!r}")
    hour = int(m.group(1))
    minute = int(m.group(2) or '0')
    if meridiem == 'AM':
        if hour == 12:
            hour = 0
    elif meridiem == 'PM':
        if hour != 12:
            hour += 12
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"Time out of range: {s!r}")
    return hour * 60 + minute


def parse_time_range(s: str) -> Tuple[int, int]:
    """
    Parse a time range string to (start_minutes, end_minutes).

    PM heuristic: if raw start < PM_THRESHOLD (7:00 AM), add 12 hrs.
    If end <= start after the start adjustment, also add 12 hrs to end.

    "1:00-2:30"       -> (780, 870)   1:00 PM – 2:30 PM
    "9:00-10:30"      -> (540, 630)   9:00 AM – 10:30 AM
    "11:00-1:00"      -> (660, 780)   raw end < start -> end gets PM shift
    "7:30-10:30"      -> (450, 630)
    """
    s = s.strip()
    m = re.search(
        r'(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–—]+\s*'
        r'(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)',
        s,
        flags=re.IGNORECASE,
    )
    if not m:
        raise ValueError(f"No time range found in: {s!r}")

    start = parse_time(m.group(1))
    end   = parse_time(m.group(2))

    if start < PM_THRESHOLD:
        start += 720
    if end <= start:
        end += 720

    if not (SCHED_START_MIN <= start and end <= SCHED_END_MAX and end > start):
        raise ValueError(
            f"Time range out of schedule bounds "
            f"[{SCHED_START_MIN}-{SCHED_END_MAX}]: "
            f"start={start} end={end} (from {s!r})"
        )

    return (start, end)


def overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """
    Return True iff [a_start, a_end) and [b_start, b_end) overlap.

    Back-to-back intervals (a_end == b_start) are NOT overlapping.
    """
    return a_start < b_end and b_start < a_end


_DAY_TOKENS = r'(?:Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Mon|Tue|Wed|Thu?|Fri|Sat|Sun|M|T|W|F|S)'
_TYPE_TOKENS = r'(?:Lab|Lec)'

# Matches "HH:MM-HH:MM" optionally followed by " DAY" and " TYPE"
_SEGMENT_WITH_TIME_RE = re.compile(
    r'^(\d{1,2}(?::\d{2})?'
    r'\s*[-–—]+\s*'
    r'\d{1,2}(?::\d{2})?)'
    r'(?:\s+(' + _DAY_TOKENS + r')(?:\s+(' + _TYPE_TOKENS + r'))?)?$',
    re.IGNORECASE,
)

# Matches segments that are ONLY "DAY" or "DAY TYPE" (no time range)
_DAY_ONLY_RE = re.compile(
    r'^(' + _DAY_TOKENS + r')(?:\s+(' + _TYPE_TOKENS + r'))?$',
    re.IGNORECASE,
)


def strip_day_overrides(s: str) -> Tuple[str, List[str]]:
    """
    Separate the time portion from day-override tokens.

    Returns (time_portion, [day_overrides]).

    "1:00-3:00"              -> ("1:00-3:00", [])
    "1:00-3:00 M"            -> ("1:00-3:00", ["M"])
    "1:30-4:30 F Lab, T Lec" -> ("1:30-4:30", ["F:Lab", "T:Lec"])
    "1:30-3:00 Sat"          -> ("1:30-3:00", ["Sat"])
    "7:30-10:30, 11:00-1:00" -> ("7:30-10:30, 11:00-1:00", [])
    "4:30-6:00 T"            -> ("4:30-6:00", ["T"])
    """
    s = s.strip()
    segments = [seg.strip() for seg in s.split(',')]
    time_parts: List[str] = []
    overrides: List[str] = []

    for seg in segments:
        tm = _SEGMENT_WITH_TIME_RE.match(seg)
        if tm:
            time_parts.append(tm.group(1).strip())
            if tm.group(2):
                day = tm.group(2).strip()
                typ = tm.group(3).strip() if tm.group(3) else ''
                overrides.append(f"{day}:{typ}" if typ else day)
        else:
            dm = _DAY_ONLY_RE.match(seg)
            if dm:
                day = dm.group(1).strip()
                typ = dm.group(2).strip() if dm.group(2) else ''
                overrides.append(f"{day}:{typ}" if typ else day)
            else:
                time_parts.append(seg)

    return (', '.join(time_parts), overrides)
