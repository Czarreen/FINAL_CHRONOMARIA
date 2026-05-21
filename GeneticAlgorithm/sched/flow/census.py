"""
Subject census invariant enforcement.

The 359->345 silent drop bug was preventable with these assertions.
Run at every stage transition.

Imports:
    from sched.flow.state import PipelineState
    from typing import List
    from sched.models.subject import Subject
"""

from typing import List, Set
from sched.flow.state import PipelineState
from sched.models.subject import Subject


class CensusViolationError(Exception):
    """Raised when subject count or identity invariants are violated."""
    # TODO: fields: stage_name, expected_ids, actual_ids,
    #               missing_ids, duplicate_ids


# TODO: function `assert_invariant(original_input: List[Subject],
#                                  state: PipelineState,
#                                  stage_name: str) -> None`
#       Checks:
#         1. state.total_count() == len(original_input)
#         2. state.all_subject_ids() == {s.curr_id for s in original_input}
#         3. No subject appears in two buckets simultaneously
#       Raises CensusViolationError with detailed diagnostics on failure.

# TODO: function `census_summary(state: PipelineState) -> dict`
#       Returns a dict suitable for the output JSON's `census` field:
#         {
#           "input_count": N,
#           "output_count": M,
#           "by_bucket": {"locked": .., "resolved": .., ...},
#           "by_tag": {"General": .., "Original": .., ...}
#         }
