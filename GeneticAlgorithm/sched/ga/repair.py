"""
Lamarckian repair operator.

After crossover/mutation, fix conflicts by nudging affected genes to
nearby free slots. Keeps the search efficient and feasible.

Imports:
    from sched.conflict.detector import find_all_conflicts
    from sched.models.subject import Subject
    from typing import List
"""

from typing import List, Optional, Tuple
from sched.conflict.detector import find_all_conflicts
from sched.models.subject import Subject
from sched.models.room import Room


# TODO: function `repair(individual: List[Subject],
#                        resolved: List[Subject],
#                        max_attempts: int = 10) -> List[Subject]`
#       1. Find all conflicts in individual (and vs resolved)
#       2. For each conflict:
#          a. Pick one of the two subjects (the non-merged one if possible)
#          b. Find nearest free (day, time, room) triple
#          c. Reassign
#       3. Repeat until no conflicts or max_attempts reached
#       4. Return repaired individual

# TODO: function `find_free_slot(subject: Subject,
#                                others: List[Subject],
#                                rooms: List[Room],
#                                timeslots: dict) -> Optional[Tuple]`
#       Returns first (day_pattern, start_minutes, room_id) with no conflict,
#       or None if exhausted.
