# Faculty Subject Preferences Feature

## Overview

The Faculty Subject Preferences feature allows administrators to tag faculty members with their preferred teaching subjects. This system supports priority levels (High, Capable, Fallback) and includes an auto-generation feature that intelligently parses faculty specialization data to suggest initial tags. **Department constraints are enforced**: faculty can only be tagged with subjects from their own department.

### Key Benefits

- **Structured Subject Assignment**: Organize faculty expertise with explicit subject mappings
- **Priority Levels**: Mark subject expertise from high (1) to fallback (3)
- **Department Constraints**: Faculty can only be tagged with subjects from their own department
- **Auto-Tagging**: Automatically generate preferences from faculty specialization field (department-scoped)
- **Embedded Dictionary**: In-memory caching for GA efficiency (future integration)
- **Full CRUD**: Add, edit, and delete preferences as needed

---

## Features

### 1. Manual Tag Management

Add or remove subject preferences for any faculty member:

- **Add Tag**: Select a subject + priority level + click "Add"
- **Edit Priority**: Change priority level (1/2/3) directly in the list
- **Delete Tag**: Remove preferences with the trash icon

### 2. Auto-Generate from Specialization

The system parses the faculty's `specialization` field and automatically suggests subjects:

- Extracts keywords from specialization (comma/semicolon-separated)
- Matches keywords against subject codes, course numbers, titles, and departments
- Assigns priority based on match score:
  - **Priority 1 (High)**: Match score ≥ 30
  - **Priority 2 (Capable)**: Match score ≥ 15
  - **Priority 3 (Fallback)**: Match score > 0

**Example**:
```
Specialization: "Programming, Web Development; Python, JavaScript"

Auto-generated tags might be:
- CS101 (Programming Fundamentals) → Priority 1
- CS201 (Web Development) → Priority 1
- CS305 (Python Advanced) → Priority 1
- CS310 (JavaScript Frameworks) → Priority 1
- CS150 (Intro to Programming) → Priority 2
```

### 3. Priority Levels

| Level | Label | Meaning | Use Case |
|-------|-------|---------|----------|
| **1** | High Expertise | Faculty is highly qualified | Primary assignment preference |
| **2** | Capable | Faculty can teach it well | Secondary/backup assignment |
| **3** | Fallback | Faculty can teach if needed | Last resort or emergency coverage |

---

## User Interface

### Access the Feature

1. Go to **Faculty View**
2. Click the **tag icon** (🏷️) in the action column for any faculty member
3. Modal opens showing current preferences and options to add more

### Modal Layout

```
┌─────────────────────────────────────┐
│ Subject Preferences                 │ [×]
│ Faculty Name                        │
├─────────────────────────────────────┤
│                                     │
│ [Error Message] (if any)            │
│                                     │
│ ADD SUBJECT TAG                     │
│ [Subject Dropdown] [Priority] [Add] │
│                                     │
│ [Auto-Generate Button]              │
│                                     │
│ CURRENT TAGS (5)                    │
│ ┌─────────────────────────────────┐ │
│ │ CS101 - Intro Programming [1] ✕ │ │
│ │ CS201 - Web Dev [2]        ✕ │ │
│ │ ...                             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Priority Levels: 1=High 2=Capable   │
│                3=Fallback           │
└─────────────────────────────────────┘
```

---

## Technical Architecture

### Database Schema

#### Table: `faculty_subject_tags`

```sql
CREATE TABLE faculty_subject_tags (
  faculty_id INTEGER PRIMARY KEY,
  subject_id INTEGER PRIMARY KEY,
  priority_level SMALLINT NOT NULL (1, 2, or 3),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (faculty_id) REFERENCES faculty(faculty_id),
  FOREIGN KEY (subject_id) REFERENCES subjects(subject_id),
  PRIMARY KEY (faculty_id, subject_id)
);

CREATE INDEX idx_faculty_subject_tags_faculty_id 
  ON faculty_subject_tags(faculty_id);
CREATE INDEX idx_faculty_subject_tags_subject_id 
  ON faculty_subject_tags(subject_id);
```

### Backend Architecture

#### Library: `Backend/node-api/src/lib/facultySubjectPreferences.js`

**Core Functions**:

- `fetchFacultySubjectPreferencesForFaculty(facultyId)` - Get all preferences for a faculty with subject details
- `saveFacultySubjectPreference({facultyId, subjectId, priorityLevel})` - Create/update preference (upsert) **with department validation**
- `deleteFacultySubjectPreference({facultyId, subjectId})` - Remove preference
- `autoGenerateFacultySubjectPreferences({facultyId})` - Auto-generate tags from specialization **filtered by department**
- `scoreSubjectMatch(facultySpecialization, subject)` - Calculate match score
- `buildFacultyPreferenceMap(rows)` - Convert DB rows to dictionary format

**Auto-Generation Algorithm**:

```javascript
1. Fetch faculty record (including department_id)
2. Extract specialization from faculty record
3. Split by delimiters: [,;/|]
4. Extract keywords (2+ chars, alphanumeric only)
5. For each subject in faculty's department (filtered by department_id):
    - Calculate match score based on:
      - Exact match in title: +24 points
      - Exact match in code: +16 points
      - Exact match in course_no: +14 points
      - Each keyword match: +10 points
6. Assign priority based on score:
    - score ≥ 30 → Priority 1
    - score ≥ 15 → Priority 2
    - score > 0  → Priority 3
7. Insert all upserts into database
```

**Department Constraint Enforcement**:

The system enforces department constraints at multiple levels:

```javascript
// In saveFacultySubjectPreference():
1. Fetch faculty record and get faculty.department_id
2. Fetch subject record and get subject.department_id
3. If departments don't match, throw error:
   "Cannot tag faculty with subjects from different departments"
4. Otherwise, proceed with upsert

// In autoGenerateFacultySubjectPreferences():
1. Fetch faculty record with department_id
2. Query subjects WHERE department_id = faculty.department_id
3. Score and generate tags only from department's subjects
4. Auto-generation respects department boundaries
```

#### Routes: `Backend/node-api/src/routes/facultySubjectPreferences.js`

**API Endpoints**:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/faculty/:id/subject-preferences` | Fetch preferences for faculty |
| POST | `/api/faculty/:id/subject-preferences` | Create/update preference |
| DELETE | `/api/faculty/:id/subject-preferences/:subjectId` | Delete preference |
| POST | `/api/faculty/:id/subject-preferences/auto-generate` | Auto-generate from specialization |

### Frontend Architecture

#### Service: `Frontend/src/services/facultySubjectPreferencesApi.js`

```javascript
fetchFacultySubjectPreferences(facultyId)
addFacultySubjectPreference(facultyId, {subjectId, priorityLevel})
deleteFacultySubjectPreference(facultyId, subjectId)
autoGenerateFacultySubjectPreferences(facultyId)
updateFacultySubjectPreferencePriority(facultyId, subjectId, priorityLevel)
```

#### Component: `Frontend/src/components/FacultySubjectPreferencesModal.jsx`

- Modal state management (preferences, subjects, loading, errors)
- CRUD operations with user feedback
- Color-coded priority display (Red=1, Amber=2, Blue=3)
- Auto-generate integration
- Scrollable preferences list (max 256px height)


