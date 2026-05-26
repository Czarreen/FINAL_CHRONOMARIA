# 📋 Faculty Loading — Feature README
### ChronoMaria Scheduling System

---

## What Is Faculty Loading?

**Faculty Loading** is the part of ChronoMaria that automatically assigns teachers (faculty) to the subjects they will teach each semester.

Think of it like a **smart matchmaker** — it looks at every available teacher and every subject that needs to be taught, then figures out the best possible pairing based on a set of rules the school already follows.

Instead of doing this by hand (which takes hours and is prone to mistakes), the system does it in seconds.

---

## Why Does It Exist?

Before ChronoMaria, scheduling coordinators had to manually:
- Check each faculty member's available units (teaching capacity)
- Avoid giving two classes that overlap in time to the same teacher
- Make sure the teacher actually specializes in the subject
- Balance the workload fairly across the department

This was time-consuming, error-prone, and hard to undo once done.

ChronoMaria's Faculty Loading module **automates this entire process** while still letting coordinators review, edit, and override any assignment before it's finalized.

---

## How to Use It (Step-by-Step)

1. **Go to the Faculty Loading page** in the system.
2. **Check the Pre-Flight Status** — the system will tell you if all the required data (faculty, subjects, rooms) is ready.
3. **Run a Dry Preview** — click the button to let the system generate a suggested assignment list *without saving anything yet*. This is just a preview.
4. **Review the Results** — see who got assigned to what, the quality score, and any subjects that could not be assigned.
5. **Edit if Needed** — go to the Master List Editor to manually change or lock specific assignments.
6. **Commit / Save** — when satisfied, run the final version to save the assignments to the database.
7. **Export** — download the final faculty load list as Excel, Word, PDF, or CSV for distribution.

---

---

# 📥 INPUT — What the System Needs

Before the system can run, it needs the following information already saved in the database.

---

### 1. Faculty Records
Each teacher must have:
- **Name and department** — which department they belong to (e.g., CS, IT)
- **Role** — Full-Time (FT), Part-Time (PT), or Guest
- **Maximum units** — how many teaching units they are allowed this semester
- **Specialization** — the subject areas they are qualified to teach (e.g., "Database Systems", "Electronics")
- **Active status** — only active faculty are considered

---

### 2. Course Offerings
Each subject section that needs a teacher must have:
- **Subject code and title** (e.g., CS-501 Database Design)
- **Number of units** (how heavy the subject is in teaching load)
- **Schedule** — which days and times the class runs:
  - **MTH** = Monday and Thursday
  - **TFS** = Tuesday and Friday
  - **SAT** = Saturday *(handled manually — not auto-assigned)*
  - **WED** = Wednesday *(handled manually — not auto-assigned)*
- **Room assignment** — which room the class will be held in

---

### 3. Faculty Subject Preferences (Tags)
Coordinators can optionally tag faculty with their preferred subjects using a **priority system**:

| Tag | Meaning |
|-----|---------|
| **P1 — High Priority** | This teacher is the top choice for this subject. Assign them first. |
| **P2 — Capable** | This teacher can handle this subject if P1 isn't available. |
| **P3 — Fallback** | This teacher can teach this as a last resort. |

These tags guide the system but are not required. If no tags exist, the system will still match based on specialization and department.

---

### 4. Pre-Flight Check (System Readiness)

Before running, the system performs a **pre-flight check** (like a checklist before a plane takes off). It checks:

- ✅ **Ready** — Everything looks good. Safe to run.
- ⚠️ **Ready with Warnings** — Some minor issues exist (e.g., a subject has no good specialization match), but the system can still run. Results may be partial.
- 🚫 **Blocked** — Critical data is missing (e.g., no active faculty in a department). The system cannot run until this is fixed.

The pre-flight screen shows a list of issues sorted by severity (High / Medium / Low) with suggested fixes.

---

### 5. Locked Assignments (Optional)
If the coordinator has already decided a specific teacher must teach a specific subject, they can **lock** that row. The system will never change a locked assignment — it works around it.

---

---

# ⚙️ PROCESS — How the System Works

Once inputs are ready, the system runs through **4 phases** automatically.

---

## Phase 1 — Assign Priority 1 (High Priority) Tags First

The system starts with the **most important preferences**.

- It looks at all subjects that have a **P1-tagged faculty member**.
- It tries to assign that faculty member first, as long as the rules allow it (see Rules section below).
- The faculty member with the **lightest current load** gets assigned first — so the system is fair even among P1 candidates.
- If a P1 faculty can't be assigned (e.g., they're already at maximum units), the system moves on and tries the next best option.

---

## Phase 2 — Reserve Slots for P2 and P3 Tags

Before the main matching begins, the system quietly **saves a spot** for every P2 and P3-tagged teacher.

Here is why this step is needed:

Every teacher has a **preparation limit** — a cap on how many *different* subjects they can prepare to teach in one semester. Think of it like a limited number of seats on a bus:
- A **Full-Time teacher** has up to **6 seats** (can prepare 6 different subjects)
- A **Part-Time teacher** has up to **4 seats** (can prepare 4 different subjects)

Without Phase 2, here is what could go wrong:

> Phase 3 (the main matching loop) runs and starts assigning subjects one by one. It might fill up all 4 of Teacher A's seats with random subjects they were never tagged for. Then when the system reaches the subject that Teacher A was specifically P2-tagged for — all their seats are taken. The system skips them, even though they were supposed to be the preferred teacher for that subject.

**Phase 2 fixes this by putting a "RESERVED" sign on one seat for each tagged teacher — before Phase 3 even starts.**

- If Teacher A has a P2 tag on "Database Design," the system marks one of their seats as reserved for that subject.
- Phase 3 can only fill the *remaining* seats with other subjects.
- When "Database Design" comes up in Phase 3, Teacher A still has their reserved spot open and can be assigned.

> **Important:** This reservation does **not** add to the teacher's teaching hours. It only holds a spot in their preparation count. The actual assignment — and the hours — happen in Phase 3.

---

## Phase 3 — Smart Matching Loop

For every remaining unassigned subject, the system runs a **three-pass search** to find the best available teacher:

**Pass A — Specialization Match**
- The system checks if any teacher's listed specialization keywords match the subject's title or code.
- Example: A teacher with specialization "Database Systems" is a strong match for "CS-501 Database Design."
- If strong matches are found, only these teachers are considered (whether same department or cross-department).

**Pass B — Same Department Match**
- If no specialization match is found, the system falls back to teachers from the **same department** as the subject.

**Pass C — Cross-Department Fallback**
- If still no candidates exist, the system allows a limited cross-department assignment (e.g., an IT teacher assigned to a CS subject) — only when there are genuinely no CS faculty available.

**Scoring**
Once a group of candidates is found, the system **scores** each teacher:
- Teachers with a matching specialization score higher.
- Full-time (FT) teachers score higher than part-time (PT) teachers.
- Teachers who still have plenty of available units score higher than those who are nearly full.
- A small random factor breaks ties fairly.

The **highest-scoring teacher who passes all the rules** gets the assignment.

---

## Phase 4 — Genetic Algorithm Refinement

After the initial assignments are made, the system uses a **Genetic Algorithm (GA)** to make the overall solution even better.

Think of it like this:
> The system generates 120 slightly different versions of the assignment plan, evaluates which ones are better, combines the good parts, and discards the bad ones — repeating this process up to 120 times (or until it stops improving).

This is inspired by how evolution works in nature: the "strongest" solutions survive and improve over generations.

The GA stops when:
- It runs 120 improvement cycles (called "generations"), **or**
- The solution has not improved for 20 cycles in a row, **or**
- 120 seconds have passed (time limit)

The end result is an assignment plan that is as balanced and well-matched as possible within the given rules.

---

## The Rules (Constraints)

The system **strictly enforces** these rules — no assignment is ever made that breaks them:

| Rule | What It Means |
|------|--------------|
| **Maximum Units** | A teacher cannot be assigned more teaching units than their allowed maximum. |
| **No Time Conflicts** | A teacher cannot have two classes that overlap on the same day. |
| **No More Than 4 Consecutive Teaching Hours** | A teacher cannot teach for more than 4 hours in a row without a break on any given day. |
| **Preparation Limit** | A teacher can only handle a limited number of *different* subjects per semester. Full-time faculty can handle up to 6 different subjects; part-time up to 4. |
| **No Room Double-Booking** | Two classes cannot be assigned to the same room at the same time. |

The system also tries its best (but is flexible) on these softer preferences:

- Prefer teachers whose specialization matches the subject
- Prefer teachers from the same department
- Prefer full-time teachers over part-time when both are available
- Balance the workload fairly — no single teacher should carry far more than the department average

---

---

# 📤 OUTPUT — What the System Produces

---

### 1. Faculty Assignment List
The main result is a **table showing every subject and who is assigned to teach it**:

- Subject code, title, section, units, schedule, and room
- Assigned faculty name, role, and department
- Assignment status:
  - ✅ **Loaded** — Successfully assigned
  - ⚠️ **Needs Attention** — Assigned but with a minor concern
  - ❌ **Unassigned** — No suitable teacher was found

---

### 2. Quality / Fitness Score
After the algorithm runs, the system gives a **quality score from 0 to 100** that shows how well the overall assignment went:

| Score Range | Rating |
|-------------|--------|
| 95–100 | ⭐ Excellent |
| 80–94 | ✅ Good |
| 65–79 | 🟡 Fair |
| 50–64 | ⚠️ Needs Review |
| Below 50 | 🚨 Needs Attention |

The score is made up of two parts:
- **Hard Score (72% weight)** — How many subjects were successfully assigned, with heavy penalties for broken rules.
- **Soft Score (28% weight)** — How well the assignments match preferences (specialization fit, load balance, role priority).

---

### 3. Faculty Load Balance Report
A summary table showing, for each teacher:
- How many units were assigned vs. their maximum allowed
- How many different subjects they were given
- Their remaining free units
- Whether their load is significantly higher or lower than the department average

This helps coordinators quickly spot if anyone is overloaded or underutilized.

---

### 4. Issue / Problem Report
If some subjects could not be assigned, the system explains **why**:

- "No faculty available for this department"
- "All eligible faculty are already at maximum units"
- "No faculty specialization matches this subject"
- "All candidates have schedule conflicts"

Each issue also comes with a **recommendation** (e.g., "Consider adding more faculty records" or "Adjust the schedule to reduce conflicts").

---

### 5. Export Files
Once the assignment list is finalized, coordinators can download it in these formats:

| Format | Use Case |
|--------|---------|
| **Excel (.xlsx)** | For editing and record-keeping |
| **Word (.docx)** | For formal document submission |
| **PDF (.pdf)** | For printing and distribution |
| **CSV (.csv)** | For importing into other systems |

---

---

# 📖 Key Terms Glossary

| Term | Plain English Meaning |
|------|-----------------------|
| **Faculty Loading** | The process of assigning teachers to subjects for a semester |
| **Course Offering** | A specific class section that needs a teacher assigned |
| **Units** | A number representing how heavy a subject is in teaching load |
| **P1 / P2 / P3 Tags** | Priority labels that tell the system which teacher is the best fit for a subject |
| **Pre-Flight Check** | A readiness check the system runs before the assignment process starts |
| **Dry Preview** | Running the system to see results without saving them — a safe "test run" |
| **Locked Assignment** | A teacher-subject pairing that the coordinator has fixed and does not want the system to change |
| **Genetic Algorithm (GA)** | A computer optimization method inspired by evolution — it generates many possible solutions, keeps the best ones, and improves them over many cycles |
| **FT (Full-Time)** | A teacher employed full-time by the institution |
| **PT (Part-Time)** | A teacher employed part-time, with a lower teaching load limit |
| **Specialization** | The subject areas a teacher is trained and qualified to teach |
| **Preparation Limit** | The maximum number of *different* subjects a teacher can be assigned in one semester |
| **MTH** | Monday and Thursday schedule pattern |
| **TFS** | Tuesday and Friday schedule pattern |
| **Fitness Score** | A number (0–100) rating how good the overall assignment plan is |

---

---

# 🗺️ System Snapshot

```
┌─────────────────────────────────────────────────────────────────┐
│                        FACULTY LOADING                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📥 INPUT                                                       │
│  ─────────────────────────────────────────────────             │
│  • Faculty Records (name, role, units, specialization)          │
│  • Course Offerings (subject, units, schedule, room)            │
│  • Faculty Subject Tags (P1 / P2 / P3 preferences)             │
│  • Locked Assignments (user-fixed pairings)                     │
│                         │                                       │
│                         ▼                                       │
│  ⚙️ PROCESS                                                     │
│  ─────────────────────────────────────────────────             │
│  Phase 1 → Assign P1 (High Priority) tags first                 │
│  Phase 2 → Reserve slots for P2/P3 tags                         │
│  Phase 3 → Smart 3-pass matching for remaining subjects         │
│            (Specialization → Department → Cross-Dept)           │
│  Phase 4 → Genetic Algorithm refines the full plan              │
│            (120 versions × 120 improvement cycles)              │
│                         │                                       │
│                         ▼                                       │
│  📤 OUTPUT                                                      │
│  ─────────────────────────────────────────────────             │
│  • Assignment List (who teaches what)                           │
│  • Quality Score (0–100 rating)                                 │
│  • Load Balance Report (per teacher summary)                    │
│  • Issue Report (unassigned subjects + reasons)                 │
│  • Export Files (Excel / Word / PDF / CSV)                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

*This document covers the Faculty Loading module of ChronoMaria. For questions about other modules (Automatic Scheduling, Rooms, Subjects), refer to their respective documentation.*
