"""
PRE-FLIGHT stage.

Pipeline contract:
  - MERGED all-scheduled -> merged_groups (tag: Original)
  - MERGED any-empty     -> pending
  - SATURDAY-only TFS    -> saturday_pile
  - all others           -> pending
"""

import re
import uuid
from typing import List, Dict, Set, Optional

from sched.models.subject import Subject, SubjectType, SubjectState, SubjectTag
from sched.models.merge_group import MergeGroup
from sched.flow.state import PipelineState
from sched.flow.census import assert_invariant
from sched.conflict.merge_detector import detect_room_based_merges


_GENERAL_RE = re.compile(
    r'^(G[- ]|CFE|PATH\s*FIT|NSTP|ADV\s*ORAL(\s*COM)?|FOR\s*LANG)',
    re.IGNORECASE,
)


def is_saturday_schedule(sched_str: Optional[str]) -> bool:
    """
    Returns True if the schedule string is a Saturday-only day override.
    Handles: "1:00-3:00 Sat", "1:00-3:00 S", "1:00-3:00 Saturday" (any case/whitespace).
    """
    if not sched_str:
        return False
    try:
        from sched.models.schedule import ParsedSchedule, DayPattern, Day
        parsed = ParsedSchedule.parse(sched_str.strip(), DayPattern.TFS)
        return (
            parsed.has_override
            and bool(parsed.blocks)
            and all(blk.day == Day.SAT for blk in parsed.blocks)
        )
    except Exception:
        return False


def classify_subject_type(subject: Subject) -> SubjectType:
    """
    Classify subject as GENERAL, MERGED, or REGULAR.
    is_general flag (from DB/Node) takes priority over regex.
    """
    if subject.is_general is True:
        return SubjectType.GENERAL
    if subject.is_general is False:
        if subject.merged_with:
            return SubjectType.MERGED
        return SubjectType.REGULAR
    # is_general is None — apply regex heuristic
    if _GENERAL_RE.match(subject.course_no or ''):
        return SubjectType.GENERAL
    if subject.merged_with:
        return SubjectType.MERGED
    return SubjectType.REGULAR


def classify_subject_state(subject: Subject) -> SubjectState:
    """EMPTY if both slots absent; SCHEDULED otherwise."""
    if subject.mth_schedule is None and subject.tfs_schedule is None:
        return SubjectState.EMPTY
    return SubjectState.SCHEDULED


def _make_section_key(dept: str, section: str) -> str:
    return f"{dept.strip().upper()}|{section.strip().upper()}"


def _tokenize_merged_with(raw: str) -> List[str]:
    """
    Split a messy merged_with string into individual reference tokens.
    Handles comma/semicolon/slash separators and space-separated dept+section pairs.
    """
    parts: List[str] = []
    for segment in re.split(r'[,;/]', raw):
        segment = segment.strip()
        if not segment:
            continue
        # findall extracts dept+section combos (e.g. "CS 1B"), pure alpha, or pure digits
        sub_tokens = re.findall(
            r'[A-Za-z]+\s*\d+[A-Za-z]*|[A-Za-z]+|[0-9]+', segment
        )
        i = 0
        while i < len(sub_tokens):
            tok = sub_tokens[i]
            # Join bare dept token with following alnum section token: "IT" + "2B" -> "IT 2B"
            if (i + 1 < len(sub_tokens)
                    and re.match(r'^[A-Za-z]+$', tok)
                    and re.match(r'^\d+[A-Za-z]*$', sub_tokens[i + 1])):
                parts.append(f"{tok} {sub_tokens[i + 1]}")
                i += 2
            else:
                parts.append(tok)
                i += 1
    return parts


def detect_merge_groups(subjects: List[Subject]) -> List[MergeGroup]:
    """
    Group subjects that reference each other via the merged_with column.
    Uses Union-Find to cluster related subjects into MergeGroup objects.
    """
    n = len(subjects)
    if n == 0:
        return []

    by_subject_id: Dict[int, int] = {}
    by_code: Dict[str, int] = {}
    by_section_key: Dict[str, int] = {}

    for i, s in enumerate(subjects):
        by_subject_id[s.subject_id] = i
        if s.code:
            by_code[s.code.strip()] = i
        key = _make_section_key(s.department_id, s.section)
        by_section_key[key] = i

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    def _resolve_token(token: str) -> Optional[int]:
        token = token.strip()
        if not token:
            return None
        if token.isdigit():
            sid = int(token)
            if sid in by_subject_id:
                return by_subject_id[sid]
            if token in by_code:
                return by_code[token]
            return None
        if token in by_code:
            return by_code[token]
        m = re.match(r'^([A-Za-z]+)\s*([0-9]+[A-Za-z]*|[A-Za-z]+[0-9]*)$', token)
        if m:
            key = f"{m.group(1).upper()}|{m.group(2).upper()}"
            if key in by_section_key:
                return by_section_key[key]
        return None

    for i, s in enumerate(subjects):
        if not s.merged_with:
            continue
        for tok in _tokenize_merged_with(s.merged_with):
            j = _resolve_token(tok)
            if j is not None and j != i:
                union(i, j)

    groups: Dict[int, List[int]] = {}
    for i in range(n):
        root = find(i)
        if root not in groups:
            groups[root] = []
        groups[root].append(i)

    merge_groups: List[MergeGroup] = []
    for members_idx in groups.values():
        if not any(subjects[i].merged_with for i in members_idx):
            continue
        if len(members_idx) < 2:
            continue
        mg = MergeGroup(
            group_id=str(uuid.uuid4()),
            members=[subjects[i].model_dump() for i in members_idx],
            is_pre_existing=True,
        )
        merge_groups.append(mg)

    return merge_groups


def run_preflight(subjects: List[Subject]) -> PipelineState:
    """
    Tag all subjects, detect merge groups, assign to pipeline buckets.
    Verifies census invariant before returning.

    Merge detection runs in two passes:
      1. merged_with column (explicit human annotation)
      2. Room-time evidence + confidence scoring (new, handles subjects
         not captured by the merged_with column)
    """
    if not subjects:
        return PipelineState(original_input_ids=[])

    for s in subjects:
        s.subject_type = classify_subject_type(s)
        s.subject_state = classify_subject_state(s)

    # Pass 1: merged_with-based detection (existing logic)
    merge_groups = detect_merge_groups(subjects)
    merged_ids: Set[int] = {
        m['subject_id'] for mg in merge_groups for m in mg.members
    }

    # Pass 2: room-time evidence detection on subjects not already grouped
    room_result = detect_room_based_merges(subjects, exclude_ids=merged_ids)

    new_confirmed_ids: Set[int] = {
        m['subject_id']
        for mg in room_result.confirmed_merges
        for m in mg.members
    }
    new_likely_ids: Set[int] = {
        m['subject_id']
        for mg in room_result.likely_merges
        for m in mg.members
    }
    new_partial_ids: Set[int] = {s.subject_id for s in room_result.partial_data}

    # All subjects handled by either detector are skipped in the main routing loop
    skip_ids = merged_ids | new_confirmed_ids | new_likely_ids | new_partial_ids

    subject_by_id: Dict[int, Subject] = {s.subject_id: s for s in subjects}

    resolved: List[Subject] = []
    manual_review: List[Subject] = []
    pending: List[Subject] = []
    saturday_pile: List[Subject] = []

    for s in subjects:
        if s.subject_id in skip_ids:
            continue
        if is_saturday_schedule(s.tfs_schedule):
            saturday_pile.append(s)
        else:
            pending.append(s)

    final_merged_groups: List[MergeGroup] = []

    # Route pass-1 merge groups
    for mg in merge_groups:
        if mg.all_scheduled():
            for m in mg.members:
                s = subject_by_id.get(m['subject_id'])
                if s:
                    s.tag = SubjectTag.ORIGINAL
            final_merged_groups.append(mg)
        else:
            for m in mg.members:
                s = subject_by_id.get(m['subject_id'])
                if s:
                    pending.append(s)

    # Route pass-2 confirmed merges -> merged_groups
    for mg in room_result.confirmed_merges:
        for m in mg.members:
            s = subject_by_id.get(m['subject_id'])
            if s:
                s.tag = SubjectTag.ORIGINAL
        final_merged_groups.append(mg)

    # Route pass-2 likely merges -> manual_review
    for mg in room_result.likely_merges:
        for m in mg.members:
            s = subject_by_id.get(m['subject_id'])
            if s:
                s.tag = SubjectTag.MANUAL_REVIEW
                manual_review.append(s)

    # Route pass-2 partial_data -> manual_review
    for s in room_result.partial_data:
        s.tag = SubjectTag.MANUAL_REVIEW
        manual_review.append(s)

    state = PipelineState(
        locked=[],
        merged_groups=final_merged_groups,
        resolved=resolved,
        pending=pending,
        unresolvable=[],
        manual_review=manual_review,
        saturday_pile=saturday_pile,
        original_input_ids=[s.subject_id for s in subjects],
    )

    assert_invariant(subjects, state, "preflight")
    return state
