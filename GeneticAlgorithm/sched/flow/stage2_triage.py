"""
STAGE 2: Triage pending subjects.

Scheduled subjects that don't conflict with RESOLVED can be promoted
directly. Empty subjects stay in pending (no schedule to check).

Imports:
    from sched.flow.state import PipelineState
    from sched.conflict.detector import conflicts
"""

from sched.flow.state import PipelineState
from sched.conflict.detector import conflicts


# TODO: function `triage(state: PipelineState) -> PipelineState`
#       For each subject in pending:
#         - If EMPTY -> leave in pending
#         - If SCHEDULED:
#             - If conflicts with any subject in resolved -> leave in pending
#             - Else -> move to resolved (tag: Original)
#       Return mutated state.
