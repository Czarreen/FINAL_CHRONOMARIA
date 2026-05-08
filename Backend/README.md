# Backend Structure

## Folders

- `node-api/` Node.js API gateway (frontend-facing endpoints)
- `python-ga/` Python optimization engine (GA/scoring logic)
- `shared/` shared backend helpers (config/db utilities)

## Env Source

All backend services read from `Backend/.env`.

## Current Endpoints

- `GET /health`
- `GET /api/course-offerings?page=1&limit=50`
- `POST /api/course-offerings/import-csv`
