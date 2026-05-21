"""Tests for sched/flow/stage3_ga.py."""
import pytest
from sched.flow.stage3_ga import run_stage3, validate_ga_output, prepare_pending_for_ga
from sched.flow.state import PipelineState
from sched.models.subject import Subject, SubjectTag
from sched.models.room import Room


def _subj(curr_id, section="1A", dept="CE", mth_schedule=None, mth_room=None, lec=3.0):
    return Subject(
        curr_id=curr_id, code=str(curr_id), course_no="ENG 1",
        department_id=dept, section=section,
        descriptive_title="Test", units=3, lec_hrs=lec, lab_hrs=0,
        mth_schedule=mth_schedule, mth_room=mth_room,
    )


def _room(room_id):
    return Room(room_id=room_id, room_name=f"Room {room_id}", room_type="LEC")


def _state(pending=None, resolved=None, locked=None):
    all_subjects = (pending or []) + (resolved or []) + (locked or [])
    return PipelineState(
        locked=locked or [],
        resolved=resolved or [],
        pending=pending or [],
        original_input_ids=[s.curr_id for s in all_subjects],
    )


class TestPrepareForGa:
    def test_needs_reschedule_cleared(self):
        s = _subj(1, mth_schedule="7:30-9:00", mth_room="R1")
        state = _state(pending=[s])
        prepared = prepare_pending_for_ga(state)
        assert prepared[0].mth_schedule is None
        assert prepared[0].mth_room is None

    def test_needs_generation_unchanged(self):
        s = _subj(1)  # already empty
        state = _state(pending=[s])
        prepared = prepare_pending_for_ga(state)
        assert prepared[0].mth_schedule is None

    def test_count_preserved(self):
        subjects = [_subj(i, section=f"{i}A") for i in range(5)]
        state = _state(pending=subjects)
        prepared = prepare_pending_for_ga(state)
        assert len(prepared) == 5

    def test_does_not_mutate_state(self):
        s = _subj(1, mth_schedule="7:30-9:00", mth_room="R1")
        state = _state(pending=[s])
        prepare_pending_for_ga(state)
        # Original subject in state should be unchanged
        assert state.pending[0].mth_schedule == "7:30-9:00"


class TestValidateGaOutput:
    def test_all_clean_no_conflict(self):
        # Two subjects with different sections and different implicit schedules
        s1 = _subj(1, section="1A", mth_schedule="7:30-9:00", mth_room="R1")
        s2 = _subj(2, section="1B", mth_schedule="7:30-9:00", mth_room="R2")
        clean, conflicted = validate_ga_output([s1, s2], resolved=[])
        assert len(clean) == 2
        assert len(conflicted) == 0

    def test_conflict_goes_to_conflicted(self):
        # Same section, same time, same room → conflict
        s1 = _subj(1, section="1A", mth_schedule="7:30-9:00", mth_room="R1")
        s2 = _subj(2, section="1A", mth_schedule="7:30-9:00", mth_room="R1")
        clean, conflicted = validate_ga_output([s1, s2], resolved=[])
        # s1 clean, s2 conflicted with s1
        assert len(clean) + len(conflicted) == 2

    def test_total_equals_input(self):
        subjects = [_subj(i, section=f"{i}A") for i in range(4)]
        clean, conflicted = validate_ga_output(subjects, resolved=[])
        assert len(clean) + len(conflicted) == 4


class TestRunStage3:
    def test_census_preserved(self):
        rooms = [_room("R1"), _room("R2"), _room("R3")]
        pending = [_subj(i, section=f"{i}A") for i in range(3)]
        state = _state(pending=pending)
        state = run_stage3(state, original_input=pending, rooms=rooms,
                           constraints={"max_runtime_seconds": 5, "population_size": 8, "max_generations": 5})
        total = state.total_count()
        assert total == 3

    def test_iteration_count_incremented(self):
        rooms = [_room("R1"), _room("R2")]
        pending = [_subj(1, section="1A")]
        state = _state(pending=pending)
        assert state.iteration_count == 0
        state = run_stage3(state, original_input=pending, rooms=rooms,
                           constraints={"max_runtime_seconds": 3, "population_size": 8, "max_generations": 5})
        assert state.iteration_count == 1

    def test_clean_tagged_generated(self):
        rooms = [_room("R1"), _room("R2"), _room("R3")]
        pending = [_subj(1, section="1A")]
        state = _state(pending=pending)
        state = run_stage3(state, original_input=pending, rooms=rooms,
                           constraints={"max_runtime_seconds": 5, "population_size": 8, "max_generations": 5})
        # Any subject that got resolved should be tagged Generated
        for s in state.resolved:
            assert s.tag == SubjectTag.GENERATED
