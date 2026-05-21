"""Tests for sched/conflict/intervals.py."""
import pytest
# TODO: from sched.conflict.intervals import parse_time, parse_time_range, overlaps, strip_day_overrides


class TestParseTime:
    def test_simple_hour(self): pass           # "9:00" -> 540
    def test_half_hour(self): pass             # "13:30" -> 810
    def test_pm_assumption(self): pass         # "1:00" in schedule context

class TestParseTimeRange:
    def test_simple_range(self): pass          # "1:00-2:30"
    def test_range_crossing_noon(self): pass

class TestOverlaps:
    def test_no_overlap(self): pass
    def test_partial_overlap(self): pass
    def test_exact_match(self): pass
    def test_back_to_back(self): pass          # not a conflict: a_end == b_start

class TestStripDayOverrides:
    def test_no_override(self): pass           # "1:00-3:00" -> ("1:00-3:00", [])
    def test_single_day(self): pass            # "1:00-3:00 M" -> ("1:00-3:00", ["M"])
    def test_lab_lec_split(self): pass         # "1:30-4:30 F Lab, T Lec"
    def test_saturday(self): pass              # "1:30-3:00 Sat"
    def test_split_session(self): pass         # "7:30-10:30, 11:00-1:00"
