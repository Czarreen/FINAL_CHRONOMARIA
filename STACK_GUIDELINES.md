# CHRONOMARIA Stack Guidelines

This repository follows the stack below for all future increments.

## Official Stack

- Python
  - Owns the Genetic Algorithm engine and core optimization logic.
  - Handles data-heavy computation, scheduling simulations, and constraint solving.
- JavaScript
  - Used for client-side interactivity and dynamic web behavior.
  - Used for server-side API handlers in Node.js.
- Supabase
  - Primary cloud database and realtime data layer.
  - Stores faculty, subjects, rooms, schedules, and system constraints.
- Node.js
  - API and orchestration layer between frontend, Supabase, and Python services.
  - Handles request validation, scheduling workflow triggers, and integration endpoints.
- React.js
  - Frontend UI framework.
  - Builds reusable components for dashboard, faculty, subject, room, and schedule screens.

## Enforcement Rules For Future Work

1. Frontend is JavaScript React (JS/JSX), not TypeScript.
2. Scheduling optimization logic must be implemented in Python modules/services.
3. Node.js APIs must be the integration gateway for frontend calls.
4. Supabase is the system of record for institutional data.
5. New features must map to this architecture before implementation.

## Suggested Ownership Per Folder (Future)

- `Frontend/` -> React.js + JavaScript UI
- `Backend/node-api/` -> Node.js API services
- `GeneticAlgorithm/` -> Python genetic algorithm and optimization engine (started by run.py)
- `Supabase/` -> SQL schema, policies, and migration files
