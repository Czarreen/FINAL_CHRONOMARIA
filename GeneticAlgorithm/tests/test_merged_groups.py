"""Tests for merge group detection (sched/flow/preflight.py detect_merge_groups)."""
import pytest
# TODO: from sched.flow.preflight import detect_merge_groups


class TestDetectMergeGroups:
    def test_simple_section_code(self): pass       # merged_with = "CS 4"
    def test_numeric_code(self): pass              # merged_with = "4754"
    def test_space_separated_refs(self): pass      # merged_with = "IT 2B LIS 2A"
    def test_comma_separated_refs(self): pass      # merged_with = '"IT 2B, CS 2A"'
    def test_numeric_typo_ignored(self): pass      # merged_with = "40" or "10"
    def test_groups_all_members_present(self, small_master_list): pass
    def test_census_preserved(self, small_master_list): pass
