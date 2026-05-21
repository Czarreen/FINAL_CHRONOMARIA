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
  "stats": {
    "generations_run": 47,
    "iterations": 3,
    "hard_conflicts_remaining": 0,
    "soft_score_final": 245.7
  }
}

CRITICAL: output_count must equal input_count or Node throws an error.

Imports:
    import json, uuid
    from sched.flow.state import PipelineState
    from sched.flow.census import census_summary
"""

import json
import uuid
from sched.flow.state import PipelineState
from sched.flow.census import census_summary


# TODO: function `format_output(state: PipelineState,
#                               stats: dict) -> dict`
#       1. Concatenate ALL buckets into output sections
#       2. Apply tags from each subject
#       3. Build census summary
#       4. Build stats
#       5. Determine status:
#          - "success" if unresolvable and manual_review are both empty
#          - "partial" if some are unresolvable but most succeeded
#          - "unresolvable" if too many failed (define threshold)
#       6. Assert input_count == output_count before returning
#       7. Return dict ready for json.dumps()
