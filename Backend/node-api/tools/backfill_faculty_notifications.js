import { supabaseAdmin } from '../src/lib/supabase.js';

async function buildNotificationForFaculty(f) {
  const missingFields = [];
  const issues = [];

  if (!f.faculty_name || String(f.faculty_name).trim() === '') {
    missingFields.push('faculty_name');
    issues.push({ message: 'Missing faculty name' });
  }

  if (!f.department_id) {
    missingFields.push('department_id');
    issues.push({ message: 'No department assigned' });
  }

  if (!f.faculty_role || String(f.faculty_role).trim() === '') {
    missingFields.push('faculty_role');
    issues.push({ message: 'Missing role/title' });
  }

  if (!f.faculty_status || String(f.faculty_status).trim() === '') {
    missingFields.push('faculty_status');
    issues.push({ message: 'Missing status (active/inactive/on-leave)' });
  }

  if (!f.faculty_specialization || String(f.faculty_specialization).trim() === '') {
    issues.push({ message: 'No specializations provided' });
  }

  if (!f.faculty_max_units) {
    issues.push({ message: 'Max units not set' });
  }

  const severity = missingFields.length > 0 ? 'critical' : issues.length > 0 ? 'medium' : 'low';

  return {
    faculty_id: f.faculty_id,
    title: f.faculty_name || `Faculty #${f.faculty_id}`,
    description: f.departments?.department_name || null,
    severity,
    missing_fields: JSON.stringify(missingFields),
    issues: JSON.stringify(issues),
    metadata: JSON.stringify({}),
  };
}

async function run() {
  console.log('Fetching faculty rows...');
  const { data: facultyRows, error } = await supabaseAdmin
    .from('faculty')
    .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)');

  if (error) {
    console.error('Failed to fetch faculty:', error);
    process.exit(1);
  }

  const inserts = [];
  for (const f of facultyRows || []) {
    const n = await buildNotificationForFaculty(f);
    // only persist items that have missing fields or issues (i.e., need attention)
    const missing = JSON.parse(n.missing_fields || '[]');
    const issues = JSON.parse(n.issues || '[]');
    if (missing.length === 0 && issues.length === 0) continue;
    inserts.push(n);
  }

  console.log(`Preparing to upsert ${inserts.length} notifications into faculty_notifications...`);

  // preserve existing is_resolved flags: fetch existing notifications for these faculty_ids
  const facultyIds = inserts.map((i) => i.faculty_id);
  let existingMap = {};
  if (facultyIds.length > 0) {
    const { data: existingRows, error: fetchErr } = await supabaseAdmin
      .from('faculty_notifications')
      .select('*')
      .in('faculty_id', facultyIds);

    if (fetchErr) {
      console.error('Failed to fetch existing notifications:', fetchErr);
      process.exit(1);
    }

    existingMap = (existingRows || []).reduce((acc, row) => {
      acc[row.faculty_id] = row;
      return acc;
    }, {});
  }

  // merge is_resolved from existing rows when present
  const toUpsert = inserts.map((item) => {
    const existing = existingMap[item.faculty_id];
    return {
      ...item,
      is_resolved: existing && existing.is_resolved ? true : false,
      updated_at: new Date().toISOString(),
    };
  });

  if (toUpsert.length === 0) {
    console.log('No notifications to upsert. Backfill complete.');
    return;
  }

  const { data, error: upsertErr } = await supabaseAdmin
    .from('faculty_notifications')
    .upsert(toUpsert, { onConflict: 'faculty_id' });

  if (upsertErr) {
    console.error('Upsert failed:', upsertErr);
    process.exit(1);
  }

  // Delete rows for faculty that don't have any issues (e.g., old "low" severity rows with no problems)
  const facultyIdsWithProblems = new Set(inserts.map((i) => i.faculty_id));
  const allFacultyIds = new Set((facultyRows || []).map((f) => f.faculty_id));
  const facultyIdsWithoutProblems = Array.from(allFacultyIds).filter((id) => !facultyIdsWithProblems.has(id));

  if (facultyIdsWithoutProblems.length > 0) {
    console.log(`Deleting ${facultyIdsWithoutProblems.length} notifications for faculty with no issues...`);
    const { error: deleteErr } = await supabaseAdmin
      .from('faculty_notifications')
      .delete()
      .in('faculty_id', facultyIdsWithoutProblems);

    if (deleteErr) {
      console.error('Delete failed:', deleteErr);
      process.exit(1);
    }
    console.log(`Deleted ${facultyIdsWithoutProblems.length} notifications.`);
  }

  console.log('Backfill complete.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
