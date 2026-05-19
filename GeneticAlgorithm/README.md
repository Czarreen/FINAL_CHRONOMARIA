# GeneticAlgorithm Service (Chronomaria)

Standalone GA microservice for faculty loading in the new Chronomaria architecture.

## Purpose
This service receives a faculty/course-offering snapshot from the Node backend and returns:
- assignment results
- fitness scores
- reports (including unassigned subjects and faculty with free units)

It is designed to work with the **existing schema only** (no DB schema changes).

## Run locally

```bash
python optimizer.py
```

Environment variables:
- `GA_HOST` (default: `0.0.0.0`)
- `GA_PORT` (default: `8000`)

## Endpoints

### GET `/health`
Health check.

### POST `/generate`
Runs GA using payload shape expected by Node backend.

Request (high-level):
- `faculty`: array
- `offerings`: array
- `subjects`: array
- `rooms`: array
- `constraints`:
  - `population_size`
  - `max_generations`
  - `mutation_rate`
  - `max_runtime_seconds`
  - `random_seed`
  - `dry_run`

Response (high-level):
- `assignments`
- `fitness_overall`
- `fitness_hard`
- `fitness_soft`
- `report`
- `generations`
- `runtime_ms`
- `run_id`
- `constraints`

## Rule coverage implemented

- Faculty assignment priority:
  1. Specialization match — any faculty from any department whose specialization matches the subject is eligible (cross-department allowed). FT preferred over PT.
  2. Department match only — no specialization match found anywhere; restrict to same-department faculty with available units. FT preferred over PT.
  3. Cross-department no-spec fallback — IT → CS only when CS has zero faculty records in the DB.
  4. Unassigned + recommendation — subject flagged unassigned; system emits cross-department candidates for manual decision.
- FT (`FT - Full time`) prioritized over PT.
- Max units enforced.
- No overlapping faculty schedules.
- MTH / TFS day parsing with robust Saturday handling (`Sat`, `SAT`, `sat`).
- No more than 4 consecutive hours per day.
- Max 4 preparations per faculty.
- Reporting:
  - unassigned subjects
  - unresolved offering reasons and recommendations
  - faculty with available free units

### Fitness interpretation

- Specialization match (any department): highest contribution.
- Department-only match (no specialization): partial contribution.
- Cross-department no-spec (IT → CS zero-faculty exception only): low contribution.
- No faculty assigned: heavy hard penalty.
- Exceeding faculty max units: hard violation.

### Fallback behavior

- If a department has faculty records but none are eligible (units exhausted/conflicts), subject is kept unassigned.
- In that case, GA emits recommendation-only fallback guidance (manual cross-department choice by user; not auto-assigned).
