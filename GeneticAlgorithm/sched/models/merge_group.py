"""
A merge group: 2+ subjects that share the same time + room.

The MERGED column in the CSV identifies these, but the format is messy:
  - "CS 4", "CS1A", "CS2A"       -- section codes
  - "4754"                         -- course code/curr_id reference
  - "IT 2B LIS 2A"                 -- multiple section refs (space-separated)
  - '"IT 2B, CS 2A"'               -- multiple refs (comma-separated)
  - "LIS A", "LIS 1A"              -- variant section codes
  - "40", "10"                     -- numeric (probably typos? confirm)
"""

from pydantic import BaseModel
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from sched.models.subject import Subject


class MergeGroup(BaseModel):
    """A set of subjects that must share schedule + room."""
    group_id: str
    members: List[dict]          # Subject dicts (forward-ref compat)
    is_pre_existing: bool

    def all_scheduled(self) -> bool:
        """True iff every member has at least one schedule slot filled."""
        return all(
            m.get('mth_schedule') or m.get('tfs_schedule')
            for m in self.members
        )

    def any_empty(self) -> bool:
        """True iff any member has no schedule slots at all."""
        return any(
            not m.get('mth_schedule') and not m.get('tfs_schedule')
            for m in self.members
        )

    def shared_schedule(self) -> Optional[str]:
        """
        Return the common schedule string if all members agree, else None.
        Checks mth_schedule first, then tfs_schedule.
        """
        for field in ('mth_schedule', 'tfs_schedule'):
            vals = {m.get(field) for m in self.members if m.get(field)}
            if len(vals) == 1:
                return vals.pop()
        return None

    def shared_room(self) -> Optional[str]:
        """Return the common room string if all members agree, else None."""
        for field in ('mth_room', 'tfs_room'):
            vals = {m.get(field) for m in self.members if m.get(field)}
            if len(vals) == 1:
                return vals.pop()
        return None

    def validate_still_merged(self) -> bool:
        """Return True if all members share identical schedule + room."""
        if len(self.members) < 2:
            return True
        first = self.members[0]
        return all(
            m.get('mth_schedule') == first.get('mth_schedule')
            and m.get('tfs_schedule') == first.get('tfs_schedule')
            and m.get('mth_room') == first.get('mth_room')
            and m.get('tfs_room') == first.get('tfs_room')
            for m in self.members[1:]
        )
