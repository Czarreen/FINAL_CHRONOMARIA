"""
Pydantic models for course offering subjects.

A Subject is one row from the course offering master list. It corresponds
to one course-section pairing (e.g., "Eng Math 2 / CE / 1A").

Each subject can have an MTh schedule, a TFS schedule, or both. Schedule
strings may include day-pattern overrides (e.g., "1:00-3:00 M" means
Monday only, not the default MTh).
"""

from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
from enum import Enum


class SubjectType(str, Enum):
    """How the subject is categorized for scheduling purposes."""
    GENERAL = "general"
    MERGED = "merged"
    REGULAR = "regular"


class SubjectState(str, Enum):
    """Whether the subject has scheduling data filled in."""
    SCHEDULED = "scheduled"
    EMPTY = "empty"


class SubjectTag(str, Enum):
    """Visual tag applied to the output for the frontend."""
    ORIGINAL = "Original"
    GENERATED = "Generated"
    RESCHEDULED = "Rescheduled"
    UNRESOLVABLE = "Unresolvable"
    MANUAL_REVIEW = "Manual Review"
    SATURDAY = "Saturday"


def _empty_to_none(v: Optional[str]) -> Optional[str]:
    if isinstance(v, str) and v.strip() == '':
        return None
    return v


class Subject(BaseModel):
    """
    One row from the course offering master list.

    Mirrors the columns from the CSV import:
    Curr ID, CODE, COURSE NO., DEPT, SECTION, DESCRIPTIVE TITLE,
    Units, Lec(hrs), Lab(hrs), MTh SCHEDULE, MTh Room,
    TFS SCHEDULE, TFS Room, MERGED
    """
    subject_id: int      # DB primary key — pipeline unique identifier
    curr_id: int         # curriculum_id display column — NOT unique, NOT used as PK
    code: Optional[str] = None
    course_no: str
    department_id: str
    section: str
    descriptive_title: str

    units: float
    lec_hrs: float
    lab_hrs: float

    mth_schedule: Optional[str] = None
    mth_room: Optional[str] = None

    tfs_schedule: Optional[str] = None
    tfs_room: Optional[str] = None

    merged_with: Optional[str] = None

    # Flag passed from DB/Node side; takes priority over course_no pattern matching
    is_general: Optional[bool] = None

    # Computed at PRE-FLIGHT
    subject_type: Optional[SubjectType] = None
    subject_state: Optional[SubjectState] = None
    tag: Optional[SubjectTag] = None

    @field_validator('code', 'mth_schedule', 'mth_room', 'tfs_schedule', 'tfs_room',
                     'merged_with', mode='before')
    @classmethod
    def normalize_empty_str(cls, v: Optional[str]) -> Optional[str]:
        return _empty_to_none(v)

    def is_general_subject(self) -> bool:
        """True if this subject is classified as a general education subject."""
        return self.subject_type == SubjectType.GENERAL

    def is_empty(self) -> bool:
        """True if both MTH and TFS schedule slots are absent."""
        return self.mth_schedule is None and self.tfs_schedule is None

    def has_mth_slot(self) -> bool:
        return self.mth_schedule is not None

    def has_tfs_slot(self) -> bool:
        return self.tfs_schedule is not None
