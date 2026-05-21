"""
Serialize PipelineState into JSON output for Node.

Output contract:
{
  "status": "success" | "partial" | "unresolvable",
  "ga_run_id": "uuid-string",
  "resolved": [...],
  "unresolvable": [...],
  "manual_review": [...],
  "census": {
    "input_count": 359,
    "output_count": 359,
    "by_bucket": {...},
    "by_tag": {...}
  },
  "stats": { ... }
}

CRITICAL: output_count must equal input_count or Node throws an error.
"""

import uuid
from sched.flow.state import PipelineState
from sched.flow.census import census_summary


def format_output(state: PipelineState, stats: dict = None) -> dict:
    """
    Serialize PipelineState to the output dict.
    Raises ValueError if census invariant is broken.
    """
    stats = stats or {}
    census = census_summary(state)

    if census["output_count"] != census["input_count"]:
        raise ValueError(
            f"Census mismatch: output_count={census['output_count']} "
            f"!= input_count={census['input_count']}"
        )

    total = state.total_count()
    failed = len(state.unresolvable) + len(state.manual_review)

    if failed == 0:
        status = "success"
    elif failed / max(1, total) < 0.20:
        status = "partial"
    else:
        status = "unresolvable"

    resolved_dicts   = [s.model_dump() for s in state.resolved]
    locked_dicts     = [s.model_dump() for s in state.locked]
    unresolv_dicts   = [s.model_dump() for s in state.unresolvable]
    manual_dicts     = [s.model_dump() for s in state.manual_review]
    merged_dicts     = [m for mg in state.merged_groups for m in mg.members]

    return {
        "status":        status,
        "ga_run_id":     str(uuid.uuid4()),
        "locked":        locked_dicts,
        "resolved":      resolved_dicts,
        "unresolvable":  unresolv_dicts,
        "manual_review": manual_dicts,
        "merged":        merged_dicts,
        "census":        census,
        "stats":         stats,
    }
