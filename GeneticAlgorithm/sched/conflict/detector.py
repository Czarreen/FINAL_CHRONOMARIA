"""
THE canonical conflict detector.

A conflict between two subjects requires:
    time overlap (interval math)
  AND
    (same section OR room overlap OR same faculty)

This is the ONLY conflict check used by:
  - Pre-flight tagging
  - Stage 1 merged-group checks
  - Stage 2 triage
  - Stage 3 GA fitness function (hard rejection)
  - Stage 3 post-GA validation

Must produce IDENTICAL results to:
  Backend/node-api/src/lib/scheduleConflictChecker.js

Both implementations are tested against:
  Backend/shared/conflict_test_cases.json
"""

from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum

from sched.models.subject import Subject
from sched.conflict.room_sets import rooms_conflict


class ConflictReason(str, Enum):
    """Why two subjects conflict. May have multiple reasons simultaneously."""
    TIME_OVERLAP = "time_overlap"
    SAME_SECTION = "same_section"
    ROOM_OVERLAP = "room_overlap"
    SAME_FACULTY = "same_faculty"


@dataclass
class ConflictReport:
    """Records a single detected conflict between two subjects."""
    subject_a_id: int
    subject_b_id: int
    reasons: List[ConflictReason]
    slot: str              # "MTH" | "TFS"
    details: dict = field(default_factory=dict)


def _same_section(a: Subject, b: Subject) -> bool:
    return (
        a.department_id == b.department_id
        and a.section == b.section
    )


def _check_slot(
    a: Subject,
    b: Subject,
    a_sched: Optional[str],
    a_room: Optional[str],
    b_sched: Optional[str],
    b_room: Optional[str],
    slot_label: str,
) -> Optional[ConflictReport]:
    if not a_sched or not b_sched:
        return None

    from sched.models.schedule import ParsedSchedule, DayPattern
    pattern = DayPattern.MTH if slot_label == "MTH" else DayPattern.TFS
    try:
        parsed_a = ParsedSchedule.parse(a_sched, pattern)
        parsed_b = ParsedSchedule.parse(b_sched, pattern)
    except Exception:
        return None

    if not parsed_a.conflicts_with(parsed_b):
        return None

    # Find the first overlapping block pair for the details dict
    overlap_a = overlap_b = None
    for blk_a in parsed_a.blocks:
        for blk_b in parsed_b.blocks:
            if blk_a.overlaps(blk_b):
                overlap_a, overlap_b = blk_a, blk_b
                break
        if overlap_a:
            break

    reasons: List[ConflictReason] = [ConflictReason.TIME_OVERLAP]

    if _same_section(a, b):
        reasons.append(ConflictReason.SAME_SECTION)

    if rooms_conflict(a_room, b_room):
        reasons.append(ConflictReason.ROOM_OVERLAP)

    a_faculty = getattr(a, 'faculty_id', None)
    b_faculty = getattr(b, 'faculty_id', None)
    if a_faculty and b_faculty and a_faculty == b_faculty:
        reasons.append(ConflictReason.SAME_FACULTY)

    # Time overlap alone is not a conflict — section/room/faculty must also match.
    if len(reasons) == 1:
        return None

    return ConflictReport(
        subject_a_id=a.curr_id,
        subject_b_id=b.curr_id,
        reasons=reasons,
        slot=slot_label,
        details={
            "a_schedule": a_sched,
            "b_schedule": b_sched,
            "a_room": a_room,
            "b_room": b_room,
            "a_start": overlap_a.start_minutes if overlap_a else None,
            "a_end": overlap_a.end_minutes if overlap_a else None,
            "b_start": overlap_b.start_minutes if overlap_b else None,
            "b_end": overlap_b.end_minutes if overlap_b else None,
        },
    )


def conflicts(a: Subject, b: Subject) -> Optional[ConflictReport]:
    """
    The canonical predicate. Returns None if no conflict, else a ConflictReport.

    Checks MTH slot pair first, then TFS slot pair.
    """
    mth = _check_slot(a, b, a.mth_schedule, a.mth_room, b.mth_schedule, b.mth_room, "MTH")
    if mth:
        return mth
    return _check_slot(a, b, a.tfs_schedule, a.tfs_room, b.tfs_schedule, b.tfs_room, "TFS")


def find_all_conflicts(subjects: List[Subject]) -> List[ConflictReport]:
    """O(n²) pairwise check. Returns all ConflictReports found."""
    reports: List[ConflictReport] = []
    for i in range(len(subjects)):
        for j in range(i + 1, len(subjects)):
            r = conflicts(subjects[i], subjects[j])
            if r:
                reports.append(r)
    return reports


def has_any_conflicts(subjects: List[Subject]) -> bool:
    """Short-circuit — returns True as soon as any conflict is found."""
    for i in range(len(subjects)):
        for j in range(i + 1, len(subjects)):
            if conflicts(subjects[i], subjects[j]):
                return True
    return False
