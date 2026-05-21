"""Tests for sched/flow/stage3_ga.py."""
import pytest
# TODO: from sched.flow.stage3_ga import run_stage3, validate_ga_output, prepare_pending_for_ga


class TestPrepareForGa:
    def test_needs_reschedule_cleared(self): pass   # schedule/room wiped
    def test_needs_generation_unchanged(self): pass # already blank
    def test_count_preserved(self): pass


class TestValidateGaOutput:
    def test_all_clean_no_conflict(self): pass
    def test_conflict_goes_to_conflicted(self): pass
    def test_total_equals_input(self): pass         # |clean| + |conflicted| == |ga_output|


class TestRunStage3:
    def test_census_preserved(self): pass
    def test_iteration_count_incremented(self): pass
    def test_clean_tagged_generated(self): pass
