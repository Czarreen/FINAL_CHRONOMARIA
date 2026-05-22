import json, os
root = os.path.dirname(__file__)
with open(os.path.join(root, "ga_last_run.json")) as f:
    data = json.load(f)

report = data.get("report", {})
loads  = report.get("faculty_load_balance", [])
free   = report.get("faculty_free_units", [])

print("Fitness: overall=%.1f  hard=%.1f  soft=%.1f" % (
    data["fitness_overall"], data["fitness_hard"], data["fitness_soft"]))
print("Generations:", data["generations"], " Runtime:", data["runtime_ms"], "ms")
print("Summary:", report.get("summary"))
print()

print("=== FACULTY LOADS (%d) ===" % len(loads))
for r in sorted(loads, key=lambda x: -x.get("load_units", 0)):
    print("  [%3s] %-42s %2s  load=%4su  assign=%2d  dept=%s" % (
        r.get("faculty_id",""), r.get("name",""), r.get("role",""),
        r.get("load_units",0), r.get("assignments",0), r.get("department_id","")
    ))

print()
print("=== FACULTY WITH FREE UNITS (%d) ===" % len(free))
for r in sorted(free, key=lambda x: -x.get("free_units", 0)):
    print("  [%3s] %-42s %2s  free=%4su  max=%s" % (
        r.get("faculty_id",""), r.get("name",""), r.get("role",""),
        r.get("free_units",0), r.get("max_units",0)
    ))

unassigned = report.get("unassigned_subjects", [])
print()
print("=== UNASSIGNED (%d) ===" % len(unassigned))
for u in unassigned:
    print(" ", u)

violations = report.get("hard_violations", [])
print()
print("=== HARD VIOLATIONS (%d) ===" % len(violations))
for v in violations:
    print(" ", v)
