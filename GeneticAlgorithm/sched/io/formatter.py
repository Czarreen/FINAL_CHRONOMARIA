"""
Serialize pool-pipeline output to JSON for Node.

Output contract:
{
  "status": "success" | "partial" | "unresolvable",
  "ga_run_id": "uuid-string",
  "rows": [...],
  "census": {
    "input_count": 359,
    "output_count": 359,
    "by_tag": {...}
  },
  "diagnostics": {...},
  "stats": {...}
}

CRITICAL: rows count must equal input_count or Node throws an error.
"""

import uuid
from typing import List

from sched.pool.pool import SchedulingEntity
from sched.models.subject import SubjectState, SubjectTag


def _compute_tag(entity: SchedulingEntity) -> str:
    if entity.manual_review_reason is not None:
        return SubjectTag.MANUAL_REVIEW.value
    if entity.state == SubjectState.EMPTY:
        return SubjectTag.GENERATED.value
    if entity.was_modified:
        return SubjectTag.RESCHEDULED.value
    return SubjectTag.ORIGINAL.value


def format_output(
    entities: List[SchedulingEntity],
    manual_review: List[SchedulingEntity],
    diagnostics: dict,
    stats: dict,
) -> dict:
    """
    Serialize all entities (placed + manual review) into a flat rows list.
    Raises ValueError if output_count != input_count.
    """
    stats = stats or {}
    rows = []
    lab_placed = 0
    lec_placed = 0

    all_entities = entities + manual_review
    for entity in all_entities:
        tag = _compute_tag(entity)
        for member in entity.members:
            row = member.model_dump()
            row['tag'] = tag
            if entity.manual_review_reason:
                row['manual_review_reason'] = entity.manual_review_reason
            rows.append(row)
            if member.mth_schedule or member.tfs_schedule:
                if entity.requires_lab_room:
                    lab_placed += 1
                else:
                    lec_placed += 1

    input_count = sum(len(e.members) for e in all_entities)
    output_count = len(rows)

    if input_count != output_count:
        raise ValueError(
            f"Census mismatch in format_output: "
            f"input_count={input_count}, output_count={output_count}"
        )

    manual_count = sum(len(e.members) for e in manual_review)
    total = output_count
    if manual_count == 0:
        status = "success"
    elif manual_count / max(1, total) < 0.20:
        status = "partial"
    else:
        status = "unresolvable"

    by_tag: dict = {}
    for row in rows:
        t = row.get('tag', 'Unknown')
        by_tag[t] = by_tag.get(t, 0) + 1

    full_diagnostics = dict(diagnostics)
    full_diagnostics['lab_subjects_placed'] = lab_placed
    full_diagnostics['lecture_subjects_placed'] = lec_placed
    full_diagnostics['manual_review_count'] = manual_count

    return {
        "status": status,
        "ga_run_id": stats.get("ga_run_id", str(uuid.uuid4())),
        "rows": rows,
        "census": {
            "input_count": input_count,
            "output_count": output_count,
            "by_tag": by_tag,
        },
        "diagnostics": full_diagnostics,
        "stats": stats,
    }
