import json, collections

with open("ga_debug_run.json", "r", encoding="utf-8") as f:
    data = json.load(f)

main_loop = data.get("main_loop", [])

print("=== NOT_IN_GA_POOL tagged faculty ===")
for x in main_loop:
    for tf in x.get("tagged_faculty", []):
        if tf.get("status") == "NOT_IN_GA_POOL":
            print(f"  [{x['offering_id']}] dept={x['dept_id']} | {x['descriptive_title'][:50]} | fac={tf['faculty_id']} P{tf['priority']}")

print()
print("=== EE dept=4 unresolved ===")
ee_unresolved = [x for x in main_loop if x.get("result") != "ASSIGNED" and x.get("dept_id") == 4]
for x in ee_unresolved:
    print(f"  [{x['offering_id']}] {x['descriptive_title'][:45]} s{x['section']} units={x['units']}")
    for tf in x.get("tagged_faculty", []):
        if tf.get("status") == "NOT_IN_GA_POOL":
            print(f"    tagged: fac_id={tf['faculty_id']} NOT_IN_GA_POOL")
        elif tf.get("name"):
            print(f"    tagged: {tf['name']} (P{tf['priority']}) load={tf.get('load')}/{tf.get('max_units')} rej={tf.get('rejection')}")
        else:
            print(f"    tagged: no_name {tf}")

print()
print("=== Dept 5 (ECE) unresolved ===")
ece_unresolved = [x for x in main_loop if x.get("result") != "ASSIGNED" and x.get("dept_id") == 5]
for x in ece_unresolved:
    print(f"  [{x['offering_id']}] {x['descriptive_title'][:45]} s{x['section']} units={x['units']}")
    for tf in x.get("tagged_faculty", []):
        if tf.get("status") == "NOT_IN_GA_POOL":
            print(f"    tagged: fac_id={tf['faculty_id']} NOT_IN_GA_POOL")
        elif tf.get("name"):
            print(f"    tagged: {tf['name']} (P{tf['priority']}) load={tf.get('load')}/{tf.get('max_units')} rej={tf.get('rejection')}")

print()
print("=== Dept 6 (IT) unresolved ===")
it_unresolved = [x for x in main_loop if x.get("result") != "ASSIGNED" and x.get("dept_id") == 6]
for x in it_unresolved:
    print(f"  [{x['offering_id']}] {x['descriptive_title'][:45]} s{x['section']} units={x['units']}")
    for tf in x.get("tagged_faculty", []):
        if tf.get("status") == "NOT_IN_GA_POOL":
            print(f"    tagged: fac_id={tf['faculty_id']} NOT_IN_GA_POOL")
        elif tf.get("name"):
            print(f"    tagged: {tf['name']} (P{tf['priority']}) load={tf.get('load')}/{tf.get('max_units')} rej={tf.get('rejection')}")

print()
# Summary of all rejection types
print("=== Rejection type summary ===")
rej_by_type = collections.Counter()
for x in main_loop:
    if x.get("result") != "ASSIGNED":
        tfs = x.get("tagged_faculty", [])
        if not tfs:
            rej_by_type["no_tagged_faculty_and_no_candidates"] += 1
        else:
            for tf in tfs:
                st = tf.get("status", "")
                rej = tf.get("rejection", "none")
                if st == "NOT_IN_GA_POOL":
                    rej_by_type["NOT_IN_GA_POOL"] += 1
                else:
                    rej_by_type[str(rej)] += 1
for k, v in rej_by_type.most_common():
    print(f"  {v:4d}  {k}")
