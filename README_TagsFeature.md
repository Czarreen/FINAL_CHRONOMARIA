# Implementation Summary (May 2026)

This document summarizes the changes and decisions implemented across sessions for faculty loading GA and faculty subject tagging visibility.

## Scope Covered

- Faculty subject tag priority behavior in GA
- Pre-assignment behavior and fairness when max units are hit
- Cross-department preference handling
- Faculty list UI visibility for subject tags
- Backend endpoint for bulk subject preference loading
- Preparation limit policy updated: role-aware cap for FT vs PT/Guest faculty
- Faculty loading GA default parameters updated for better optimization coverage

## Core GA Behavior (Faculty Loading)

### GA Priority Chain (Actual Selection Order)

For faculty loading, the GA evaluates candidates in this order:

1. Faculty Preferences (Subject Tags)
- Priority 1 can be pre-assigned first when eligible.
- Priority bonuses are applied during scoring: P1 = 100, P2 = 50, P3 = 15.

2. Faculty Specialization
- If no explicit preference match applies, specialization keyword matching is used.

3. Department Matching
- Same-department candidates are preferred in regular scoring.

4. Cross-Department Fallback
- Pass A (specialization match) already surfaces cross-department candidates automatically — any faculty whose specialization keywords score > 0 against a subject becomes a candidate regardless of department, ranked after same-department matches.
- Explicit P1/P2/P3 preference tags bypass department rules entirely (see Cross-department Handling for Explicit Preferences below).
- Pass C (no specialization, no tag) is restricted to the IT -> CS zero-faculty exception only.

5. Faculty Role (Applies to All Candidates)
- Faculty role weighting is always applied in scoring for every candidate (FT preferred over PT).

In short: Preferences -> Specialization (same-dept first, cross-dept second) -> Department match -> IT->CS fallback -> Role weighting across all candidates.

### Why A Candidate Falls Down To The Next Step

The GA moves down the chain when a higher-priority path cannot be used.

- From Preferences to Specialization:
  - no subject tag match for that faculty and subject, or
  - tagged faculty is ineligible (max units reached, time conflict, consecutive-hours limit, preparation limit).
- From Specialization to Department matching:
  - no eligible specialization-match candidate remains.
- From Department matching to Cross-department fallback:
  - no eligible same-department candidate remains AND no cross-department specialization match was found in Pass A.
- Cross-department Pass C fallback applies only when:
  - offering is CS,
  - CS has zero faculty records,
  - IT faculty are considered as fallback candidates.
- Note: Cross-department is NOT limited to IT->CS when going through Pass A (spec match) or explicit preferences. Only the no-spec, no-tag Pass C fallback is restricted.

If all steps fail, the subject remains unassigned in that candidate solution and GA continues searching other combinations.

### Priority Model

Subject tag priorities are interpreted as:

- Priority 1 = High (primary assignment)
- Priority 2 = Capable (secondary)
- Priority 3 = Fallback (emergency)

### Pre-assignment Rule

Only Priority 1 tags are hard pre-assigned before the regular GA candidate selection.

Priority 2 and Priority 3 are not hard-locked; they are handled through scoring bonus in normal GA assignment.

### Preference Scoring Rule

When a faculty has an explicit subject tag match:

- Priority 1 returns score 100
- Priority 2 returns score 50
- Priority 3 returns score 15

If there is no explicit preference, specialization keyword matching is used.

### Cross-department Handling for Explicit Preferences

For explicit preference-tag matches, cross-department penalty is bypassed so admin intent is not diluted.

Meaning: if faculty is explicitly tagged for a subject, they are treated like a department match for scoring multiplier.

### Capacity and Conflicts Still Apply

Even in pre-assignment, hard constraints are enforced:

- max units
- schedule overlap
- consecutive minutes limit
- SAT-only skip behavior

If Priority 1 cannot be assigned due to hard constraints, that offering falls through to regular GA.

## Preparation Limit Policy (F-H8)

The preparation limit caps how many distinct course preparations a faculty member can hold.
The cap is now role-aware to better reflect actual teaching capacity.

### Rule

- FT / Department Head: `cap = min(6, floor(max_units / 3))`, minimum 1
- PT / Guest Lecturer / others: `cap = min(4, floor(max_units / 3))`, minimum 1

### Examples

| Role | Max Units | Prep Cap |
|---|---|---|
| FT | 24 | 6 |
| FT | 21 | 6 |
| FT | 15 | 5 |
| FT | 12 | 4 |
| FT | 9  | 3 |
| PT | 12 | 4 |
| PT | 9  | 3 |
| PT | 6  | 2 |

### Why This Changed

The previous cap was a flat `min(4, floor(max_units / 3))` for all roles.
A FT faculty with 24 max units was capped at 4 distinct course preparations even when they had
12+ units of free capacity remaining. This caused `prep_units_exceeded` rejections for subjects
that the faculty could have taken on — blocking valid assignments.

### Implementation

- Function: `prep_limit_for_faculty()` in `GeneticAlgorithm/optimizer.py`
- Role check uses `normalize_role()`: "FT" or role starting with "DEPARTMENT" → FT rules apply

## Fairness Adjustment Implemented

Problem identified:

- When one faculty had many Priority 1 tags and limited max units, whichever offerings were encountered first were assigned.
- That depends on DB/offering order and is a bias source.

Fix implemented:

- Matching offerings for a Priority 1 subject code are sorted by workload descending before pre-assignment.
- Workload sort key uses:
  - units if available
  - otherwise lec_hrs + lab_hrs

Result:

- Larger classes are assigned first under the cap.
- Smaller one is more likely to be the one pushed to normal GA when cap is hit.
- Behavior is deterministic and less order-biased.

## Important Bugfix in Unit Computation

Pre-assignment unit calculation now includes lab hours when units is missing:

- old behavior: units or lec_hrs only
- new behavior: units or (lec_hrs + lab_hrs)

This prevents undercounting load for lab-bearing subjects.

## Bugfix: P2/P3 Reservation Was Inflating preps_units (False prep_units_exceeded)

### Problem

The P2/P3 reservation phase (which runs before the main assignment loop) was adding reserved
subject units to `preps_units[fi]` even though those subjects were NOT yet assigned. This caused
faculty with many P2/P3 tags to appear "prep-full" to the main loop's `_hard_eligible` check,
producing false `prep_units_exceeded` rejections for subjects they had ample capacity to teach.

Example: A faculty with max_units=24, actual load=5u, and 14u of P2/P3 reservations (never
assigned) would show `preps_units=19` to the main loop. The check `19 + 4 > 19` → false reject.
After the full run, their actual prep_units would revert to 5 — confirming the 14u reservations
were never used, yet they blocked valid assignments the entire time.

### Fix

The P2/P3 reservation phase now updates `preps_keys` only (for count-based protection via
`prep_limit_for_faculty()`), without touching `preps_units`. The remaining_capacity formula
in the reservation phase was updated accordingly to use raw teaching capacity.

`preps_units` is now only updated by actual P1 pre-assignments and main-loop assignments.

### Impact

- `prep_units_exceeded` rejections in the main loop now reflect real assignment burden only
- Faculty with P2/P3 tags are no longer incorrectly blocked from non-preferred subjects
- Subject assignment rate improved significantly

### File Changed

- `GeneticAlgorithm/optimizer.py` — P2/P3 reservation phase (~line 756)

## Faculty Loading GA Default Parameters

The faculty loading GA default parameters were updated after observing the GA timing out at
generation 7 of 120 (60-second limit hit before any meaningful evolution occurred).

### Changes

| Parameter | Old Default | New Default | Reason |
|---|---|---|---|
| `population_size` | 72 | 120 | More chromosomes = more genetic diversity |
| `mutation_rate` | 0.12 | 0.07 | Matches the optimizer's intended rate; less destructive exploration |
| `max_runtime_seconds` | 60 | 120 | Prevents premature cutoff before stagnation check fires |

### Notes

- These are default values applied when the caller does not pass explicit constraints.
- The GA will still accept overrides from the request body.
- `max_generations` remains at 120.
- Stagnation threshold (20 generations without improvement) is unchanged.

### Implementation

- File: `Backend/node-api/src/controllers/gaController.js`
- Location: `normalizedConstraints` block in the faculty loading GA handler (~line 1274)

## Faculty UI Enhancement

A Subject Tags column was added to the Faculty list view to make tag visibility immediate without opening per-faculty modal.

### What was added

- New column: Subject Tags
- Displays each faculty's subject tags as pills with priority label:
  - P1 (High)
  - P2 (Capable)
  - P3 (Fallback)
- Auto-refresh after preferences modal closes

## Backend/API Enhancement

To support list-level display efficiently, a bulk endpoint was added.

### Added backend function

- fetchAllFacultySubjectPreferences()

Returns grouped data:

- { [facultyId]: [{ subject_tag, priority_level }, ...] }

### Added route

- GET /api/faculty/subject-preferences/all

## Frontend Service Enhancement

Added API service method:

- fetchAllFacultySubjectPreferences()

FacultyView now loads:

- faculty list
- subject-preference map

in parallel and renders the new column.

## Files Touched

- GeneticAlgorithm/optimizer.py
- Backend/node-api/src/controllers/gaController.js
- Backend/node-api/src/lib/facultySubjectPreferences.js
- Backend/node-api/src/routes/facultySubjectPreferences.js
- Frontend/src/services/facultySubjectPreferencesApi.js
- Frontend/src/pages/FacultyView.jsx

## Current Expected Behavior (Quick Example)

If a faculty has 5 Priority 1 subjects but max units only allow 4:

- GA pre-assignment tries largest workload subjects first
- first 4 that fit are pre-assigned
- remaining one is not dropped; it is sent to regular GA candidate selection

No random kick-out is performed.

## Notes

This summary is chat-specific and intended as a quick handoff/reference file for the work completed in this session.
