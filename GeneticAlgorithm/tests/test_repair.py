"""Tests for sched/ga/repair.py."""
import pytest
# TODO: from sched.ga.repair import repair, find_free_slot


class TestRepair:
    def test_no_conflict_unchanged(self): pass
    def test_single_conflict_resolved(self): pass
    def test_all_subjects_preserved(self): pass   # no subjects lost during repair
    def test_max_attempts_respected(self): pass


class TestFindFreeSlot:
    def test_returns_none_if_no_slot(self): pass
    def test_returned_slot_has_no_conflict(self): pass
