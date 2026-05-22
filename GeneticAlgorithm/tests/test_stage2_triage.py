"""Tests for sched/flow/stage2_triage.py."""
import pytest
from sched.flow.stage2_triage import triage
from sched.flow.state import PipelineState
from sched.models.subject import Subject, SubjectTag


def _subj(curr_id, section="1A", dept="CE", mth_schedule=None, mth_room=None):
    return Subject(
        curr_id=curr_id, code=str(curr_id), course_no="ENG 1",
        department_id=dept, section=section,
        descriptive_title="Test", units=3, lec_hrs=3, lab_hrs=0,
        mth_schedule=mth_schedule, mth_room=mth_room,
    )


def _state(pending=None, resolved=None, locked=None):
    return PipelineState(
        locked=locked or [],
        resolved=resolved or [],
        pending=pending or [],
        original_input_ids=[s.curr_id for s in (pending or []) + (resolved or []) + (locked or [])],
    )


class TestTriage:
    def test_empty_subject_stays_pending(self):
        s = _subj(1)  # no schedule
        state = _state(pending=[s])
        triage(state)
        assert len(state.pending) == 1
        assert len(state.resolved) == 0

    def test_conflict_free_scheduled_promoted(self):
        s = _subj(1, section="1A", mth_schedule="7:30-9:00", mth_room="R1")
        state = _state(pending=[s])
        triage(state)
        assert len(state.resolved) == 1
        assert len(state.pending) == 0

    def test_conflicting_scheduled_stays_pending(self):
        # Two subjects in same section at overlapping time
        s1 = _subj(1, section="1A", mth_schedule="7:30-9:00", mth_room="R1")
        s2 = _subj(2, section="1A", mth_schedule="8:00-9:30", mth_room="R1")
        state = _state(pending=[s1, s2])
        triage(state)
        # s1 gets promoted (no conflict vs empty baseline), s2 conflicts with s1
        assert len(state.resolved) == 1
        assert len(state.pending) == 1
        assert state.pending[0].curr_id == 2

    def test_census_preserved(self):
        subjects = [
            _subj(1, section="1A", mth_schedule="7:30-9:00", mth_room="R1"),
            _subj(2, section="1B", mth_schedule="7:30-9:00", mth_room="R2"),
            _subj(3),  # empty
        ]
        state = _state(pending=subjects)
        triage(state)
        assert len(state.resolved) + len(state.pending) == 3

    def test_promoted_gets_original_tag(self):
        s = _subj(1, section="1A", mth_schedule="7:30-9:00", mth_room="R1")
        state = _state(pending=[s])
        triage(state)
        assert state.resolved[0].tag == SubjectTag.ORIGINAL
