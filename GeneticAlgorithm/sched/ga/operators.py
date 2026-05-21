"""
Custom crossover and mutation operators.

Constraints these operators must respect:
  - Merged groups stay merged (treat as super-genes, swap together)
  - LOCKED subjects are not in the chromosome (immutable)
  - Resolved baseline is read-only (constraint, not gene)

Imports:
    from deap import tools
    import random
    from sched.models.subject import Subject
"""

from deap import tools
import random
from sched.models.subject import Subject


# TODO: function `crossover_two_point_grouped(ind1, ind2)`
#       Two-point crossover that respects merged-group boundaries.

# TODO: function `mutate_reschedule(individual, mutation_rate: float)`
#       For each gene with probability mutation_rate:
#         - Pick a new (day_pattern, start_minutes, room_id) tuple
#         - If gene is part of a merged group, apply same mutation to all members
