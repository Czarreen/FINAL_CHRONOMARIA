"""Tests for sched/io/parser.py."""
import pytest
# TODO: from sched.io.parser import parse_input


class TestParseInput:
    def test_valid_input(self): pass
    def test_missing_subjects_key_raises(self): pass
    def test_malformed_curr_id_raises(self): pass
    def test_null_code_allowed(self): pass          # NSTP placeholder
    def test_null_schedule_allowed(self): pass
    def test_returns_correct_types(self): pass       # (List[Subject], List[Room], dict)
