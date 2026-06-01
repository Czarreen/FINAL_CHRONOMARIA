# Backend Structure

## Folders

- `node-api/` Node.js API gateway (frontend-facing endpoints)
- `../../GeneticAlgorithm/` Python optimization engine (GA/scoring logic, started by run.py)
- `shared/` shared backend helpers (config/db utilities)

## Env Source

All backend services read from `Backend/.env`.

## Current Endpoints

- `GET /health`
- `GET /api/course-offerings?page=1&limit=50`
- `POST /api/course-offerings/import-csv`

## Faculty Teaching Record

- The faculty teaching record shown in the UI is sourced from `faculty_subject_tags`.
- `faculty_subject_tags` is the current active record of the subjects a faculty member can teach.

## Faculty Preference Records

- Each save to `faculty_subject_tags` also appends a row to `faculty_preference_records`.
- The Faculty modal shows those archive rows below the editable tags list.
- Users can delete an archive row or re-add its subject back into the selected tags list.
