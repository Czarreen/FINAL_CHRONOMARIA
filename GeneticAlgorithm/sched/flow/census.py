"""
Subject census invariant enforcement.

The 359->345 silent drop bug was preventable with these assertions.
Run at every stage transition.
"""

from collections import Counter
from typing import List, Set

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


def assert_entity_invariant(
    original_subjects: List[Subject],
    entities,
    manual_review,
    stage_name: str,
) -> None:
    """
    Pool-pipeline census: all original subject IDs must appear exactly once
    across entities + manual_review.
    """
    expected_ids: Set[int] = {s.subject_id for s in original_subjects}
    all_ids = [sid for e in (list(entities) + list(manual_review)) for sid in e.subject_ids]
    id_counts = Counter(all_ids)
    actual_ids = set(id_counts.keys())
    missing_ids = expected_ids - actual_ids
    extra_ids = actual_ids - expected_ids
    duplicate_ids = {cid for cid, cnt in id_counts.items() if cnt > 1}
    ok = (
        len(all_ids) == len(original_subjects)
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
