"""Integration tests for ParsedSchedule.parse() — spec compliance."""
import pytest
from sched.models.schedule import ParsedSchedule, DayPattern, Day


class TestParsedScheduleParse:
    def test_wednesday_rejected(self):
        ps = ParsedSchedule.parse("1:30-4:30 W", DayPattern.MTH)
        assert ps.blocks == []

    def test_slash_separator(self):
        ps = ParsedSchedule.parse("7:30-10:30 M Lec/7:30-10:30 Th Lab", DayPattern.MTH)
        days = {b.day for b in ps.blocks}
        assert Day.MON in days and Day.THU in days
        assert len(ps.blocks) == 2
        assert all(b.start_minutes == 450 and b.end_minutes == 630 for b in ps.blocks)

    def test_date_annotation_with_saturday_propagation(self):
        # "(Jan 20-..)" dropped; trailing "Sat" propagates to both segments
        ps = ParsedSchedule.parse("5:30-8:30, 11:00-2:00 Sat (Jan 20-..)", DayPattern.TFS)
        assert len(ps.blocks) == 2
        assert all(b.day == Day.SAT for b in ps.blocks)

    def test_semicolon_fix_end_to_end(self):
        # "4;30" -> "4:30" -> 4:30 PM = 990; "6:00" -> 6:00 PM = 1080
        ps = ParsedSchedule.parse("4;30-6:00", DayPattern.TFS)
        assert len(ps.blocks) == 2  # T and F
        assert all(b.start_minutes == 990 and b.end_minutes == 1080 for b in ps.blocks)

    def test_saturday_both_segments_get_tag(self):
        # One tagged segment ("1:00-3:00 Saturday") + one untagged -> Sat propagates
        ps = ParsedSchedule.parse("9:00-12:00,1:00-3:00 Saturday", DayPattern.MTH)
        assert len(ps.blocks) == 2
        assert all(b.day == Day.SAT for b in ps.blocks)
        starts = {b.start_minutes for b in ps.blocks}
        assert 540 in starts  # 9:00 AM
        assert 780 in starts  # 1:00 PM

    def test_garbage_returns_empty(self):
        ps = ParsedSchedule.parse("`", DayPattern.MTH)
        assert ps.blocks == []

    def test_no_tag_uses_default_mth(self):
        # No overrides: both time segments expand to M and Th
        ps = ParsedSchedule.parse("7:30-10:30, 11:00-1:00", DayPattern.MTH)
        assert len(ps.blocks) == 4  # 2 times x 2 days
        days = {b.day for b in ps.blocks}
        assert days == {Day.MON, Day.THU}

    def test_no_tag_uses_default_tfs(self):
        # No overrides: TFS default is T and F (not Saturday)
        ps = ParsedSchedule.parse("7:30-10:30, 11:00-1:00", DayPattern.TFS)
        assert len(ps.blocks) == 4
        days = {b.day for b in ps.blocks}
        assert days == {Day.TUE, Day.FRI}

    def test_saturday_evening_class(self):
        # 5:30 PM - 8:30 PM = 1050 - 1230; previously rejected by old SCHED_END_MAX
        ps = ParsedSchedule.parse("5:30-8:30 Sat", DayPattern.TFS)
        assert len(ps.blocks) == 1
        assert ps.blocks[0].day == Day.SAT
        assert ps.blocks[0].start_minutes == 1050
        assert ps.blocks[0].end_minutes == 1230

    def test_trailing_comma_single_segment(self):
        # Trailing comma must not create a phantom second segment
        ps = ParsedSchedule.parse("1:30-4:30 T Lab,", DayPattern.TFS)
        assert len(ps.blocks) == 1
        assert ps.blocks[0].day == Day.TUE
