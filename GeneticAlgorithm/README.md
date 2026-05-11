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
  1. Department match
  2. Specialization affinity
  3. Title/subject text affinity
- FT (`FT - Full time`) prioritized over PT.
- Max units enforced.
- No overlapping faculty schedules.
- MTH / TFS day parsing with robust Saturday handling (`Sat`, `SAT`, `sat`).
- No more than 4 consecutive hours per day.
- Max 4 preparations per faculty.
- Reporting:
  - unassigned subjects
  - faculty with available free units
