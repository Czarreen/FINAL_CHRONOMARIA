"""
STAGE SAT: Resolve conflicts among Saturday-pile subjects.

Saturday subjects are segregated from the main MTH/TFS pipeline in
preflight. Their tfs_schedule has an explicit Saturday day override
(Sat, S, Saturday). Conflicts are checked only within this pile
(room + time on Saturday day), so regular MTH/TFS subjects are never
affected.

Resolution order:
  1. No conflicts -> tag SATURDAY, move all to resolved.
  2. Conflict found -> pick one subject to reschedule:
       a. Same room, different time on Saturday.
       b. Any available room, any time on Saturday.
     Tagged RESCHEDULED on success, UNRESOLVABLE on failure.
  Loop up to MAX_SAT_PASSES times or until no conflicts remain.

All subjects leave saturday_pile by the end of this stage — they end
up in resolved or unresolvable.
"""

from typing import List, Tuple, Optional

from sched.flow.state import PipelineState
from sched.models.subject import Subject, SubjectTag
from sched.models.room import Room
from sched.conflict.intervals import overlaps, parse_time_range
from sched.conflict.room_sets import rooms_conflict

SCHED_START      = 7 * 60 + 30   # 7:30 AM in minutes
SCHED_END        = 20 * 60        # 8:00 PM in minutes
SLOT_STEP        = 30             # 30-minute increments
MAX_SAT_PASSES   = 10
LUNCH_START_MIN  = 12 * 60        # 12:00 PM
LUNCH_END_MIN    = 13 * 60        #  1:00 PM


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _sat_time_range(sched_str: str) -> Optional[Tuple[int, int]]:
    """Return (start_min, end_min) for the Saturday time block, or None on parse failure."""
    try:
        return parse_time_range(sched_str)
    except ValueError:
        return None


def _sat_duration(sched_str: str) -> Optional[int]:
    """Return duration in minutes of the Saturday slot, or None on parse failure."""
    r = _sat_time_range(sched_str)
    if r is None:
        return None
    return r[1] - r[0]


def _same_section(a: Subject, b: Subject) -> bool:
    return (
        str(a.department_id).strip().upper() == str(b.department_id).strip().upper()
        and a.section.strip().upper() == b.section.strip().upper()
    )


def _sat_conflicts(a: Subject, b: Subject) -> bool:
    """
    True if a and b have overlapping Saturday times AND share a room or section.
    Both subjects must have a tfs_schedule to conflict.
    """
    if not a.tfs_schedule or not b.tfs_schedule:
        return False
    a_range = _sat_time_range(a.tfs_schedule)
    b_range = _sat_time_range(b.tfs_schedule)
    if a_range is None or b_range is None:
        return False
    if not overlaps(a_range[0], a_range[1], b_range[0], b_range[1]):
        return False
    return rooms_conflict(a.tfs_room, b.tfs_room) or _same_section(a, b)


def _candidate_starts(duration_min: int) -> List[int]:
    """Generate all valid start times (minute offsets) for a given duration."""
    starts: List[int] = []
    t = SCHED_START
    while t + duration_min <= SCHED_END:
        if t < LUNCH_END_MIN and t + duration_min > LUNCH_START_MIN:
            t = LUNCH_END_MIN
            continue
        starts.append(t)
        t += SLOT_STEP
    return starts


def _format_sat_schedule(start_min: int, end_min: int) -> str:
    """Format a time range into a schedule string with Sat day override."""
    s_h, s_m = divmod(start_min, 60)
    e_h, e_m = divmod(end_min, 60)
    return f"{s_h % 12 or 12}:{s_m:02d}-{e_h % 12 or 12}:{e_m:02d} Sat"


def _find_free_sat_slot(
    subject: Subject,
    others: List[Subject],
    rooms: List[Room],
    prefer_room_id: Optional[str],
) -> Tuple[Optional[str], Optional[str]]:
    """
    Find the first available (schedule_str, room_id) on Saturday for subject.

    Strategy:
      - Iterate candidate start times from SCHED_START upward in SLOT_STEP steps.
      - For each time, try prefer_room_id first, then all other rooms.
      - A slot is free if it does not overlap with any subject in `others`
        sharing the same room or same section.

    Returns (new_schedule_str, new_room_id), or (None, None) if none found.
    """
    if not subject.tfs_schedule:
        return None, None

    dur = _sat_duration(subject.tfs_schedule)
    if dur is None or dur <= 0:
        return None, None

    all_room_ids = [r.room_id for r in rooms]
    if prefer_room_id and prefer_room_id not in all_room_ids:
        all_room_ids.insert(0, prefer_room_id)

    # Prefer same room first
    if prefer_room_id:
        ordered_rooms = [prefer_room_id] + [rid for rid in all_room_ids if rid != prefer_room_id]
    else:
        ordered_rooms = all_room_ids

    for t in _candidate_starts(dur):
        new_end = t + dur
        for room_id in ordered_rooms:
            slot_free = True
            for other in others:
                if not other.tfs_schedule:
                    continue
                other_range = _sat_time_range(other.tfs_schedule)
                if other_range is None:
                    continue
                o_start, o_end = other_range
                if overlaps(t, new_end, o_start, o_end):
                    if rooms_conflict(room_id, other.tfs_room) or _same_section(subject, other):
                        slot_free = False
                        break
            if slot_free:
                return _format_sat_schedule(t, new_end), room_id

    return None, None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def resolve_saturday_pile(state: PipelineState, rooms: List[Room]) -> PipelineState:
    """
    Resolve all subjects in state.saturday_pile and drain the pile.

    Conflict-free subjects -> state.resolved (tag: SATURDAY).
    Rescheduled subjects   -> state.resolved (tag: RESCHEDULED).
    Truly stuck subjects   -> state.unresolvable (tag: UNRESOLVABLE).
    """
    if not state.saturday_pile:
        return state

    subjects = list(state.saturday_pile)

    for s in subjects:
        s.tag = SubjectTag.SATURDAY

    unresolvable_ids: set = set()

    for _pass in range(MAX_SAT_PASSES):
        # Collect conflicting pairs (skip subjects already marked unresolvable)
        active = [s for s in subjects if s.subject_id not in unresolvable_ids]
        conflict_pairs: List[Tuple[int, int]] = []
        for i in range(len(active)):
            for j in range(i + 1, len(active)):
                if _sat_conflicts(active[i], active[j]):
                    conflict_pairs.append((i, j))

        if not conflict_pairs:
            break

        # Count how many conflicts each subject index is involved in
        conflict_count: dict = {}
        for i, j in conflict_pairs:
            conflict_count[i] = conflict_count.get(i, 0) + 1
            conflict_count[j] = conflict_count.get(j, 0) + 1

        # Move the subject involved in the most conflicts (ties: higher index)
        to_move_idx = max(conflict_count, key=lambda k: (conflict_count[k], k))
        s_to_move = active[to_move_idx]

        others = [s for s in active if s.subject_id != s_to_move.subject_id]
        new_sched, new_room = _find_free_sat_slot(
            s_to_move, others, rooms, s_to_move.tfs_room
        )

        if new_sched is not None:
            s_to_move.tfs_schedule = new_sched
            s_to_move.tfs_room = new_room
            s_to_move.tag = SubjectTag.RESCHEDULED
        else:
            unresolvable_ids.add(s_to_move.subject_id)

    # Drain saturday_pile into locked / unresolvable
    for s in subjects:
        if s.subject_id in unresolvable_ids:
            s.tag = SubjectTag.UNRESOLVABLE
            state.unresolvable.append(s)
        else:
            state.locked.append(s)

    state.saturday_pile = []
    return state
