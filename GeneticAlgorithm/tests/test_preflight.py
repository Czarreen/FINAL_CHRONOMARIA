"""Tests for sched/flow/preflight.py."""
import pytest
from sched.flow.preflight import (
    run_preflight, classify_subject_type, classify_subject_state, detect_merge_groups
)
from sched.models.subject import Subject, SubjectType, SubjectState, SubjectTag


def _make_subject(curr_id: int, course_no: str = "ENG 1", section: str = "1A",
                  mth_schedule=None, mth_room=None, merged_with=None,
                  is_general=None, department_id: str = "CE") -> Subject:
    return Subject(
        curr_id=curr_id, code=str(curr_id), course_no=course_no,
        department_id=department_id, section=section,
        descriptive_title="Test Subject", units=3, lec_hrs=3, lab_hrs=0,
        mth_schedule=mth_schedule, mth_room=mth_room, merged_with=merged_with,
        is_general=is_general,
    )


class TestClassifySubjectType:
    def test_general_prefix_g(self):
        s = _make_subject(1, course_no="G 101 Mathematics")
        assert classify_subject_type(s) == SubjectType.GENERAL

    def test_general_nstp(self):
        s = _make_subject(2, course_no="NSTP 1")
        assert classify_subject_type(s) == SubjectType.GENERAL

    def test_general_path_fit(self):
        s = _make_subject(3, course_no="PATH FIT 1")
        assert classify_subject_type(s) == SubjectType.GENERAL

    def test_general_cfe(self):
        s = _make_subject(4, course_no="CFE 101")
        assert classify_subject_type(s) == SubjectType.GENERAL

    def test_merged_subject(self):
        s = _make_subject(5, course_no="ENG 1", merged_with="CS 1A")
        assert classify_subject_type(s) == SubjectType.MERGED

    def test_regular_subject(self):
        s = _make_subject(6, course_no="ENG 1")
        assert classify_subject_type(s) == SubjectType.REGULAR

    def test_is_general_flag_true_overrides_pattern(self):
        s = _make_subject(7, course_no="ENG 1", is_general=True)
        assert classify_subject_type(s) == SubjectType.GENERAL

    def test_is_general_flag_false_skips_regex(self):
        s = _make_subject(8, course_no="G 101 Math", is_general=False)
        assert classify_subject_type(s) == SubjectType.REGULAR

    def test_is_general_false_merged_still_merged(self):
        s = _make_subject(9, course_no="G 101 Math", is_general=False, merged_with="CS 1A")
        assert classify_subject_type(s) == SubjectType.MERGED


class TestClassifySubjectState:
    def test_empty_both_null(self):
        s = _make_subject(1)
        assert classify_subject_state(s) == SubjectState.EMPTY

    def test_scheduled_mth_only(self):
        s = _make_subject(1, mth_schedule="1:00-2:30", mth_room="R101")
        assert classify_subject_state(s) == SubjectState.SCHEDULED

    def test_scheduled_tfs_only(self):
        s = Subject(
            curr_id=2, code="2", course_no="ENG 1", department_id="CE",
            section="1A", descriptive_title="T", units=3, lec_hrs=3, lab_hrs=0,
            tfs_schedule="1:00-2:30", tfs_room="R101",
        )
        assert classify_subject_state(s) == SubjectState.SCHEDULED

    def test_scheduled_both(self):
        s = Subject(
            curr_id=3, code="3", course_no="ENG 1", department_id="CE",
            section="1A", descriptive_title="T", units=3, lec_hrs=3, lab_hrs=0,
            mth_schedule="7:30-9:00", mth_room="R101",
            tfs_schedule="1:00-2:30", tfs_room="R101",
        )
        assert classify_subject_state(s) == SubjectState.SCHEDULED


class TestRunPreflight:
    def test_general_scheduled_goes_to_locked(self):
        s = _make_subject(1, course_no="NSTP 1", mth_schedule="7:30-9:00", mth_room="R101")
        state = run_preflight([s])
        assert len(state.locked) == 1
        assert state.locked[0].curr_id == 1
        assert state.locked[0].tag == SubjectTag.GENERAL

    def test_general_empty_goes_to_manual_review(self):
        s = _make_subject(1, course_no="NSTP 1")
        state = run_preflight([s])
        assert len(state.manual_review) == 1
        assert state.manual_review[0].curr_id == 1
        assert state.manual_review[0].tag == SubjectTag.MANUAL_REVIEW

    def test_regular_empty_goes_to_pending(self):
        s = _make_subject(1, course_no="ENG 1")
        state = run_preflight([s])
        assert len(state.pending) == 1
        assert state.pending[0].curr_id == 1

    def test_regular_scheduled_goes_to_pending(self):
        s = _make_subject(1, course_no="ENG 1", mth_schedule="7:30-9:00", mth_room="R101")
        state = run_preflight([s])
        assert len(state.pending) == 1

    def test_total_count_matches_input(self):
        subjects = [
            _make_subject(1, course_no="NSTP 1", mth_schedule="7:30-9:00", mth_room="R101"),
            _make_subject(2, course_no="NSTP 1"),
            _make_subject(3, course_no="ENG 1", mth_schedule="7:30-9:00", mth_room="R101"),
            _make_subject(4, course_no="ENG 2"),
        ]
        state = run_preflight(subjects)
        assert state.total_count() == 4
        assert len(state.original_input_ids) == 4

    def test_merged_all_scheduled_goes_to_merged_groups(self):
        s1 = _make_subject(1, course_no="CS 1", department_id="CS", section="1A",
                           mth_schedule="7:30-9:00", mth_room="R101", merged_with="CS 1B")
        s2 = _make_subject(2, course_no="CS 1", department_id="CS", section="1B",
                           mth_schedule="7:30-9:00", mth_room="R101", merged_with="CS 1A")
        state = run_preflight([s1, s2])
        assert len(state.merged_groups) == 1
        assert len(state.merged_groups[0].members) == 2
        assert len(state.pending) == 0
        assert state.total_count() == 2

    def test_merged_any_empty_goes_to_pending(self):
        s1 = _make_subject(1, course_no="CS 1", department_id="CS", section="1A",
                           mth_schedule="7:30-9:00", mth_room="R101", merged_with="CS 1B")
        s2 = _make_subject(2, course_no="CS 1", department_id="CS", section="1B",
                           merged_with="CS 1A")  # empty schedule
        state = run_preflight([s1, s2])
        assert len(state.merged_groups) == 0
        assert len(state.pending) == 2
        assert state.total_count() == 2

    def test_census_preserved_after_preflight(self, small_master_list):
        subjects_data = small_master_list.get("subjects", [])
        if not subjects_data:
            pytest.skip("small_master_list fixture is empty; populate before running")
        from sched.io.parser import parse_input
        subjects, _, _ = parse_input({"subjects": subjects_data})
        state = run_preflight(subjects)
        assert state.total_count() == len(subjects)
