"""Tests for sched/ga/operators.py."""
import random
import pytest
from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.operators import crossover_two_point_grouped, mutate_reschedule
from sched.ga.common import SCHED_START_MIN


def _subj(curr_id, section="1A", dept="CE", lec=3.0, lab=0.0):
    return Subject(
        curr_id=curr_id, code=str(curr_id), course_no="ENG 1",
        department_id=dept, section=section,
        descriptive_title="Test", units=3, lec_hrs=lec, lab_hrs=lab,
    )


def _room(room_id, room_type="LEC"):
    return Room(room_id=room_id, room_name=f"Room {room_id}", room_type=room_type)


def _chrom(n, start=SCHED_START_MIN):
    return [(0, start, i % 2, i % 2) for i in range(n)]


class TestCrossoverTwoPointGrouped:
    def test_output_same_length(self):
        subjects = [_subj(i, section=f"{i}A") for i in range(6)]
        rng = random.Random(42)
        ind1 = _chrom(6)
        ind2 = _chrom(6, start=SCHED_START_MIN + 60)
        c1, c2 = crossover_two_point_grouped(ind1, ind2, subjects=subjects, rng=rng)
        assert len(c1) == 6
        assert len(c2) == 6

    def test_all_genes_present(self):
        subjects = [_subj(i, section=f"{i}A") for i in range(4)]
        rng = random.Random(0)
        ind1 = [(0, SCHED_START_MIN + i * 30, 0, 0) for i in range(4)]
        ind2 = [(1, SCHED_START_MIN + i * 30, 1, 1) for i in range(4)]
        c1, c2 = crossover_two_point_grouped(ind1, ind2, subjects=subjects, rng=rng)
        # Each gene in each child should come from either ind1 or ind2 at that index
        for i in range(4):
            assert c1[i] in (ind1[i], ind2[i])
            assert c2[i] in (ind1[i], ind2[i])

    def test_merged_group_not_split(self):
        # Two subjects in the same section — must be swapped together
        subjects = [_subj(0, section="1A"), _subj(1, section="1A"), _subj(2, section="2A")]
        rng = random.Random(123)
        ind1 = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 1, 1)]
        ind2 = [(1, SCHED_START_MIN + 90, 1, 1), (1, SCHED_START_MIN + 90, 1, 1), (1, SCHED_START_MIN, 0, 0)]
        # Run many times — section "1A" genes at indices 0,1 should always be from same parent
        for seed in range(20):
            rng = random.Random(seed)
            c1, _ = crossover_two_point_grouped(ind1, ind2, subjects=subjects, rng=rng)
            # Indices 0 and 1 are in same section — must come from same parent
            assert (c1[0] == ind1[0]) == (c1[1] == ind1[1])

    def test_does_not_mutate_originals(self):
        subjects = [_subj(i, section=f"{i}A") for i in range(4)]
        rng = random.Random(0)
        ind1 = _chrom(4)
        ind2 = _chrom(4, start=SCHED_START_MIN + 60)
        orig1 = list(ind1)
        orig2 = list(ind2)
        crossover_two_point_grouped(ind1, ind2, subjects=subjects, rng=rng)
        assert ind1 == orig1
        assert ind2 == orig2


class TestMutateReschedule:
    def test_output_same_length(self):
        subjects = [_subj(i) for i in range(5)]
        rooms    = [_room("R1"), _room("R2")]
        rng = random.Random(0)
        ind = _chrom(5)
        result = mutate_reschedule(ind, subjects=subjects, rooms=rooms, rng=rng, mutation_rate=1.0)
        assert len(result) == 5

    def test_does_not_mutate_original(self):
        subjects = [_subj(0)]
        rooms    = [_room("R1")]
        rng = random.Random(0)
        ind = [(0, SCHED_START_MIN, 0, 0)]
        orig = list(ind)
        mutate_reschedule(ind, subjects=subjects, rooms=rooms, rng=rng, mutation_rate=1.0)
        assert ind == orig

    def test_mutation_applied_at_rate(self):
        subjects = [_subj(i, section=f"{i}A") for i in range(20)]
        rooms    = [_room("R1"), _room("R2")]
        rng = random.Random(42)
        ind = _chrom(20)
        result = mutate_reschedule(ind, subjects=subjects, rooms=rooms, rng=rng, mutation_rate=0.0)
        assert result == ind  # rate=0 → no mutations

    def test_high_mutation_rate_changes_some(self):
        subjects = [_subj(i, section=f"{i}A") for i in range(10)]
        rooms    = [_room("R1"), _room("R2"), _room("R3")]
        rng = random.Random(7)
        ind = _chrom(10)
        result = mutate_reschedule(ind, subjects=subjects, rooms=rooms, rng=rng, mutation_rate=1.0)
        # With rate=1.0, at least one gene should change
        assert any(result[i] != ind[i] for i in range(10))
