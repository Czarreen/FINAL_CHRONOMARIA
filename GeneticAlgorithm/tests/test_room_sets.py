"""Tests for sched/conflict/room_sets.py."""
import pytest
from sched.conflict.room_sets import expand_room_string, rooms_conflict


class TestExpandRoomString:
    def test_none_input(self):
        assert expand_room_string(None) == set()

    def test_empty_string(self):
        assert expand_room_string("") == set()

    def test_single_room(self):
        assert expand_room_string("E301") == {"E301"}

    def test_compound_room(self):
        assert expand_room_string("E301/E401") == {"E301", "E401"}

    def test_whitespace_trimmed(self):
        assert expand_room_string(" E301 / E401 ") == {"E301", "E401"}

    def test_numeric_room_ids(self):
        assert expand_room_string("1200/1195") == {"1200", "1195"}


class TestRoomsConflict:
    def test_same_room(self):
        assert rooms_conflict("E301", "E301")

    def test_different_rooms(self):
        assert not rooms_conflict("E301", "E401")

    def test_compound_overlaps_simple(self):
        assert rooms_conflict("1200/1195", "1200")

    def test_none_vs_room(self):
        assert not rooms_conflict(None, "E301")

    def test_none_vs_none(self):
        assert not rooms_conflict(None, None)

    def test_compound_vs_compound_overlap(self):
        assert rooms_conflict("E301/E401", "E401/E501")

    def test_compound_vs_compound_no_overlap(self):
        assert not rooms_conflict("E301/E401", "E501/E601")
