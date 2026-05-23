"""
Core data structures for the pool-based scheduler.

SchedulingEntity: wraps one Subject (or a merge group of Subjects) as a
scheduling unit that moves atomically through the pipeline.

Pool: all entities currently assigned to a specific room (or room pair).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import FrozenSet, List, Literal, Optional, Set

from sched.models.room import RoomType
from sched.models.schedule import TimeBlock
from sched.models.subject import Subject, SubjectState


@dataclass
class SchedulingEntity:
    entity_id: str
    members: List[Subject]
    is_merge_group: bool

    total_units: float
    total_lab_hrs: float
    total_lec_hrs: float
    requires_lab_room: bool
    department_id: str
    state: SubjectState

    current_schedule_blocks: List[TimeBlock] = field(default_factory=list)
    current_room_keys: Set[str] = field(default_factory=set)
    current_day_pattern: Optional[Literal["MTh", "TFS"]] = None
    has_dual_room: bool = False
    was_modified: bool = False
    manual_review_reason: Optional[str] = None

    @property
    def subject_ids(self) -> List[int]:
        return [m.subject_id for m in self.members]

    def is_saturday_entity(self) -> bool:
        from sched.models.schedule import Day
        return (
            bool(self.current_schedule_blocks)
            and all(b.day == Day.SAT for b in self.current_schedule_blocks)
        )


@dataclass
class Pool:
    pool_id: str
    room_keys: FrozenSet[str]
    building: str
    room_type: RoomType
    is_dual_room: bool
    entities: List[SchedulingEntity] = field(default_factory=list)
    conflicted_entities: List[SchedulingEntity] = field(default_factory=list)

    def all_entities(self) -> List[SchedulingEntity]:
        return self.entities + self.conflicted_entities

    def entity_count(self) -> int:
        return len(self.entities) + len(self.conflicted_entities)


def extract_building(pool_id_or_room_key: str) -> str:
    """Extract leading alphabetic characters from a room key."""
    m = re.match(r'^([A-Za-z]+)', pool_id_or_room_key.strip())
    return m.group(1).upper() if m else pool_id_or_room_key.upper()
