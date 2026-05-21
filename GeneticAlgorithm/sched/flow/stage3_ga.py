"""
STAGE 3: Run GA on remaining pending subjects.

Uses RESOLVED as hard constraints -- GA outputs cannot conflict with any
subject in resolved.

Imports:
    from sched.flow.state import PipelineState
    from sched.ga.deap_setup import run_ga_optimization
    from sched.conflict.detector import find_all_conflicts
"""

from typing import List, Tuple
from sched.flow.state import PipelineState
from sched.ga.deap_setup import run_ga_optimization
from sched.conflict.detector import find_all_conflicts
from sched.models.subject import Subject


# TODO: function `prepare_pending_for_ga(state: PipelineState) -> List[Subject]`
#       Clears schedule/room of NEEDS_RESCHEDULE subjects (treat as blank).
#       Leaves NEEDS_GENERATION as-is (already blank).
#       Returns list ready for GA.

# TODO: function `validate_ga_output(ga_output: List[Subject],
#                                    resolved: List[Subject]) -> Tuple[List, List]`
#       Returns (clean, conflicted):
#         clean = subjects with no internal conflicts AND no conflicts vs resolved
#         conflicted = the rest
#       CRITICAL: must include EVERY input subject in one of the two lists.
#       Assert |ga_output| == |clean| + |conflicted| to prevent silent drops.

# TODO: function `run_stage3(state: PipelineState,
#                            original_input: List[Subject]) -> PipelineState`
#       1. prepare_pending_for_ga
#       2. run_ga_optimization with state.resolved as hard constraints
#       3. validate_ga_output
#       4. Move clean to resolved (tag: Generated or Rescheduled based on origin)
#       5. Move conflicted back to pending
#       6. Increment iteration_count
#       7. Assert census invariant
#       8. Return state
