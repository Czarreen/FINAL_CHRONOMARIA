"""Tests for sched/io/parser.py."""
import pytest
import json
from pydantic import ValidationError

from sched.io.parser import parse_input
from sched.models.subject import Subject
from sched.models.room import Room


_VALID_SUBJECT = {
    "curr_id": 945,
    "code": "4065",
    "course_no": "Eng Math 2",
    "department_id": "CE",
    "section": "1A",
    "descriptive_title": "Engineering Data Analysis",
    "units": 3,
    "lec_hrs": 3,
    "lab_hrs": 0,
    "mth_schedule": "1:00-2:30",
    "mth_room": "1200/1195",
    "tfs_schedule": None,
    "tfs_room": None,
    "merged_with": None,
}

_VALID_ROOM = {
    "room_id": "1200",
    "room_name": "Room 1200",
}


class TestParseInput:
    def test_valid_input(self):
        payload = {"subjects": [_VALID_SUBJECT], "rooms": [_VALID_ROOM], "constraints": {}}
        subjects, rooms, constraints = parse_input(payload)
        assert len(subjects) == 1
        assert subjects[0].curr_id == 945

    def test_valid_input_as_json_string(self):
        payload_str = json.dumps({"subjects": [_VALID_SUBJECT], "rooms": []})
        subjects, rooms, constraints = parse_input(payload_str)
        assert len(subjects) == 1

    def test_missing_subjects_key_raises(self):
        with pytest.raises(ValueError, match="subjects"):
            parse_input({"rooms": []})

    def test_malformed_curr_id_raises(self):
        bad = dict(_VALID_SUBJECT, curr_id="not-an-int")
        with pytest.raises((ValidationError, ValueError)):
            parse_input({"subjects": [bad]})

    def test_null_code_allowed(self):
        nstp = dict(_VALID_SUBJECT, curr_id=999, code=None, course_no="NSTP 1")
        subjects, _, _ = parse_input({"subjects": [nstp]})
        assert subjects[0].code is None

    def test_null_schedule_allowed(self):
        empty = dict(_VALID_SUBJECT, curr_id=998, mth_schedule=None, tfs_schedule=None)
        subjects, _, _ = parse_input({"subjects": [empty]})
        assert subjects[0].mth_schedule is None

    def test_returns_correct_types(self):
        payload = {"subjects": [_VALID_SUBJECT], "rooms": [_VALID_ROOM]}
        subjects, rooms, constraints = parse_input(payload)
        assert all(isinstance(s, Subject) for s in subjects)
        assert all(isinstance(r, Room) for r in rooms)
        assert isinstance(constraints, dict)

    def test_empty_rooms_allowed(self):
        subjects, rooms, _ = parse_input({"subjects": [_VALID_SUBJECT]})
        assert rooms == []

    def test_empty_string_normalized_to_none(self):
        subject_with_empty = dict(_VALID_SUBJECT, curr_id=997, mth_schedule="", mth_room="")
        subjects, _, _ = parse_input({"subjects": [subject_with_empty]})
        assert subjects[0].mth_schedule is None
        assert subjects[0].mth_room is None
