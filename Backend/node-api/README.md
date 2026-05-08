# Node API Gateway

This service is the integration gateway between frontend, Supabase, and Python services.

## Run

1. Install dependencies:
   - `npm install`
2. Start dev server:
   - `npm run dev`

It reads environment values from `Backend/.env`.

## Course Offering CSV Import

### Endpoint

- `POST /api/course-offerings/import-csv`

### Request Body

Send JSON with CSV text read from an uploaded `.csv` file:

```json
{
   "fileName": "All_Subjects_Full_List1.xlsx.csv",
   "csvText": "Curr ID,CODE,COURSE NO.,DEPT,SECTION,DESCRIPTIVE TITLE,Units,Lec(hrs),Lab(hrs)\n947,4000,ArchMath 2,AR,1A,Differential and Integral Calculus,3,3,0"
}
```

### Header Mapping (Header-driven)

- `Curr ID` -> `curr_id`
- `CODE` -> `code`
- `COURSE NO.` -> `course_no`
- `DEPT` -> `department_code` (resolved through Supabase `departments` table)
- `SECTION` -> `section`
- `DESCRIPTIVE TITLE` -> `descriptive_title`
- `Units` -> `units`
- `Lec(hrs)` -> `lec_hrs`
- `Lab(hrs)` -> `lab_hrs`

### Validation and Cleaning

- Trims all values.
- Normalizes empty values (`""`, `"null"`, `"n/a"`, `"-"`) to `null`.
- Parses numeric fields (`curr_id`, `units`, `lec_hrs`, `lab_hrs`).
- Parses boolean fields when present.
- Parses date fields when present.
- Returns row-level errors without aborting the entire import.

### Upsert Rule

Rows are matched using:

- `curr_id + course_no + section + department_id`

If a row exists for that key, it is updated. Otherwise, it is inserted.

### Department Resolution (Supabase Tables)

`DEPT` values are resolved from the `departments` table. The importer builds lookup candidates from available table columns such as:

- `dept_code` (if present)
- `department_program`
- `department_name`

Unknown department codes fail only the affected rows.

For known codes used in imports (for example `AR`, `CE`, `IT`, `CS`, `CPE`, `ECE`, `EE`, `LIS`), if no matching row exists yet, the importer can auto-create a `departments` row using a default department name and `department_program` code.

### Response Shape

```json
{
   "success": true,
   "summary": {
      "fileName": "All_Subjects_Full_List1.xlsx.csv",
      "totalRows": 500,
      "processedRows": 470,
      "insertedRows": 320,
      "updatedRows": 150,
      "failedRows": 20,
      "skippedRows": 10,
      "errors": [
         {
            "row": 15,
            "messages": ["Unknown department code: \"XXX\""]
         }
      ],
      "warnings": []
   }
}
```
