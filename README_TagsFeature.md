# Implementation Summary (May 2026)

This document summarizes the changes and decisions implemented during this chat for faculty loading GA and faculty subject tagging visibility.

## Scope Covered

- Faculty subject tag priority behavior in GA
- Pre-assignment behavior and fairness when max units are hit
- Cross-department preference handling
- Faculty list UI visibility for subject tags
- Backend endpoint for bulk subject preference loading

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
- Cross-department without specialization is allowed only for the IT -> CS zero-faculty exception.

5. Faculty Role (Applies to All Candidates)
- Faculty role weighting is always applied in scoring for every candidate (FT preferred over PT).

In short: Preferences -> Specialization -> Department match -> IT->CS fallback -> Role weighting across all candidates.

### Why A Candidate Falls Down To The Next Step

The GA moves down the chain when a higher-priority path cannot be used.

- From Preferences to Specialization:
  - no subject tag match for that faculty and subject, or
  - tagged faculty is ineligible (max units reached, time conflict, consecutive-hours limit, preparation limit).
- From Specialization to Department matching:
  - no eligible specialization-match candidate remains.
- From Department matching to Cross-department fallback:
  - no eligible same-department candidate remains.
- Cross-department fallback applies only when:
  - offering is CS,
  - CS has zero faculty records,
  - IT faculty are considered as fallback candidates.

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

## Files Touched During This Chat

- GeneticAlgorithm/optimizer.py
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
