"""
Parse JSON input from Node into Pydantic models.

Input contract (from Backend/node-api/src/controllers/gaController.js):
{
  "subjects": [
    {
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
      "tfs_schedule": null,
      "tfs_room": null,
      "merged_with": null
    }
  ],
  "rooms": [...],
  "constraints": {
    "max_iterations": 50,
    "timeslots": {...},
    "days": ["M","T","W","Th","F","Sat"]
  }
}

Imports:
    import json
    from typing import Dict, List
    from sched.models.subject import Subject
    from sched.models.room import Room
"""

import json
from typing import Dict, List, Tuple, Union
from sched.models.subject import Subject
from sched.models.room import Room


# TODO: function `parse_input(raw_json: str | dict) -> Tuple[List[Subject],
#                                                            List[Room], dict]`
#       1. Parse JSON
#       2. Validate via Pydantic (fails loudly on malformed data)
#       3. Return (subjects, rooms, constraints)
#       Pydantic catches: missing fields, wrong types, malformed curr_ids.
