"""Tests for sched/conflict/merge_detector.py (Phases 1-6)."""
import pytest
from sched.conflict.merge_detector import (
    normalize_room_single,
    normalize_room_ids,
    normalize_title,
    extract_year_level,
    detect_room_based_merges,
)
from sched.models.subject import Subject, SubjectType


def _subject(
    subject_id: int,
    descriptive_title: str = "Test Subject",
    section: str = "1A",
    units: float = 3.0,
    lec_hrs: float = 3.0,
    lab_hrs: float = 0.0,
    course_no: str = "ENG 1",
    department_id: str = "CE",
    mth_schedule: str = None,
    mth_room: str = None,
    tfs_schedule: str = None,
    tfs_room: str = None,
    subject_type: SubjectType = SubjectType.REGULAR,
) -> Subject:
    return Subject(
        curr_id=subject_id,
        subject_id=subject_id,
        code=str(subject_id),
        course_no=course_no,
        department_id=department_id,
        section=section,
        descriptive_title=descriptive_title,
        units=units,
        lec_hrs=lec_hrs,
        lab_hrs=lab_hrs,
        mth_schedule=mth_schedule,
        mth_room=mth_room,
        tfs_schedule=tfs_schedule,
        tfs_room=tfs_room,
        subject_type=subject_type,
    )


# ── normalize_room_single ─────────────────────────────────────────────────────

class TestNormalizeRoomSingle:
    def test_already_clean(self):
        assert normalize_room_single("AP104") == "AP104"

    def test_internal_space(self):
        assert normalize_room_single("AP 104") == "AP104"

    def test_hyphen(self):
        assert normalize_room_single("E-101") == "E101"

    def test_space_and_hyphen(self):
        assert normalize_room_single("E-301 ") == "E301"

    def test_lowercase(self):
        assert normalize_room_single("tc1") == "TC1"

    def test_trailing_space(self):
        assert normalize_room_single("  TC 1  ") == "TC1"


# ── normalize_room_ids ────────────────────────────────────────────────────────

class TestNormalizeRoomIds:
    def test_single(self):
        assert normalize_room_ids("E101") == {"E101"}

    def test_compound(self):
        assert normalize_room_ids("E301/E401") == {"E301", "E401"}

    def test_compound_with_hyphens_and_spaces(self):
        assert normalize_room_ids("E-301 / E401") == {"E301", "E401"}

    def test_numeric(self):
        assert normalize_room_ids("1200/1195") == {"1200", "1195"}

    def test_empty(self):
        assert normalize_room_ids("") == set()

    def test_none_like_empty(self):
        assert normalize_room_ids("  ") == set()


# ── normalize_title ───────────────────────────────────────────────────────────

class TestNormalizeTitle:
    def test_normal(self):
        assert normalize_title("Engineering Data Analysis") == "engineering data analysis"

    def test_preserves_hyphen(self):
        assert normalize_title("HCI-101") == "hci-101"

    def test_letter_suffix(self):
        assert normalize_title("HCI101a") == "hci101a"

    def test_collapse_spaces(self):
        assert normalize_title("AR  a221") == "ar a221"

    def test_strips(self):
        assert normalize_title("  Calculus  ") == "calculus"


# ── extract_year_level ────────────────────────────────────────────────────────

class TestExtractYearLevel:
    def test_single_digit(self):
        assert extract_year_level("1A") == "1"

    def test_two_digit(self):
        assert extract_year_level("10A") == "10"

    def test_no_leading_digit(self):
        assert extract_year_level("A1") == ""

    def test_pure_digits(self):
        assert extract_year_level("2B") == "2"


# ── detect_room_based_merges: empty/skip behaviour ────────────────────────────

class TestPhase1Skip:
    def test_empty_subjects_skipped(self):
        s = _subject(1)  # no schedule, no room
        result = detect_room_based_merges([s])
        assert s.subject_id in result.skipped_empty_subjects
        assert result.confirmed_merges == []
        assert result.partial_data == []

    def test_general_subjects_skipped(self):
        s = _subject(1, mth_schedule="7:30-9:00", mth_room="E101",
                     subject_type=SubjectType.GENERAL)
        result = detect_room_based_merges([s])
        assert result.confirmed_merges == []
        assert result.likely_merges == []
        assert s.subject_id not in result.skipped_empty_subjects

    def test_exclude_ids_respected(self):
        s = _subject(1, mth_schedule="7:30-9:00", mth_room="E101")
        result = detect_room_based_merges([s], exclude_ids={1})
        assert result.confirmed_merges == []
        assert s.subject_id not in result.skipped_empty_subjects


# ── detect_room_based_merges: partial data ────────────────────────────────────

class TestPartialData:
    def test_schedule_without_room_is_partial(self):
        s = _subject(1, mth_schedule="7:30-9:00", mth_room=None)
        result = detect_room_based_merges([s])
        assert any(p.subject_id == 1 for p in result.partial_data)

    def test_room_without_schedule_is_partial(self):
        s = _subject(1, mth_schedule=None, mth_room="E101")
        result = detect_room_based_merges([s])
        assert any(p.subject_id == 1 for p in result.partial_data)

    def test_complete_slot_not_partial(self):
        s = _subject(1, mth_schedule="7:30-9:00", mth_room="E101")
        result = detect_room_based_merges([s])
        assert result.partial_data == []


# ── detect_room_based_merges: Phase 2 grouping ───────────────────────────────

class TestPhase2Grouping:
    def test_two_subjects_same_room_time_detected(self):
        s1 = _subject(1, descriptive_title="Calculus", section="1A",
                      mth_schedule="7:30-9:00", mth_room="E101")
        s2 = _subject(2, descriptive_title="Calculus", section="1B",
                      mth_schedule="7:30-9:00", mth_room="E101")
        result = detect_room_based_merges([s1, s2])
        # Same title, same year-level, same units -> score >= 5 -> CONFIRMED
        assert len(result.confirmed_merges) == 1
        ids = {m['subject_id'] for m in result.confirmed_merges[0].members}
        assert ids == {1, 2}

    def test_different_room_not_grouped(self):
        s1 = _subject(1, descriptive_title="Calculus", section="1A",
                      mth_schedule="7:30-9:00", mth_room="E101")
        s2 = _subject(2, descriptive_title="Calculus", section="1B",
                      mth_schedule="7:30-9:00", mth_room="E102")
        result = detect_room_based_merges([s1, s2])
        assert result.confirmed_merges == []
        assert result.likely_merges == []


# ── detect_room_based_merges: Phase 3 transitive closure ─────────────────────

class TestPhase3Transitive:
    def test_abc_chained_across_days(self):
        # A+B share Monday, B+C share Thursday -> {A,B,C} one group
        s_a = _subject(1, descriptive_title="Physics", section="1A",
                       mth_schedule="7:30-9:00", mth_room="E101")
        s_b = _subject(2, descriptive_title="Physics", section="1B",
                       mth_schedule="7:30-9:00", mth_room="E101",
                       tfs_schedule="7:30-9:00", tfs_room="E101")
        s_c = _subject(3, descriptive_title="Physics", section="1C",
                       tfs_schedule="7:30-9:00", tfs_room="E101")
        result = detect_room_based_merges([s_a, s_b, s_c])
        assert len(result.confirmed_merges) == 1
        ids = {m['subject_id'] for m in result.confirmed_merges[0].members}
        assert ids == {1, 2, 3}


# ── detect_room_based_merges: title gate (critical) ──────────────────────────

class TestTitleGate:
    def test_different_titles_same_room_time_is_conflict(self):
        """
        Eng Math 2 vs GPIC: same section, same room, overlapping time.
        Without the title gate this would score 5 and be CONFIRMED.
        With the title gate: no title match -> ROOM_CONFLICT.
        """
        s1 = _subject(1, descriptive_title="Engineering Mathematics 2",
                      section="1A", units=3, lec_hrs=3, lab_hrs=0,
                      course_no="MATH 2",
                      mth_schedule="7:30-9:00", mth_room="E101")
        s2 = _subject(2, descriptive_title="Graphics and Product Innovation Course",
                      section="1A", units=3, lec_hrs=3, lab_hrs=0,
                      course_no="GPIC 1",
                      mth_schedule="7:30-9:00", mth_room="E101")
        result = detect_room_based_merges([s1, s2])
        assert result.confirmed_merges == []
        assert result.likely_merges == []
        assert len(result.room_conflicts) >= 1

    def test_same_title_confirms_merge(self):
        s1 = _subject(1, descriptive_title="Chemistry",
                      section="1A", units=3, lec_hrs=3, lab_hrs=0,
                      mth_schedule="10:30-12:00", mth_room="R201")
        s2 = _subject(2, descriptive_title="Chemistry",
                      section="1B", units=3, lec_hrs=3, lab_hrs=0,
                      mth_schedule="10:30-12:00", mth_room="R201")
        result = detect_room_based_merges([s1, s2])
        assert len(result.confirmed_merges) == 1

    def test_title_match_but_low_score_is_likely(self):
        # Same title (+3) only => score 3 => LIKELY (2 <= score < 5)
        s1 = _subject(1, descriptive_title="Art History",
                      section="1A", units=3, lec_hrs=2, lab_hrs=1,
                      course_no="AH 1",
                      mth_schedule="1:00-2:30", mth_room="A101")
        s2 = _subject(2, descriptive_title="Art History",
                      section="2A",             # different year-level -> no +2
                      units=2,                  # different units -> no +1
                      lec_hrs=1, lab_hrs=1,     # different lec_hrs -> no +1
                      course_no="AH 2",         # different course_no -> no +1
                      mth_schedule="1:00-2:30", mth_room="A101")
        result = detect_room_based_merges([s1, s2])
        # Score = 3 (title only) -> LIKELY
        assert len(result.likely_merges) == 1
        assert result.confirmed_merges == []


# ── detect_room_based_merges: compound room normalization ────────────────────

class TestCompoundRooms:
    def test_compound_room_emits_two_keys(self):
        # Two subjects: s1 in "E101/E102", s2 in "E101" -> share E101 key
        s1 = _subject(1, descriptive_title="Biology", section="1A",
                      mth_schedule="7:30-9:00", mth_room="E101/E102")
        s2 = _subject(2, descriptive_title="Biology", section="1B",
                      mth_schedule="7:30-9:00", mth_room="E101")
        result = detect_room_based_merges([s1, s2])
        assert len(result.confirmed_merges) == 1

    def test_hyphenated_room_normalizes_for_match(self):
        # "E-101" and "E101" should be the same room
        s1 = _subject(1, descriptive_title="Statics", section="1A",
                      mth_schedule="7:30-9:00", mth_room="E-101")
        s2 = _subject(2, descriptive_title="Statics", section="1B",
                      mth_schedule="7:30-9:00", mth_room="E101")
        result = detect_room_based_merges([s1, s2])
        assert len(result.confirmed_merges) == 1


# ── detect_room_based_merges: partial_data removed from CONFIRMED/LIKELY ──────

class TestPartialDataPriority:
    def test_confirmed_member_removed_from_partial_data(self):
        # s1 has complete MTH + partial TFS; s2 is a match for s1 on MTH
        s1 = _subject(1, descriptive_title="Thermodynamics", section="1A",
                      mth_schedule="7:30-9:00", mth_room="E101",
                      tfs_schedule="1:00-2:30", tfs_room=None)  # partial TFS
        s2 = _subject(2, descriptive_title="Thermodynamics", section="1B",
                      mth_schedule="7:30-9:00", mth_room="E101")
        result = detect_room_based_merges([s1, s2])
        assert len(result.confirmed_merges) == 1
        partial_ids = {p.subject_id for p in result.partial_data}
        assert 1 not in partial_ids  # promoted to CONFIRMED, not in partial
