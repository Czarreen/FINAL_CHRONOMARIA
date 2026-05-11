# GA + Faculty Loading Migration TODO

- [x] Read remaining orchestration/config files:
  - [x] run.py
  - [x] Backend/node-api/src/routes/ga.js
  - [x] Backend/node-api/src/config/env.js
  - [x] Backend/python-ga/README.md
- [x] Create new top-level GeneticAlgorithm service:
  - [x] Add GeneticAlgorithm/optimizer.py (migrated + enhanced GA logic)
  - [x] Add GeneticAlgorithm/README.md
- [x] Update backend integration:
  - [x] Update Backend/node-api/src/config/env.js GA service defaults (if needed)
  - [x] Update Backend/node-api/src/controllers/gaController.js pre-flight + mapping + persistence safeguards
- [x] Update orchestration:
  - [x] Update run.py to run top-level GeneticAlgorithm service
- [x] Keep schema compatibility:
  - [x] Ensure no DB schema changes
  - [x] Ensure faculty_loading columns are preserved exactly
- [x] Validate:
  - [x] Python syntax check
  - [x] Backend check/build
  - [x] Frontend check/build
  - [x] Verify GA output/report shape and persistence behavior

## UI Revamp (old Faculty Loading layout concept with current styling)

- [ ] Revamp `Frontend/src/pages/FacultyLoadingView.jsx` layout to old-page-inspired sections
- [ ] Preserve all existing current functions/behaviors (no removals)
- [ ] Add latest run snapshot + quality/issues panel + generated list table view
- [ ] Keep design consistent with current app style classes/tokens
- [ ] Rebuild frontend and verify no errors

## Course Offering CRUD sync with Subjects and Rooms

- [x] Review `Backend/node-api/src/routes/courseOfferings.js` CRUD flow and current sync helpers
- [x] Update create/update handlers to sync both subjects and rooms consistently
- [x] Update delete handler to propagate delete effects to related subjects/rooms safely
- [x] Add safe orphan-room pruning (only if not referenced elsewhere)
- [ ] Run backend syntax/quick verification
