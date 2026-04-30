# Chronomaria Scalable Structure

This structure follows `STACK_GUIDELINES.md` and is organized for long-term growth.

## Root

- `Frontend/` React client (JS/JSX only)
- `Backend/node-api/` Node.js API gateway
- `Backend/python-ga/` Python optimization engine
- `Backend/shared/` shared backend config/db helpers
- `Supabase/` SQL migrations, policies, and seed scripts (create as features grow)

## Data Flow

1. Frontend calls Node API endpoints.
2. Node API reads/writes Supabase data.
3. Node API triggers Python GA routines when optimization is needed.
4. Python returns optimized schedules to Node API for persistence and client response.
