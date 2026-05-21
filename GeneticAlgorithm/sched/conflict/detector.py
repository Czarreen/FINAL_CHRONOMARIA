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

Imports:
    from typing import List, Optional, Tuple
    from enum import Enum
    from sched.models.subject import Subject
    from sched.conflict.intervals import overlaps
    from sched.conflict.room_sets import rooms_conflict
"""

from typing import List, Optional
from enum import Enum
from sched.models.subject import Subject
from sched.conflict.intervals import overlaps
from sched.conflict.room_sets import rooms_conflict


class ConflictReason(str, Enum):
    """Why two subjects conflict. May have multiple reasons simultaneously."""
    TIME_OVERLAP = "time_overlap"        # always required for a conflict
    SAME_SECTION = "same_section"
    ROOM_OVERLAP = "room_overlap"
    SAME_FACULTY = "same_faculty"        # if faculty info available


class ConflictReport:
    """Records a single detected conflict between two subjects."""
    # TODO: fields: subject_a_id, subject_b_id, reasons: List[ConflictReason],
    #               slot ("MTh" | "TFS"), details: dict


# TODO: function `conflicts(a: Subject, b: Subject) -> Optional[ConflictReport]`
#       The canonical predicate. Returns None if no conflict, else a ConflictReport
#       listing all reasons.
#       Check BOTH the mth slot pair AND the tfs slot pair.
#       Check all three axes (section, room, faculty) when times overlap.

# TODO: function `find_all_conflicts(subjects: List[Subject]) -> List[ConflictReport]`
#       O(n^2) naive version for correctness. Use intervaltree later for speed.

# TODO: function `has_any_conflicts(subjects: List[Subject]) -> bool`
#       Short-circuit version for quick checks.
