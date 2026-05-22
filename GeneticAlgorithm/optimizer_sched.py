"""
Schedule GA optimizer -- entry point invoked by Node via subprocess.

Reads JSON from stdin, runs the full pipeline, writes JSON to stdout.
All real logic lives in sched/*.

Usage (from Node):
    const result = spawn('python', ['optimizer_sched.py'])
    result.stdin.write(JSON.stringify(payload))
    result.stdin.end()
    // read result.stdout for JSON output
"""
import sys
import json
import time
import traceback
import uuid


def main():
    try:
        # Lazy imports so ImportError (unimplemented TODOs) returns error JSON
        from sched.io.parser import parse_input
        from sched.io.formatter import format_output
        from sched.flow.preflight import run_preflight
        from sched.flow.stage_sat import resolve_saturday_pile
        from sched.flow.stage1_merged import run_stage1
        from sched.flow.stage2_triage import triage
        from sched.flow.stage3_ga import run_stage3
        from sched.flow.census import assert_invariant

        raw = json.load(sys.stdin)
        subjects, rooms, constraints = parse_input(raw)

        # Global wall-clock budget.  Must finish before Node.js spawn timeout
        # kills the process (default 180 s).  We leave a 30 s buffer so the
        # process always has time to serialise output and exit cleanly.
        global_budget_s = float(constraints.get('global_budget_seconds', 150.0))
        global_start = time.perf_counter()

        run_id = str(uuid.uuid4())

        # PRE-FLIGHT
        state = run_preflight(subjects)
        assert_invariant(subjects, state, "post-preflight")

        # STAGE SAT: resolve Saturday-only subjects in isolation before GA
        state = resolve_saturday_pile(state, rooms)
        assert_invariant(subjects, state, "post-sat")

        # STAGE 1
        state = run_stage1(state, subjects)
        assert_invariant(subjects, state, "post-stage1")

        # STAGE 2/3 LOOP
        generations_total = 0
        while state.has_pending() and not state.max_iterations_reached():
            elapsed = time.perf_counter() - global_start
            remaining = global_budget_s - elapsed

            if remaining < 2.0:
                # Out of time — move all remaining pending subjects to unresolvable
                state.unresolvable.extend(state.pending)
                state.pending = []
                break

            # Clamp per-GA-call budget to remaining global time (keep 2 s for I/O)
            per_call_max = min(
                float(constraints.get('max_runtime_seconds', 45.0)),
                remaining - 2.0,
            )
            iter_constraints = dict(constraints)
            iter_constraints['max_runtime_seconds'] = per_call_max

            prev_resolved_count = len(state.resolved)

            state = triage(state)
            assert_invariant(subjects, state, f"post-triage-iter{state.iteration_count}")

            state = run_stage3(state, subjects, rooms=rooms, constraints=iter_constraints)
            assert_invariant(subjects, state, f"post-ga-iter{state.iteration_count}")

            # Stop if no progress
            if len(state.resolved) == prev_resolved_count:
                # Move remaining pending to unresolvable
                state.unresolvable.extend(state.pending)
                state.pending = []
                break

        # OUTPUT
        stats = {
            "generations_run": generations_total,
            "iterations": state.iteration_count,
            "ga_run_id": run_id,
        }
        output = format_output(state, stats)
        json.dump(output, sys.stdout)
        sys.exit(0)

    except Exception as e:
        # Always return valid JSON, even on error, so Node can parse it
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
