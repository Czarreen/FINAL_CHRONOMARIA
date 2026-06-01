# 📅 Automatic Scheduler — Feature README
### ChronoMaria Scheduling System

---

## What Is the Automatic Scheduler?

The **Automatic Scheduler** is the part of ChronoMaria that automatically assigns **time slots and rooms** to every subject that needs to be taught each semester.

Think of it like a **Tetris solver for classrooms** — it looks at every subject, every available room, and every open time slot, then fits everything together so that no two classes share the same room at the same time, and no section is overloaded on any given day.

Instead of manually figuring out which subject goes in Room 201 at 7:30 AM on Monday and Thursday, the system works it all out automatically — in seconds.

---

## Why Does It Exist?

Before ChronoMaria, scheduling coordinators had to manually:
- Check room availability for every subject, every day of the week
- Make sure no two classes were booked in the same room at the same time
- Match the right room type to the right subject (lab subjects need lab rooms, lecture subjects need lecture rooms)
- Avoid overloading a section with too many hours in a single day

With dozens or hundreds of subjects per semester, this was an enormous task — easy to get wrong, and hard to fix once mistakes were made.

ChronoMaria's Automatic Scheduler **removes this burden** by handling all the room and time assignments automatically, while still letting coordinators review, override, and export the results.

---

## Where Does It Fit in the Overall Workflow?

The Automatic Scheduler is **Step 1 of 2** in the scheduling pipeline:

```
Step 1 → AUTOMATIC SCHEDULER   (This module)
          Assigns: TIME SLOTS + ROOMS to subjects

Step 2 → FACULTY LOADING        (Next module)
          Assigns: TEACHERS to subjects
```

The Automatic Scheduler must be completed and saved **before** running Faculty Loading, because Faculty Loading reads the room and time data that this module produces.

---

## How to Use It (Step-by-Step)

1. **Go to the Schedule page** in the system and click the **Automatic Scheduler** tab.
2. **Check the Status** — the system will tell you if everything is ready to run.
3. **Review any issues** — the system lists missing data or problems that need to be fixed first.
4. **Run a Dry Preview** — click the button to see the generated schedule *without saving anything yet*. This is a safe test run.
5. **Review the results** — see what time slot and room each subject was assigned, the quality score, and any subjects that could not be placed.
6. **Fix issues if needed** — go to the Subjects or Rooms pages to correct any problem data, then re-run the preview.
7. **Run for Real** — turn off Dry Preview and click "Generate Schedule" to save the results to the database.
8. **Update Course Offering** — optionally push the generated schedule into the Course Offering records so the rest of the system can use it.
9. **Move to Faculty Loading** — once satisfied, proceed to assign teachers.

---

---

# 📥 INPUT — What the System Needs

Before the Automatic Scheduler can run, the following information must already be saved in the database.

---

### 1. Subjects
Each subject (course section) must have:

- **Subject code and title** — e.g., "CS-501 Database Design"
- **Section** — which group of students takes this class (e.g., "BSCS-3A")
- **Lecture hours and/or Lab hours** — how long the class runs each session
- **Units** — the weight of the subject in terms of academic load
- **Department** — which department owns this subject
- **Status** — only **Active** subjects are scheduled; inactive ones are skipped

Subjects may also have an **existing schedule and room** already saved from a previous run. The system handles these smartly (see *Two Starting Scenarios* below).

> ⚠️ Subjects with **Saturday-only** schedules are excluded from automatic scheduling and must be handled manually.

---

### 2. Rooms
Each room in the database must have:

- **Room name** — e.g., "Room 201", "CS Lab 1"
- **Room type** — either **LAB** (computer lab, science lab, etc.) or **LEC** (regular lecture room)
- **Status** — only **Active** rooms are used

Room type matters because the system tries to match subjects that need a lab to lab rooms, and regular subjects to lecture rooms.

---

### 3. Two Starting Scenarios

Before running, the system automatically detects which of two situations it is in:

**Scenario A — Some subjects already have schedules (Preserve Mode)**
- Some subjects already have a time slot and room assigned (from a previous run or manual entry).
- The system will **keep those assignments as-is** and only re-schedule the subjects that are still unassigned.
- Subjects used by multiple curricula (called **"merged" subjects**) that share the same room and time are always preserved.

**Scenario B — Clean Slate**
- No subjects have any existing schedule assignments.
- The system schedules **everything from scratch**.

The system detects this automatically — the coordinator does not need to choose.

---

### 4. Pre-Flight Check (System Readiness)

Before running, the system performs a **pre-flight check** to make sure data is complete enough to work with. It checks every subject and flags any problems:

| Status | What It Means |
|--------|--------------|
| ✅ **Ready** | All data looks good. Safe to run. |
| ⚠️ **Partial** | Some subjects have issues and will be skipped, but the rest can still be scheduled. |
| 🚫 **Blocked** | Critical data is missing. The system cannot run until fixed. |

**Common issues the pre-flight catches:**

- A subject has no schedule or no room assigned (and we're in Preserve Mode)
- A subject's Monday-Thursday room is a lab but its Tuesday-Friday room is a lecture room (they must match)
- A room is marked inactive
- A subject is missing its department

Each issue is shown with a **severity level** (High / Medium / Low) and a suggested fix.

---

---

# ⚙️ PROCESS — How the System Works

Once inputs are ready, the system runs through **7 stages** automatically. Think of each stage as a layer that handles increasingly tricky cases.

---

## Stage 1 — Data Check & Cleanup

Before anything else, the system reads all subjects and rooms from the database and prepares them for processing:

- Converts time ranges like "7:30–10:00" into a format the algorithm can compare mathematically
- Expands schedule codes: **MTH** = Monday + Thursday; **TFS** = Tuesday + Friday
- Filters out inactive subjects and inactive rooms
- Flags general education subjects that should be excluded from automated scheduling

---

## Stage 2 — Detect What to Keep vs. Re-schedule

**(Preserve Mode only — Scenario A)**

The system looks at subjects that already have a schedule and room assigned, and decides what to do with each one:

**Merged Subjects (Preserved as-is)**
- Some subjects from different curricula (study programs) are physically the same class — same room, same time. These are called **merged** subjects.
- Example: A "Database Design" class that serves both BSCS and BSIT students at the same time and room.
- The system detects these automatically by looking for subjects with identical room + time assignments.
- Merged subjects are **locked in** and never touched by the algorithm.

**Unique-Clean Subjects (Preserved as-is)**
- A subject that already has a schedule and room, and does **not** conflict with any other preserved subject.
- These are also locked in and skipped by the algorithm.

**Everything else → sent to the algorithm for (re-)scheduling.**

---

## Stage 3 — Group Subjects into Room Pools

The system organizes all unscheduled subjects into **room pools** — one pool per room.

- Lab subjects go into lab room pools
- Lecture subjects go into lecture room pools
- If a subject uses two rooms (one for MTH, one for TFS), it gets an entry in each pool

Subjects that are already preserved (merged or unique-clean) are added to their room's pool as **blocked time slots** — the algorithm knows not to place anything else there.

---

## Stage 4 — Resolve Conflicts Inside Pools

Within each room pool, the system checks if any two subjects are trying to use the same room at overlapping times.

If a conflict is found:
- The subject with **higher priority** keeps its slot (manually reviewed subjects and merged subjects win)
- The lower-priority subject is **moved out** and flagged for re-scheduling

This ensures that preserved assignments are never disturbed.

---

## Stage 5 — Move Subjects That Don't Fit (Migration)

If a subject was kicked out of its preferred room in Stage 4, the system tries to **move it to a compatible alternate room**:

- A lab subject that can't fit in its preferred lab may be moved to another available lab
- If absolutely necessary, it may be placed in a lecture room (with a small quality penalty)
- If no compatible room exists at all, the subject is added to the unresolved list

---

## Stage 6 — Greedy Fallback Placement

For all subjects still without a time slot and room, the system runs a **greedy placement** algorithm (think of it like a fast, logical best-guess approach):

- Sorts subjects: lab subjects first, then lecture subjects
- For each subject, tries time slots starting from **7:30 AM** and moving forward in 30-minute steps until **8:00 PM**
- Picks the first open slot where:
  - The room is available at that time
  - The subject's section does not already have a class at that time
  - No other class in the same section will exceed 10 hours in one day
- If a valid slot is found → the subject is assigned
- If no valid slot exists → the subject is marked as **unresolved**

---

## Stage 7 — Final Conflict Scan

As a final safety check, the system scans **all** assignments (preserved + newly scheduled) for any remaining violations:

- Two subjects in the same room at overlapping times
- A section scheduled for more than 10 hours in one day
- Any special gymnasium room rule violations

Any violations found are reported to the coordinator with details on which subjects are involved.

---

## The Rules (Constraints)

The system **strictly enforces** these rules — no assignment is ever made that breaks them:

| Rule | What It Means |
|------|--------------|
| **No Room Double-Booking** | Two subjects cannot be placed in the same room at the same time on the same day. |
| **No Section Overlap** | The same group of students (section) cannot have two classes at the same time. |
| **Max 10 Hours Per Section Per Day** | A section cannot be scheduled for more than 10 hours of class on any single day. |
| **Time Bounds** | All classes must fall between **7:30 AM and 8:00 PM**. |
| **Room Type Matching** | A subject that uses both an MTH room and a TFS room must use the **same type** for both (both lab or both lecture). |
| **Merged Subject Preservation** | Subjects that are intentionally shared across curricula are never moved or rescheduled. |
| **Saturday Exclusion** | Saturday classes are not handled by this module — they must be assigned manually. |

---

---

# 📤 OUTPUT — What the System Produces

---

### 1. Schedule Table
The main result is a **table listing every active subject with its assigned time and room**:

| Column | What It Shows |
|--------|--------------|
| **Code** | Subject code, with a tag showing if it was *Original* (preserved), *Generated* (new), or *Rescheduled* |
| **Course No.** | The curriculum course number |
| **Section** | The student group for this class |
| **Department** | Which department owns this subject |
| **Title** | Full subject name |
| **Lec / Lab Hours** | Duration of lecture and/or lab portions |
| **MTH Schedule** | The Monday–Thursday time slot (e.g., "7:30–10:00 AM") |
| **MTH Room** | The room for Monday–Thursday |
| **TFS Schedule** | The Tuesday–Friday time slot (e.g., "1:00–3:30 PM") |
| **TFS Room** | The room for Tuesday–Friday |
| **Status** | *Merged* (shared class) / *Preserved* (kept as-is) / *No Schedule* (could not place) |

---

### 2. Quality / Fitness Score
After the algorithm runs, the system gives a **quality score from 0 to 100%** showing how well the overall scheduling went:

| Score Range | Rating |
|-------------|--------|
| 95–100% | ⭐ Excellent |
| 80–94% | ✅ Good |
| 60–79% | 🟡 Fair |
| 40–59% | ⚠️ Poor |
| Below 40% | 🚨 Very Poor |

The score is based primarily on **how many subjects were successfully placed** (coverage). A score of 100% means every subject got a valid time slot and room with no conflicts.

---

### 3. Issue Reports
After a run, the system shows three types of issues in collapsible panels:

**Partial Data Issues**
- Subjects that are missing a schedule or room assignment in the database
- Example: "CS-501 has no MTH room assigned"
- Fix: Go to the Subjects page, fill in the missing data, and rerun

**Mixed Room Type Issues**
- Subjects whose Monday–Thursday room and Tuesday–Friday room are different types (one lab, one lecture)
- Example: "CS-502 uses CS Lab 1 (LAB) on MTH but Room 201 (LEC) on TFS"
- Fix: Update the room assignment so both are the same type

**Unresolved Conflicts**
- Subjects that, even after all stages, still end up in a time or room conflict with another subject
- Shows which two subjects are conflicting, when, and where
- Fix: Go to the Subjects page and manually adjust one of their schedules, then rerun

---

### 4. Export Options

Once the schedule is generated, coordinators can download the results:

| Format | Use Case |
|--------|---------|
| **CSV (.csv)** | Download the full schedule table for records or import into other tools |
| **Selected Rows CSV** | Download only the rows you choose (check boxes on the table, then click Export Selected) |

---

### 5. Update Course Offering
After a successful run, the coordinator can click **"Update Course Offering"** to copy the generated schedule into the official Course Offering records.

> ⚠️ **Important:** This action **replaces** the existing Course Offering data. The system will offer to download a **backup** (JSON file) of the current data before overwriting — always recommended.

Once updated, the rest of the system (especially Faculty Loading) will read the new schedule data from Course Offerings.

---

---

# 📖 Key Terms Glossary

| Term | Plain English Meaning |
|------|-----------------------|
| **Automatic Scheduler** | The module that assigns time slots and rooms to subjects automatically |
| **MTH** | Monday and Thursday — one half of the weekly schedule pattern |
| **TFS** | Tuesday and Friday — the other half of the weekly schedule pattern |
| **LAB Room** | A room equipped for laboratory or computer work |
| **LEC Room** | A standard lecture/classroom room |
| **Section** | A specific group of students taking a subject together (e.g., BSCS-3A) |
| **Merged Subject** | A subject that is physically shared between two or more curricula in the same room and time slot |
| **Preserve Mode** | When the system detects existing schedules and keeps them instead of replacing everything |
| **Clean Slate** | When no existing schedules are found and everything is scheduled from scratch |
| **Pool** | A group of subjects competing for the same room — the system resolves conflicts within each pool |
| **Migration** | When a subject is moved from its preferred room to an alternate compatible room |
| **Greedy Placement** | A step-by-step slot-finding strategy: try the earliest open slot and move forward until one fits |
| **Pre-Flight Check** | A readiness check the system runs before scheduling starts |
| **Dry Preview** | A safe test run that shows results without saving anything to the database |
| **Fitness / Quality Score** | A number (0–100%) rating how well the overall schedule turned out |
| **Course Offering** | The official database record of what subjects are being offered this semester, including their schedule |
| **Update Course Offering** | The action that copies the Automatic Scheduler's results into the official Course Offering records |

---

---

# 🗺️ System Snapshot

```
┌─────────────────────────────────────────────────────────────────┐
│                     AUTOMATIC SCHEDULER                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📥 INPUT                                                       │
│  ─────────────────────────────────────────────────             │
│  • Subjects (code, title, section, lec/lab hours, department)   │
│  • Rooms (name, type: LAB or LEC, active status)                │
│  • Existing schedules (if any) → Preserve Mode                  │
│  • No existing schedules → Clean Slate Mode                     │
│                         │                                       │
│                         ▼                                       │
│  ⚙️ PROCESS                                                     │
│  ─────────────────────────────────────────────────             │
│  Stage 1 → Data check & cleanup                                 │
│  Stage 2 → Detect: preserve merged/clean subjects               │
│  Stage 3 → Group remaining subjects into room pools             │
│  Stage 4 → Resolve conflicts inside each pool                   │
│  Stage 5 → Migrate subjects that don't fit to other rooms       │
│  Stage 6 → Greedy fallback: fill remaining subjects             │
│  Stage 7 → Final scan for any leftover conflicts                │
│                         │                                       │
│                         ▼                                       │
│  📤 OUTPUT                                                      │
│  ─────────────────────────────────────────────────             │
│  • Schedule Table (MTH + TFS time slots + rooms per subject)    │
│  • Quality Score (0–100% rating)                                │
│  • Issue Reports (missing data / room type mismatch / conflict) │
│  • CSV Export (full table or selected rows)                     │
│  • Update Course Offering (save results to official records)    │
│                         │                                       │
│                         ▼                                       │
│  ➡️  NEXT STEP: Faculty Loading                                 │
│     (Assign teachers to the now-scheduled subjects)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## How the Two Scheduling Modules Connect

```
┌─────────────────────┐        ┌─────────────────────┐
│  AUTOMATIC          │        │  FACULTY LOADING     │
│  SCHEDULER          │──────▶ │                      │
│                     │        │                      │
│  Assigns:           │        │  Assigns:            │
│  • Time slots       │        │  • Teachers          │
│  • Rooms            │        │    to subjects       │
└─────────────────────┘        └─────────────────────┘
       Step 1                         Step 2
  (Do this first)              (Do this after Step 1)
```

The Automatic Scheduler feeds its room and time data into the Faculty Loading module. Running them in the correct order ensures teachers are assigned to classes that already have a confirmed schedule.

---

*This document covers the Automatic Scheduler module of ChronoMaria. For the faculty assignment process, refer to `README_FacultyLoading.md`.*
