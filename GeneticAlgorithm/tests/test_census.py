"""Tests for sched/flow/census.py -- the silent-drop prevention."""
import pytest
from sched.flow.census import assert_invariant, census_summary, CensusViolationError
from sched.flow.state import PipelineState
from sched.models.subject import Subject


def _make_subject(curr_id: int) -> Subject:
    return Subject(
        curr_id=curr_id, code="X", course_no="TEST 1",
        department_id="CE", section="1A",
        descriptive_title="Test", units=3, lec_hrs=3, lab_hrs=0,
    )


def _make_state(locked=None, resolved=None, pending=None,
                unresolvable=None, manual_review=None):
    return PipelineState(
        locked=locked or [],
        resolved=resolved or [],
        pending=pending or [],
        unresolvable=unresolvable or [],
        manual_review=manual_review or [],
    )


class TestAssertInvariant:
    def test_passes_when_all_present(self):
        subjects = [_make_subject(i) for i in range(5)]
        state = _make_state(pending=subjects[:3], resolved=subjects[3:])
        assert_invariant(subjects, state, "test-stage")  # should not raise

    def test_raises_on_drop(self):
        subjects = [_make_subject(i) for i in range(5)]
        state = _make_state(pending=subjects[:4])  # subject 4 missing
        with pytest.raises(CensusViolationError) as exc_info:
            assert_invariant(subjects, state, "test-drop")
        assert exc_info.value.stage_name == "test-drop"
        assert 4 in exc_info.value.missing_ids

    def test_raises_on_duplicate(self):
        subjects = [_make_subject(i) for i in range(3)]
        s0_copy = _make_subject(0)
        # Subject 0 in both locked and pending
        state = _make_state(locked=[subjects[0]], pending=[s0_copy, subjects[1], subjects[2]])
        with pytest.raises(CensusViolationError) as exc_info:
            assert_invariant(subjects, state, "test-dupe")
        assert 0 in exc_info.value.duplicate_ids

    def test_raises_on_extra(self):
        subjects = [_make_subject(i) for i in range(3)]
        extra = _make_subject(99)
        state = _make_state(pending=subjects + [extra])
        with pytest.raises(CensusViolationError) as exc_info:
            assert_invariant(subjects, state, "test-extra")
        assert 99 in exc_info.value.extra_ids

    def test_error_message_includes_stage_name(self):
        subjects = [_make_subject(i) for i in range(3)]
        state = _make_state(pending=subjects[:2])
        with pytest.raises(CensusViolationError) as exc_info:
            assert_invariant(subjects, state, "my-stage")
        assert "my-stage" in str(exc_info.value)


class TestCensusSummary:
    def test_counts_match(self):
        subjects = [_make_subject(i) for i in range(6)]
        state = _make_state(
            locked=subjects[:2],
            resolved=subjects[2:4],
            pending=subjects[4:],
        )
        state.original_input_ids = [s.curr_id for s in subjects]
        summary = census_summary(state)
        assert summary["output_count"] == 6
        assert summary["by_bucket"]["locked"] == 2
        assert summary["by_bucket"]["resolved"] == 2
        assert summary["by_bucket"]["pending"] == 2


def test_359_in_359_out(full_master_list_359):
    """Full fixture: 359 subjects -> preflight -> census invariant holds."""
    # The fixture is empty until populated; skip if empty.
    subjects_data = full_master_list_359.get("subjects", [])
    if not subjects_data:
        pytest.skip("full_master_list_359 fixture is empty; populate before running")
    from sched.io.parser import parse_input
    subjects, _, _ = parse_input({"subjects": subjects_data})
    from sched.flow.preflight import run_preflight
    state = run_preflight(subjects)
    assert state.total_count() == len(subjects)
