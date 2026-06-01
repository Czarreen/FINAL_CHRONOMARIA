#!/usr/bin/env node
import { query } from '../src/lib/postgres.js';

async function main() {
  console.log('[backfill] starting faculty teaching history backfill');

  const sql = `
INSERT INTO faculty_teaching_history (run_id, source, record_key, faculty_id, curr_id, code, course_no, department_id, section, descriptive_title, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id, merged, payload)
SELECT
  NULL as run_id,
  'backfill' as source,
  (curr_id::text || '|' || upper(coalesce(code,'')) || '|' || upper(coalesce(course_no,'')) || '|' || department_id::text || '|' || upper(coalesce(section,''))) as record_key,
  faculty_id,
  curr_id,
  code,
  course_no,
  department_id,
  section,
  descriptive_title,
  units,
  lec_hrs,
  lab_hrs,
  mth_schedule,
  mth_room_id,
  tfs_schedule,
  tfs_room_id,
  merged,
  to_jsonb(row) as payload
FROM public.faculty_loading row
WHERE faculty_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM faculty_teaching_history h
    WHERE h.record_key = (row.curr_id::text || '|' || upper(coalesce(row.code,'')) || '|' || upper(coalesce(row.course_no,'')) || '|' || row.department_id::text || '|' || upper(coalesce(row.section,'')))
      AND h.faculty_id = row.faculty_id
  );
`;

  try {
    const result = await query(sql);
    console.log('[backfill] completed:', result && result.rowCount ? `${result.rowCount} inserted` : 'no rows inserted');
  } catch (err) {
    console.error('[backfill] failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
