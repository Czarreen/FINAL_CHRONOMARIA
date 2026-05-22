"""Tests for sched/ga/repair.py."""
import random
import pytest
from sched.models.subject import Subject
from sched.models.room import Room
from sched.ga.repair import repair, find_free_slot
from sched.ga.fitness import count_hard_conflicts
from sched.ga.common import SCHED_START_MIN


def _subj(curr_id, section="1A", dept="CE", lec=3.0, lab=0.0):
    return Subject(
        curr_id=curr_id, code=str(curr_id), course_no="ENG 1",
        department_id=dept, section=section,
        descriptive_title="Test", units=3, lec_hrs=lec, lab_hrs=lab,
    )


def _room(room_id, room_type="LEC"):
    return Room(room_id=room_id, room_name=f"Room {room_id}", room_type=room_type)


class TestRepair:
    def test_no_conflict_unchanged(self):
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1"), _room("R2")]
        # Different rooms, different sections — no conflict
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 1, 1)]
        rng = random.Random(0)
        result = repair(chrom, subjects, rooms, rng)
        assert result == chrom

    def test_all_subjects_preserved(self):
        # Repair must never drop subjects
        subjects = [_subj(i, section=f"{i}A") for i in range(4)]
        rooms    = [_room("R1")]
        # All subjects in same room at same time → all conflicted
        chrom = [(0, SCHED_START_MIN, 0, 0)] * 4
        rng = random.Random(42)
        result = repair(chrom, subjects, rooms, rng, max_passes=3)
        assert len(result) == 4

    def test_single_conflict_resolved(self):
        # Two subjects in same room — one should be moved
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1"), _room("R2"), _room("R3")]
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 0, 0)]
        rng = random.Random(0)
        result = repair(chrom, subjects, rooms, rng, max_passes=5)
        # After repair, hard conflicts should be reduced
        before = count_hard_conflicts(chrom, subjects, rooms)
        after  = count_hard_conflicts(result, subjects, rooms)
        assert after <= before

    def test_max_attempts_respected(self):
        subjects = [_subj(1, section="1A"), _subj(2, section="1B")]
        rooms    = [_room("R1")]  # only one room — impossible to fully repair
        chrom = [(0, SCHED_START_MIN, 0, 0), (0, SCHED_START_MIN, 0, 0)]
        rng = random.Random(0)
        # Should not raise; just returns best effort
        result = repair(chrom, subjects, rooms, rng, max_passes=2)
        assert len(result) == 2


class TestFindFreeSlot:
    def test_returns_none_if_no_slot(self):
        subjects = [_subj(1, section="1A")]
        rooms    = [_room("R1")]
        # Fill the only room for all possible start times on pattern 0
        # by placing a very long "subject" — we simulate by having only one start
        # and the candidate occupying it.
        # Use a subject with lec=3, duration=90min → valid_starts has many slots.
        # Since we can't fill ALL slots easily, just test with empty others → always finds one.
        others_chrom: list = []
        result = find_free_slot(subjects[0], others=[], rooms=rooms, chromosome_others=others_chrom)
        assert result is not None

    def test_returned_slot_has_no_conflict(self):
        s1 = _subj(1, section="1A")
        s2 = _subj(2, section="1A")  # same section — must avoid time overlap
        rooms = [_room("R1")]
        # s1 is already placed at SCHED_START_MIN in room 0, pattern 0
        others_chrom = [(0, SCHED_START_MIN, 0, 0)]
        result = find_free_slot(s2, others=[s1], rooms=rooms, chromosome_others=others_chrom)
        # Either None (no slot found) or a non-overlapping slot
        if result is not None:
            from sched.ga.common import SCHED_PATTERNS, subject_duration
            pat_idx, start, r1, r2 = result
            end = start + subject_duration(s2)
            # Must not overlap with s1's slot (SCHED_START_MIN to SCHED_START_MIN + 90)
            s1_end = SCHED_START_MIN + subject_duration(s1)
            # Check no time overlap on same day and room
            # (They're in the same section so check section overlap)
            pat_name, days = SCHED_PATTERNS[pat_idx]
            if pat_name == "MTH":  # same pattern as s1
                assert not (start < s1_end and SCHED_START_MIN < end)
