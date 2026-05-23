"""
PRE-FLIGHT stage (Steps 0 + 1 of the pool-based pipeline).

Builds a RoomTypeRegistry and converts all subjects into SchedulingEntity
objects. Merge groups move as atomic units. Saturday entities are flagged
for manual review and never enter the pool system.

Returns: (RoomTypeRegistry, List[SchedulingEntity])
"""

import re
import uuid
from typing import Dict, List, Optional, Set, Tuple

from sched.models.room import Room, RoomType
from sched.models.subject import Subject, SubjectType, SubjectState, SubjectTag
from sched.models.merge_group import MergeGroup
from sched.models.schedule import ParsedSchedule, DayPattern, TimeBlock
from sched.conflict.room_sets import expand_room_string
from sched.conflict.merge_detector import detect_room_based_merges
from sched.pool.room_types import RoomTypeRegistry
from sched.pool.pool import SchedulingEntity


_GENERAL_RE = re.compile(
    r'^(G[- ]|CFE|PATH\s*FIT|NSTP|ADV\s*ORAL(\s*COM)?|FOR\s*LANG)',
    re.IGNORECASE,
)


def is_saturday_schedule(sched_str: Optional[str]) -> bool:
    if not sched_str:
        return False
    try:
        parsed = ParsedSchedule.parse(sched_str.strip(), DayPattern.TFS)
        from sched.models.schedule import Day
        return (
            parsed.has_override
            and bool(parsed.blocks)
            and all(blk.day == Day.SAT for blk in parsed.blocks)
        )
    except Exception:
        return False


def classify_subject_type(subject: Subject) -> SubjectType:
    if subject.is_general is True:
        return SubjectType.GENERAL
    if subject.is_general is False:
        if subject.merged_with:
            return SubjectType.MERGED
        return SubjectType.REGULAR
    if _GENERAL_RE.match(subject.course_no or ''):
        return SubjectType.GENERAL
    if subject.merged_with:
        return SubjectType.MERGED
    return SubjectType.REGULAR


def classify_subject_state(subject: Subject) -> SubjectState:
    if subject.mth_schedule is None and subject.tfs_schedule is None:
        return SubjectState.EMPTY
    return SubjectState.SCHEDULED


def _make_section_key(dept: str, section: str) -> str:
    return f"{dept.strip().upper()}|{section.strip().upper()}"


def _tokenize_merged_with(raw: str) -> List[str]:
    parts: List[str] = []
    for segment in re.split(r'[,;/]', raw):
        segment = segment.strip()
        if not segment:
            continue
        sub_tokens = re.findall(
            r'[A-Za-z]+\s*\d+[A-Za-z]*|[A-Za-z]+|[0-9]+', segment
        )
        i = 0
        while i < len(sub_tokens):
            tok = sub_tokens[i]
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


def _parse_entity_schedule(
    subject: Subject,
) -> Tuple[List[TimeBlock], Set[str], Optional[str]]:
    """
    Parse a subject's primary schedule slot into (blocks, room_keys, day_pattern).
    MTh slot is preferred when both are present.
    Returns empty collections for EMPTY subjects.
    """
    slot_schedule: Optional[str] = None
    slot_room: Optional[str] = None
    day_pattern: Optional[str] = None

    if subject.mth_schedule:
        slot_schedule = subject.mth_schedule
        slot_room = subject.mth_room
        day_pattern = "MTh"
    elif subject.tfs_schedule:
        slot_schedule = subject.tfs_schedule
        slot_room = subject.tfs_room
        day_pattern = "TFS"

    if not slot_schedule:
        return [], set(), None

    try:
        dp = DayPattern.MTH if day_pattern == "MTh" else DayPattern.TFS
        parsed = ParsedSchedule.parse(slot_schedule.strip(), dp)
        blocks = parsed.blocks
    except Exception:
        blocks = []

    room_keys: Set[str] = set()
    if slot_room:
        room_keys = expand_room_string(slot_room)

    return blocks, room_keys, day_pattern


def _build_entity(
    entity_id: str,
    members: List[Subject],
    is_merge_group: bool,
    manual_review_reason: Optional[str] = None,
) -> SchedulingEntity:
    rep = members[0]
    blocks, room_keys, day_pattern = _parse_entity_schedule(rep)

    total_units = sum(m.units or 0 for m in members)
    if is_merge_group and len(members) > 1:
        total_units = total_units / len(members)

    total_lab_hrs = max((m.lab_hrs or 0) for m in members)
    total_lec_hrs = max((m.lec_hrs or 0) for m in members)
    requires_lab_room = any((m.lab_hrs or 0) > 0 for m in members)

    state = classify_subject_state(rep)
    is_saturday = is_saturday_schedule(rep.tfs_schedule)
    has_dual = len(room_keys) > 1

    entity = SchedulingEntity(
        entity_id=entity_id,
        members=members,
        is_merge_group=is_merge_group,
        total_units=total_units,
        total_lab_hrs=total_lab_hrs,
        total_lec_hrs=total_lec_hrs,
        requires_lab_room=requires_lab_room,
        department_id=rep.department_id,
        state=state,
        current_schedule_blocks=blocks,
        current_room_keys=room_keys,
        current_day_pattern=day_pattern,
        has_dual_room=has_dual,
        manual_review_reason=manual_review_reason,
    )

    if is_saturday and entity.manual_review_reason is None:
        entity.manual_review_reason = "saturday_explicit"

    return entity


def _build_entities(
    subjects: List[Subject],
    all_merge_groups: List[MergeGroup],
    subject_by_id: Dict[int, Subject],
    likely_merge_ids: Set[int],
    partial_data_ids: Set[int],
) -> List[SchedulingEntity]:
    entities: List[SchedulingEntity] = []
    handled_ids: Set[int] = set()

    for mg in all_merge_groups:
        members: List[Subject] = []
        for m_dict in mg.members:
            sid = m_dict['subject_id']
            s = subject_by_id.get(sid)
            if s is None:
                try:
                    s = Subject(**m_dict)
                except Exception:
                    continue
            s.requires_lab_room = (s.lab_hrs or 0) > 0
            members.append(s)
            handled_ids.add(sid)

        if not members:
            continue

        entity = _build_entity(
            entity_id=f"MG_{mg.group_id}",
            members=members,
            is_merge_group=True,
        )
        entities.append(entity)

    for s in subjects:
        if s.subject_id in handled_ids:
            continue
        handled_ids.add(s.subject_id)
        s.requires_lab_room = (s.lab_hrs or 0) > 0

        reason: Optional[str] = None
        if s.subject_id in likely_merge_ids:
            reason = "likely_merge"
        elif s.subject_id in partial_data_ids:
            reason = "partial_data"

        entity = _build_entity(
            entity_id=f"E{s.subject_id}",
            members=[s],
            is_merge_group=False,
            manual_review_reason=reason,
        )
        entities.append(entity)

    return entities


def run_preflight(
    subjects: List[Subject],
    rooms: List[Room],
) -> Tuple[RoomTypeRegistry, List[SchedulingEntity]]:
    """
    Steps 0+1: data cleaning, room type registry, merge detection,
    and SchedulingEntity construction.

    Returns (RoomTypeRegistry, List[SchedulingEntity]).
    All subjects appear in exactly one entity (census invariant).
    """
    registry = RoomTypeRegistry(rooms)

    if not subjects:
        return registry, []

    for s in subjects:
        s.subject_type = classify_subject_type(s)
        s.subject_state = classify_subject_state(s)
        s.requires_lab_room = (s.lab_hrs or 0) > 0

    subject_by_id: Dict[int, Subject] = {s.subject_id: s for s in subjects}

    # Pass 1: merged_with column
    merge_groups = detect_merge_groups(subjects)
    merged_ids: Set[int] = {
        m['subject_id'] for mg in merge_groups for m in mg.members
    }

    # Pass 2: room-time evidence
    room_result = detect_room_based_merges(subjects, exclude_ids=merged_ids)

    all_merge_groups = merge_groups + room_result.confirmed_merges
    likely_merge_ids: Set[int] = {
        m['subject_id'] for mg in room_result.likely_merges for m in mg.members
    }
    partial_data_ids: Set[int] = {s.subject_id for s in room_result.partial_data}

    entities = _build_entities(
        subjects=subjects,
        all_merge_groups=all_merge_groups,
        subject_by_id=subject_by_id,
        likely_merge_ids=likely_merge_ids,
        partial_data_ids=partial_data_ids,
    )

    # Census check
    actual_ids = [sid for e in entities for sid in e.subject_ids]
    expected_count = len(subjects)
    if len(actual_ids) != expected_count:
        raise ValueError(
            f"Preflight census error: expected {expected_count} subjects, "
            f"got {len(actual_ids)} in entities"
        )

    return registry, entities
