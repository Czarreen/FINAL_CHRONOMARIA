"""
Room-time-based merge detection (Phases 1-6).

Detects merged subjects by finding those that share the same
(day, start_minutes, end_minutes, room_id) key, then scoring
their similarity to distinguish true merges from room conflicts.
"""

import re
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from sched.models.merge_group import MergeGroup
from sched.models.schedule import DayPattern, ParsedSchedule
from sched.models.subject import Subject


# ── Normalize helpers ─────────────────────────────────────────────────────────

def normalize_room_single(raw: str) -> str:
    """Strip, remove all internal whitespace, remove hyphens, uppercase."""
    s = raw.strip()
    s = re.sub(r'\s+', '', s)
    s = s.replace('-', '')
    return s.upper()


def normalize_room_ids(raw: str) -> Set[str]:
    """
    Split a room string on '/' and normalize each part.
    "E-301 / E401" -> {"E301", "E401"}
    """
    if not raw:
        return set()
    return {normalize_room_single(p) for p in raw.split('/') if p.strip()}


def normalize_title(raw: str) -> str:
    """
    Strip, collapse multiple spaces to one, lowercase.
    Preserves hyphens and letter suffixes.
    "Engineering Data Analysis" -> "engineering data analysis"
    "HCI-101" -> "hci-101"
    """
    s = raw.strip()
    s = re.sub(r' +', ' ', s)
    return s.lower()


def extract_year_level(section: str) -> str:
    """
    Extract leading digits from a section string.
    "1A" -> "1", "10B" -> "10", "A1" -> ""
    """
    m = re.match(r'^(\d+)', section.strip())
    return m.group(1) if m else ''


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class ConfidenceBreakdown:
    group_id: str
    member_ids: List[int]
    total_score: int
    matched_signals: List[str]
    verdict: str  # "CONFIRMED", "LIKELY", "ROOM_CONFLICT"


@dataclass
class RoomConflictReport:
    subject_ids: Tuple[int, ...]
    day: str
    start_minutes: int
    end_minutes: int
    room_id: str


@dataclass
class MergeDetectionResult:
    confirmed_merges: List[MergeGroup] = field(default_factory=list)
    likely_merges: List[MergeGroup] = field(default_factory=list)
    room_conflicts: List[RoomConflictReport] = field(default_factory=list)
    partial_data: List[Subject] = field(default_factory=list)
    normalized_rooms: List[Tuple[str, str]] = field(default_factory=list)
    merge_decisions: List[ConfidenceBreakdown] = field(default_factory=list)
    skipped_empty_subjects: List[int] = field(default_factory=list)


# ── Scoring ───────────────────────────────────────────────────────────────────

_SIGNAL_WEIGHTS = {
    'descriptive_title': 3,
    'year_level':        2,
    'units':             1,
    'lec_hrs':           1,
    'lab_hrs':           1,
    'course_no':         1,
}

MAX_SCORE: int = sum(_SIGNAL_WEIGHTS.values())  # 9


def _score_group(members: List[Subject]) -> ConfidenceBreakdown:
    """Compute confidence score and verdict for a candidate merge group."""
    matched_signals: List[str] = []
    total_score = 0

    def _all_same(values: list) -> bool:
        vs = [v for v in values if v is not None]
        return len(vs) == len(members) and len(set(vs)) == 1

    if _all_same([normalize_title(s.descriptive_title or '') for s in members]):
        matched_signals.append('descriptive_title')
        total_score += _SIGNAL_WEIGHTS['descriptive_title']

    if _all_same([extract_year_level(s.section or '') for s in members]):
        matched_signals.append('year_level')
        total_score += _SIGNAL_WEIGHTS['year_level']

    if _all_same([s.units for s in members]):
        matched_signals.append('units')
        total_score += _SIGNAL_WEIGHTS['units']

    if _all_same([s.lec_hrs for s in members]):
        matched_signals.append('lec_hrs')
        total_score += _SIGNAL_WEIGHTS['lec_hrs']

    if _all_same([s.lab_hrs for s in members]):
        matched_signals.append('lab_hrs')
        total_score += _SIGNAL_WEIGHTS['lab_hrs']

    norm_course = [re.sub(r'\s+', '', (s.course_no or '')).upper() for s in members]
    if _all_same(norm_course):
        matched_signals.append('course_no')
        total_score += _SIGNAL_WEIGHTS['course_no']

    verdict = _classify_verdict(total_score, matched_signals)
    return ConfidenceBreakdown(
        group_id='',  # assigned after validation
        member_ids=[s.subject_id for s in members],
        total_score=total_score,
        matched_signals=matched_signals,
        verdict=verdict,
    )


def _classify_verdict(total_score: int, matched_signals: List[str]) -> str:
    """
    Title match is required for any merge verdict.
    Without it the group is always a ROOM_CONFLICT.
    """
    if 'descriptive_title' not in matched_signals:
        return 'ROOM_CONFLICT'
    if total_score >= 5:
        return 'CONFIRMED'
    if total_score >= 2:
        return 'LIKELY'
    return 'ROOM_CONFLICT'


# ── Main detector ─────────────────────────────────────────────────────────────

_KeyType = Tuple[str, int, int, str]  # (day_value, start_min, end_min, room_id)


def detect_room_based_merges(
    subjects: List[Subject],
    exclude_ids: Optional[Set[int]] = None,
) -> MergeDetectionResult:
    """
    Run Phases 1-6 to detect merged subjects from observable evidence.

    exclude_ids: subject_ids already grouped by the merged_with detector; skipped here.
    """
    result = MergeDetectionResult()
    if exclude_ids is None:
        exclude_ids = set()

    # ── Phase 1: Emit (day, start, end, room_id) keys ────────────────────────
    key_map: Dict[_KeyType, List[int]] = {}
    partial_ids: Set[int] = set()
    active_subjects: List[Subject] = []

    for s in subjects:
        if s.subject_id in exclude_ids:
            continue

        is_mth_empty = (s.mth_schedule is None and s.mth_room is None)
        is_tfs_empty = (s.tfs_schedule is None and s.tfs_room is None)
        if is_mth_empty and is_tfs_empty:
            result.skipped_empty_subjects.append(s.subject_id)
            continue

        idx = len(active_subjects)
        active_subjects.append(s)

        for sched_str, room_str, pattern in (
            (s.mth_schedule, s.mth_room, DayPattern.MTH),
            (s.tfs_schedule, s.tfs_room, DayPattern.TFS),
        ):
            has_sched = sched_str is not None
            has_room = room_str is not None

            if has_sched and has_room:
                try:
                    parsed = ParsedSchedule.parse(sched_str, pattern)
                except Exception:
                    continue
                room_ids = normalize_room_ids(room_str)
                if room_ids:
                    result.normalized_rooms.append(
                        (room_str, '/'.join(sorted(room_ids)))
                    )
                for blk in parsed.blocks:
                    for rid in room_ids:
                        key: _KeyType = (blk.day.value, blk.start_minutes, blk.end_minutes, rid)
                        key_map.setdefault(key, []).append(idx)
            elif has_sched ^ has_room:
                partial_ids.add(s.subject_id)

    if not active_subjects:
        return result

    # Collect initial partial_data (deduped via set)
    result.partial_data = [s for s in active_subjects if s.subject_id in partial_ids]

    # ── Phases 2-3: Group by key, transitive union-find closure ──────────────
    n = len(active_subjects)
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

    for idxs in key_map.values():
        deduped = list(dict.fromkeys(idxs))
        if len(deduped) < 2:
            continue
        for i in range(1, len(deduped)):
            union(deduped[0], deduped[i])

    groups: Dict[int, List[int]] = {}
    for i in range(n):
        root = find(i)
        groups.setdefault(root, []).append(i)

    # ── Phases 4-6: Score, classify, validate ────────────────────────────────
    confirmed_likely_ids: Set[int] = set()

    for members_idx in groups.values():
        if len(members_idx) < 2:
            continue

        members = [active_subjects[i] for i in members_idx]
        breakdown = _score_group(members)

        # Phase 6: sanity-check CONFIRMED groups
        if breakdown.verdict == 'CONFIRMED':
            has_schedule = all(m.mth_schedule or m.tfs_schedule for m in members)
            no_nones = all(m is not None for m in members)
            if not (len(members) >= 2 and has_schedule and no_nones):
                breakdown.verdict = 'LIKELY'

        breakdown.group_id = str(uuid.uuid4())
        result.merge_decisions.append(breakdown)

        if breakdown.verdict == 'CONFIRMED':
            for sid in breakdown.member_ids:
                confirmed_likely_ids.add(sid)
            mg = MergeGroup(
                group_id=breakdown.group_id,
                members=[s.model_dump() for s in members],
                is_pre_existing=False,
            )
            result.confirmed_merges.append(mg)

        elif breakdown.verdict == 'LIKELY':
            for sid in breakdown.member_ids:
                confirmed_likely_ids.add(sid)
            mg = MergeGroup(
                group_id=breakdown.group_id,
                members=[s.model_dump() for s in members],
                is_pre_existing=False,
            )
            result.likely_merges.append(mg)

        else:  # ROOM_CONFLICT
            member_set = set(members_idx)
            seen_keys: Set[_KeyType] = set()
            for key, idxs in key_map.items():
                overlap = [ix for ix in dict.fromkeys(idxs) if ix in member_set]
                if len(overlap) >= 2 and key not in seen_keys:
                    seen_keys.add(key)
                    day_str, start_min, end_min, room_id = key
                    result.room_conflicts.append(RoomConflictReport(
                        subject_ids=tuple(active_subjects[ix].subject_id for ix in overlap),
                        day=day_str,
                        start_minutes=start_min,
                        end_minutes=end_min,
                        room_id=room_id,
                    ))

    # Subjects promoted to CONFIRMED/LIKELY are removed from partial_data
    if confirmed_likely_ids:
        result.partial_data = [
            s for s in result.partial_data
            if s.subject_id not in confirmed_likely_ids
        ]

    return result
