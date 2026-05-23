"""
Department-to-building room affinity table.

Used during migration cascade and empty placement to prefer rooms
in the subject's home building before falling back to cross-building search.

Building extraction: leading alphabetic characters of a room key.
  "E101"  -> "E"
  "AP201" -> "AP"
  "RS102" -> "RS"
  "JVD"   -> "JVD"
"""

import re
from typing import Dict, List

# Maps department_id (string as stored in DB) to preferred building prefixes.
# Primary building is index 0; subsequent entries are ordered fallbacks.
# Update this table to match actual department_id values from the DB.
_AFFINITY: Dict[str, List[str]] = {
    # Information Technology
    "IT":   ["AP"],
    # Computer Science
    "CS":   ["AP"],
    # Library Information Science
    "LIS":  ["AP"],
    # Electrical Engineering
    "EE":   ["E", "S"],
    # Electronics and Communications Engineering
    "ECE":  ["E", "S"],
    # Computer Engineering
    "CpE":  ["E", "S"],
    # Civil Engineering
    "CE":   ["RS", "S"],
    # Architecture
    "AR":   ["D"],
}


def preferred_buildings(department_id: str) -> List[str]:
    """Ordered list of preferred building prefixes for a department."""
    dept = (department_id or "").strip()
    return list(_AFFINITY.get(dept, []))


def extract_building(room_key: str) -> str:
    """Extract leading alphabetic characters from a room key."""
    m = re.match(r'^([A-Za-z]+)', room_key.strip())
    return m.group(1).upper() if m else room_key.upper()
