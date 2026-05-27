import json, collections

with open("ga_debug_run.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# final_faculty_loads is a list — build lookup by faculty_id
final_loads_list = data.get("final_faculty_loads", [])
final_loads = {}
for f in final_loads_list:
    fid = str(f.get("faculty_id", ""))
    final_loads[fid] = f

# Get initial state
initial = data.get("faculty_initial_state", [])

def show_dept(dept_id, label):
    print(f"=== {label} dept={dept_id} faculty ===")
    fac = [f for f in initial if f.get("dept_id") == dept_id]
    if not fac:
        print("  (none in pool)")
        return
    for f in sorted(fac, key=lambda x: x.get("faculty_id", 0)):
        fid = str(f.get("faculty_id"))
        nm = str(f.get("name","?")).encode("ascii","replace").decode()
        max_u = f.get("max_units", 0) or 0
        fl = final_loads.get(fid, {})
        used = fl.get("total_units", "?")
        free = fl.get("free_units", "?")
        role = str(f.get("role","")).encode("ascii","replace").decode()
        print(f"  fac_id={fid:3s} max={max_u:5.1f} used={used!s:5} free={free!s:4} | {nm[:35]} ({role[:15]})")
    print()

show_dept(4, "EE")
show_dept(2, "CE")
show_dept(3, "CpE")
show_dept(5, "ECE")
show_dept(6, "IT/CS")
show_dept(1, "Architecture")
