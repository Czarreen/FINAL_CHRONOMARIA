"""
Subject census invariant enforcement.

The 359->345 silent drop bug was preventable with these assertions.
Run at every stage transition.
"""

from typing import List, Set
from collections import Counter

from sched.flow.state import PipelineState
from sched.models.subject import Subject


class CensusViolationError(Exception):
    """Raised when subject count or identity invariants are violated."""

    def __init__(
        self,
        stage_name: str,
        expected_ids: Set[int],
        actual_ids: Set[int],
        missing_ids: Set[int],
        duplicate_ids: Set[int],
        extra_ids: Set[int],
    ):
        self.stage_name = stage_name
        self.expected_ids = expected_ids
        self.actual_ids = actual_ids
        self.missing_ids = missing_ids
        self.duplicate_ids = duplicate_ids
        self.extra_ids = extra_ids
        msg = (
            f"Census violation at '{stage_name}': "
            f"expected {len(expected_ids)}, got {len(actual_ids)} unique IDs. "
            f"Missing: {missing_ids}. "
            f"Duplicates: {duplicate_ids}. "
            f"Extra: {extra_ids}."
        )
        super().__init__(msg)


def assert_invariant(
    original_input: List[Subject],
    state: PipelineState,
    stage_name: str,
) -> None:
    """
    Assert that all original subjects are present exactly once across all buckets.

    Checks:
      1. state.total_count() == len(original_input)
      2. state.all_subject_ids() == {s.curr_id for s in original_input}
      3. No subject appears in two buckets simultaneously

    Raises CensusViolationError with full diagnostics on failure.
    """
    expected_ids: Set[int] = {s.curr_id for s in original_input}

    all_ids_with_dupes = state.all_subject_ids_with_dupes()
    id_counts = Counter(all_ids_with_dupes)

    actual_ids = set(id_counts.keys())
    missing_ids = expected_ids - actual_ids
    extra_ids = actual_ids - expected_ids
    duplicate_ids = {cid for cid, cnt in id_counts.items() if cnt > 1}

    ok = (
        len(all_ids_with_dupes) == len(original_input)
        and actual_ids == expected_ids
        and not duplicate_ids
    )

    if not ok:
        raise CensusViolationError(
            stage_name=stage_name,
            expected_ids=expected_ids,
            actual_ids=actual_ids,
            missing_ids=missing_ids,
            duplicate_ids=duplicate_ids,
            extra_ids=extra_ids,
        )


def census_summary(state: PipelineState) -> dict:
    """
    Return a dict for the output JSON's 'census' field.
    """
    from sched.models.subject import SubjectTag

    total = state.total_count()
    by_tag: dict = {}
    for s in state.locked + state.resolved + state.pending + state.unresolvable + state.manual_review:
        if s.tag:
            by_tag[s.tag.value] = by_tag.get(s.tag.value, 0) + 1

    return {
        "input_count": len(state.original_input_ids),
        "output_count": total,
        "by_bucket": {
            "locked": len(state.locked),
            "merged_groups": sum(len(g.members) for g in state.merged_groups),
            "resolved": len(state.resolved),
            "pending": len(state.pending),
            "unresolvable": len(state.unresolvable),
            "manual_review": len(state.manual_review),
        },
        "by_tag": by_tag,
    }
