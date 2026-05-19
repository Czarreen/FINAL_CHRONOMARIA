# Automatic Scheduler GA - Implementation TODO

- [x] Backend: Add automatic scheduler routes in `Backend/node-api/src/routes/ga.js`
- [x] Backend: Implement automatic scheduler controller logic in `Backend/node-api/src/controllers/gaController.js`
  - [x] Preflight with rule-aware filtering and validations
  - [x] Run GA (automatic scheduling mode) with payload preparation
  - [x] Persist generated rows to `public.automatic_scheduler`
  - [x] Export rows for backup/import
  - [x] Update `course_offerings` with optional backup-first flow
- [x] Python GA: Automatic scheduling mode implemented in `GeneticAlgorithm/optimizer.py`
  - [x] Enforce hard constraints (days/pattern/time bounds/no overlaps/room-type priority)
  - [x] Apply soft constraints and fitness scoring
  - [x] Generate unresolved issues + room/time suggestions
- [ ] Frontend API: Add automatic scheduler API methods in `Frontend/src/services/gaApi.js`
- [ ] Frontend UI: Implement Automatic Scheduler page in `Frontend/src/pages/ScheduleView.jsx`
  - [ ] List view for `automatic_scheduler` rows
  - [ ] Run controls and fitness/issue reporting
  - [ ] Export-only action
  - [ ] Update-course-offering action with:
    - [ ] Backup export then update
    - [ ] Update without backup
- [ ] Faculty Loading GA (Part.2): Update and enforce refined faculty-loading constraints/rules
  - [ ] Strict pre-filters for inactive/zero-capacity faculty
  - [ ] Hard-constraint enforcement for max 4 consecutive teaching hours
  - [ ] Hard-constraint enforcement for max 4 preparations
  - [ ] Unassigned + recommendation fallback when no valid faculty candidate remains
  - [ ] Available-units baseline computation and enforcement
- [ ] Validate integration and basic flow checks
- [ ] Final review for GA rules/constraints alignment

## Current Task: Code-only alignment with DB schema for Automatic Scheduler + GA
- [x] Confirm scope: no DB schema changes, code changes only
- [ ] Normalize `merged` and room-id handling in `Backend/node-api/src/controllers/gaController.js`
- [x] Align `GeneticAlgorithm/optimizer.py` behavior with scheduler payload expectations
- [ ] Run consistency checks (no schema edits, scheduler + GA variable/path alignment)
