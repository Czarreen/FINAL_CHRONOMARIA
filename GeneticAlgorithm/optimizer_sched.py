"""
Pool-based automatic scheduler — entry point invoked by Node via subprocess.

Pipeline (Steps 0-8):
  0+1  Preflight: data cleaning, room type registry, entity construction
  2    Pool building: group entities by room
  3    Intra-pool conflict resolution (deterministic, priority-based)
  4    Migration cascade: move conflicted entities to other pools
  5    Empty-field placement (lab entities first, then lecture entities)
  8    Output assembly (with final conflict safety-net scan)

Reads JSON from stdin, writes JSON to stdout.
"""

import json
import sys
import time
import traceback
import uuid


def _fmt_mins(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _fmt_entity(entity) -> str:
    members_str = "  |  ".join(
        f"{(m.code or m.course_no):<10} {m.department_id}/{m.section}  \"{m.descriptive_title}\""
        for m in entity.members
    )
    room_str = ", ".join(sorted(entity.current_room_keys)) if entity.current_room_keys else "no room"
    sched_str = (
        "  ".join(
            f"{b.day.value} {_fmt_mins(b.start_minutes)}-{_fmt_mins(b.end_minutes)}"
            for b in entity.current_schedule_blocks
        )
        if entity.current_schedule_blocks else "no schedule"
    )
    return f"{members_str}  [{sched_str}  {room_str}]"


def _log_post_ga_conflicts(pairs) -> None:
    print(
        f"\n[SCHEDULER] POST-OPTIMIZATION CONFLICTS DETECTED: {len(pairs)}",
        file=sys.stderr,
    )
    for i, (loser, winner) in enumerate(pairs, 1):
        print(f"  [{i}] FLAGGED : {_fmt_entity(loser)}", file=sys.stderr)
        print(f"      KEPT    : {_fmt_entity(winner)}", file=sys.stderr)
    print("", file=sys.stderr)


def main():
    try:
        from sched.io.parser import parse_input
        from sched.io.formatter import format_output
        from sched.flow.preflight import run_preflight
        from sched.flow.census import assert_entity_invariant
        from sched.pool.pool_builder import build_pools, ensure_all_room_pools
        from sched.pool.conflict_resolver import resolve_pool_conflicts
        from sched.pool.migration import migrate_conflicted_entities
        from sched.pool.empty_placement import place_empty_entities
        from sched.pool.conflict_resolver import detect_final_conflicts

        raw = json.load(sys.stdin)
        subjects, rooms, constraints = parse_input(raw)

        global_budget_s = float(constraints.get('global_budget_seconds', 150.0))
        global_start = time.perf_counter()
        run_id = str(uuid.uuid4())

        # Steps 0+1: data cleaning + entity construction
        registry, entities = run_preflight(subjects, rooms)
        assert_entity_invariant(subjects, entities, [], "post-preflight")

        # Step 2: pool building
        active_room_keys = {str(r.room_id) for r in rooms}
        pools, unassigned = build_pools(entities, registry, active_room_keys)
        pools = ensure_all_room_pools(pools, registry, active_room_keys)

        # Lock manual-review scheduled entities as room/time constraints so
        # Steps 4 and 5 never place other subjects into their occupied slots.
        pool_by_room = {
            next(iter(p.room_keys)): p
            for p in pools if not p.is_dual_room
        }
        for entity in unassigned:
            if (entity.manual_review_reason is not None
                    and entity.current_room_keys
                    and entity.current_schedule_blocks):
                for room_key in entity.current_room_keys:
                    if room_key in pool_by_room:
                        pool_by_room[room_key].locked_entities.append(entity)

        diagnostics: dict = {
            "pools_created": len(pools),
            "conflicts_detected": 0,
            "conflicts_resolved_by_migration": 0,
            "manual_review_count": 0,
            "warnings": [],
        }

        # Step 3: intra-pool conflict resolution
        total_conflicted = 0
        for pool in pools:
            resolve_pool_conflicts(pool)
            total_conflicted += len(pool.conflicted_entities)
        diagnostics["conflicts_detected"] = total_conflicted

        # Step 4: migration cascade
        pools, migration_manual_review = migrate_conflicted_entities(
            pools, registry, max_per_entity_s=5.0
        )
        resolved_by_migration = total_conflicted - len(migration_manual_review)
        diagnostics["conflicts_resolved_by_migration"] = max(0, resolved_by_migration)

        # Step 5: empty-field placement (two-phase: lab then lecture)
        pools, _newly_placed, still_empty = place_empty_entities(
            unassigned, pools, registry, global_start, global_budget_s
        )
        manual_review = migration_manual_review + still_empty

        # Step 8: output assembly
        all_placed = [e for pool in pools for e in pool.entities]

        # Step 8a: final conflict scan (catches any conflicts introduced by Steps 5-7)
        late_conflict_pairs = detect_final_conflicts(all_placed)
        if late_conflict_pairs:
            _log_post_ga_conflicts(late_conflict_pairs)
            late_conflicts = []
            placed_ids = {loser.entity_id for loser, _ in late_conflict_pairs}
            all_placed = [e for e in all_placed if e.entity_id not in placed_ids]
            for loser, winner in late_conflict_pairs:
                loser.manual_review_reason = "post_optimization_conflict"
                if winner.members:
                    m = winner.members[0]
                    loser.conflict_partner_info = {
                        "code": m.code,
                        "course_no": m.course_no,
                        "section": m.section,
                        "descriptive_title": m.descriptive_title,
                        "mth_schedule": m.mth_schedule,
                        "mth_room": m.mth_room,
                        "tfs_schedule": m.tfs_schedule,
                        "tfs_room": m.tfs_room,
                    }
                late_conflicts.append(loser)
            manual_review = manual_review + late_conflicts
            diagnostics["warnings"].append(
                f"post_ga_conflicts_detected: {len(late_conflicts)}"
            )

        assert_entity_invariant(subjects, all_placed, manual_review, "post-pipeline")

        stats = {
            "ga_run_id": run_id,
            "elapsed_s": round(time.perf_counter() - global_start, 2),
        }
        output = format_output(all_placed, manual_review, diagnostics, stats)
        json.dump(output, sys.stdout)
        sys.exit(0)

    except Exception as e:
        error_response = {
            "status": "error",
            "error_type": type(e).__name__,
            "error_message": str(e),
            "traceback": traceback.format_exc(),
        }
        json.dump(error_response, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
