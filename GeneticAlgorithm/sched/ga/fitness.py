"""
Fitness function with HARD constraint rejection.

The fix for the previous bug. Solutions with any hard conflict get
-inf fitness and never survive selection.

Imports:
    from sched.conflict.detector import find_all_conflicts, ConflictReason
    from sched.models.subject import Subject
    from typing import List, Tuple
"""

from typing import List, Tuple
from sched.conflict.detector import find_all_conflicts, ConflictReason
from sched.models.subject import Subject


# Soft objective weights (tunable)
WEIGHT_ROOM_BALANCE = 1.0
WEIGHT_TIME_DISTRIBUTION = 1.0
WEIGHT_FACULTY_GAPS = 1.0   # if faculty info available

# TODO: function `count_hard_conflicts(individual: List[Subject],
#                                      resolved: List[Subject]) -> int`
#       Counts conflicts within individual + conflicts vs resolved.

# TODO: function `evaluate(individual_chromosome,
#                          pending_template: List[Subject],
#                          resolved: List[Subject]) -> Tuple[float]`
#       1. Decode chromosome into List[Subject]
#       2. hard = count_hard_conflicts(...)
#       3. If hard > 0: return (float('-inf'),)
#       4. Compute soft score (room balance, time spread, etc.)
#       5. Return (soft_score,)

# TODO: function `soft_score(individual: List[Subject]) -> float`
#       Weighted sum of soft objectives. Higher is better.
