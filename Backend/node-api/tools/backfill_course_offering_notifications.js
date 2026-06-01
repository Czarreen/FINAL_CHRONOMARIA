/**
 * Backfill course offering notifications into data_quality_notifications.
 *
 * Applies the same issue-detection rules as buildCourseOfferingNotifications
 * (Frontend/src/utils/missingData.js) so the database stays in sync with
 * what the frontend would compute client-side.
 *
 * Run once after applying the 001_add_notifications.sql migration, and
 * whenever notification rules change.
 *
 * Usage:
 *   node tools/backfill_course_offering_notifications.js
 */

import { supabaseAdmin } from '../src/lib/supabase.js';

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === '' || v === 0;
}

function buildIssuesForOffering(offering) {
  const issues = [];

  if (isEmpty(offering.code)) {
    issues.push({ field_name: 'code', severity: 'high', message: 'Course code is required', issue_type: 'missing' });
  }
  if (isEmpty(offering.course_no)) {
    issues.push({ field_name: 'course_no', severity: 'high', message: 'Course number is required', issue_type: 'missing' });
  }

  const mthSchedule = !isEmpty(offering.mth_schedule);
  const mthRoom = !isEmpty(offering.mth_room_id);
  const tfsSchedule = !isEmpty(offering.tfs_schedule);
  const tfsRoom = !isEmpty(offering.tfs_room_id);
  const mthComplete = mthSchedule && mthRoom;
  const tfsComplete = tfsSchedule && tfsRoom;

  if (!mthComplete && !tfsComplete) {
    if (!mthSchedule && !tfsSchedule) {
      issues.push({ field_name: 'mth_schedule', severity: 'high', message: 'No schedule assigned', issue_type: 'missing' });
    } else if (!mthRoom && !tfsRoom) {
      issues.push({ field_name: 'mth_room_id', severity: 'high', message: 'No classroom assigned for scheduled times', issue_type: 'missing' });
    } else {
      if (mthSchedule && !mthRoom) issues.push({ field_name: 'mth_room_id', severity: 'medium', message: 'MTH schedule is missing room assignment', issue_type: 'missing' });
      if (tfsSchedule && !tfsRoom) issues.push({ field_name: 'tfs_room_id', severity: 'medium', message: 'TFS schedule is missing room assignment', issue_type: 'missing' });
      if (!mthSchedule && mthRoom) issues.push({ field_name: 'mth_schedule', severity: 'medium', message: 'MTH room assigned but no schedule', issue_type: 'missing' });
      if (!tfsSchedule && tfsRoom) issues.push({ field_name: 'tfs_schedule', severity: 'medium', message: 'TFS room assigned but no schedule', issue_type: 'missing' });
    }
  }

  if (isEmpty(offering.descriptive_title)) issues.push({ field_name: 'descriptive_title', severity: 'medium', message: 'Course title is missing', issue_type: 'missing' });
  if (isEmpty(offering.department_id)) issues.push({ field_name: 'department_id', severity: 'medium', message: 'Department is not assigned', issue_type: 'missing' });
  if (isEmpty(offering.curr_id)) issues.push({ field_name: 'curr_id', severity: 'medium', message: 'Curriculum ID is missing', issue_type: 'missing' });
  if (isEmpty(offering.units)) issues.push({ field_name: 'units', severity: 'medium', message: 'Credit units are not specified', issue_type: 'missing' });
  const hasLectureHours = !isEmpty(offering.lec_hrs);
  const hasLabHours = !isEmpty(offering.lab_hrs);
  if (!hasLectureHours && !hasLabHours) {
    issues.push({
      field_name: 'hours',
      severity: 'medium',
      message: 'Either lecture hours or lab hours must be specified',
      issue_type: 'missing',
    });
  }

  // Severity escalation: 4+ issues and no critical → escalate all to critical
  const hasCritical = issues.some((i) => i.severity === 'high');
  if (!hasCritical && issues.length >= 4) {
    issues.forEach((i) => { i.severity = 'high'; });
  }

  return issues;
}

async function run() {
  console.log('Fetching course offering rows...');

  const { data: offerings, error: fetchErr } = await supabaseAdmin
    .from('course_offerings')
    .select('id, code, course_no, descriptive_title, department_id, curr_id, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id');

  if (fetchErr) {
    console.error('Failed to fetch course offerings:', fetchErr);
    process.exit(1);
  }

  console.log(`Found ${(offerings || []).length} offerings. Computing notifications...`);

  // Fetch existing resolved notifications so we preserve is_resolved=true
  const { data: existingResolved, error: resolvedErr } = await supabaseAdmin
    .from('data_quality_notifications')
    .select('entity_id, field_name')
    .eq('entity_type', 'course_offering')
    .eq('is_resolved', true);

  if (resolvedErr) {
    console.error('Failed to fetch existing resolved notifications:', resolvedErr);
    process.exit(1);
  }

  // Build a set of "entity_id:field_name" pairs that are already resolved
  const resolvedSet = new Set(
    (existingResolved || []).map((r) => `${r.entity_id}:${r.field_name}`)
  );

  // Delete all existing unresolved notifications
  const { error: delErr } = await supabaseAdmin
    .from('data_quality_notifications')
    .delete()
    .eq('entity_type', 'course_offering')
    .eq('is_resolved', false);

  if (delErr) {
    console.error('Failed to delete existing notifications:', delErr);
    process.exit(1);
  }

  // Build inserts
  const now = new Date().toISOString();
  const inserts = [];

  for (const offering of offerings || []) {
    const issues = buildIssuesForOffering(offering);
    for (const issue of issues) {
      const resolvedKey = `${offering.id}:${issue.field_name}`;
      inserts.push({
        entity_type: 'course_offering',
        entity_id: offering.id,
        field_name: issue.field_name,
        issue_type: issue.issue_type,
        severity: issue.severity,
        message: issue.message,
        details: { offering_id: offering.id, code: offering.code || null },
        is_resolved: resolvedSet.has(resolvedKey),
        created_at: now,
        updated_at: now,
      });
    }
  }

  console.log(`Inserting ${inserts.length} notification rows...`);

  if (inserts.length === 0) {
    console.log('No notifications to insert. All offerings are complete.');
    return;
  }

  // Insert in batches of 200 to avoid payload limits
  const BATCH_SIZE = 200;
  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    const batch = inserts.slice(i, i + BATCH_SIZE);
    const { error: insertErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .insert(batch);

    if (insertErr) {
      console.error(`Batch insert failed at offset ${i}:`, insertErr);
      process.exit(1);
    }
    console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(inserts.length / BATCH_SIZE)}`);
  }

  console.log(`Backfill complete. ${inserts.length} notification rows written.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
