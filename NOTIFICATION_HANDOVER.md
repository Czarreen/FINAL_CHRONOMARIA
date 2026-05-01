# Notification Handover

This document explains the notification feature that was added for the course offering workflow, how it is structured, which parts are reusable, and where to extend it later.

## What the feature does

The notification system surfaces data-quality issues for course offerings in the UI and reads those issues from a cached database table instead of recalculating them on every page load.

Current goals:

- Show missing or important fields for course offerings.
- Keep the UI responsive by reading from a backend endpoint.
- Preserve room assignment compatibility with both legacy and newer storage patterns.
- Provide a reusable structure for future notification rules and future datasets.

## Current architecture

### Database layer

The database migration at `Backend/migrations/001_add_notifications.sql` creates the notification cache and helper logic.

Main objects:

- `public.data_quality_notifications`
- `public.course_offering_notifications` view
- `public.refresh_course_offering_notifications(p_offering_id)`
- `public.refresh_all_course_offering_notifications()`
- triggers on `course_offerings`, `course_offering_mth_rooms`, and `course_offering_tfs_rooms`

What it means:

- Notifications are stored once and reused.
- The refresh function clears and rebuilds notifications for a single course offering.
- Triggers keep the cache in sync when course offering rows or related room assignments change.

### Backend layer

The backend route lives in `Backend/node-api/src/routes/notifications.js` and is registered in `Backend/node-api/src/server.js`.

Endpoint:

- `GET /api/notifications/course-offerings`
- `GET /api/notifications/course-offerings/debug`

Response shape for the main endpoint:

- `page`
- `limit`
- `total`
- `rows`

The debug endpoint is useful when verifying that the database has rows but the UI does not appear to show them.

### Frontend layer

The course offering page uses:

- `Frontend/src/pages/CourseOfferingView.jsx`
- `Frontend/src/components/NotificationButton.jsx`
- `Frontend/src/services/notificationsApi.js`

The page fetches notifications from the backend and passes them to the notification button component. The notification button then renders a floating panel with actions for each issue.

## Reusable pieces

### `NotificationButton`

File: `Frontend/src/components/NotificationButton.jsx`

Reusable UI features:

- Floating trigger button with badge count.
- Portal-based dropdown panel so it is not hidden by table stacking contexts.
- Configurable empty state text.
- Action hooks for:
  - jump to row
  - open edit view

This component can be reused for any future module that needs an issue badge and a popover list of items.

### `fetchCourseOfferingNotifications`

File: `Frontend/src/services/notificationsApi.js`

Reusable API helper features:

- Centralizes the backend URL.
- Supports paging and resolution filtering.
- Returns parsed JSON with a consistent shape.

This is the right place to extend if the notifications endpoint gains more query parameters later.

### Database refresh pattern

The refresh pattern is reusable for any future entity type:

1. Store notifications in a cache table.
2. Add a per-entity refresh function.
3. Add triggers on the source tables.
4. Add a backfill function for initial seeding.

That pattern can be copied for faculty, rooms, schedules, or other modules if needed.

## Notification rule logic today

The current notification logic focuses on course offerings and checks for:

- missing `faculty_id` when the column exists
- missing `subject_id` when the column exists
- missing room assignments for MTH and TFS schedules
- missing start/end time when both columns exist

Important detail:

- The SQL was written to tolerate schema differences.
- It detects optional columns and junction-table column names dynamically.
- This was necessary because the data model had legacy and newer variations.

## Why the cache exists

The cache avoids scanning the full dataset on every page render.

Benefits:

- faster UI load time
- easier pagination
- easier reuse by other screens
- less duplicate computation in the frontend

## Current data flow

1. Course offering rows are stored in the database.
2. Triggers call the refresh function when related rows change.
3. The cache table stores the latest notification rows.
4. The backend endpoint reads from the cached view.
5. The frontend renders the notification badge and panel.

## Known implementation notes

- The frontend notification fetch must use `VITE_API_BASE_URL` so it reaches the backend server rather than the Vite dev server.
- The backend route currently returns unresolved notifications by default in the frontend helper.
- The debug endpoint is useful during local validation.
- The current SQL uses defensive schema checks because some column names differ across course offering tables and junction tables.

## Future update areas

### 1. Mark notifications as resolved

Recommended next step:

- Add `PATCH /api/notifications/:id/resolve`
- Update `is_resolved` to `true`
- Refresh the UI badge count after resolution

### 2. Add configurable rules

Recommended direction:

- Move rule definitions into a config table or JSON-based rule registry
- Support severity thresholds per rule
- Allow per-module or per-entity-type rule sets

### 3. Expand to other modules

The same pattern can be reused for:

- faculty
- rooms
- subjects
- schedule conflicts
- missing prerequisite data

### 4. UI enhancements

Potential improvements:

- show notification grouping by severity
- add filters for unresolved / resolved
- add action buttons that jump directly to editable fields
- add bulk resolve

## Future prompt template

When continuing this work later, the most useful prompt structure is:

- what module is being updated
- whether the request is database, backend, or frontend
- whether the change should stay backward-compatible
- whether the notification list should be cached or computed live
- whether the new rule applies to one row, one module, or the whole dataset

Example future prompt:

- "Add resolve action support to the notification panel and backend API, keeping the existing cached notification structure."

## Files involved

- `Backend/migrations/001_add_notifications.sql`
- `Backend/node-api/src/server.js`
- `Backend/node-api/src/routes/notifications.js`
- `Frontend/src/services/notificationsApi.js`
- `Frontend/src/components/NotificationButton.jsx`
- `Frontend/src/pages/CourseOfferingView.jsx`

## Verification checklist

Use this checklist after future changes:

- backend route returns JSON
- frontend fetch uses the backend URL
- notifications display in the UI
- database backfill has been run
- trigger updates still work after edits
- no HTML fallback is being parsed as JSON

## Short summary

The notification feature is now a cached, backend-driven data-quality system for course offerings. Its structure is intentionally reusable so the same pattern can be extended to other modules without rewriting the UI pattern, the API shape, or the refresh strategy.
