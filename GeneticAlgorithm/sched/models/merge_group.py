"""
A merge group: 2+ subjects that share the same time + room.

The MERGED column in the CSV identifies these, but the format is messy:
  - "CS 4", "CS1A", "CS2A"       -- section codes
  - "4754"                         -- course code/curr_id reference
  - "IT 2B LIS 2A"                 -- multiple section refs (space-separated)
  - '"IT 2B, CS 2A"'               -- multiple refs (comma-separated)
  - "LIS A", "LIS 1A"              -- variant section codes
  - "40", "10"                     -- numeric (probably typos? confirm)

The merge detector (existing, working -- do not rewrite) outputs MergeGroup
instances. This module just defines the data shape.

Imports:
    from pydantic import BaseModel
    from typing import List
    from sched.models.subject import Subject
"""

from pydantic import BaseModel
from typing import List, TYPE_CHECKING

if TYPE_CHECKING:
    from sched.models.subject import Subject


class MergeGroup(BaseModel):
    """A set of subjects that must share schedule + room."""
    group_id: str                    # unique identifier for the group
    members: List[dict]              # 2+ subjects (use dict for forward-ref compat)
    is_pre_existing: bool            # True if discovered from CSV merged_with
                                     # False if detected during scheduling

    # TODO: method `all_scheduled() -> bool`
    #       True iff every member.subject_state == SCHEDULED
    # TODO: method `any_empty() -> bool`
    # TODO: method `shared_schedule() -> ParsedSchedule | None`
    #       Returns the schedule all members share, or None if inconsistent
    # TODO: method `shared_room() -> RoomAssignment | None`
    # TODO: method `validate_still_merged() -> bool`
    #       Asserts all members have identical schedule + room
