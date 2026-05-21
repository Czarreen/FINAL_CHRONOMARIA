"""Tests for sched/io/formatter.py."""
import json
import pytest
from sched.io.formatter import format_output
from sched.flow.state import PipelineState
from sched.models.subject import Subject, SubjectTag


def _subj(curr_id, section="1A", dept="CE", tag=None):
    s = Subject(
        curr_id=curr_id, code=str(curr_id), course_no="ENG 1",
        department_id=dept, section=section,
        descriptive_title="Test", units=3, lec_hrs=3, lab_hrs=0,
    )
    if tag:
        s.tag = tag
    return s


def _state(resolved=None, locked=None, unresolvable=None, manual_review=None, pending=None):
    all_s = (resolved or []) + (locked or []) + (unresolvable or []) + (manual_review or []) + (pending or [])
    return PipelineState(
        locked=locked or [],
        resolved=resolved or [],
        unresolvable=unresolvable or [],
        manual_review=manual_review or [],
        pending=pending or [],
        original_input_ids=[s.curr_id for s in all_s],
    )


class TestFormatOutput:
    def test_census_counts_match(self):
        subjects = [_subj(i) for i in range(4)]
        state = _state(resolved=subjects)
        out = format_output(state)
        assert out["census"]["output_count"] == 4
        assert out["census"]["input_count"] == 4

    def test_status_success_when_all_resolved(self):
        state = _state(resolved=[_subj(1), _subj(2)])
        out = format_output(state)
        assert out["status"] == "success"

    def test_status_partial_when_some_unresolvable(self):
        resolved   = [_subj(i) for i in range(8)]
        unresolvable = [_subj(10)]
        state = _state(resolved=resolved, unresolvable=unresolvable)
        out = format_output(state)
        # 1/9 failed < 20% → partial
        assert out["status"] == "partial"

    def test_all_buckets_included_in_output(self):
        state = _state(
            locked=[_subj(1)],
            resolved=[_subj(2)],
            unresolvable=[_subj(3)],
            manual_review=[_subj(4)],
        )
        out = format_output(state)
        assert len(out["locked"]) == 1
        assert len(out["resolved"]) == 1
        assert len(out["unresolvable"]) == 1
        assert len(out["manual_review"]) == 1

    def test_valid_json_serializable(self):
        state = _state(resolved=[_subj(1)])
        out = format_output(state)
        serialized = json.dumps(out)
        parsed = json.loads(serialized)
        assert parsed["status"] == "success"

    def test_raises_if_count_mismatch(self):
        # Construct a state where total_count != len(original_input_ids)
        # by manually setting original_input_ids to a larger value
        state = _state(resolved=[_subj(1)])
        state.original_input_ids = [1, 2, 3]  # claims 3 inputs but only 1 in buckets
        with pytest.raises(ValueError, match="Census mismatch"):
            format_output(state)
