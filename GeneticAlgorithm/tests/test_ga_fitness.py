"""Tests for sched/ga/fitness.py."""
import pytest
from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.fitness import evaluate, count_hard_conflicts, soft_score
from sched.ga.common import SCHED_START_MIN


def _subj(curr_id, section="1A", dept="CE", lec=3.0, lab=0.0, course_no="ENG 1"):
    return Subject(
        curr_id=curr_id, code=str(curr_id), course_no=course_no,
        department_id=dept, section=section,
        descriptive_title="Test", units=3, lec_hrs=lec, lab_hrs=lab,
    )


def _room(room_id, room_type="LEC"):
    return Room(room_id=room_id, room_name=f"Room {room_id}", room_type=room_type)


class TestCountHardConflicts:
    def test_no_conflicts(self):
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1"), _room("R2")]
        # Two different sections, different rooms, same time — no conflict
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 1, 1)]
        assert count_hard_conflicts(chrom, subjects, rooms) == 0

    def test_room_conflict(self):
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1")]
        # Both subjects use same room at same time on same day
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 0, 0)]
        assert count_hard_conflicts(chrom, subjects, rooms) > 0

    def test_section_conflict(self):
        # Same section scheduled twice at overlapping times
        subjects = [_subj(1, section="1A"), _subj(2, section="1A")]
        rooms    = [_room("R1"), _room("R2")]
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 1, 1)]
        assert count_hard_conflicts(chrom, subjects, rooms) > 0

    def test_compound_room_no_conflict_different_times(self):
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1"), _room("R2")]
        # Different start times — no room conflict
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN + 90, 0, 0)]
        assert count_hard_conflicts(chrom, subjects, rooms) == 0


class TestEvaluate:
    def test_hard_conflict_returns_neg_inf(self):
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1")]
        # Same room, same time → hard conflict
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 0, 0)]
        result = evaluate(chrom, subjects=subjects, rooms=rooms)
        assert result == (float('-inf'),)

    def test_clean_individual_returns_positive(self):
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1"), _room("R2")]
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 1, 1)]
        result = evaluate(chrom, subjects=subjects, rooms=rooms)
        assert isinstance(result, tuple)
        assert len(result) == 1
        assert result[0] > 0

    def test_tuple_output(self):
        subjects = [_subj(1)]
        rooms    = [_room("R1")]
        chrom = [(0, SCHED_START_MIN, 0, 0)]
        result = evaluate(chrom, subjects=subjects, rooms=rooms)
        assert isinstance(result, tuple)
        assert len(result) == 1

    def test_earlier_time_scores_higher(self):
        subjects = [_subj(1, section="1A")]
        rooms    = [_room("R1")]
        early = evaluate([(0, SCHED_START_MIN,       0, 0)], subjects=subjects, rooms=rooms)
        late  = evaluate([(0, SCHED_START_MIN + 300, 0, 0)], subjects=subjects, rooms=rooms)
        # Early start has lower soft penalty → higher fitness
        assert early[0] >= late[0]


class TestSoftScore:
    def test_returns_float(self):
        subjects = [_subj(1)]
        rooms    = [_room("R1")]
        chrom = [(0, SCHED_START_MIN, 0, 0)]
        score = soft_score(chrom, subjects, rooms)
        assert isinstance(score, float)

    def test_higher_is_better(self):
        subjects = [_subj(1, section="1A")]
        rooms    = [_room("R1")]
        # Early time → lower penalty → higher score
        s1 = soft_score([(0, SCHED_START_MIN,       0, 0)], subjects, rooms)
        s2 = soft_score([(0, SCHED_START_MIN + 300, 0, 0)], subjects, rooms)
        assert s1 >= s2
