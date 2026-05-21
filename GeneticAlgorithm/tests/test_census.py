"""Tests for sched/flow/census.py -- the silent-drop prevention."""
import pytest
# TODO: from sched.flow.census import assert_invariant, CensusViolationError


def test_359_in_359_out(full_master_list_359):
    """The bug: 359 in must equal 359 across all buckets at every stage."""
    # TODO: load, run preflight, assert total_count == 359
    pass


def test_raises_on_drop():
    """Manually construct a state missing a subject -- must raise."""
    # TODO
    pass


def test_raises_on_duplicate():
    """Manually construct a state with same subject in two buckets -- must raise."""
    # TODO
    pass
