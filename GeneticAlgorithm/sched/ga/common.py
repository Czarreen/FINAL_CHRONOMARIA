"""
Shared constants, types, and helper functions for the GA modules.

Gene format: (pattern_idx, start_min, day1_room_idx, day2_room_idx)
  pattern_idx   : 0 = MTH (Mon/Thu), 1 = TF (Tue/Fri)
  start_min     : start time in minutes from midnight
  day1_room_idx : index into rooms list for day 1
  day2_room_idx : index into rooms list for day 2 (same as day1 when R-H4)

Schedule bounds: 450 (7:30 AM) to 1200 (8:00 PM)
Duration: round((lec_hrs + lab_hrs) / 2 * 60), min 30 min
"""

import re
import random
import functools
from typing import List, Tuple, Dict

from sched.models.subject import Subject
from sched.models.room import Room

# Chromosome gene type
Gene = Tuple[int, int, int, int]

SCHED_PATTERNS: List[Tuple[str, List[str]]] = [
    ("MTH", ["MON", "THU"]),
    ("TF",  ["TUE", "FRI"]),
]
SCHED_START_MIN = 450    # 7:30 AM
SCHED_END_MAX   = 1200   # 8:00 PM
SCHED_SLOT_STEP = 30
GYM_MAX_OVERLAP = 3

_PATHFIT_RE = re.compile(r"path\s*fit", re.IGNORECASE)
_GYM_RE     = re.compile(r"gym",        re.IGNORECASE)


@functools.lru_cache(maxsize=256)
def _duration_cached(lec_hrs: float, lab_hrs: float) -> int:
    return max(30, round(((lec_hrs or 0.0) + (lab_hrs or 0.0)) / 2.0 * 60))


def subject_duration(s: Subject) -> int:
    """Per-day duration in minutes (total hours split over 2 pattern days)."""
    return _duration_cached(s.lec_hrs or 0.0, s.lab_hrs or 0.0)


@functools.lru_cache(maxsize=256)
def _valid_starts_cached(duration: int) -> Tuple[int, ...]:
    return tuple(range(SCHED_START_MIN, SCHED_END_MAX - duration + 1, SCHED_SLOT_STEP))


def valid_starts(duration: int) -> List[int]:
    return list(_valid_starts_cached(duration))


def section_key(s: Subject) -> str:
    """Composite dept|section key (keeps same-named sections in different depts separate)."""
    dept = str(s.department_id or "").strip().upper()
    sec  = str(s.section or "").strip().upper()
    return f"{dept}|{sec}"


def is_lab_room(r: Room) -> bool:
    return "LAB" in (r.room_type or "").upper()


def is_gym_room(r: Room) -> bool:
    return bool(_GYM_RE.search(r.room_name or ""))


def is_pathfit(s: Subject) -> bool:
    return bool(_PATHFIT_RE.search(s.course_no or ""))


def needs_lab(s: Subject) -> bool:
    return (s.lab_hrs or 0.0) > 0.0


def has_lec_and_lab(s: Subject) -> bool:
    return (s.lec_hrs or 0.0) > 0.0 and (s.lab_hrs or 0.0) > 0.0


def pick_rooms(s: Subject, rooms: List[Room], rng: random.Random) -> Tuple[int, int]:
    """
    Return (day1_room_idx, day2_room_idx).
    PATH FIT → GYM rooms only (same room both days).
    Non-PATH FIT with lec+lab → lec room on day1, lab room on day2 (S-S7).
    """
    if is_pathfit(s):
        gym_pool = [i for i, r in enumerate(rooms) if is_gym_room(r)]
        pool = gym_pool if gym_pool else list(range(len(rooms)))
        r = rng.choice(pool)
        return (r, r)

    lec_pool = [i for i, r in enumerate(rooms) if not is_lab_room(r) and not is_gym_room(r)]
    lab_pool = [i for i, r in enumerate(rooms) if is_lab_room(r) and not is_gym_room(r)]
    any_pool = [i for i in range(len(rooms)) if not is_gym_room(rooms[i])]
    if not any_pool:
        any_pool = list(range(len(rooms)))

    if has_lec_and_lab(s):
        r1 = rng.choice(lec_pool) if lec_pool else rng.choice(any_pool)
        r2 = rng.choice(lab_pool) if lab_pool else rng.choice(any_pool)
    elif needs_lab(s):
        r = rng.choice(lab_pool) if lab_pool else rng.choice(any_pool)
        r1 = r2 = r
    else:
        r = rng.choice(lec_pool) if lec_pool else rng.choice(any_pool)
        r1 = r2 = r
    return (r1, r2)


def format_time(minutes: int) -> str:
    h12 = (minutes // 60) % 12 or 12
    mm  = minutes % 60
    return f"{h12}:{mm:02d}"


def decode_chromosome(
    chromosome: List[Gene],
    subjects: List[Subject],
    rooms: List[Room],
) -> List[Subject]:
    """
    Decode a chromosome into Subject objects with mth_schedule/tfs_schedule/room fields set.
    Returns a list of deep-copied subjects with schedule fields filled in.
    """
    decoded: List[Subject] = []
    for i, (pat_idx, start, r1_idx, r2_idx) in enumerate(chromosome):
        s = subjects[i].model_copy(deep=True)
        duration = subject_duration(s)
        end      = start + duration
        pat_name, _ = SCHED_PATTERNS[pat_idx]
        same_room = (r1_idx == r2_idx)

        r1 = rooms[r1_idx] if 0 <= r1_idx < len(rooms) else None
        r2 = rooms[r2_idx] if 0 <= r2_idx < len(rooms) else None

        if same_room or (r1 and r2 and r1.room_id == r2.room_id):
            room_str = str(r1.room_id) if r1 else None
        else:
            ids = [str(r1.room_id) if r1 else "", str(r2.room_id) if r2 else ""]
            room_str = "/".join(x for x in ids if x) or None

        sched_txt = f"{format_time(start)}-{format_time(end)}"

        if pat_name == "MTH":
            s.mth_schedule = sched_txt
            s.mth_room     = room_str
            s.tfs_schedule = None
            s.tfs_room     = None
        else:
            s.tfs_schedule = sched_txt
            s.tfs_room     = room_str
            s.mth_schedule = None
            s.mth_room     = None

        decoded.append(s)
    return decoded
