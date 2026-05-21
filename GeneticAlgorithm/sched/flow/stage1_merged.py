"""
STAGE 1: Fix merged groups.

Merged groups must move as units (shared time + room). Fix conflicts
against LOCKED first, then against each other.

Imports:
    from sched.flow.state import PipelineState
    from sched.flow.census import assert_invariant
    from sched.conflict.detector import find_all_conflicts
"""

from typing import List
from sched.flow.state import PipelineState
from sched.flow.census import assert_invariant
from sched.conflict.detector import find_all_conflicts
from sched.models.subject import Subject


# TODO: function `fix_merged_vs_locked(state: PipelineState) -> PipelineState`
#       For each merged group conflicting with locked: reschedule as a unit.
#       Use the GA's group-rescheduling operator.

# TODO: function `fix_merged_vs_merged(state: PipelineState) -> PipelineState`
#       For each pair of merged groups in conflict: reschedule one as a unit.

# TODO: function `run_stage1(state: PipelineState,
#                            original_input: List[Subject]) -> PipelineState`
#       1. fix_merged_vs_locked
#       2. fix_merged_vs_merged
#       3. Promote all fixed merged groups into resolved (flatten members)
#       4. Assert census invariant
#       5. Return state
#       FAILURE MODE: if a merged group cannot be scheduled, move it to
#       unresolvable (NEVER silently drop).
