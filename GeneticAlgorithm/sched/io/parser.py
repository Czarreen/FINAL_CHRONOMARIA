"""
Parse JSON input from Node into Pydantic models.

Input contract (from Backend/node-api/src/controllers/gaController.js):
{
  "subjects": [...],
  "rooms": [...],
  "constraints": {"max_iterations": 50, ...}
}
"""

import json
from typing import List, Tuple, Union

from sched.models.subject import Subject
from sched.models.room import Room


def parse_input(
    raw_json: Union[str, dict]
) -> Tuple[List[Subject], List[Room], dict]:
    """
    Parse raw JSON (string or dict) into typed Python objects.

    Returns (subjects, rooms, constraints).
    Pydantic raises ValidationError on malformed subject/room data.
    Raises ValueError on missing required top-level keys.
    """
    if isinstance(raw_json, str):
        raw_json = json.loads(raw_json)

    if 'subjects' not in raw_json:
        raise ValueError("Input JSON must contain a 'subjects' key")

    subjects_raw = raw_json['subjects']
    if not isinstance(subjects_raw, list):
        raise ValueError("'subjects' must be a list")

    subjects: List[Subject] = [Subject(**s) for s in subjects_raw]
    rooms: List[Room] = [Room(**r) for r in raw_json.get('rooms', [])]
    constraints: dict = raw_json.get('constraints', {}) or {}

    return (subjects, rooms, constraints)
