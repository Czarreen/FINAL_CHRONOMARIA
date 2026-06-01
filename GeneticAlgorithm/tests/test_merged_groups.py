"""Tests for MergeGroup model + detect_merge_groups (Step 5)."""
import pytest
from sched.models.merge_group import MergeGroup


# MergeGroup model tests (Step 2)

class TestMergeGroupModel:
    def _group(self, members):
        return MergeGroup(group_id="g1", members=members, is_pre_existing=True)

    def test_all_scheduled_true(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30", "mth_room": "R1"},
            {"mth_schedule": "1:00-2:30", "mth_room": "R1"},
        ])
        assert g.all_scheduled()

    def test_all_scheduled_false_if_any_empty(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30", "mth_room": "R1"},
            {"mth_schedule": None, "tfs_schedule": None},
        ])
        assert not g.all_scheduled()

    def test_any_empty_true(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30"},
            {},
        ])
        assert g.any_empty()

    def test_any_empty_false(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30"},
            {"mth_schedule": "1:00-2:30"},
        ])
        assert not g.any_empty()

    def test_shared_schedule_consistent(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30"},
            {"mth_schedule": "1:00-2:30"},
        ])
        assert g.shared_schedule() == "1:00-2:30"

    def test_shared_schedule_inconsistent(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30"},
            {"mth_schedule": "3:00-4:30"},
        ])
        assert g.shared_schedule() is None

    def test_validate_still_merged_true(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30", "mth_room": "R1",
             "tfs_schedule": None, "tfs_room": None},
            {"mth_schedule": "1:00-2:30", "mth_room": "R1",
             "tfs_schedule": None, "tfs_room": None},
        ])
        assert g.validate_still_merged()

    def test_validate_still_merged_false(self):
        g = self._group([
            {"mth_schedule": "1:00-2:30", "mth_room": "R1",
             "tfs_schedule": None, "tfs_room": None},
            {"mth_schedule": "3:00-4:30", "mth_room": "R1",
             "tfs_schedule": None, "tfs_room": None},
        ])
        assert not g.validate_still_merged()


# detect_merge_groups tests — filled in Step 5 (test_preflight.py covers them)
class TestDetectMergeGroups:
    def test_simple_section_code(self): pass
    def test_numeric_code(self): pass
    def test_space_separated_refs(self): pass
    def test_comma_separated_refs(self): pass
    def test_numeric_typo_ignored(self): pass
    def test_groups_all_members_present(self, small_master_list): pass
    def test_census_preserved(self, small_master_list): pass
