"""Tests for sched/conflict/intervals.py."""
import pytest
from sched.conflict.intervals import parse_time, parse_time_range, overlaps, strip_day_overrides


class TestParseTime:
    def test_simple_hour(self):
        assert parse_time("9:00") == 540

    def test_half_hour(self):
        assert parse_time("13:30") == 810

    def test_raw_one_am(self):
        # parse_time returns RAW minutes — no PM adjustment
        assert parse_time("1:00") == 60

    def test_no_minutes(self):
        assert parse_time("8") == 480

    def test_strips_am_pm(self):
        assert parse_time("9:00 AM") == 540
        assert parse_time("1:00 PM") == 780


class TestParseTimeRange:
    def test_afternoon_range_gets_pm_shift(self):
        # "1:00-2:30" — start < 7 AM threshold -> both shifted to PM
        start, end = parse_time_range("1:00-2:30")
        assert start == 780   # 1:00 PM
        assert end == 870     # 2:30 PM

    def test_morning_range_no_shift(self):
        start, end = parse_time_range("9:00-10:30")
        assert start == 540
        assert end == 630

    def test_range_crossing_noon(self):
        # 11:00 AM to 1:00 PM: start=660, raw_end=60, end <= start -> end += 720
        start, end = parse_time_range("11:00-1:00")
        assert start == 660
        assert end == 780

    def test_7_30_start(self):
        start, end = parse_time_range("7:30-10:30")
        assert start == 450
        assert end == 630

    def test_en_dash_separator(self):
        start, end = parse_time_range("1:00–2:30")
        assert start == 780
        assert end == 870

    def test_malformed_raises(self):
        with pytest.raises(ValueError):
            parse_time_range("not-a-time")

    def test_too_late_raises(self):
        # 9:00 PM start -> raw 21:00 = 1260 > SCHED_END_MAX 1200 -> ValueError
        with pytest.raises(ValueError):
            parse_time_range("9:00 PM-10:00 PM")


class TestOverlaps:
    def test_no_overlap(self):
        assert not overlaps(540, 630, 660, 780)

    def test_partial_overlap(self):
        # "1:00-2:30" vs "1:30-3:00" -> overlap
        assert overlaps(780, 870, 810, 900)

    def test_exact_match(self):
        assert overlaps(780, 870, 780, 870)

    def test_one_contains_other(self):
        assert overlaps(780, 960, 810, 870)

    def test_back_to_back_no_overlap(self):
        # a_end == b_start -> NOT a conflict
        assert not overlaps(780, 870, 870, 960)


class TestStripDayOverrides:
    def test_no_override(self):
        time_part, overrides = strip_day_overrides("1:00-3:00")
        assert time_part == "1:00-3:00"
        assert overrides == []

    def test_single_day(self):
        time_part, overrides = strip_day_overrides("1:00-3:00 M")
        assert time_part == "1:00-3:00"
        assert overrides == ["M"]

    def test_lab_lec_split(self):
        time_part, overrides = strip_day_overrides("1:30-4:30 F Lab, T Lec")
        assert time_part == "1:30-4:30"
        assert "F:Lab" in overrides
        assert "T:Lec" in overrides

    def test_saturday(self):
        time_part, overrides = strip_day_overrides("1:30-3:00 Sat")
        assert time_part == "1:30-3:00"
        assert overrides == ["Sat"]

    def test_split_session_no_override(self):
        # Two time ranges, no day codes -> both times kept, no overrides
        time_part, overrides = strip_day_overrides("7:30-10:30, 11:00-1:00")
        assert "7:30-10:30" in time_part
        assert "11:00-1:00" in time_part
        assert overrides == []

    def test_tuesday_only(self):
        time_part, overrides = strip_day_overrides("4:30-6:00 T")
        assert time_part == "4:30-6:00"
        assert overrides == ["T"]
