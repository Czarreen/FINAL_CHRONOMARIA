"""
Spec-compliant conflict detector.

Conflict rule:
  Two subjects conflict iff they share a time overlap on the same day,
  occupy a shared room, AND have different descriptive_titles.

Same title + shared room + time overlap = ImplicitMergeWarning (not a conflict).
Self-comparison uses (code, department_id, section) — NOT curr_id.

This is the ONLY conflict check used by:
  - Stage 1 merged-group checks
  - Stage 2 triage
  - Stage 3 GA fitness function (hard rejection)
  - Post-GA validation

Must produce IDENTICAL results to:
  Backend/node-api/src/lib/scheduleConflictChecker.js

Both implementations are tested against:
  Backend/shared/conflict_test_cases.json
"""

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple

from sched.models.schedule import Day, DayPattern, ParsedSchedule, TimeBlock
from sched.conflict.room_sets import expand_room_string as room_key_set
from sched.models.merge_group import MergeGroup
from sched.models.subject import Subject


# ── Private parse helper ──────────────────────────────────────────────────────

def _parse_schedule_string(
    raw: str,
    column: str,
) -> Tuple[List[TimeBlock], List[str]]:
    """
    Wrap ParsedSchedule.parse() to return (blocks, warnings).
    column: "MTh" | "TFS" (or "MTH").
    """
    pattern = DayPattern.MTH if column in ("MTh", "MTH") else DayPattern.TFS
    try:
        parsed = ParsedSchedule.parse(raw, pattern)
        return parsed.blocks, []
    except Exception as exc:
        return [], [f"parse_error_{column}: {exc}"]


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class SlotOccupancy:
    """One physical (day × time × rooms) slot a subject occupies."""
    day: Day
    start_minutes: int
    end_minutes: int
    room_keys: Set[str]
    source_column: str  # "MTh" or "TFS"


class ConflictAxis(str, Enum):
    SAME_ROOM = "same_room"
    DIFFERENT_TITLE = "different_title"


@dataclass
class SlotConflict:
    day: Day
    overlap_start: int
    overlap_end: int
    shared_rooms: Set[str]
    a_source_column: str
    b_source_column: str
    axes: List[ConflictAxis]


@dataclass
class ConflictReport:
    subject_a_code: str
    subject_a_department: str
    subject_a_section: str
    subject_b_code: str
    subject_b_department: str
    subject_b_section: str
    slot_conflicts: List[SlotConflict]


@dataclass
class ImplicitMergeWarning:
    subject_a_code: str
    subject_a_department: str
    subject_a_section: str
    subject_b_code: str
    subject_b_department: str
    subject_b_section: str
    shared_title: str
    day: Day
    overlap_start: int
    overlap_end: int
    shared_rooms: Set[str]
    reason: str


@dataclass
class DetectionResult:
    conflicts: List[ConflictReport] = field(default_factory=list)
    implicit_merges: List[ImplicitMergeWarning] = field(default_factory=list)


# ── Core functions ────────────────────────────────────────────────────────────

def enumerate_slots(
    subject: Subject,
) -> Tuple[List[SlotOccupancy], List[str]]:
    """
    Convert a subject's MTh and TFS columns into a flat list of SlotOccupancy.
    Returns (slots, warnings). Empty list means no schedulable data.
    """
    slots: List[SlotOccupancy] = []
    warnings: List[str] = []

    for column, schedule_str, room_str in (
        ("MTh", subject.mth_schedule, subject.mth_room),
        ("TFS", subject.tfs_schedule, subject.tfs_room),
    ):
        if not schedule_str and not room_str:
            continue

        if not schedule_str or not room_str:
            warnings.append(
                f"partial_data_{column}: "
                f"schedule={schedule_str!r}, room={room_str!r}"
            )
            continue

        blocks, parse_warnings = _parse_schedule_string(schedule_str, column)
        warnings.extend(parse_warnings)

        rkeys = room_key_set(room_str)
        if not rkeys:
            warnings.append(f"empty_room_set_{column}: {room_str!r}")
            continue

        for block in blocks:
            slots.append(SlotOccupancy(
                day=block.day,
                start_minutes=block.start_minutes,
                end_minutes=block.end_minutes,
                room_keys=rkeys,
                source_column=column,
            ))

    return slots, warnings


def time_overlaps(
    a_start: int,
    a_end: int,
    b_start: int,
    b_end: int,
) -> bool:
    """
    The single canonical overlap predicate.
    Back-to-back intervals (a_end == b_start) are NOT overlapping.
    """
    return a_start < b_end and b_start < a_end


def normalize_title(raw: Optional[str]) -> str:
    """
    Normalize descriptive_title for comparison.
    None/empty → "". Strip, lowercase, collapse internal whitespace.
    Preserves hyphens, parentheses, and punctuation.
    """
    if not raw:
        return ""
    s = raw.strip().lower()
    return re.sub(r'\s+', ' ', s)


def is_same_row(a: Subject, b: Subject) -> bool:
    """
    True iff a and b are the same row in the course offering master list.
    Row identity is (code, department_id, section). NOT curr_id.
    """
    return (
        a.code == b.code
        and a.department_id == b.department_id
        and a.section == b.section
    )


def check_conflict(
    a: Subject,
    b: Subject,
) -> Tuple[Optional[ConflictReport], List[ImplicitMergeWarning]]:
    """
    Pairwise conflict check.

    Returns (ConflictReport | None, [ImplicitMergeWarning]).
    Same-title pairs sharing room+time: (None, [warning]).
    Different-title pairs sharing room+time: (ConflictReport, []).
    """
    if is_same_row(a, b):
        return None, []

    a_slots, _ = enumerate_slots(a)
    b_slots, _ = enumerate_slots(b)

    return _check_with_precomputed_slots(a, a_slots, b, b_slots)


def _check_with_precomputed_slots(
    a: Subject,
    a_slots: List[SlotOccupancy],
    b: Subject,
    b_slots: List[SlotOccupancy],
) -> Tuple[Optional[ConflictReport], List[ImplicitMergeWarning]]:
    """Inner loop reused by all bulk detection functions."""
    if is_same_row(a, b):
        return None, []

    a_title = normalize_title(a.descriptive_title)
    b_title = normalize_title(b.descriptive_title)
    same_title = a_title != "" and a_title == b_title

    slot_conflicts: List[SlotConflict] = []
    implicit_merges: List[ImplicitMergeWarning] = []

    for a_slot in a_slots:
        for b_slot in b_slots:
            if a_slot.day != b_slot.day:
                continue
            if not time_overlaps(
                a_slot.start_minutes, a_slot.end_minutes,
                b_slot.start_minutes, b_slot.end_minutes,
            ):
                continue

            shared_rooms = a_slot.room_keys & b_slot.room_keys
            if not shared_rooms:
                continue

            overlap_start = max(a_slot.start_minutes, b_slot.start_minutes)
            overlap_end = min(a_slot.end_minutes, b_slot.end_minutes)

            if same_title:
                implicit_merges.append(ImplicitMergeWarning(
                    subject_a_code=a.code or "",
                    subject_a_department=a.department_id,
                    subject_a_section=a.section,
                    subject_b_code=b.code or "",
                    subject_b_department=b.department_id,
                    subject_b_section=b.section,
                    shared_title=a_title,
                    day=a_slot.day,
                    overlap_start=overlap_start,
                    overlap_end=overlap_end,
                    shared_rooms=shared_rooms,
                    reason="same_title_same_room_overlap_not_in_merge_group",
                ))
                continue

            slot_conflicts.append(SlotConflict(
                day=a_slot.day,
                overlap_start=overlap_start,
                overlap_end=overlap_end,
                shared_rooms=shared_rooms,
                a_source_column=a_slot.source_column,
                b_source_column=b_slot.source_column,
                axes=[ConflictAxis.SAME_ROOM, ConflictAxis.DIFFERENT_TITLE],
            ))

    if not slot_conflicts:
        return None, implicit_merges

    report = ConflictReport(
        subject_a_code=a.code or "",
        subject_a_department=a.department_id,
        subject_a_section=a.section,
        subject_b_code=b.code or "",
        subject_b_department=b.department_id,
        subject_b_section=b.section,
        slot_conflicts=slot_conflicts,
    )
    return report, implicit_merges


def find_all_conflicts(
    subjects: List[Subject],
) -> DetectionResult:
    """
    O(n²) pairwise check. Pre-enumerates slots once per subject.
    Returns DetectionResult with sorted conflicts and implicit_merges.
    """
    enumerated = [(s, enumerate_slots(s)[0]) for s in subjects]

    all_conflicts: List[ConflictReport] = []
    all_implicit: List[ImplicitMergeWarning] = []

    for i in range(len(enumerated)):
        a, a_slots = enumerated[i]
        for j in range(i + 1, len(enumerated)):
            b, b_slots = enumerated[j]
            report, im_warnings = _check_with_precomputed_slots(
                a, a_slots, b, b_slots,
            )
            if report:
                all_conflicts.append(report)
            all_implicit.extend(im_warnings)

    return DetectionResult(
        conflicts=_sort_conflicts(all_conflicts),
        implicit_merges=_sort_implicit_merges(all_implicit),
    )


def find_conflicts_merge_aware(
    subjects: List[Subject],
    merge_groups: List[MergeGroup],
) -> DetectionResult:
    """
    Find conflicts while treating merged groups as units.
    Members of the same merge group are skipped against each other.
    """
    row_to_group: Dict[Tuple[Optional[str], str, str], str] = {}
    for group in merge_groups:
        for member in group.members:
            key = (member.get("code"), member["department_id"], member["section"])
            row_to_group[key] = group.group_id

    def group_of(s: Subject) -> Optional[str]:
        return row_to_group.get((s.code, s.department_id, s.section))

    enumerated = [(s, enumerate_slots(s)[0]) for s in subjects]

    all_conflicts: List[ConflictReport] = []
    all_implicit: List[ImplicitMergeWarning] = []

    for i in range(len(enumerated)):
        a, a_slots = enumerated[i]
        a_group = group_of(a)
        for j in range(i + 1, len(enumerated)):
            b, b_slots = enumerated[j]
            b_group = group_of(b)

            if a_group is not None and a_group == b_group:
                continue

            report, im_warnings = _check_with_precomputed_slots(
                a, a_slots, b, b_slots,
            )
            if report:
                all_conflicts.append(report)
            all_implicit.extend(im_warnings)

    return DetectionResult(
        conflicts=_sort_conflicts(all_conflicts),
        implicit_merges=_sort_implicit_merges(all_implicit),
    )


def find_conflicts_against_baseline(
    candidates: List[Subject],
    baseline: List[Subject],
) -> DetectionResult:
    """
    Check each candidate against every baseline subject only.
    Does NOT check candidate-vs-candidate conflicts.
    Used in Stage 2 triage and Stage 3 GA validation.
    """
    candidate_enum = [(s, enumerate_slots(s)[0]) for s in candidates]
    baseline_enum = [(s, enumerate_slots(s)[0]) for s in baseline]

    all_conflicts: List[ConflictReport] = []
    all_implicit: List[ImplicitMergeWarning] = []

    for c, c_slots in candidate_enum:
        for b, b_slots in baseline_enum:
            report, im_warnings = _check_with_precomputed_slots(
                c, c_slots, b, b_slots,
            )
            if report:
                all_conflicts.append(report)
            all_implicit.extend(im_warnings)

    return DetectionResult(
        conflicts=_sort_conflicts(all_conflicts),
        implicit_merges=_sort_implicit_merges(all_implicit),
    )


def has_any_conflict(
    candidate: Subject,
    others: List[Subject],
) -> bool:
    """
    Short-circuit conflict check for GA fitness.
    Returns True at the first REAL conflict found.
    ImplicitMergeWarnings are NOT counted as conflicts.
    """
    c_slots, _ = enumerate_slots(candidate)
    for other in others:
        o_slots, _ = enumerate_slots(other)
        report, _ = _check_with_precomputed_slots(candidate, c_slots, other, o_slots)
        if report is not None:
            return True
    return False


# ── Sorting helpers ───────────────────────────────────────────────────────────

def _sort_conflicts(reports: List[ConflictReport]) -> List[ConflictReport]:
    return sorted(
        reports,
        key=lambda r: (
            r.subject_a_code, r.subject_a_department, r.subject_a_section,
            r.subject_b_code, r.subject_b_department, r.subject_b_section,
        ),
    )


def _sort_implicit_merges(
    warnings: List[ImplicitMergeWarning],
) -> List[ImplicitMergeWarning]:
    return sorted(
        warnings,
        key=lambda w: (
            w.subject_a_code, w.subject_a_department, w.subject_a_section,
            w.subject_b_code, w.subject_b_department, w.subject_b_section,
        ),
    )
