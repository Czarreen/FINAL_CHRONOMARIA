"""
STAGE 2: Triage pending subjects.

Scheduled subjects that don't conflict with RESOLVED (or LOCKED) can be
promoted directly. Empty subjects stay in pending for Stage 3 (GA).
"""

from typing import List
from sched.flow.state import PipelineState
from sched.conflict.detector import check_conflict
from sched.models.subject import Subject, SubjectTag


def triage(state: PipelineState) -> PipelineState:
    """
    Promote conflict-free scheduled subjects from pending to resolved.
    EMPTY subjects stay in pending.
    """
    baseline: List[Subject] = list(state.resolved) + list(state.locked)
    still_pending: List[Subject] = []

    for s in state.pending:
        if s.mth_schedule is None and s.tfs_schedule is None:
            still_pending.append(s)
        else:
            has_conflict = any(check_conflict(s, other)[0] is not None for other in baseline)
            if has_conflict:
                still_pending.append(s)
            else:
                s.tag = SubjectTag.ORIGINAL
                state.resolved.append(s)
                baseline.append(s)

    state.pending = still_pending
    return state
