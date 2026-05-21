"""Tests for sched/conflict/room_sets.py."""
import pytest
# TODO: from sched.conflict.room_sets import expand_room_string, rooms_conflict


class TestExpandRoomString:
    def test_none_input(self): pass            # None -> set()
    def test_empty_string(self): pass          # "" -> set()
    def test_single_room(self): pass           # "E301" -> {"E301"}
    def test_compound_room(self): pass         # "E301/E401" -> {"E301", "E401"}
    def test_whitespace_trimmed(self): pass    # " E301 / E401 " -> {"E301", "E401"}


class TestRoomsConflict:
    def test_same_room(self): pass
    def test_different_rooms(self): pass
    def test_compound_overlaps_simple(self): pass   # "1200/1195" vs "1200"
    def test_none_vs_room(self): pass               # None vs "E301" -> False
    def test_none_vs_none(self): pass               # None vs None -> False
