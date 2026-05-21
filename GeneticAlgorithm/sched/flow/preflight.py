"""
PRE-FLIGHT stage.

Takes raw parsed subjects, tags them, assigns to buckets.

Imports:
    from typing import List
    from sched.models.subject import Subject, SubjectType, SubjectState, SubjectTag
    from sched.models.merge_group import MergeGroup
    from sched.flow.state import PipelineState
"""

from typing import List
from sched.models.subject import Subject, SubjectType, SubjectState, SubjectTag
from sched.models.merge_group import MergeGroup
from sched.flow.state import PipelineState


# TODO: function `classify_subject_type(subject: Subject) -> SubjectType`
#       GENERAL if course_no matches general patterns (G*, CFE*, PATH FIT,
#       NSTP, AdvOral Com, For Lang, etc.) -- confirm exact rule with team.
#       MERGED if subject.merged_with is non-empty.
#       REGULAR otherwise.

# TODO: function `classify_subject_state(subject: Subject) -> SubjectState`
#       EMPTY if both mth and tfs slots are null.
#       SCHEDULED if at least one slot has a schedule + room.

# TODO: function `detect_merge_groups(subjects: List[Subject]) -> List[MergeGroup]`
#       Parses the messy merged_with column and groups related subjects.
#       NOTE: existing merge detector logic works -- port it here, do not redesign.

# TODO: function `run_preflight(subjects: List[Subject]) -> PipelineState`
#       1. Tag each subject with type and state
#       2. Detect merge groups
#       3. Place into buckets:
#          - GENERAL + SCHEDULED -> locked (tag: General)
#          - GENERAL + EMPTY -> manual_review (flag for humans)
#          - MERGED + all SCHEDULED -> merged_groups (tag: Original)
#          - MERGED + any EMPTY -> pending (will be scheduled together)
#          - REGULAR + SCHEDULED -> pending (NEEDS_RESCHEDULE -- check conflicts later)
#          - REGULAR + EMPTY -> pending (NEEDS_GENERATION)
#       4. Construct PipelineState
#       5. Assert census invariant
#       6. Return state
