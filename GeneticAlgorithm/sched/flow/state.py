"""
Pipeline state object -- the single source of truth as subjects flow
through PRE-FLIGHT -> STAGE 1 -> STAGE 2/3 loop -> OUTPUT.

Invariant: at all times, every input subject is in exactly one bucket.
No subject may exist in two buckets. No subject may vanish.
"""

from pydantic import BaseModel
from typing import List, Set
from sched.models.subject import Subject
from sched.models.merge_group import MergeGroup


class PipelineState(BaseModel):
    """
    Holds all buckets. Mutates as subjects move between stages.

    BUCKETS:
      locked          : general subjects — never modified
      merged_groups   : grouped subjects awaiting Stage 1
      resolved        : conflict-free, finalized — growing baseline
      pending         : awaiting GA work
      unresolvable    : GA could not schedule within max iterations
      manual_review   : GENERAL+EMPTY edge cases — flagged for humans
    """
    locked: List[Subject] = []
    merged_groups: List[MergeGroup] = []
    resolved: List[Subject] = []
    pending: List[Subject] = []
    unresolvable: List[Subject] = []
    manual_review: List[Subject] = []

    original_input_ids: List[int] = []
    iteration_count: int = 0
    max_iterations: int = 50

    model_config = {"arbitrary_types_allowed": True}

    def total_count(self) -> int:
        """Sum of all bucket sizes (merged_groups flattened to member count)."""
        return (
            len(self.locked)
            + sum(len(g.members) for g in self.merged_groups)
            + len(self.resolved)
            + len(self.pending)
            + len(self.unresolvable)
            + len(self.manual_review)
        )

    def all_subject_ids(self) -> Set[int]:
        """Union of curr_id across all buckets."""
        ids: Set[int] = set()
        for s in self.locked:
            ids.add(s.curr_id)
        for g in self.merged_groups:
            for m in g.members:
                ids.add(m['curr_id'])
        for s in self.resolved:
            ids.add(s.curr_id)
        for s in self.pending:
            ids.add(s.curr_id)
        for s in self.unresolvable:
            ids.add(s.curr_id)
        for s in self.manual_review:
            ids.add(s.curr_id)
        return ids

    def all_subject_ids_with_dupes(self) -> List[int]:
        """Return all curr_ids including duplicates — used by census to detect dupes."""
        ids: List[int] = []
        for s in self.locked:
            ids.append(s.curr_id)
        for g in self.merged_groups:
            for m in g.members:
                ids.append(m['curr_id'])
        for s in self.resolved:
            ids.append(s.curr_id)
        for s in self.pending:
            ids.append(s.curr_id)
        for s in self.unresolvable:
            ids.append(s.curr_id)
        for s in self.manual_review:
            ids.append(s.curr_id)
        return ids

    def has_pending(self) -> bool:
        return bool(self.pending)

    def converged(self) -> bool:
        """True if there are no more pending subjects to schedule."""
        return not self.pending

    def max_iterations_reached(self) -> bool:
        return self.iteration_count >= self.max_iterations

    def move_to_resolved(self, subject: Subject) -> None:
        """
        Remove subject from its current bucket and append to resolved.
        Raises ValueError if the subject is not found in exactly one bucket.
        """
        removed = False

        for bucket_name in ('locked', 'pending', 'unresolvable', 'manual_review'):
            bucket: List[Subject] = getattr(self, bucket_name)
            for i, s in enumerate(bucket):
                if s.curr_id == subject.curr_id:
                    if removed:
                        raise ValueError(
                            f"Subject {subject.curr_id} found in multiple buckets"
                        )
                    bucket.pop(i)
                    removed = True
                    break

        if not removed:
            raise ValueError(
                f"Subject {subject.curr_id} not found in any mutable bucket"
            )

        self.resolved.append(subject)
