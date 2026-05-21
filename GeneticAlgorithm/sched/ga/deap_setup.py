"""
DEAP toolbox setup.

Chromosome representation: a list of (subject_idx, day_pattern, start_minutes,
room_id) tuples -- one per pending subject. LOCKED subjects in resolved are
hard constraints, not genes.

Imports:
    from deap import base, creator, tools, algorithms
    from typing import List
    from sched.models.subject import Subject
"""

from deap import base, creator, tools, algorithms
from typing import List
from sched.models.subject import Subject
from sched.models.room import Room


# TODO: setup creator.FitnessMax (or FitnessMulti for multi-objective)
# TODO: setup creator.Individual

# TODO: function `build_toolbox(pending: List[Subject],
#                               resolved: List[Subject],
#                               rooms: List[Room],
#                               timeslots: dict) -> base.Toolbox`
#       Registers:
#         - individual: chromosome factory
#         - population: List[Individual] factory
#         - evaluate: fitness function (see sched/ga/fitness.py)
#         - mate: crossover (see sched/ga/operators.py)
#         - mutate: mutation (see sched/ga/operators.py)
#         - select: tournament selection
#         - repair: Lamarckian repair (see sched/ga/repair.py)

# TODO: function `run_ga_optimization(pending: List[Subject],
#                                     resolved: List[Subject],
#                                     rooms: List[Room],
#                                     timeslots: dict,
#                                     generations: int = 100,
#                                     pop_size: int = 200) -> List[Subject]`
#       Main GA loop.
#       1. Build toolbox
#       2. Initialize population (warm-start from initialization.py)
#       3. For each generation:
#          a. Evaluate
#          b. Select parents
#          c. Crossover + mutation
#          d. Apply repair operator
#          e. Re-evaluate
#       4. Return best individual decoded back to List[Subject]
#       CRITICAL: output must contain ALL input pending subjects.
#       Assert this before returning.
