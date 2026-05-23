"""
STAGE 1: Fix merged groups.

Merged groups must move as units (shared time + room). Fix conflicts
against LOCKED first, then against each other.
"""

from typing import List, Optional
from sched.flow.state import PipelineState
from sched.flow.census import assert_invariant
from sched.conflict.detector import check_conflict, find_all_conflicts
from sched.models.subject import Subject, SubjectTag
from sched.models.merge_group import MergeGroup


def _group_subjects(mg: MergeGroup) -> List[Subject]:
    """Convert MergeGroup member dicts back to Subject objects."""
    return [Subject(**m) for m in mg.members]


def _group_has_conflict(mg: MergeGroup, baseline: List[Subject]) -> bool:
    """Return True if any member of the merge group conflicts with any baseline subject."""
    members = _group_subjects(mg)
    for m in members:
        for b in baseline:
            if check_conflict(m, b)[0] is not None:
                return True
    return False


def _apply_slot_to_group(mg: MergeGroup, new_members: List[Subject]) -> MergeGroup:
    """Return a new MergeGroup whose members have been updated to the new_members' schedules."""
    return MergeGroup(
        group_id=mg.group_id,
        members=[m.model_dump() for m in new_members],
        is_pre_existing=mg.is_pre_existing,
    )


def fix_merged_vs_locked(state: PipelineState) -> PipelineState:
    """
    For each merged group that conflicts with locked subjects, try to reschedule.
    Groups that cannot be resolved go to unresolvable.
    """
    from sched.ga.repair import find_free_slot

    fixed: List[MergeGroup] = []
    for mg in state.merged_groups:
        if not _group_has_conflict(mg, state.locked):
            fixed.append(mg)
            continue

        members = _group_subjects(mg)
        representative = members[0]

        others_for_slot = state.locked + [m for m in members[1:]]
        new_gene = find_free_slot(
            representative,
            others=others_for_slot,
            rooms=[],
            chromosome_others=[],
        )

        if new_gene is not None:
            from sched.ga.common import SCHED_PATTERNS, subject_duration, format_time
            pat_idx, start, r1_idx, r2_idx = new_gene
            duration  = subject_duration(representative)
            end       = start + duration
            pat_name, _ = SCHED_PATTERNS[pat_idx]
            sched_txt = f"{format_time(start)}-{format_time(end)}"
            new_members = []
            for m in members:
                mc = m.model_copy(deep=True)
                if pat_name == "MTH":
                    mc.mth_schedule = sched_txt
                    mc.tfs_schedule = None
                else:
                    mc.tfs_schedule = sched_txt
                    mc.mth_schedule = None
                new_members.append(mc)
            fixed.append(_apply_slot_to_group(mg, new_members))
        else:
            for m in members:
                m.tag = SubjectTag.UNRESOLVABLE
                state.unresolvable.append(m)

    state.merged_groups = fixed
    return state


def fix_merged_vs_merged(state: PipelineState) -> PipelineState:
    """
    For each pair of merged groups in conflict, reschedule the smaller group.
    """
    from sched.ga.repair import find_free_slot
    from sched.ga.common import SCHED_PATTERNS, subject_duration, format_time

    stable = False
    while not stable:
        stable = True
        for i in range(len(state.merged_groups)):
            for j in range(i + 1, len(state.merged_groups)):
                mg_a = state.merged_groups[i]
                mg_b = state.merged_groups[j]
                a_members = _group_subjects(mg_a)
                b_members = _group_subjects(mg_b)
                all_a_vs_b = any(
                    conflicts(ma, mb) is not None
                    for ma in a_members
                    for mb in b_members
                )
                if not all_a_vs_b:
                    continue

                # Reschedule the smaller group
                stable = False
                to_fix_idx = i if len(mg_a.members) <= len(mg_b.members) else j
                to_keep_idx = j if to_fix_idx == i else i
                mg_fix  = state.merged_groups[to_fix_idx]
                mg_keep = state.merged_groups[to_keep_idx]

                fix_members = _group_subjects(mg_fix)
                keep_members = _group_subjects(mg_keep)
                rep = fix_members[0]

                new_gene = find_free_slot(
                    rep,
                    others=state.locked + keep_members,
                    rooms=[],
                    chromosome_others=[],
                )

                if new_gene is not None:
                    pat_idx, start, r1_idx, r2_idx = new_gene
                    duration  = subject_duration(rep)
                    end       = start + duration
                    pat_name, _ = SCHED_PATTERNS[pat_idx]
                    sched_txt = f"{format_time(start)}-{format_time(end)}"
                    new_members = []
                    for m in fix_members:
                        mc = m.model_copy(deep=True)
                        if pat_name == "MTH":
                            mc.mth_schedule = sched_txt
                            mc.tfs_schedule = None
                        else:
                            mc.tfs_schedule = sched_txt
                            mc.mth_schedule = None
                        new_members.append(mc)
                    state.merged_groups[to_fix_idx] = _apply_slot_to_group(mg_fix, new_members)
                else:
                    for m in fix_members:
                        m.tag = SubjectTag.UNRESOLVABLE
                        state.unresolvable.append(m)
                    state.merged_groups.pop(to_fix_idx)
                break
            if not stable:
                break

    return state


def run_stage1(
    state: PipelineState,
    original_input: List[Subject],
) -> PipelineState:
    """
    1. Fix merged groups vs locked
    2. Fix merged groups vs each other
    3. Flatten fixed merge groups into resolved
    4. Assert census invariant
    """
    state = fix_merged_vs_locked(state)
    state = fix_merged_vs_merged(state)

    # Flatten remaining merged groups into resolved
    for mg in state.merged_groups:
        for m in mg.members:
            s = Subject(**m)
            s.tag = SubjectTag.ORIGINAL
            state.resolved.append(s)

    state.merged_groups = []
    assert_invariant(original_input, state, "stage1")
    return state
