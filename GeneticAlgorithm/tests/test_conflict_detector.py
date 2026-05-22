"""Tests for sched/conflict/detector.py."""
import pytest
import json
from pathlib import Path

from sched.conflict.detector import conflicts, find_all_conflicts, ConflictReason
from sched.models.subject import Subject

FIXTURES = Path(__file__).parent / "fixtures"


def _subj(curr_id, dept, section, mth_sched=None, mth_room=None,
          tfs_sched=None, tfs_room=None, **kw):
    return Subject(
        curr_id=curr_id, code="TEST", course_no="TEST 1",
        department_id=dept, section=section,
        descriptive_title="Test", units=3, lec_hrs=3, lab_hrs=0,
        mth_schedule=mth_sched, mth_room=mth_room,
        tfs_schedule=tfs_sched, tfs_room=tfs_room,
        **kw,
    )


class TestEngMathGpicCase:
    """Regression test for the original PM-time parsing bug."""

    def test_detects_conflict(self, eng_math_gpic_case):
        a = Subject(**eng_math_gpic_case["subject_a"])
        b = Subject(**eng_math_gpic_case["subject_b"])
        report = conflicts(a, b)
        assert report is not None, "Expected conflict but got None"

    def test_lists_all_three_reasons(self, eng_math_gpic_case):
        a = Subject(**eng_math_gpic_case["subject_a"])
        b = Subject(**eng_math_gpic_case["subject_b"])
        report = conflicts(a, b)
        assert report is not None
        vals = [r.value for r in report.reasons]
        assert "same_section" in vals
        assert "room_overlap" in vals
        assert "time_overlap" in vals


class TestTimeOverlap:
    def test_no_overlap_separate_times(self):
        a = _subj(1, "CE", "1A", mth_sched="9:00-10:30", mth_room="R1")
        b = _subj(2, "CE", "1A", mth_sched="11:00-12:30", mth_room="R1")
        assert conflicts(a, b) is None

    def test_partial_overlap(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="R1")
        b = _subj(2, "CE", "1A", mth_sched="1:30-3:00", mth_room="R1")
        assert conflicts(a, b) is not None

    def test_exact_match(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="R1")
        b = _subj(2, "CE", "1A", mth_sched="1:00-2:30", mth_room="R1")
        assert conflicts(a, b) is not None

    def test_one_contains_other(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-4:00", mth_room="R1")
        b = _subj(2, "CE", "1A", mth_sched="1:30-3:00", mth_room="R1")
        assert conflicts(a, b) is not None

    def test_back_to_back_no_overlap(self):
        # "1:00-2:30" vs "2:30-4:00" — adjacent, NOT a conflict
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="R1")
        b = _subj(2, "CE", "1A", mth_sched="2:30-4:00", mth_room="R1")
        assert conflicts(a, b) is None

    def test_different_slots_no_conflict(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="R1")
        b = _subj(2, "CE", "1A", tfs_sched="1:00-2:30", tfs_room="R1")
        assert conflicts(a, b) is None


class TestRoomConflict:
    def test_same_room(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="1200")
        b = _subj(2, "CE", "1B", mth_sched="1:30-3:00", mth_room="1200")
        report = conflicts(a, b)
        assert report is not None
        assert ConflictReason.ROOM_OVERLAP in report.reasons

    def test_different_rooms(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="R1")
        b = _subj(2, "CE", "1B", mth_sched="1:30-3:00", mth_room="R2")
        # Different section AND different room -> no conflict
        assert conflicts(a, b) is None

    def test_compound_vs_simple_overlap(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="1200/1195")
        b = _subj(2, "CE", "1B", mth_sched="1:30-3:00", mth_room="1200")
        report = conflicts(a, b)
        assert report is not None
        assert ConflictReason.ROOM_OVERLAP in report.reasons

    def test_compound_vs_compound_overlap(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="E301/E401")
        b = _subj(2, "CE", "1B", mth_sched="1:30-3:00", mth_room="E401/E501")
        report = conflicts(a, b)
        assert report is not None
        assert ConflictReason.ROOM_OVERLAP in report.reasons

    def test_compound_no_overlap(self):
        a = _subj(1, "CE", "1A", mth_sched="1:00-2:30", mth_room="E301/E401")
        b = _subj(2, "CE", "1B", mth_sched="1:30-3:00", mth_room="E501/E601")
        # No shared room -> no conflict (different sections too)
        assert conflicts(a, b) is None
