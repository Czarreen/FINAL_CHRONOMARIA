"""
Pipeline state object -- the single source of truth as subjects flow
through PRE-FLIGHT -> STAGE 1 -> STAGE 2/3 loop -> OUTPUT.

Invariant: at all times, every input subject is in exactly one bucket.
No subject may exist in two buckets. No subject may vanish.

Imports:
    from pydantic import BaseModel
    from typing import List, Dict
    from sched.models.subject import Subject
    from sched.models.merge_group import MergeGroup
"""

from pydantic import BaseModel
from typing import List, Set
from sched.models.subject import Subject
from sched.models.merge_group import MergeGroup


class PipelineState(BaseModel):
    """
    Holds all buckets. Mutates as subjects move between stages.

    BUCKETS:
      locked          : LOCKED -- general subjects, never modified
      merged_groups   : grouped subjects awaiting Stage 1 or already fixed
      resolved        : conflict-free, finalized -- growing baseline
      pending         : awaiting GA work (NEEDS_RESCHEDULE or NEEDS_GENERATION)
      unresolvable    : GA could not schedule within max iterations
      manual_review   : GENERAL+EMPTY edge cases -- flagged for humans
    """
    locked: List[Subject] = []
    merged_groups: List[MergeGroup] = []
    resolved: List[Subject] = []
    pending: List[Subject] = []
    unresolvable: List[Subject] = []
    manual_review: List[Subject] = []

    # Metadata
    original_input_ids: List[int] = []   # set at construction, never mutated
    iteration_count: int = 0
    max_iterations: int = 50

    # TODO: method `total_count() -> int`
    #       sum of len of all buckets, including merged_groups flattened
    # TODO: method `all_subject_ids() -> Set[int]`
    #       union of IDs across all buckets
    # TODO: method `has_pending() -> bool`
    # TODO: method `converged() -> bool`
    #       True if pending is empty and no movement happened last iteration
    # TODO: method `max_iterations_reached() -> bool`
    # TODO: method `move_to_resolved(subject: Subject) -> None`
    #       Helper that removes from current bucket and adds to resolved.
    #       Asserts the subject was in exactly one bucket before move.
