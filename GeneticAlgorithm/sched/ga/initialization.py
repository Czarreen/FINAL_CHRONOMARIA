"""
Warm-start heuristic initialization.

Instead of random initial population, use a greedy schedule that respects
locked constraints and merged-group requirements. Better starting point
means faster convergence and fewer wasted generations.

Imports:
    from sched.models.subject import Subject
    from typing import List
"""

from typing import List
from sched.models.subject import Subject
from sched.models.room import Room


# TODO: function `greedy_schedule(pending: List[Subject],
#                                 resolved: List[Subject],
#                                 rooms: List[Room],
#                                 timeslots: dict) -> List[Subject]`
#       For each pending subject (sorted by constraint difficulty):
#         - Find first free (day, time, room) that doesn't conflict
#         - Assign
#       Returns one valid initial individual.

# TODO: function `seeded_population(pending: List[Subject],
#                                   resolved: List[Subject],
#                                   rooms: List[Room],
#                                   timeslots: dict,
#                                   pop_size: int) -> List`
#       Mix: 10% greedy_schedule, 90% perturbations of it.
#       Gives the GA a good starting point but preserves diversity.
