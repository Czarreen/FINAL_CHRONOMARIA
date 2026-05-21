"""Tests for sched/conflict/detector.py."""
import pytest
# TODO: from sched.conflict.detector import conflicts, find_all_conflicts, ConflictReason


class TestEngMathGpicCase:
    """Regression test for the original bug."""
    def test_detects_conflict(self, eng_math_gpic_case):
        # TODO: load both subjects, call conflicts(), assert not None
        pass

    def test_lists_all_three_reasons(self, eng_math_gpic_case):
        # TODO: assert reasons include SAME_SECTION, ROOM_OVERLAP, TIME_OVERLAP
        pass


class TestTimeOverlap:
    def test_no_overlap_separate_times(self): pass
    def test_partial_overlap(self): pass         # "1:00-2:30" vs "1:30-3:00"
    def test_exact_match(self): pass
    def test_one_contains_other(self): pass
    def test_back_to_back_no_overlap(self): pass # "1:00-2:30" vs "2:30-4:00"


class TestRoomConflict:
    def test_same_room(self): pass
    def test_different_rooms(self): pass
    def test_compound_vs_simple_overlap(self): pass  # "1200/1195" vs "1200"
    def test_compound_vs_compound_overlap(self): pass
    def test_compound_no_overlap(self): pass
