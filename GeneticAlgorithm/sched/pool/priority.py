"""
Priority scoring for intra-pool conflict resolution.

Tiebreaker chain (higher = wins):
  1. total_units (descending)
  2. total_lab_hrs (descending)
  3. total_lec_hrs (descending)
  4. earliest start time (ascending — earlier start = higher priority)
  5. code/course_no lexicographic (ascending)
"""

from typing import List, Tuple

from sched.pool.pool import SchedulingEntity


def priority_key(entity: SchedulingEntity) -> Tuple:
    start_min = min(
        (b.start_minutes for b in entity.current_schedule_blocks),
        default=9999,
    )
    code = entity.members[0].code or entity.members[0].course_no or ""
    return (
        entity.total_units,
        entity.total_lab_hrs,
        entity.total_lec_hrs,
        -start_min,
        code,
    )


def sort_by_priority(entities: List[SchedulingEntity]) -> List[SchedulingEntity]:
    return sorted(entities, key=priority_key, reverse=True)


def higher_priority(a: SchedulingEntity, b: SchedulingEntity) -> SchedulingEntity:
    return a if priority_key(a) >= priority_key(b) else b


def lower_priority(a: SchedulingEntity, b: SchedulingEntity) -> SchedulingEntity:
    return b if priority_key(a) >= priority_key(b) else a
