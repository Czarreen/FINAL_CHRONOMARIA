"""Tests for sched/flow/stage2_triage.py."""
import pytest
# TODO: from sched.flow.stage2_triage import triage


class TestTriage:
    def test_empty_subject_stays_pending(self): pass
    def test_conflict_free_scheduled_promoted(self): pass
    def test_conflicting_scheduled_stays_pending(self): pass
    def test_census_preserved(self): pass           # no subjects lost
    def test_promoted_gets_original_tag(self): pass
