import json

base = "C:/Users/hp/Desktop/ChronoMariaDEV/FINAL_CHRONOMARIA/GeneticAlgorithm/"

# ── ga_last_run.json ─────────────────────────────────────────────────────────
with open(base + "ga_last_run.json", encoding="utf-8") as f:
    run = json.load(f)

rpt = run.get("report", {})
print("=" * 60)
print("ga_last_run.json")
print("=" * 60)
print("Summary :", rpt.get("summary"))
print("SAT-only:", rpt.get("sat_only_count", "N/A"))
print("WED-only:", rpt.get("wed_only_count", "N/A"))
print(f"Fitness  : overall={run.get('fitness_overall')}  hard={run.get('fitness_hard')}  soft={run.get('fitness_soft')}")
print(f"Gens     : {run.get('generations')}  Runtime: {run.get('runtime_ms')} ms")
print(f"Assigned : {len(run.get('assignments', []))}")

hvs = rpt.get("hard_violations", [])
print(f"\n--- Hard violations ({len(hvs)}) ---")
for v in hvs[:30]:
    print(" ", v)

unresolved = rpt.get("unresolved_offerings", [])
print(f"\n--- Unassigned offerings ({len(unresolved)}) ---")
for u in unresolved:
    code = u.get("code")
    sec  = u.get("section")
    dept = u.get("department_id")
    reason = u.get("reason")
    print(f"  code={code} sec={sec} dept={dept} | {reason}")

print("\n--- Assignments (all) ---")
for a in run.get("assignments", []):
    fac = a.get("faculty", {})
    off = a.get("offering", {})
    print(f"  code={off.get('code')} sec={off.get('section')} -> fid={fac.get('faculty_id')} {fac.get('faculty_name')} [{fac.get('faculty_role')}]")

# ── ga_debug_run.json ────────────────────────────────────────────────────────
with open(base + "ga_debug_run.json", encoding="utf-8") as f:
    dbg = json.load(f)

print("\n" + "=" * 60)
print("ga_debug_run.json")
print("=" * 60)
inp = dbg.get("input", {})
print("Input:", inp)

print("\n--- P1 Pre-assignments ---")
for p in dbg.get("p1_preassignments", []):
    result = p.get("result")
    code   = p.get("code")
    sec    = p.get("section")
    winner = p.get("winner")
    cands  = p.get("candidates", [])
    if result == "ASSIGNED":
        w = winner or {}
        print(f"  [OK]  code={code} sec={sec} -> {w.get('name')} (fid={w.get('faculty_id')}) score={w.get('score_tuple')} load_after={w.get('load_after')}")
    else:
        print(f"  [FAIL] code={code} sec={sec} | NO eligible P1 faculty")
        for c in cands:
            print(f"         fid={c.get('faculty_id')} {c.get('name')} [{c.get('role')}] eligible={c.get('eligible')} rejection={c.get('rejection')}")

print("\n--- P2/P3 Reservations ---")
for r in dbg.get("p2p3_reservations", []):
    print(f"  P{r.get('priority')} fid={r.get('faculty_id')} {r.get('name')} | reserved={r.get('subject_code')} preps_after={r.get('preps_total_after')}")

print("\n--- Main loop: UNASSIGNED ---")
for m in dbg.get("main_loop", []):
    if m.get("result") == "UNASSIGNED":
        code = m.get("code")
        sec  = m.get("section")
        dept = m.get("dept_id")
        print(f"  UNASSIGNED code={code} sec={sec} dept={dept} | pass={m.get('pass_used')} candidates={m.get('candidate_count')}")
        for tf in m.get("tagged_faculty", []):
            print(f"    tagged fid={tf.get('faculty_id')} {tf.get('name')} P{tf.get('priority')} in_cands={tf.get('in_candidates')} rej={tf.get('rejection')}")

print("\n--- Main loop: tagged faculty that ended up ASSIGNED to different faculty ---")
for m in dbg.get("main_loop", []):
    tagged = m.get("tagged_faculty", [])
    if not tagged:
        continue
    winner = (m.get("winner") or {})
    winner_fid = winner.get("faculty_id")
    for tf in tagged:
        if tf.get("faculty_id") != winner_fid:
            print(f"  code={m.get('code')} sec={m.get('section')} | tagged fid={tf.get('faculty_id')} {tf.get('name')} P{tf.get('priority')} NOT winner | winner={winner_fid} {winner.get('name')} | tagged_rej={tf.get('rejection')}")

print("\n--- Faculty final state (initial candidate) ---")
for fac in dbg.get("faculty_initial_state", []):
    print(f"  fid={fac.get('faculty_id')} {fac.get('name')} [{fac.get('role')}] "
          f"units={fac.get('units_loaded')}/{fac.get('max_units')} "
          f"preps={fac.get('prep_count')}{fac.get('preps')} "
          f"assignments={fac.get('assignments')}")

print("\n--- SAT-only excluded ---")
for s in dbg.get("sat_only_excluded", []):
    print(f"  code={s.get('code')} sec={s.get('section')} {s.get('descriptive_title')}")
print("\n--- WED-only excluded ---")
for s in dbg.get("wed_only_excluded", []):
    print(f"  code={s.get('code')} sec={s.get('section')} {s.get('descriptive_title')}")
