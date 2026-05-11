# GA Integration for Final_ChronoMaria — Implementation Guide

## Overview
Final_ChronoMaria uses a React + Vite frontend, Node/Express API gateway, and Python GA scaffold. The goal is to implement the GA core in `optimizer.py`, expose it via Node routes, and persist results in existing `faculty_notifications` table **without schema changes**.

## Current Architecture
- **Backend**: `server.js` (Express) + `supabase.js` (Supabase client) exposing `/api/*` routes
- **Database**: Supabase/Postgres with existing tables (`faculty`, `subjects`, `rooms`, `faculty_notifications`, etc.)
- **Python GA**: `optimizer.py` (empty scaffold) to implement GA logic
- **Frontend**: React app calling Node API; displays notifications from existing endpoints
- **Run orchestrator**: `run.py` starts frontend, backend, and GA service in dev

## Faculty Data Flow & Where GA Integrates
1. Faculty rows live in `faculty` table (columns: `id`, `name`, `email`, `department`, `max_units`, `preferred_subjects` (JSON), `status`, `role`).
2. Node exposes `GET /api/faculty` (read-only) and `POST /api/faculty`, `PATCH /api/faculty/:id` (create/update).
3. Existing backfill scripts update `faculty_notifications` to track data-quality issues (see `backend/tools/backfill_faculty_notifications.js`).
4. **GA Integration Point**: Node will add new route `POST /api/ga/run/faculty` that:
   - Fetches faculty, subjects, rooms from DB (read-only)
   - Calls Python GA service with this data
   - Receives back: assignments, fitness scores, report
   - **Persists results to `faculty_notifications` table** (upsert) with fields matching existing schema
5. Frontend displays results via existing `GET /api/notifications/faculty` (no UI changes needed).

**Key**: GA outputs are stored as **notifications**, not as new tables. This preserves existing DB structure.

## Key Files to Reference
- **Dev orchestrator**: `run.py` (starts all services)
- **Node API entry**: `server.js`
- **Supabase client**: `backend/config/database.js`
- **Faculty routes**: `backend/routes/facultyRoutes.js` and `backend/controllers/facultyController.js`
- **Notification routes**: `backend/routes/notificationRoutes.js` (pattern to follow)
- **Backfill example**: `backend/tools/backfill_faculty_notifications.js` (how to upsert notifications)
- **Python GA scaffold**: `genetic_algorithm/optimizer.py` (where GA logic goes)
- **Models**: `backend/models/Faculty.js`, `Subject.js`, `Room.js` (data access patterns)

## Migration & Integration Guidance (No DB Schema Changes)



**Why**:
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`: Node calls Supabase with admin privileges to read/write data
- `PYTHON_SERVICE_URL`: Points to the GA microservice (see section 3 below)
- `GA_REQUEST_TIMEOUT_MS`: Max time to wait for GA to complete

### 2) Data Model — No Schema Changes
Use **existing** faculty/subject/room fields as-is:

**Faculty** (existing fields):
- `id` (UUID) — unique identifier
- `name` — faculty name
- `email` — faculty email
- `department` — department string (e.g., "Computer Science")
- `max_units` (int) — maximum teaching load in units
- `preferred_subjects` (JSON/array) — list of subject IDs faculty prefers
- `status` — active/inactive
- `role` — faculty role (e.g., "professor")

**Subjects** (existing fields):
- `id` (UUID)
- `code` (string) — subject code (e.g., "CS101")
- `name` — subject name
- `units` (int) — credit units
- `department` — subject department
- `section` (int) — section number
- `hours_per_week` (int) — contact hours per week

**Rooms** (existing fields):
- `id` (UUID)
- `room_number` (string) — room identifier (e.g., "CSCI-101")
- `building` — building name
- `capacity` (int) — seating capacity
- `type` — room type (classroom, lab, etc.)

**Notification persistence** (existing `faculty_notifications` table):
GA results will be stored as notifications with existing columns:
- `id` (UUID)
- `faculty_id` (UUID, FK to faculty)
- `type` (string) — e.g., "ga_run_result"
- `severity` (string) — e.g., "info", "warning"
- `message` (text) — human-readable note
- `data` (JSON) — store GA result details here (score, flags, conflicts)
- `created_at` (timestamp)
- `is_resolved` (boolean) — mark as resolved by admin

### 3) Where GA Runs — Recommended Approach
Implement GA logic in `genetic_algorithm/optimizer.py` and expose it as a **microservice** that Node calls via HTTP:

**Option A (Recommended): GA as HTTP Microservice**
```bash
# Terminal 1: Start GA service
cd genetic_algorithm
python optimizer.py
# Exposes POST http://localhost:8000/generate
```

Node will call GA like:
```javascript
const response = await axios.post(
  `${process.env.PYTHON_SERVICE_URL}/generate`,
  {
    faculty: [...],
    subjects: [...],
    rooms: [...],
    constraints: {...}
  },
  { timeout: parseInt(process.env.GA_REQUEST_TIMEOUT_MS) }
);
```

**Option B: GA as Subprocess** (if HTTP overhead is a concern)
```javascript
const { spawn } = require('child_process');
const process = spawn('python', ['optimizer.py', '--run-json', inputFile]);
// pipe JSON, read output
```

**Recommendation**: Use Option A (HTTP). Benefits:
- Decoupled: GA service can be restarted or scaled independently
- Easy to test: call `/generate` from curl or Postman
- Works in production: can run on separate machine/container

### 4) GA Input/Output Contract (Using Existing Fields Only)

**Request JSON** (Node sends to GA):
```json
{
  "faculty": [
    {
      "id": "fac-uuid-1",
      "name": "Dr. Smith",
      "department": "Computer Science",
      "max_units": 18,
      "preferred_subjects": ["CS401", "CS402"],
      "email": "smith@uni.edu",
      "status": "active"
    }
  ],
  "subjects": [
    {
      "id": "subj-uuid-1",
      "code": "CS401",
      "name": "AI Fundamentals",
      "units": 3,
      "hours_per_week": 3,
      "department": "Computer Science",
      "section": 1
    }
  ],
  "rooms": [
    {
      "id": "room-uuid-1",
      "room_number": "CSCI-101",
      "building": "Engineering",
      "capacity": 40,
      "type": "classroom"
    }
  ],
  "constraints": {
    "population_size": 80,
    "max_generations": 300,
    "mutation_rate": 0.1,
    "max_runtime_seconds": 20,
    "random_seed": 123,
    "dry_run": false
  }
}
```

**Response JSON** (GA returns to Node):
```json
{
  "assignments": [
    {
      "subject_id": "subj-uuid-1",
      "faculty_id": "fac-uuid-1",
      "room_id": "room-uuid-1",
      "day": "Monday",
      "time": "08:00-09:00",
      "section": 1
    }
  ],
  "fitness_overall": 87.5,
  "fitness_hard": 95.0,
  "fitness_soft": 92.1,
  "generations": 120,
  "runtime_ms": 13240,
  "report": {
    "summary": "Generated 245 assignments covering 98% of subjects",
    "faculty_load_balance": [
      {
        "faculty_id": "fac-uuid-1",
        "total_units": 16,
        "class_count": 5,
        "imbalance_score": 0.8
      }
    ],
    "hard_violations": [],
    "soft_penalties": [
      {
        "type": "room_oversize",
        "subject_id": "subj-uuid-1",
        "wasted_capacity": 25,
        "penalty": 50
      }
    ],
    "schedule_fragmentation": {
      "avg_consecutive_blocks": 1.8,
      "faculty_with_scattered_schedule": ["fac-uuid-1"]
    },
    "unassigned_subjects": ["MATH205-Sec2"],
    "explainability": [
      "Dr. Smith: 16 units across 5 classes (ideal 18/4). Fragmented across 4 days (penalty: 25pts)."
    ]
  }
}
```

### 5) Persisting GA Results (Using Existing `faculty_notifications` Table)
Node adapter will:
1. Create a **run_id** (UUID) to group all results from one GA run
2. For each faculty in the GA output, upsert a row in `faculty_notifications`:
   - `faculty_id`: the faculty UUID
   - `type`: "ga_assignment_result"
   - `severity`: "info"
   - `message`: "GA run <run_id> completed with fitness <score>"
   - `data`: JSON blob containing:
     ```json
     {
       "run_id": "run-uuid-123",
       "fitness_overall": 87.5,
       "fitness_hard": 95.0,
       "fitness_soft": 92.1,
       "assignments": [...],
       "explainability": "Dr. Smith: 16 units across 5 classes...",
       "load_imbalance_score": 0.8,
       "fragmentation_score": 25,
       "conflicts": []
     }
     ```
   - `created_at`: now()
   - `is_resolved`: false (admin can mark resolved after review)

**No new tables needed**. Results live as notifications in the existing table.

### 6) Trigger Points & API Endpoint
Add new Node route: `POST /api/ga/run/faculty`

**Usage**:
```bash
# Manual run (dry_run = true means no persistence)
curl -X POST http://localhost:5000/api/ga/run/faculty?dry_run=true \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"population_size": 80, "max_generations": 300}'

# Actual run (persists results)
curl -X POST http://localhost:5000/api/ga/run/faculty \
  -H "Authorization: Bearer <token>"
```

**Adapter Logic**:
1. Call `GET /api/ga/pre-flight` to validate data (see section below)
2. If blocked, return 400 with issues list
3. Fetch all faculty, subjects, rooms from DB
4. Call GA service: `POST http://localhost:8000/generate` with data
5. On success, upsert notifications for each faculty
6. Return: `{ run_id, status: "completed", fitness_overall, faculty_count, summary }`

### 7) Pre-flight Validation — Data Quality Check (CRITICAL)
Add new Node route: `GET /api/ga/pre-flight`

**Purpose**: Ensure data is valid before running GA. No schema changes; just validation.

**Checks**:
- All faculty have `name`, `department`, `max_units` (no NULLs)
- All subjects have `code`, `units`, `department` (no NULLs)
- All rooms have `room_number`, `capacity` (no NULLs)
- Department names match between faculty and subjects (no mismatches)
- `preferred_subjects` array references valid subject IDs
- No duplicate faculty/subject/room IDs
- Time slot formats valid (if storing time data)

**Response**:
```json
{
  "status": "ok",
  "faculty_count": 45,
  "subject_count": 120,
  "room_count": 15,
  "issues": []
}
```

Or if blocked:
```json
{
  "status": "blocked",
  "issues": [
    {
      "type": "faculty",
      "id": "fac-123",
      "problem": "missing max_units"
    },
    {
      "type": "subject",
      "id": "subj-456",
      "problem": "department 'CS' not found in any faculty"
    }
  ],
  "suggested_next_step": "Resolve issues in Dashboard, then retry GA."
}
```

### 8) Error Handling & Idempotency
- **Dry run mode**: `POST /api/ga/run/faculty?dry_run=true` returns results without persisting
- **Idempotent runs**: Include a `run_id` (UUID hash of input snapshot + seed) so same input always produces same output
- **Transactional upserts**: Write all notifications in one transaction; if any fail, roll back all
- **Timeout handling**: If GA takes too long, return 504 and log error; don't persist partial results

### 9) Testing & Backfill
After implementing GA:
1. Run backfill script to compute GA for all faculty once: `node backend/tools/ga_backfill.js`
   - Fetches all faculty, subjects, rooms
   - Calls GA service
   - Upserts notifications
   - Prints: "Before: 100 faculty. After: 95 with GA results, 5 skipped. Run ID: <uuid>"

2. Smoke test:
   ```bash
   # Pre-flight check
   curl http://localhost:5000/api/ga/pre-flight
   
   # Dry run
   curl -X POST http://localhost:5000/api/ga/run/faculty?dry_run=true
   
   # Check results
   curl http://localhost:5000/api/notifications/faculty?type=ga_assignment_result
   ```

3. Unit tests:
   - GA core: hard-constraint enforcement, repair correctness, deterministic seed
   - Soft-scoring: load balancing, fragmentation, preference satisfaction
   - Pre-flight validation: each rule (missing fields, invalid references, etc.)
   - Integration: end-to-end flow from request to persisted notification

### 10) Acceptance Criteria
- ✅ GA produces valid assignments with no time/room conflicts
- ✅ Results deterministic: same seed → same output
- ✅ Adapter persists notifications using existing table schema
- ✅ Frontend displays GA results via existing `/api/notifications/faculty` endpoint (no UI changes)
- ✅ Pre-flight validation blocks GA if critical data issues exist
- ✅ Backfill script recreates notifications consistently
- ✅ All tests pass locally

---

## GA Scoring Logic — What Makes a "Better" Schedule

The improved GA actively optimizes for university faculty concerns (not just feasibility):

### Hard Constraints (MUST NOT VIOLATE)
- No faculty double-booking (same time)
- No room double-booking (same time)
- Faculty department ≠ subject department (when applicable)
- Room capacity ≥ expected enrollment

### Soft Penalties (Quality Scoring) — Weighted
1. **Load Balancing (30%)**: Minimize variance in units across faculty. Penalize `(faculty.units - avg)² × 3` per faculty.
2. **Workload Distribution (20%)**: Prefer 4-5 mid-sized classes over 8 tiny ones. Penalize if class count deviates >1.5× optimal.
3. **Schedule Fragmentation (15%)**: Prefer consecutive blocks on same day. Penalize `avg_breaks_between_classes × 20`.
4. **Preference Satisfaction (20%)**: +50pts for preferred subject; +20pts for preferred time; -30pts/-15pts if not matched.
5. **Room Optimization (10%)**: Penalize oversized rooms. Bonus for 80-95% capacity utilization.
6. **Other (5%)**: Department alignment, specialization matches (if tracked in future).

**Result**: High-quality, sustainable schedules that faculty prefer, not just conflict-free assignments.

---

## Implementation Checklist for Claude Sonnet

### Phase 1: GA Core
1. Implement `genetic_algorithm/optimizer.py`:
   - Accept POST request with faculty/subjects/rooms/constraints
   - Implement GA algorithm with hard/soft scoring above
   - Return assignments + fitness scores + report
   - Support `random_seed` (deterministic) and `dry_run` flag

2. Expose HTTP endpoint:
   - `POST /generate` accepting JSON request
   - Return JSON response (see section 4 above)
   - Include `optimizer.py` as Flask app or `server.py` as wrapper

### Phase 2: Node Adapter
3. Add `backend/routes/gaRoutes.js`:
   - `GET /api/ga/pre-flight` — validate data, return status + issues
   - `POST /api/ga/run/faculty` — call GA, persist results

4. Add `backend/controllers/gaController.js`:
   - Pre-flight logic: check all faculty/subjects/rooms have required fields
   - Adapter logic: fetch data → call GA → upsert notifications

### Phase 3: Persistence & Testing
5. Add `backend/tools/ga_backfill.js`:
   - Fetch all faculty, subjects, rooms
   - Call GA adapter
   - Print summary: "Before/after notification counts, load distribution stats"

6. Add integration tests:
   - Pre-flight validation (each rule)
   - GA call + notification persistence
   - Dry run verification
   - Negative test: bad data → 400

### Phase 4: Documentation
7. Include short README in `genetic_algorithm/`:
   - How to run GA service
   - Example curl commands to `/generate`
   - Explain hard/soft constraints

---

## Example Run Commands

```bash
# Terminal 1: Start GA service
cd genetic_algorithm
python optimizer.py
# Listens on http://localhost:8000

# Terminal 2: Start backend
cd backend
npm start
# Listens on http://localhost:5000

# Terminal 3: Test pre-flight validation
curl http://localhost:5000/api/ga/pre-flight

# If pre-flight OK, run GA (dry mode)
curl -X POST http://localhost:5000/api/ga/run/faculty?dry_run=true

# Check results
curl http://localhost:5000/api/notifications/faculty?type=ga_assignment_result | jq .

# Backfill all faculty (one-time)
node backend/tools/ga_backfill.js
```

---

---

## Frontend UI/UX — Faculty Loading Page

### Component Structure (FacultyLoading.jsx)
Create `frontend/src/pages/FacultyLoading.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import { gaService, facultyService, subjectService, roomService } from '../services/api';
import './FacultyLoading.css';
import { FaChalkboardTeacher, FaBookOpen, FaDoorOpen, FaCheckCircle, FaExclamationTriangle, FaClock, FaBolt } from 'react-icons/fa';

const fitnessToQuality = (score) => {
  if (score >= 95) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Poor';
  return 'Very Poor';
};

const QUALITY_COLOR = { Excellent: '#22c55e', Good: '#22c55e', Fair: '#facc15', Poor: '#f97316', 'Very Poor': '#ef4444' };
const QUALITY_ICON = { Excellent: '🟢', Good: '🟢', Fair: '🟡', Poor: '🔴', 'Very Poor': '🔴' };

function GAResultPanel({ result }) {
  if (!result) return null;

  const fitness = result.fitness_overall ?? 0;
  const quality = fitnessToQuality(fitness);
  const color = QUALITY_COLOR[quality];
  const icon = QUALITY_ICON[quality];

  return (
    <div className="ga-result-card" style={{ '--quality-color': color }}>
      <div className="ga-result-bar" />
      <div className="ga-result-header">
        <div className="ga-result-left">
          <span className="ga-result-icon">{icon}</span>
          <div className="ga-result-text">
            <p className="ga-result-label">Faculty Loading Quality</p>
            <h3>{quality}</h3>
          </div>
        </div>
        <div className="ga-result-metrics">
          <span>Fitness: <strong>{fitness.toFixed(1)}/100</strong></span>
          <span>Run ID: <strong>{result.run_id?.substring(0, 8)}</strong></span>
          <span>Generated: <strong>{new Date(result.created_at).toLocaleDateString()}</strong></span>
        </div>
      </div>

      <details className="ga-result-dropdown">
        <summary>View Details</summary>
        <div className="ga-result-dropdown-content">
          <div className="ga-result-grid">
            <div className="ga-result-section">
              <h4>Fitness Breakdown</h4>
              <p>Hard Constraints: <strong>{result.fitness_hard?.toFixed(1)}/100</strong></p>
              <p>Soft Penalties: <strong>{result.fitness_soft?.toFixed(1)}/100</strong></p>
              <p>Load Imbalance: <strong>{result.load_imbalance_score?.toFixed(2)}</strong></p>
              <p>Fragmentation: <strong>{result.fragmentation_score?.toFixed(2)}</strong></p>
            </div>
            <div className="ga-result-section">
              <h4>Summary</h4>
              <p>{result.explainability || 'No detailed summary available.'}</p>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

export default function FacultyLoading() {
  const [dataCounts, setDataCounts] = useState({ faculty: 0, subjects: 0, rooms: 0 });
  const [dataReady, setDataReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preFlightStatus, setPreFlightStatus] = useState(null);
  const [gaResult, setGAResult] = useState(null);
  const [error, setError] = useState('');
  const [lastRunTime, setLastRunTime] = useState('');

  useEffect(() => {
    checkData();
    const saved = localStorage.getItem('lastFacultyLoadingRun');
    if (saved) setLastRunTime(new Date(saved).toLocaleString());
  }, []);

  const checkData = async () => {
    try {
      const [faculty, subjects, rooms] = await Promise.all([
        facultyService.getAll(),
        subjectService.getAll(),
        roomService.getAll()
      ]);
      const counts = { faculty: faculty.length, subjects: subjects.length, rooms: rooms.length };
      setDataCounts(counts);
      setDataReady(counts.faculty > 0 && counts.subjects > 0 && counts.rooms > 0);
    } catch (err) {
      console.error('Error checking data:', err);
      setError('Failed to load data counts.');
    }
  };

  const runPreFlight = async () => {
    try {
      setError('');
      const response = await gaService.preFlight();
      setPreFlightStatus(response);

      if (response.status === 'blocked') {
        setError(`Data issues found: ${response.issues.length} problems prevent GA execution.`);
      }
    } catch (err) {
      console.error('Pre-flight check failed:', err);
      setError('Pre-flight validation failed. Check server logs.');
    }
  };

  const runGALoading = async () => {
    if (preFlightStatus?.status !== 'ok') {
      setError('Please run pre-flight validation first.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await gaService.runFaculty();
      setGAResult(result);
      localStorage.setItem('lastFacultyLoadingRun', new Date().toISOString());
      setLastRunTime(new Date().toLocaleString());
    } catch (err) {
      console.error('GA execution failed:', err);
      setError('Faculty loading failed. Check server logs.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="faculty-loading-container">
      <Navbar />
      <div className="faculty-loading-content">
        <h1>Faculty Loading Optimizer</h1>

        {/* Data Overview */}
        <div className="fa-dashboard-grid">
          <div className="fa-mini-card">
            <div className="fa-mini-head">
              <span className="fa-mini-icon"><FaChalkboardTeacher /></span>
              <p className="fa-mini-label">Faculty</p>
            </div>
            <h3>{dataCounts.faculty}</h3>
          </div>
          <div className="fa-mini-card">
            <div className="fa-mini-head">
              <span className="fa-mini-icon"><FaBookOpen /></span>
              <p className="fa-mini-label">Subjects</p>
            </div>
            <h3>{dataCounts.subjects}</h3>
          </div>
          <div className="fa-mini-card">
            <div className="fa-mini-head">
              <span className="fa-mini-icon"><FaDoorOpen /></span>
              <p className="fa-mini-label">Rooms</p>
            </div>
            <h3>{dataCounts.rooms}</h3>
          </div>
        </div>

        {/* Status Messages */}
        {dataReady ? (
          <div className="fa-ready-alert">
            <FaCheckCircle /> All data loaded. Ready to run faculty loading.
          </div>
        ) : (
          <div className="fa-warning-alert">
            <FaExclamationTriangle /> Missing data. Please ensure faculty, subjects, and rooms are populated.
          </div>
        )}

        {error && <div className="fa-error-alert">{error}</div>}

        {/* Control Panel */}
        <div className="fa-control-card">
          <h2>Run Faculty Loading</h2>
          <div className="fa-button-group">
            <button
              onClick={runPreFlight}
              className="fa-btn fa-btn-secondary"
              disabled={!dataReady}
              title="Validate data before running GA"
            >
              <FaClock /> Validate Data
            </button>
            <button
              onClick={runGALoading}
              className="fa-btn fa-btn-primary"
              disabled={!dataReady || loading || preFlightStatus?.status !== 'ok'}
            >
              {loading ? 'Running...' : <><FaBolt /> Run Faculty Loading</>}
            </button>
          </div>
          {lastRunTime && (
            <p className="fa-last-run">Last run: {lastRunTime}</p>
          )}
        </div>

        {/* Pre-flight Results */}
        {preFlightStatus && (
          <div className={`fa-preflight-card fa-preflight-${preFlightStatus.status}`}>
            <h3>{preFlightStatus.status === 'ok' ? '✅ Data Valid' : '⚠️ Data Issues'}</h3>
            <p>Faculty: {preFlightStatus.faculty_count} | Subjects: {preFlightStatus.subject_count} | Rooms: {preFlightStatus.room_count}</p>
            {preFlightStatus.issues?.length > 0 && (
              <ul className="fa-issues-list">
                {preFlightStatus.issues.slice(0, 5).map((issue, idx) => (
                  <li key={idx}>{issue.type}: {issue.problem}</li>
                ))}
                {preFlightStatus.issues.length > 5 && <li>... and {preFlightStatus.issues.length - 5} more</li>}
              </ul>
            )}
          </div>
        )}

        {/* GA Results */}
        {gaResult && <GAResultPanel result={gaResult} />}
      </div>
    </div>
  );
}
```

### CSS Styling (FacultyLoading.css)
Create `frontend/src/pages/FacultyLoading.css`:

```css
.faculty-loading-container {
  min-height: 100vh;
  background: #f5f7fa;
}

.faculty-loading-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 20px;
}

.faculty-loading-content h1 {
  margin: 0 0 24px;
  color: #0f4f96;
  font-size: 32px;
  font-weight: 700;
}

/* Data Overview Cards */
.fa-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.fa-mini-card {
  border: 1px solid rgba(176, 211, 252, 0.78);
  border-radius: 12px;
  background: linear-gradient(160deg, rgba(248, 252, 255, 0.98) 0%, rgba(231, 244, 255, 0.92) 100%);
  padding: 16px;
}

.fa-mini-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fa-mini-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(195, 225, 255, 0.9);
  color: #0f4f96;
  border-radius: 10px;
  font-size: 16px;
}

.fa-mini-label {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: #4f6d8f;
  font-weight: 600;
}

.fa-mini-card h3 {
  margin: 8px 0 0;
  color: #124784;
  font-size: 28px;
  font-weight: 700;
}

/* Alert Messages */
.fa-ready-alert,
.fa-warning-alert,
.fa-error-alert {
  padding: 12px 14px;
  margin-bottom: 14px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.fa-ready-alert {
  background: rgba(34, 197, 94, 0.1);
  color: #15803d;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.fa-warning-alert {
  background: rgba(250, 204, 21, 0.1);
  color: #92400e;
  border: 1px solid rgba(250, 204, 21, 0.3);
}

.fa-error-alert {
  background: rgba(239, 68, 68, 0.1);
  color: #991b1b;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

/* Control Panel */
.fa-control-card {
  border: 1px solid rgba(176, 211, 252, 0.78);
  border-radius: 12px;
  background: linear-gradient(160deg, rgba(248, 252, 255, 0.98) 0%, rgba(231, 244, 255, 0.92) 100%);
  padding: 20px;
  margin-bottom: 16px;
}

.fa-control-card h2 {
  margin: 0 0 14px;
  color: #124784;
  font-size: 18px;
  font-weight: 700;
}

.fa-button-group {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.fa-btn {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.fa-btn-primary {
  background: linear-gradient(135deg, #0066cc 0%, #0052a3 100%);
  color: white;
}

.fa-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #0052a3 0%, #003d7a 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 102, 204, 0.3);
}

.fa-btn-secondary {
  background: rgba(195, 225, 255, 0.9);
  color: #0f4f96;
  border: 1px solid rgba(176, 211, 252, 0.78);
}

.fa-btn-secondary:hover:not(:disabled) {
  background: rgba(176, 211, 252, 0.9);
}

.fa-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fa-last-run {
  margin: 0;
  font-size: 12px;
  color: #4f6d8f;
  font-style: italic;
}

/* Pre-flight Results */
.fa-preflight-card {
  border: 1px solid #d7e7fb;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.fa-preflight-ok {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.3);
}

.fa-preflight-blocked {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}

.fa-preflight-card h3 {
  margin: 0 0 8px;
  color: #124784;
  font-size: 16px;
  font-weight: 700;
}

.fa-preflight-card p {
  margin: 0 0 10px;
  color: #4f6d8f;
  font-size: 14px;
}

.fa-issues-list {
  margin: 0;
  padding-left: 20px;
  color: #991b1b;
}

.fa-issues-list li {
  margin: 4px 0;
  font-size: 13px;
}

/* GA Result Panel */
.ga-result-card {
  border: 2px solid var(--quality-color, #0066cc);
  border-radius: 12px;
  background: linear-gradient(160deg, rgba(248, 252, 255, 0.98) 0%, rgba(231, 244, 255, 0.92) 100%);
  padding: 20px;
  position: relative;
  overflow: hidden;
}

.ga-result-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--quality-color, #0066cc);
}

.ga-result-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.ga-result-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.ga-result-icon {
  font-size: 32px;
  line-height: 1;
}

.ga-result-text {
  display: flex;
  flex-direction: column;
}

.ga-result-label {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #4f6d8f;
  font-weight: 600;
}

.ga-result-text h3 {
  margin: 4px 0 0;
  color: #124784;
  font-size: 24px;
  font-weight: 700;
}

.ga-result-metrics {
  display: flex;
  gap: 20px;
  text-align: right;
}

.ga-result-metrics span {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #4f6d8f;
}

.ga-result-metrics strong {
  color: #124784;
  font-size: 14px;
  font-weight: 700;
}

/* Details Dropdown */
.ga-result-dropdown {
  margin-top: 12px;
}

.ga-result-dropdown summary {
  cursor: pointer;
  padding: 10px;
  border-radius: 6px;
  background: rgba(195, 225, 255, 0.5);
  color: #0f4f96;
  font-weight: 600;
  user-select: none;
}

.ga-result-dropdown summary:hover {
  background: rgba(195, 225, 255, 0.8);
}

.ga-result-dropdown-content {
  padding: 14px 10px;
  border-top: 1px solid rgba(176, 211, 252, 0.5);
}

.ga-result-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.ga-result-section {
  padding: 12px;
  background: rgba(248, 252, 255, 0.9);
  border-radius: 8px;
}

.ga-result-section h4 {
  margin: 0 0 8px;
  color: #124784;
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ga-result-section p {
  margin: 6px 0;
  font-size: 13px;
  color: #4f6d8f;
}

.ga-result-section strong {
  color: #124784;
  font-weight: 700;
}

@media (max-width: 768px) {
  .fa-dashboard-grid {
    grid-template-columns: 1fr;
  }

  .fa-button-group {
    flex-direction: column;
  }

  .fa-btn {
    width: 100%;
    justify-content: center;
  }

  .ga-result-header {
    flex-direction: column;
  }

  .ga-result-metrics {
    margin-top: 12px;
    justify-content: flex-start;
  }

  .ga-result-grid {
    grid-template-columns: 1fr;
  }
}
```

### API Service Integration (api.js Update)
Add to `frontend/src/services/api.js`:

```javascript
export const gaService = {
  preFlight: async () => {
    const response = await fetch(`${API_BASE_URL}/ga/pre-flight`);
    if (!response.ok) throw new Error('Pre-flight check failed');
    return response.json();
  },

  runFaculty: async (dryRun = false) => {
    const url = new URL(`${API_BASE_URL}/ga/run/faculty`);
    if (dryRun) url.searchParams.append('dry_run', 'true');

    const response = await fetch(url.toString(), { method: 'POST' });
    if (!response.ok) throw new Error('GA execution failed');
    return response.json();
  }
};
```

### Add Route to Navbar
Update `frontend/src/components/Navbar.jsx` to include link to Faculty Loading page (similar to existing links to Faculty, Schedule, etc.).

---

## Summary
- **No DB schema changes**: Results stored as notifications in existing `faculty_notifications` table
- **Existing API endpoints**: Frontend uses `GET /api/notifications/faculty` (no changes)
- **Clean separation**: GA logic in Python, Node adapter orchestrates, Supabase persists
- **Easy testing**: Pre-flight endpoint validates before running GA
- **Reproducible**: Deterministic seeds, dry-run mode, idempotent runs
- **Unified UI**: Frontend Faculty Loading page follows existing design patterns from Schedule.jsx
}
```

**Improved scoring logic (what makes a "better" schedule):**

Hard constraints (must not violate; fitness_hard):
- No faculty double-booking (same time).
- No room double-booking (same time).
- Faculty specialization matches required subject skill level (if specified).
- Room capacity ≥ expected subject enrollment.
- Department must align (no CS faculty → History subject).

Soft penalties (quality scoring; fitness_soft):
1. **Load Balancing (weight: 30%)**
   - Minimize variance in total units across faculty (avoid one person with 18 units, another with 6).
   - Penalize: `(faculty.units - avg_units)² × 3` per faculty.
   - Bonus: Faculty near max_units (e.g., 16-18) should be utilized.

2. **Workload Distribution Quality (weight: 20%)**
   - Prefer fewer, higher-value classes over many small classes (e.g., 4 classes of 3-4 units each is better than 8 classes of 1-2 units).
   - Penalize: `class_count - optimal_class_count × 5` (optimal ≈ 3-5 classes for 15-18 units).

3. **Schedule Fragmentation (weight: 15%)**
   - Prefer consecutive blocks on same day; penalize scattered schedules.
   - Penalize: `avg_breaks_between_classes × 20`.
   - Bonus: Faculty teaching MWF/TR patterns (easier to manage).

4. **Preference Satisfaction (weight: 20%)**
   - Preferred subject match: +50pts if assigned; -30pts if not.
   - Preferred time slot (e.g., MWF vs TR): +20pts if matched; -15pts if not.
   - Department match: +10pts if within faculty's department.

5. **Room Optimization (weight: 10%)**
   - Avoid oversized rooms (wasted space/overhead).
   - Penalize: `max(0, room.capacity - expected_enrollment) × 2`.
   - Bonus: Right-sized rooms (80-95% capacity): +10pts.

6. **Specialization Alignment (weight: 5%)**
   - If subject requires specialization (e.g., "AI"), prioritize faculty with that specialization.
   - Penalize: `-40pts` if unqualified faculty forced into specialized subject.

6) Persisting results
- Node should upsert per-faculty flags/scores into `faculty_notifications` or a dedicated `ga_results` table with `run_id` and `snapshot_id` for reproducibility.
- Include fields: `run_id`, `faculty_id`, `score`, `flags` (json), `conflicts` (json), `created_by`, `created_at`.

7) Error handling & idempotency
- GA runs must support `dry_run` mode and deterministic `random_seed` for reproducibility.
- Use `run_id` (UUID) derived from input snapshot + seed to make runs idempotent.
- Failures should leave no partial persisted state; use transactional upserts or write to a staging table then promote on success.

8) Testing & backfill
- After integration, run `backend/tools/backfill_faculty_notifications.js` to regenerate notifications from GA outputs.
- Add smoke test that calls `POST /api/ga/run/faculty?dry_run=true` and then `GET /api/notifications/faculty/debug` to verify output shape.

9) Data quality prerequisites & pre-flight validation (CRITICAL)

GA requires valid, complete data. If users run faculty loading with unresolved data issues, results will be poor or invalid.

Integration with notification system:
- Check `/api/notifications/faculty`, `/api/notifications/subjects`, `/api/notifications/rooms` for outstanding issues.
- Pre-flight endpoint: `GET /api/ga/pre-flight` returns validation report without running GA.
- Pre-flight must verify:
  - All faculty have name, department, max_units set (no nulls).
  - All subjects have code, units, department set.
  - All rooms have room_number, capacity set.
  - Department names normalize consistently (no mixed aliases).
  - preferred_subjects array references valid subject IDs.
  - No duplicate faculty/subject/room IDs.
  - Time slot formats are valid (e.g., "Monday", "8:00-9:00").

Pre-flight response if blocked:
```json
{
  "status": "blocked",
  "reason": "Data quality issues prevent GA execution",
  "issues": [
    { "type": "faculty", "id": "fac-123", "problem": "missing max_units", "notification_id": "notif-456" },
    { "type": "subject", "id": "subj-789", "problem": "invalid department alias", "notification_id": "notif-789" }
  ],
  "unresolved_notification_count": 3,
  "suggested_next_step": "Resolve issues in Dashboard > Notifications, then retry."
}
```

UI workflow:
- Before `POST /api/ga/run/faculty`, call `GET /api/ga/pre-flight`.
- If blocked, show modal listing issues + link to Notifications page.
- Only enable "Run Faculty Loading" button if pre-flight passes.
- Optional: `POST /api/ga/run/faculty?skip_validation=true` (admin-only, log warning).

Acceptance criteria (short)
-------------------------
- GA produces per-faculty score objects and conflict lists.
- Node persists notifications via existing endpoints (no frontend changes required).
- Backfill script recreates notifications consistently.
- Pre-flight validation blocks GA if critical data quality issues exist.
- Frontend respects pre-flight checks and prevents user error.


NEW DATABASE CURRENT STRUCTURE/SCHEMA:

