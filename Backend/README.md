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
