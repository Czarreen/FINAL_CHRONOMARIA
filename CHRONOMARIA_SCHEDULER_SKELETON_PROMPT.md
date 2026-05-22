# Chronomaria Schedule GA — Skeleton Implementation Prompt

> **Purpose**: A single, copy-pasteable prompt to scaffold the entire
> `optimizer_sched.py` rewrite. Pass this to any LLM (or follow it manually)
> to generate the directory structure, empty files, function signatures,
> docstrings, and TODO markers. **No business logic is implemented** —
> only the scaffolding. Implementation happens file-by-file afterward.

---

## Context for the Implementer

You are scaffolding a Genetic Algorithm-based schedule optimizer for
**Chronomaria**, a web-based faculty loading automation system for
Saint Mary's University (BS Thesis project).

### Stack
- **Frontend**: React (Vite) — already built, do not touch
- **Backend API**: Node.js/Express — already built, do not touch except `gaController.js`
- **GA Service**: Python (this rewrite) — invoked by Node via subprocess (`run.py`)
- **Database**: Supabase (PostgreSQL) — Node owns all DB access; Python is stateless

### Existing Project Structure
```
FINAL_CHRONOMARIA/
├── Frontend/                       # React — DO NOT MODIFY
├── Backend/
│   ├── node-api/                   # Node — minor changes only (gaController.js)
│   ├── migrations/                 # add new migration here
│   └── shared/db/connection.py     # exists, do not touch
├── GeneticAlgorithm/
│   ├── optimizer.py                # faculty loading GA — DO NOT MODIFY
│   └── optimizer_sched.py          # CURRENTLY EMPTY — this rewrite targets this file
├── .venv/                          # use this Python env
├── run.py                          # entry point, called by Node
└── PROJECT_STRUCTURE.md
```

### The Bug Being Fixed
The previous schedule optimizer produced outputs like:
```
Eng Math 2, 1A, 1:00-2:30, Room 1200/1195
GPIC,       1A, 1:30-3:00, Room 1200
```
Same section, overlapping times, overlapping rooms — a hard conflict.
The downstream notification system catches it; the GA itself did not.
Additionally, a run of 359 input subjects produced 345 output subjects
(14 silently dropped).

### Architectural Principles for the Rewrite
1. **Hard constraints are rejected, not penalized** — GA fitness returns
   `-inf` for any solution with conflicts. Solutions with hard violations
   never survive selection.
2. **Subject census invariant** — at every stage transition,
   `len(input) == len(all_buckets_combined)`. Silent drops are impossible.
3. **One canonical conflict detector** — shared logic between Python GA
   and Node's `scheduleConflictChecker.js`, tested against shared fixtures
   in `Backend/shared/conflict_test_cases.json`.
4. **General subjects are LOCKED** — external faculty controls them;
   never modified by the GA.
5. **Merged subjects move as units** — same time + same room for all members.
6. **Stateless Python** — Node passes input JSON via stdin, Python returns
   output JSON via stdout. No DB access from Python.

### The Flow (Implemented Across the Skeleton)
```
PRE-FLIGHT  → tag subjects: GENERAL | MERGED | REGULAR × SCHEDULED | EMPTY
              place into buckets: LOCKED / MERGED_GROUPS / PENDING
              assert census invariant

STAGE 1     → fix merged groups against LOCKED, then against each other
              RESOLVED ← LOCKED ∪ fixed merged groups

STAGE 2/3   → tight loop:
              triage PENDING (move conflict-free to RESOLVED)
              run GA on remaining PENDING with RESOLVED as hard constraints
              validate, move clean to RESOLVED, conflicted back to PENDING
              halt on convergence or max iterations

OUTPUT      → concat ALL buckets (RESOLVED + UNRESOLVABLE + MANUAL_REVIEW)
              with tags preserved
              assert |output| == |input|
```

### Real-World Data Quirks (from TestImport.csv)
The CSV master list has these complications the implementation must handle:
- **Schedule strings have day overrides**: `"1:00-3:00 M"`, `"1:30-4:30 F Lab, T Lec"`,
  `"1:30-3:00 Sat"`, `"4:30-6:00 T"`, `"7:30-10:30, 11:00-1:00"`
- **Compound rooms**: `"E301/E401"`, `"1200/1195"` — must expand to sets
- **Merged column is freeform**: `"CS 4"`, `"CS1A"`, `"4754"`, `"IT 2B LIS 2A"`,
  `'"IT 2B, CS 2A"'`, numeric values like `"40"`, `"10"` (may be typos)
- **Empty CODE rows**: NSTP 2 rows have null code — placeholder subjects
- **Fully empty rows**: some subjects have only curr_id/code/section, nothing else
- **Schedule without room** (or vice versa): partial state
- **General subject identification**: G*, CFE*, PATH FIT, NSTP, AdvOral Com
  prefixes appear to mark general subjects, but confirm with the actual DB flag

### Library Stack (already decided)
- `deap` — GA framework (thesis: academic standard, citeable)
- `pydantic` — input/output validation (catches malformed data at boundary)
- `pandas` — data manipulation, census checks
- `intervaltree` — fast O(log n) time-overlap queries
- `numpy` — required by deap, also for statistics
- `pytest` — testing
- `matplotlib` — Gantt charts and convergence plots for thesis Results chapter

---

## Scaffolding Tasks (Execute in Order)

### Task 1: Create the directory structure

Inside `GeneticAlgorithm/`, create:

```
GeneticAlgorithm/
├── optimizer.py                    # existing — do not touch
├── optimizer_sched.py              # currently empty — will become thin entry point
├── requirements.txt                # add new file
├── sched/                          # NEW package — all rewrite lives here
│   ├── __init__.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── subject.py
│   │   ├── schedule.py
│   │   ├── room.py
│   │   └── merge_group.py
│   ├── conflict/
│   │   ├── __init__.py
│   │   ├── detector.py
│   │   ├── intervals.py
│   │   └── room_sets.py
│   ├── flow/
│   │   ├── __init__.py
│   │   ├── preflight.py
│   │   ├── stage1_merged.py
│   │   ├── stage2_triage.py
│   │   ├── stage3_ga.py
│   │   ├── census.py
│   │   └── state.py
│   ├── ga/
│   │   ├── __init__.py
│   │   ├── deap_setup.py
│   │   ├── fitness.py
│   │   ├── operators.py
│   │   ├── repair.py
│   │   └── initialization.py
│   └── io/
│       ├── __init__.py
│       ├── parser.py
│       └── formatter.py
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── test_conflict_detector.py
    ├── test_intervals.py
    ├── test_room_sets.py
    ├── test_preflight.py
    ├── test_census.py
    ├── test_merged_groups.py
    ├── test_ga_fitness.py
    ├── test_ga_operators.py
    ├── test_repair.py
    ├── test_stage2_triage.py
    ├── test_stage3_ga.py
    ├── test_parser.py
    ├── test_formatter.py
    ├── test_end_to_end.py
    └── fixtures/
        ├── eng_math_gpic_conflict.json    # the original bug case
        ├── sample_master_list_small.json  # 10-20 subjects for quick tests
        ├── sample_master_list_full.json   # 359-subject regression test
        └── merged_groups_sample.json
```

Inside `Backend/shared/`, add:
```
Backend/shared/
├── db/connection.py                # exists
└── conflict_test_cases.json        # NEW — shared fixtures for Python + Node detectors
```

Inside `Backend/migrations/`, add:
```
Backend/migrations/
├── 001_*.sql ... 007_*.sql         # existing
└── 008_add_schedule_tags.sql       # NEW
```

---

### Task 2: Create `requirements.txt`

```txt
# GA framework
deap>=1.4.0

# Data validation at the I/O boundary
pydantic>=2.0.0

# Data manipulation and census checks
pandas>=2.0.0

# Fast interval overlap queries for conflict detection
intervaltree>=3.1.0

# Numerical operations (deap dependency, also stats)
numpy>=1.24.0

# Testing
pytest>=7.4.0

# Thesis visualizations
matplotlib>=3.7.0
```

---

### Task 3: Scaffold `sched/models/` (Pydantic models)

For each file below, create with docstrings, class signatures, field
definitions with types, and `# TODO:` markers for validators.
Do NOT implement validation logic yet.

#### `sched/models/subject.py`
```python
"""
Pydantic models for course offering subjects.

A Subject is one row from the course offering master list. It corresponds
to one course-section pairing (e.g., "Eng Math 2 / CE / 1A").

Each subject can have an MTh schedule, a TFS schedule, or both. Schedule
strings may include day-pattern overrides (e.g., "1:00-3:00 M" means
Monday only, not the default MTh).

Imports:
    from pydantic import BaseModel, Field, field_validator
    from typing import Optional
    from enum import Enum
"""

class SubjectType(str, Enum):
    """How the subject is categorized for scheduling purposes."""
    GENERAL = "general"   # External faculty — LOCKED, never modified
    MERGED = "merged"     # Part of a merge group — moved as a unit
    REGULAR = "regular"   # Standard subject — GA may freely schedule

class SubjectState(str, Enum):
    """Whether the subject has scheduling data filled in."""
    SCHEDULED = "scheduled"  # Has at least one (schedule, room) pair
    EMPTY = "empty"          # Both MTh and TFS slots are null

class SubjectTag(str, Enum):
    """Visual tag applied to the output for the frontend."""
    GENERAL = "General"
    ORIGINAL = "Original"
    GENERATED = "Generated"
    RESCHEDULED = "Rescheduled"
    UNRESOLVABLE = "Unresolvable"
    MANUAL_REVIEW = "Manual Review"

class Subject(BaseModel):
    """
    One row from the course offering master list.

    Mirrors the columns from the CSV import:
    Curr ID, CODE, COURSE NO., DEPT, SECTION, DESCRIPTIVE TITLE,
    Units, Lec(hrs), Lab(hrs), MTh SCHEDULE, MTh Room,
    TFS SCHEDULE, TFS Room, MERGED
    """
    # Core identity
    curr_id: int
    code: Optional[str]              # may be null (e.g., NSTP placeholders)
    course_no: str
    department_id: str               # e.g., "AR", "CE", "IT", "CS", "LIS"
    section: str                     # e.g., "1A", "2B"
    descriptive_title: str

    # Hours
    units: float
    lec_hrs: float
    lab_hrs: float

    # MTh slot
    mth_schedule: Optional[str]      # raw string from CSV, may have overrides
    mth_room: Optional[str]          # may be compound: "E301/E401"

    # TFS slot
    tfs_schedule: Optional[str]
    tfs_room: Optional[str]

    # Merge info
    merged_with: Optional[str]       # raw value from MERGED column, freeform

    # Computed at PRE-FLIGHT (not in CSV)
    subject_type: Optional[SubjectType] = None
    subject_state: Optional[SubjectState] = None
    tag: Optional[SubjectTag] = None

    # TODO: validator to normalize empty strings to None
    # TODO: validator to detect general subjects (G*, CFE*, PATH FIT, NSTP, etc.)
    #       or to read from a passed-in is_general flag — confirm with team
    # TODO: validator to detect SCHEDULED vs EMPTY state
    # TODO: helper method `is_general() -> bool`
    # TODO: helper method `is_empty() -> bool`
    # TODO: helper method `has_mth_slot() -> bool`
    # TODO: helper method `has_tfs_slot() -> bool`
```

#### `sched/models/schedule.py`
```python
"""
Parsed schedule representations.

Schedule strings in the CSV are messy:
  - "1:00-2:30"                       — simple, uses default day pattern
  - "1:00-3:00 M"                     — override: Monday only
  - "1:30-4:30 F Lab, T Lec"          — split lab/lec across days
  - "1:30-3:00 Sat"                   — Saturday only
  - "7:30-10:30, 11:00-1:00"          — split session same day
  - "4:30-6:00 T"                     — Tuesday only

This module parses raw strings into structured time blocks.

Imports:
    from pydantic import BaseModel
    from typing import List, Optional
    from enum import Enum
"""

class Day(str, Enum):
    MON = "M"
    TUE = "T"
    WED = "W"
    THU = "Th"
    FRI = "F"
    SAT = "Sat"

class DayPattern(str, Enum):
    """The default day pattern based on which column the schedule is in."""
    MTH = "MTh"      # Monday + Thursday
    TFS = "TFS"      # Tuesday + Friday + Saturday

class TimeBlock(BaseModel):
    """One contiguous time range on one specific day."""
    day: Day
    start_minutes: int   # minutes since midnight, e.g., 13:00 = 780
    end_minutes: int

    # TODO: validator: end > start
    # TODO: validator: 0 <= start < 1440 and 0 < end <= 1440
    # TODO: method `overlaps(other: TimeBlock) -> bool`
    #       returns True iff same day AND start < other.end AND other.start < end

class ParsedSchedule(BaseModel):
    """A schedule string fully decomposed into TimeBlocks."""
    raw: str                          # original CSV string, preserved for debugging
    default_pattern: DayPattern       # MTH if from mth_schedule column, else TFS
    blocks: List[TimeBlock]           # all time blocks across all days
    has_override: bool                # True if raw contained day codes like " M", " Sat"

    # TODO: classmethod `parse(raw: str, default_pattern: DayPattern) -> ParsedSchedule`
    #       handles all the edge cases above
    # TODO: method `conflicts_with(other: ParsedSchedule) -> bool`
    #       True if any block overlaps any block of other
```

#### `sched/models/room.py`
```python
"""
Room models.

Rooms can be compound (e.g., "E301/E401" means a lab uses both rooms
simultaneously). The detector must treat these as occupying ALL listed
rooms during the scheduled time.

Imports:
    from pydantic import BaseModel
    from typing import Set, Optional, List
"""

class Room(BaseModel):
    """A single physical room."""
    room_id: str           # e.g., "E301", "AP202", "Gym", "TC 1"
    capacity: Optional[int] = None
    # TODO: any other fields the existing Rooms table has — confirm with Node side

class RoomAssignment(BaseModel):
    """
    A room assignment for one schedule slot. May reference multiple rooms
    (compound assignment like "E301/E401").
    """
    raw: str                  # original CSV string, preserved for debugging
    room_ids: Set[str]        # parsed set: {"E301", "E401"}

    # TODO: classmethod `parse(raw: str) -> RoomAssignment`
    #       splits on "/" and trims whitespace
    #       handles None/empty string → empty set
    # TODO: method `conflicts_with(other: RoomAssignment) -> bool`
    #       True iff intersection of room_ids is non-empty
```

#### `sched/models/merge_group.py`
```python
"""
A merge group: 2+ subjects that share the same time + room.

The MERGED column in the CSV identifies these, but the format is messy:
  - "CS 4", "CS1A", "CS2A"       — section codes
  - "4754"                         — course code/curr_id reference
  - "IT 2B LIS 2A"                 — multiple section refs (space-separated)
  - '"IT 2B, CS 2A"'               — multiple refs (comma-separated)
  - "LIS A", "LIS 1A"              — variant section codes
  - "40", "10"                     — numeric (probably typos? confirm)

The merge detector (existing, working — do not rewrite) outputs MergeGroup
instances. This module just defines the data shape.

Imports:
    from pydantic import BaseModel
    from typing import List
    from sched.models.subject import Subject
"""

class MergeGroup(BaseModel):
    """A set of subjects that must share schedule + room."""
    group_id: str                    # unique identifier for the group
    members: List[Subject]           # 2+ subjects
    is_pre_existing: bool            # True if discovered from CSV merged_with
                                     # False if detected during scheduling

    # TODO: method `all_scheduled() -> bool`
    #       True iff every member.subject_state == SCHEDULED
    # TODO: method `any_empty() -> bool`
    # TODO: method `shared_schedule() -> ParsedSchedule | None`
    #       Returns the schedule all members share, or None if inconsistent
    # TODO: method `shared_room() -> RoomAssignment | None`
    # TODO: method `validate_still_merged() -> bool`
    #       Asserts all members have identical schedule + room
```

---

### Task 4: Scaffold `sched/conflict/`

#### `sched/conflict/intervals.py`
```python
"""
Time interval parsing and overlap math.

The single source of truth for parsing time strings and checking overlap.
Used by both ParsedSchedule.parse() and the conflict detector.

Imports:
    from typing import Tuple, Optional
    import re
"""

# TODO: function `parse_time(s: str) -> int`
#       "9:00" → 540, "13:30" → 810, "1:00" → 60 (AM)
#       NOTE: schedule uses 12-hour-ish format without AM/PM markers.
#       Confirm convention: probably afternoon times are unambiguous from
#       context (1:00 in a "1:00-3:00" range likely means 1 PM since
#       schedules don't span midnight). Document the assumption clearly.

# TODO: function `parse_time_range(s: str) -> Tuple[int, int]`
#       "1:00-2:30" → (60, 150) — or with PM assumption: (780, 870)
#       returns (start_minutes, end_minutes)

# TODO: function `overlaps(a_start: int, a_end: int,
#                          b_start: int, b_end: int) -> bool`
#       returns a_start < b_end and b_start < a_end
#       This is THE one and only overlap check used everywhere.

# TODO: function `strip_day_overrides(s: str) -> Tuple[str, List[str]]`
#       Separates time portion from day codes.
#       "1:00-3:00 M" → ("1:00-3:00", ["M"])
#       "1:30-4:30 F Lab, T Lec" → ("1:30-4:30", ["F:Lab", "T:Lec"])
#       "7:30-10:30, 11:00-1:00" → ("7:30-10:30, 11:00-1:00", [])
```

#### `sched/conflict/room_sets.py`
```python
"""
Room ID set expansion for compound rooms.

"E301/E401" → {"E301", "E401"}

Imports:
    from typing import Set, Optional
"""

# TODO: function `expand_room_string(s: Optional[str]) -> Set[str]`
#       None or "" → set()
#       "E301" → {"E301"}
#       "E301/E401" → {"E301", "E401"}
#       Strips whitespace, normalizes case if needed.

# TODO: function `rooms_conflict(a: Optional[str], b: Optional[str]) -> bool`
#       Returns True iff expand_room_string(a) & expand_room_string(b) is non-empty.
```

#### `sched/conflict/detector.py`
```python
"""
THE canonical conflict detector.

A conflict between two subjects requires:
    time overlap (interval math)
  AND
    (same section OR room overlap OR same faculty)

This is the ONLY conflict check used by:
  - Pre-flight tagging
  - Stage 1 merged-group checks
  - Stage 2 triage
  - Stage 3 GA fitness function (hard rejection)
  - Stage 3 post-GA validation

Must produce IDENTICAL results to:
  Backend/node-api/src/lib/scheduleConflictChecker.js

Both implementations are tested against:
  Backend/shared/conflict_test_cases.json

Imports:
    from typing import List, Optional, Tuple
    from enum import Enum
    from sched.models.subject import Subject
    from sched.conflict.intervals import overlaps
    from sched.conflict.room_sets import rooms_conflict
"""

class ConflictReason(str, Enum):
    """Why two subjects conflict. May have multiple reasons simultaneously."""
    TIME_OVERLAP = "time_overlap"        # always required for a conflict
    SAME_SECTION = "same_section"
    ROOM_OVERLAP = "room_overlap"
    SAME_FACULTY = "same_faculty"        # if faculty info available

class ConflictReport:
    """Records a single detected conflict between two subjects."""
    # TODO: fields: subject_a_id, subject_b_id, reasons: List[ConflictReason],
    #               slot ("MTh" | "TFS"), details: dict

# TODO: function `conflicts(a: Subject, b: Subject) -> Optional[ConflictReport]`
#       The canonical predicate. Returns None if no conflict, else a ConflictReport
#       listing all reasons.
#       Check BOTH the mth slot pair AND the tfs slot pair.
#       Check all three axes (section, room, faculty) when times overlap.

# TODO: function `find_all_conflicts(subjects: List[Subject]) -> List[ConflictReport]`
#       O(n²) naive version for correctness. Use intervaltree later for speed.

# TODO: function `has_any_conflicts(subjects: List[Subject]) -> bool`
#       Short-circuit version for quick checks.
```

---

### Task 5: Scaffold `sched/flow/`

#### `sched/flow/state.py`
```python
"""
Pipeline state object — the single source of truth as subjects flow
through PRE-FLIGHT → STAGE 1 → STAGE 2/3 loop → OUTPUT.

Invariant: at all times, every input subject is in exactly one bucket.
No subject may exist in two buckets. No subject may vanish.

Imports:
    from pydantic import BaseModel
    from typing import List, Dict
    from sched.models.subject import Subject
    from sched.models.merge_group import MergeGroup
"""

class PipelineState(BaseModel):
    """
    Holds all buckets. Mutates as subjects move between stages.

    BUCKETS:
      locked          : LOCKED — general subjects, never modified
      merged_groups   : grouped subjects awaiting Stage 1 or already fixed
      resolved        : conflict-free, finalized — growing baseline
      pending         : awaiting GA work (NEEDS_RESCHEDULE or NEEDS_GENERATION)
      unresolvable    : GA could not schedule within max iterations
      manual_review   : GENERAL+EMPTY edge cases — flagged for humans
    """
    locked: List[Subject]
    merged_groups: List[MergeGroup]
    resolved: List[Subject]
    pending: List[Subject]
    unresolvable: List[Subject]
    manual_review: List[Subject]

    # Metadata
    original_input_ids: List[int]    # set at construction, never mutated
    iteration_count: int = 0
    max_iterations: int = 50

    # TODO: method `total_count() -> int`
    #       sum of len of all buckets, including merged_groups flattened
    # TODO: method `all_subject_ids() -> Set[int]`
    #       union of IDs across all buckets
    # TODO: method `has_pending() -> bool`
    # TODO: method `converged() -> bool`
    #       True if pending is empty and no movement happened last iteration
    # TODO: method `max_iterations_reached() -> bool`
    # TODO: method `move_to_resolved(subject: Subject) -> None`
    #       Helper that removes from current bucket and adds to resolved.
    #       Asserts the subject was in exactly one bucket before move.
```

#### `sched/flow/census.py`
```python
"""
Subject census invariant enforcement.

The 359→345 silent drop bug was preventable with these assertions.
Run at every stage transition.

Imports:
    from sched.flow.state import PipelineState
    from typing import List
    from sched.models.subject import Subject
"""

class CensusViolationError(Exception):
    """Raised when subject count or identity invariants are violated."""
    # TODO: fields: stage_name, expected_ids, actual_ids,
    #               missing_ids, duplicate_ids

# TODO: function `assert_invariant(original_input: List[Subject],
#                                  state: PipelineState,
#                                  stage_name: str) -> None`
#       Checks:
#         1. state.total_count() == len(original_input)
#         2. state.all_subject_ids() == {s.curr_id for s in original_input}
#         3. No subject appears in two buckets simultaneously
#       Raises CensusViolationError with detailed diagnostics on failure.

# TODO: function `census_summary(state: PipelineState) -> dict`
#       Returns a dict suitable for the output JSON's `census` field:
#         {
#           "input_count": N,
#           "output_count": M,
#           "by_bucket": {"locked": .., "resolved": .., ...},
#           "by_tag": {"General": .., "Original": .., ...}
#         }
```

#### `sched/flow/preflight.py`
```python
"""
PRE-FLIGHT stage.

Takes raw parsed subjects, tags them, assigns to buckets.

Imports:
    from typing import List
    from sched.models.subject import Subject, SubjectType, SubjectState, SubjectTag
    from sched.models.merge_group import MergeGroup
    from sched.flow.state import PipelineState
"""

# TODO: function `classify_subject_type(subject: Subject) -> SubjectType`
#       GENERAL if course_no matches general patterns (G*, CFE*, PATH FIT,
#       NSTP, AdvOral Com, For Lang, etc.) — confirm exact rule with team.
#       MERGED if subject.merged_with is non-empty.
#       REGULAR otherwise.

# TODO: function `classify_subject_state(subject: Subject) -> SubjectState`
#       EMPTY if both mth and tfs slots are null.
#       SCHEDULED if at least one slot has a schedule + room.

# TODO: function `detect_merge_groups(subjects: List[Subject]) -> List[MergeGroup]`
#       Parses the messy merged_with column and groups related subjects.
#       NOTE: existing merge detector logic works — port it here, do not redesign.

# TODO: function `run_preflight(subjects: List[Subject]) -> PipelineState`
#       1. Tag each subject with type and state
#       2. Detect merge groups
#       3. Place into buckets:
#          - GENERAL + SCHEDULED → locked (tag: General)
#          - GENERAL + EMPTY → manual_review (flag for humans)
#          - MERGED + all SCHEDULED → merged_groups (tag: Original)
#          - MERGED + any EMPTY → pending (will be scheduled together)
#          - REGULAR + SCHEDULED → pending (NEEDS_RESCHEDULE — check conflicts later)
#          - REGULAR + EMPTY → pending (NEEDS_GENERATION)
#       4. Construct PipelineState
#       5. Assert census invariant
#       6. Return state
```

#### `sched/flow/stage1_merged.py`
```python
"""
STAGE 1: Fix merged groups.

Merged groups must move as units (shared time + room). Fix conflicts
against LOCKED first, then against each other.

Imports:
    from sched.flow.state import PipelineState
    from sched.flow.census import assert_invariant
    from sched.conflict.detector import find_all_conflicts
"""

# TODO: function `fix_merged_vs_locked(state: PipelineState) -> PipelineState`
#       For each merged group conflicting with locked: reschedule as a unit.
#       Use the GA's group-rescheduling operator.

# TODO: function `fix_merged_vs_merged(state: PipelineState) -> PipelineState`
#       For each pair of merged groups in conflict: reschedule one as a unit.

# TODO: function `run_stage1(state: PipelineState,
#                            original_input: List[Subject]) -> PipelineState`
#       1. fix_merged_vs_locked
#       2. fix_merged_vs_merged
#       3. Promote all fixed merged groups into resolved (flatten members)
#       4. Assert census invariant
#       5. Return state
#       FAILURE MODE: if a merged group cannot be scheduled, move it to
#       unresolvable (NEVER silently drop).
```

#### `sched/flow/stage2_triage.py`
```python
"""
STAGE 2: Triage pending subjects.

Scheduled subjects that don't conflict with RESOLVED can be promoted
directly. Empty subjects stay in pending (no schedule to check).

Imports:
    from sched.flow.state import PipelineState
    from sched.conflict.detector import conflicts
"""

# TODO: function `triage(state: PipelineState) -> PipelineState`
#       For each subject in pending:
#         - If EMPTY → leave in pending
#         - If SCHEDULED:
#             - If conflicts with any subject in resolved → leave in pending
#             - Else → move to resolved (tag: Original)
#       Return mutated state.
```

#### `sched/flow/stage3_ga.py`
```python
"""
STAGE 3: Run GA on remaining pending subjects.

Uses RESOLVED as hard constraints — GA outputs cannot conflict with any
subject in resolved.

Imports:
    from sched.flow.state import PipelineState
    from sched.ga.deap_setup import run_ga_optimization
    from sched.conflict.detector import find_all_conflicts
"""

# TODO: function `prepare_pending_for_ga(state: PipelineState) -> List[Subject]`
#       Clears schedule/room of NEEDS_RESCHEDULE subjects (treat as blank).
#       Leaves NEEDS_GENERATION as-is (already blank).
#       Returns list ready for GA.

# TODO: function `validate_ga_output(ga_output: List[Subject],
#                                    resolved: List[Subject]) -> Tuple[List, List]:
#       Returns (clean, conflicted):
#         clean = subjects with no internal conflicts AND no conflicts vs resolved
#         conflicted = the rest
#       CRITICAL: must include EVERY input subject in one of the two lists.
#       Assert |ga_output| == |clean| + |conflicted| to prevent silent drops.

# TODO: function `run_stage3(state: PipelineState,
#                            original_input: List[Subject]) -> PipelineState`
#       1. prepare_pending_for_ga
#       2. run_ga_optimization with state.resolved as hard constraints
#       3. validate_ga_output
#       4. Move clean to resolved (tag: Generated or Rescheduled based on origin)
#       5. Move conflicted back to pending
#       6. Increment iteration_count
#       7. Assert census invariant
#       8. Return state
```

---

### Task 6: Scaffold `sched/ga/`

#### `sched/ga/deap_setup.py`
```python
"""
DEAP toolbox setup.

Chromosome representation: a list of (subject_idx, day_pattern, start_minutes,
room_id) tuples — one per pending subject. LOCKED subjects in resolved are
hard constraints, not genes.

Imports:
    from deap import base, creator, tools, algorithms
    from typing import List
    from sched.models.subject import Subject
"""

# TODO: setup creator.FitnessMax (or FitnessMulti for multi-objective)
# TODO: setup creator.Individual

# TODO: function `build_toolbox(pending: List[Subject],
#                               resolved: List[Subject],
#                               rooms: List[Room],
#                               timeslots: dict) -> base.Toolbox`
#       Registers:
#         - individual: chromosome factory
#         - population: List[Individual] factory
#         - evaluate: fitness function (see sched/ga/fitness.py)
#         - mate: crossover (see sched/ga/operators.py)
#         - mutate: mutation (see sched/ga/operators.py)
#         - select: tournament selection
#         - repair: Lamarckian repair (see sched/ga/repair.py)

# TODO: function `run_ga_optimization(pending: List[Subject],
#                                     resolved: List[Subject],
#                                     rooms: List[Room],
#                                     timeslots: dict,
#                                     generations: int = 100,
#                                     pop_size: int = 200) -> List[Subject]`
#       Main GA loop.
#       1. Build toolbox
#       2. Initialize population (warm-start from initialization.py)
#       3. For each generation:
#          a. Evaluate
#          b. Select parents
#          c. Crossover + mutation
#          d. Apply repair operator
#          e. Re-evaluate
#       4. Return best individual decoded back to List[Subject]
#       CRITICAL: output must contain ALL input pending subjects.
#       Assert this before returning.
```

#### `sched/ga/fitness.py`
```python
"""
Fitness function with HARD constraint rejection.

The fix for the previous bug. Solutions with any hard conflict get
-inf fitness and never survive selection.

Imports:
    from sched.conflict.detector import find_all_conflicts, ConflictReason
    from sched.models.subject import Subject
    from typing import List, Tuple
"""

# Soft objective weights (tunable)
WEIGHT_ROOM_BALANCE = 1.0
WEIGHT_TIME_DISTRIBUTION = 1.0
WEIGHT_FACULTY_GAPS = 1.0   # if faculty info available

# TODO: function `count_hard_conflicts(individual: List[Subject],
#                                      resolved: List[Subject]) -> int`
#       Counts conflicts within individual + conflicts vs resolved.

# TODO: function `evaluate(individual_chromosome,
#                          pending_template: List[Subject],
#                          resolved: List[Subject]) -> Tuple[float]`
#       1. Decode chromosome into List[Subject]
#       2. hard = count_hard_conflicts(...)
#       3. If hard > 0: return (float('-inf'),)
#       4. Compute soft score (room balance, time spread, etc.)
#       5. Return (soft_score,)

# TODO: function `soft_score(individual: List[Subject]) -> float`
#       Weighted sum of soft objectives. Higher is better.
```

#### `sched/ga/operators.py`
```python
"""
Custom crossover and mutation operators.

Constraints these operators must respect:
  - Merged groups stay merged (treat as super-genes, swap together)
  - LOCKED subjects are not in the chromosome (immutable)
  - Resolved baseline is read-only (constraint, not gene)

Imports:
    from deap import tools
    import random
    from sched.models.subject import Subject
"""

# TODO: function `crossover_two_point_grouped(ind1, ind2)`
#       Two-point crossover that respects merged-group boundaries.

# TODO: function `mutate_reschedule(individual, mutation_rate: float)`
#       For each gene with probability mutation_rate:
#         - Pick a new (day_pattern, start_minutes, room_id) tuple
#         - If gene is part of a merged group, apply same mutation to all members
```

#### `sched/ga/repair.py`
```python
"""
Lamarckian repair operator.

After crossover/mutation, fix conflicts by nudging affected genes to
nearby free slots. Keeps the search efficient and feasible.

Imports:
    from sched.conflict.detector import find_all_conflicts
    from sched.models.subject import Subject
    from typing import List
"""

# TODO: function `repair(individual: List[Subject],
#                        resolved: List[Subject],
#                        max_attempts: int = 10) -> List[Subject]`
#       1. Find all conflicts in individual (and vs resolved)
#       2. For each conflict:
#          a. Pick one of the two subjects (the non-merged one if possible)
#          b. Find nearest free (day, time, room) triple
#          c. Reassign
#       3. Repeat until no conflicts or max_attempts reached
#       4. Return repaired individual

# TODO: function `find_free_slot(subject: Subject,
#                                others: List[Subject],
#                                rooms: List[Room],
#                                timeslots: dict) -> Optional[Tuple]`
#       Returns first (day_pattern, start_minutes, room_id) with no conflict,
#       or None if exhausted.
```

#### `sched/ga/initialization.py`
```python
"""
Warm-start heuristic initialization.

Instead of random initial population, use a greedy schedule that respects
locked constraints and merged-group requirements. Better starting point
means faster convergence and fewer wasted generations.

Imports:
    from sched.models.subject import Subject
    from typing import List
"""

# TODO: function `greedy_schedule(pending: List[Subject],
#                                 resolved: List[Subject],
#                                 rooms: List[Room],
#                                 timeslots: dict) -> List[Subject]`
#       For each pending subject (sorted by constraint difficulty):
#         - Find first free (day, time, room) that doesn't conflict
#         - Assign
#       Returns one valid initial individual.

# TODO: function `seeded_population(pending: List[Subject],
#                                   resolved: List[Subject],
#                                   rooms: List[Room],
#                                   timeslots: dict,
#                                   pop_size: int) -> List`
#       Mix: 10% greedy_schedule, 90% perturbations of it.
#       Gives the GA a good starting point but preserves diversity.
```

---

### Task 7: Scaffold `sched/io/`

#### `sched/io/parser.py`
```python
"""
Parse JSON input from Node into Pydantic models.

Input contract (from Backend/node-api/src/controllers/gaController.js):
{
  "subjects": [
    {
      "curr_id": 945,
      "code": "4065",
      "course_no": "Eng Math 2",
      "department_id": "CE",
      "section": "1A",
      "descriptive_title": "Engineering Data Analysis",
      "units": 3,
      "lec_hrs": 3,
      "lab_hrs": 0,
      "mth_schedule": "1:00-2:30",
      "mth_room": "1200/1195",
      "tfs_schedule": null,
      "tfs_room": null,
      "merged_with": null
    }
  ],
  "rooms": [...],
  "constraints": {
    "max_iterations": 50,
    "timeslots": {...},
    "days": ["M","T","W","Th","F","Sat"]
  }
}

Imports:
    import json
    from typing import Dict, List
    from sched.models.subject import Subject
    from sched.models.room import Room
"""

# TODO: function `parse_input(raw_json: str | dict) -> Tuple[List[Subject],
#                                                            List[Room], dict]`
#       1. Parse JSON
#       2. Validate via Pydantic (fails loudly on malformed data)
#       3. Return (subjects, rooms, constraints)
#       Pydantic catches: missing fields, wrong types, malformed curr_ids.
```

#### `sched/io/formatter.py`
```python
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
```

---

### Task 8: Rewrite `optimizer_sched.py` as Thin Entry Point

```python
"""
Schedule GA optimizer — entry point invoked by Node via subprocess.

Reads JSON from stdin, runs the full pipeline, writes JSON to stdout.
All real logic lives in sched/*.

Usage (from Node):
    const result = spawn('python', ['optimizer_sched.py'])
    result.stdin.write(JSON.stringify(payload))
    result.stdin.end()
    // read result.stdout for JSON output
"""
import sys, json, traceback, uuid

from sched.io.parser import parse_input
from sched.io.formatter import format_output
from sched.flow.preflight import run_preflight
from sched.flow.stage1_merged import run_stage1
from sched.flow.stage2_triage import triage
from sched.flow.stage3_ga import run_stage3
from sched.flow.census import assert_invariant

def main():
    try:
        raw = json.load(sys.stdin)
        subjects, rooms, constraints = parse_input(raw)

        run_id = str(uuid.uuid4())

        # PRE-FLIGHT
        state = run_preflight(subjects)
        assert_invariant(subjects, state, "post-preflight")

        # STAGE 1
        state = run_stage1(state, subjects)
        assert_invariant(subjects, state, "post-stage1")

        # STAGE 2/3 LOOP
        generations_total = 0
        while state.has_pending() and not state.max_iterations_reached():
            prev_resolved_count = len(state.resolved)

            state = triage(state)
            assert_invariant(subjects, state, f"post-triage-iter{state.iteration_count}")

            state = run_stage3(state, subjects)
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
```

---

### Task 9: Test Scaffolding

For each test file in `GeneticAlgorithm/tests/`, create the file with:
- `import pytest`
- Test class or test functions matching the module being tested
- `# TODO: implement` markers for each test case

Key tests to scaffold (with the actual assertions to fill in):

#### `tests/conftest.py`
```python
"""Shared pytest fixtures."""
import pytest, json
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"

@pytest.fixture
def eng_math_gpic_case():
    """The original bug: same section + overlapping rooms + overlapping times."""
    with open(FIXTURES / "eng_math_gpic_conflict.json") as f:
        return json.load(f)

@pytest.fixture
def small_master_list():
    with open(FIXTURES / "sample_master_list_small.json") as f:
        return json.load(f)

@pytest.fixture
def full_master_list_359():
    """The 359-subject case that previously dropped to 345."""
    with open(FIXTURES / "sample_master_list_full.json") as f:
        return json.load(f)
```

#### `tests/test_conflict_detector.py`
```python
"""Tests for sched/conflict/detector.py."""
import pytest
# TODO: import conflicts, find_all_conflicts

class TestEngMathGpicCase:
    """Regression test for the original bug."""
    def test_detects_conflict(self, eng_math_gpic_case):
        # TODO: load both subjects, call conflicts(), assert not None
        pass

    def test_lists_all_three_reasons(self, eng_math_gpic_case):
        # TODO: assert reasons include SAME_SECTION, ROOM_OVERLAP, TIME_OVERLAP
        pass

class TestTimeOverlap:
    def test_no_overlap_separate_times(self): pass
    def test_partial_overlap(self): pass         # "1:00-2:30" vs "1:30-3:00"
    def test_exact_match(self): pass
    def test_one_contains_other(self): pass
    def test_back_to_back_no_overlap(self): pass # "1:00-2:30" vs "2:30-4:00"

class TestRoomConflict:
    def test_same_room(self): pass
    def test_different_rooms(self): pass
    def test_compound_vs_simple_overlap(self): pass  # "1200/1195" vs "1200"
    def test_compound_vs_compound_overlap(self): pass
    def test_compound_no_overlap(self): pass
```

#### `tests/test_census.py`
```python
"""Tests for sched/flow/census.py — the silent-drop prevention."""
import pytest
# TODO: import assert_invariant, CensusViolationError

def test_359_in_359_out(full_master_list_359):
    """The bug: 359 in must equal 359 across all buckets at every stage."""
    # TODO: load, run preflight, assert total_count == 359
    pass

def test_raises_on_drop():
    """Manually construct a state missing a subject — must raise."""
    # TODO
    pass

def test_raises_on_duplicate():
    """Manually construct a state with same subject in two buckets — must raise."""
    # TODO
    pass
```

---

### Task 10: Shared Conflict Fixtures (Python + Node)

#### `Backend/shared/conflict_test_cases.json`
```json
[
  {
    "name": "eng_math_gpic_original_bug",
    "description": "The bug that triggered this rewrite. Same section, overlapping times, overlapping rooms.",
    "subject_a": {
      "curr_id": 945,
      "code": "4065",
      "course_no": "Eng Math 2",
      "department_id": "CE",
      "section": "1A",
      "mth_schedule": "1:00-2:30",
      "mth_room": "1200/1195"
    },
    "subject_b": {
      "curr_id": 945,
      "code": "4070",
      "course_no": "GPIC",
      "department_id": "CE",
      "section": "1A",
      "mth_schedule": "1:30-3:00",
      "mth_room": "1200"
    },
    "expected_conflict": true,
    "expected_reasons": ["same_section", "room_overlap", "time_overlap"]
  },
  {
    "name": "no_conflict_different_sections",
    "subject_a": {
      "section": "1A",
      "mth_schedule": "1:00-2:30",
      "mth_room": "E101"
    },
    "subject_b": {
      "section": "1B",
      "mth_schedule": "1:00-2:30",
      "mth_room": "E102"
    },
    "expected_conflict": false
  },
  {
    "name": "back_to_back_not_a_conflict",
    "subject_a": {
      "section": "1A",
      "mth_schedule": "1:00-2:30",
      "mth_room": "E101"
    },
    "subject_b": {
      "section": "1A",
      "mth_schedule": "2:30-4:00",
      "mth_room": "E101"
    },
    "expected_conflict": false
  }
]
```

Both `tests/test_conflict_detector.py` (Python) and
`Backend/node-api/tests/scheduleConflictChecker.test.js` (Node) MUST
consume this file. CI fails if either detector disagrees with a case.

---

### Task 11: Database Migration

#### `Backend/migrations/008_add_schedule_tags.sql`
```sql
-- Add tag column for the new visual tagging system
ALTER TABLE course_offerings
ADD COLUMN IF NOT EXISTS tag TEXT
CHECK (tag IN (
  'General',
  'Original',
  'Generated',
  'Rescheduled',
  'Unresolvable',
  'Manual Review'
));

-- Track which GA run produced each schedule (for debugging + audit)
ALTER TABLE course_offerings
ADD COLUMN IF NOT EXISTS ga_run_id UUID;

-- Indexes to speed up conflict checks (Node's scheduleConflictChecker.js)
CREATE INDEX IF NOT EXISTS idx_course_offerings_section_mth
  ON course_offerings(section, mth_schedule);

CREATE INDEX IF NOT EXISTS idx_course_offerings_section_tfs
  ON course_offerings(section, tfs_schedule);

CREATE INDEX IF NOT EXISTS idx_course_offerings_mth_room
  ON course_offerings(mth_room_id);

CREATE INDEX IF NOT EXISTS idx_course_offerings_tfs_room
  ON course_offerings(tfs_room_id);

CREATE INDEX IF NOT EXISTS idx_course_offerings_ga_run
  ON course_offerings(ga_run_id);
```

---

### Task 12: Node-Side Update

In `Backend/node-api/src/controllers/gaController.js`, after the Python
subprocess returns, add a census validation guard:

```javascript
// After receiving Python's JSON output:
const result = JSON.parse(pythonOutput);

if (result.status === "error") {
  throw new Error(
    `GA failed: ${result.error_type}: ${result.error_message}\n` +
    `Traceback:\n${result.traceback}`
  );
}

// Census validation: catches silent drops at the API boundary
if (result.census.input_count !== result.census.output_count) {
  throw new Error(
    `GA dropped subjects: ${result.census.input_count} sent, ` +
    `${result.census.output_count} returned. ` +
    `Run ID: ${result.stats.ga_run_id}`
  );
}

// Continue with existing persistence logic
```

---

## Implementation Order After Scaffolding

Once all files exist (empty with TODO markers), implement in this order:

1. `sched/conflict/intervals.py` + `room_sets.py` + `detector.py`
   (with `tests/test_conflict_detector.py` and `test_intervals.py` passing)
2. `sched/models/*` (Pydantic models; fail loudly on bad input)
3. `sched/io/parser.py` (boundary validation)
4. `sched/flow/census.py` + `sched/flow/state.py` (invariant infrastructure)
5. `sched/flow/preflight.py` (tagging + bucket assignment)
6. `sched/ga/*` (DEAP setup, fitness, operators, repair, initialization)
7. `sched/flow/stage1_merged.py`
8. `sched/flow/stage2_triage.py`
9. `sched/flow/stage3_ga.py`
10. `sched/io/formatter.py`
11. `optimizer_sched.py` (wire it all together)
12. Node update + migration

Each step ends with passing tests. If a test fails, do not proceed to the next step.

---

## Definition of Done

- All files in the structure exist
- `requirements.txt` exists and `pip install -r requirements.txt` succeeds
- `pytest GeneticAlgorithm/tests/` runs (most will fail — that's expected at scaffold stage)
- `Backend/shared/conflict_test_cases.json` exists with the Eng Math 2 / GPIC case
- `Backend/migrations/008_add_schedule_tags.sql` exists
- `optimizer_sched.py` runs without error on `echo '{}' | python optimizer_sched.py`
  (it will return an error JSON, but it must not crash with a Python traceback)
- Git commit message: `scaffold(sched): structure for GA rewrite`

After scaffolding, implementation begins file-by-file following the order above.
