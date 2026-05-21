"""
Pydantic models for course offering subjects.

A Subject is one row from the course offering master list. It corresponds
to one course-section pairing (e.g., "Eng Math 2 / CE / 1A").

Each subject can have an MTh schedule, a TFS schedule, or both. Schedule
strings may include day-pattern overrides (e.g., "1:00-3:00 M" means
Monday only, not the default MTh).

Imports:
    from pydantic import BaseModel, Field, field_validator
    from typing import Optional
    from enum import Enum
"""

from pydantic import BaseModel
from typing import Optional
from enum import Enum


class SubjectType(str, Enum):
    """How the subject is categorized for scheduling purposes."""
    GENERAL = "general"   # External faculty -- LOCKED, never modified
    MERGED = "merged"     # Part of a merge group -- moved as a unit
    REGULAR = "regular"   # Standard subject -- GA may freely schedule


class SubjectState(str, Enum):
    """Whether the subject has scheduling data filled in."""
    SCHEDULED = "scheduled"  # Has at least one (schedule, room) pair
    EMPTY = "empty"          # Both MTh and TFS slots are null


class SubjectTag(str, Enum):
    """Visual tag applied to the output for the frontend."""
    GENERAL = "General"
    ORIGINAL = "Original"
    GENERATED = "Generated"
    RESCHEDULED = "Rescheduled"
    UNRESOLVABLE = "Unresolvable"
    MANUAL_REVIEW = "Manual Review"


class Subject(BaseModel):
    """
    One row from the course offering master list.

    Mirrors the columns from the CSV import:
    Curr ID, CODE, COURSE NO., DEPT, SECTION, DESCRIPTIVE TITLE,
    Units, Lec(hrs), Lab(hrs), MTh SCHEDULE, MTh Room,
    TFS SCHEDULE, TFS Room, MERGED
    """
    # Core identity
    curr_id: int
    code: Optional[str] = None        # may be null (e.g., NSTP placeholders)
    course_no: str
    department_id: str                 # e.g., "AR", "CE", "IT", "CS", "LIS"
    section: str                       # e.g., "1A", "2B"
    descriptive_title: str

    # Hours
    units: float
    lec_hrs: float
    lab_hrs: float

    # MTh slot
    mth_schedule: Optional[str] = None   # raw string from CSV, may have overrides
    mth_room: Optional[str] = None       # may be compound: "E301/E401"

    # TFS slot
    tfs_schedule: Optional[str] = None
    tfs_room: Optional[str] = None

    # Merge info
    merged_with: Optional[str] = None   # raw value from MERGED column, freeform

    # Computed at PRE-FLIGHT (not in CSV)
    subject_type: Optional[SubjectType] = None
    subject_state: Optional[SubjectState] = None
    tag: Optional[SubjectTag] = None

    # TODO: validator to normalize empty strings to None
    # TODO: validator to detect general subjects (G*, CFE*, PATH FIT, NSTP, etc.)
    #       or to read from a passed-in is_general flag -- confirm with team
    # TODO: validator to detect SCHEDULED vs EMPTY state
    # TODO: helper method `is_general() -> bool`
    # TODO: helper method `is_empty() -> bool`
    # TODO: helper method `has_mth_slot() -> bool`
    # TODO: helper method `has_tfs_slot() -> bool`
