"""
Department-to-building room affinity table.

Used during migration cascade and empty placement to prefer rooms
in the subject's home building before falling back to cross-building search.

Building extraction: leading alphabetic characters of a room name.
  "E101"  -> "E"
  "AP201" -> "AP"
  "RS102" -> "RS"
  "JVD"   -> "JVD"

Keys are the numeric department_id values from the DB departments table.
"""

import re
from typing import Dict, List

# Maps department_id (numeric string from DB) to preferred building prefixes.
# Primary building is index 0; subsequent entries are ordered fallbacks.
_AFFINITY: Dict[str, List[str]] = {
    "1":  ["D"],        # Architecture
    "2":  ["RS", "S"],  # Civil Engineering
    "3":  ["E", "S"],   # Computer Engineering
    "4":  ["E", "S"],   # Electrical Engineering
    "5":  ["E", "S"],   # Electronics Engineering
    "6":  ["AP"],       # Information Technology
    "7":  ["AP"],       # Library Information Science
    "11": ["AP"],       # Computer Science
    # Departments 8 (Mathematics) and 10 (ECE) are intentionally excluded.
}


def preferred_buildings(department_id: str) -> List[str]:
    """Ordered list of preferred building prefixes for a department."""
    dept = (department_id or "").strip()
    return list(_AFFINITY.get(dept, []))


def extract_building(room_key: str) -> str:
    """Extract leading alphabetic characters from a room key."""
    m = re.match(r'^([A-Za-z]+)', room_key.strip())
    return m.group(1).upper() if m else room_key.upper()
