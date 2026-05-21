"""Tests for sched/flow/preflight.py."""
import pytest
# TODO: from sched.flow.preflight import run_preflight, classify_subject_type, classify_subject_state


class TestClassifySubjectType:
    def test_general_prefix_g(self): pass      # course_no starting with "G"
    def test_general_nstp(self): pass
    def test_general_path_fit(self): pass
    def test_merged_subject(self): pass        # merged_with is non-empty
    def test_regular_subject(self): pass


class TestClassifySubjectState:
    def test_empty_both_null(self): pass
    def test_scheduled_mth_only(self): pass
    def test_scheduled_tfs_only(self): pass
    def test_scheduled_both(self): pass


class TestRunPreflight:
    def test_general_scheduled_goes_to_locked(self): pass
    def test_general_empty_goes_to_manual_review(self): pass
    def test_regular_empty_goes_to_pending(self): pass
    def test_regular_scheduled_goes_to_pending(self): pass
    def test_census_preserved_after_preflight(self, small_master_list): pass
