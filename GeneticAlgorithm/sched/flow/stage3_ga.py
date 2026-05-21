"""
STAGE 3: Run GA on remaining pending subjects.

Uses RESOLVED (+ LOCKED) as hard constraints -- GA outputs cannot conflict
with any subject in resolved or locked.
"""

from typing import List, Tuple
from sched.flow.state import PipelineState
from sched.flow.census import assert_invariant
from sched.ga.deap_setup import run_ga_optimization
from sched.conflict.detector import has_any_conflicts, find_all_conflicts
from sched.models.subject import Subject, SubjectTag


def prepare_pending_for_ga(state: PipelineState) -> List[Subject]:
    """
    Clear schedule/room from subjects that were previously scheduled.
    Subjects with no schedule are already ready for generation.
    Returns a copy-list ready for the GA.
    """
    prepared: List[Subject] = []
    for s in state.pending:
        if s.mth_schedule is not None or s.tfs_schedule is not None:
            # NEEDS_RESCHEDULE: clear old assignments so GA starts fresh
            sc = s.model_copy(deep=True)
            sc.mth_schedule = None
            sc.mth_room     = None
            sc.tfs_schedule = None
            sc.tfs_room     = None
            prepared.append(sc)
        else:
            prepared.append(s.model_copy(deep=True))
    return prepared


def validate_ga_output(
    ga_output: List[Subject],
    resolved: List[Subject],
) -> Tuple[List[Subject], List[Subject]]:
    """
    Split GA output into clean (no conflicts) and conflicted.
    CRITICAL: |clean| + |conflicted| == |ga_output| — no silent drops.
    """
    baseline = list(resolved)
    clean:     List[Subject] = []
    conflicted: List[Subject] = []

    for s in ga_output:
        if has_any_conflicts([s] + baseline):
            conflicted.append(s)
        else:
            clean.append(s)
            baseline.append(s)

    assert len(clean) + len(conflicted) == len(ga_output), (
        f"Silent drop in validate_ga_output: "
        f"{len(clean)} + {len(conflicted)} != {len(ga_output)}"
    )
    return clean, conflicted


def run_stage3(
    state: PipelineState,
    original_input: List[Subject],
    rooms=None,
    constraints=None,
) -> PipelineState:
    """
    1. Prepare pending for GA
    2. Run GA optimization
    3. Validate output
    4. Route clean → resolved, conflicted → back to pending
    5. Increment iteration_count
    6. Assert census invariant
    """
    rooms       = rooms or []
    constraints = constraints or {}

    pending_for_ga = prepare_pending_for_ga(state)
    baseline = list(state.resolved) + list(state.locked)

    ga_output = run_ga_optimization(
        pending=pending_for_ga,
        resolved=baseline,
        rooms=rooms,
        constraints=constraints,
    )

    clean, conflicted = validate_ga_output(ga_output, baseline)

    # Map GA output back to original pending subjects by curr_id
    pending_by_id = {s.curr_id: s for s in state.pending}

    for s in clean:
        original = pending_by_id.get(s.curr_id, s)
        original.mth_schedule = s.mth_schedule
        original.mth_room     = s.mth_room
        original.tfs_schedule = s.tfs_schedule
        original.tfs_room     = s.tfs_room
        original.tag = SubjectTag.GENERATED
        state.resolved.append(original)

    new_pending: List[Subject] = []
    conflicted_ids = {s.curr_id for s in conflicted}
    for s in state.pending:
        if s.curr_id in conflicted_ids:
            new_pending.append(s)

    state.pending = new_pending
    state.iteration_count += 1

    assert_invariant(original_input, state, f"stage3-iter{state.iteration_count}")
    return state
