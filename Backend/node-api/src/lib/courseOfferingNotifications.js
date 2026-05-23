import { supabaseAdmin } from './supabase.js';
import { findConflictingSchedules, isRoomGym } from './scheduleConflictChecker.js';

function isEmptyVal(v) {
  return v === null || v === undefined || String(v).trim() === '' || v === 0;
}

async function getGymRoomIds() {
  const { data: allRooms } = await supabaseAdmin.from('rooms').select('room_id, room_name');
  return new Set(
    (allRooms || []).filter((r) => isRoomGym(r.room_name)).map((r) => String(r.room_id))
  );
}

/**
 * Compute issue objects for a single course offering.
 * Mirrors buildSubjectNotificationIssues in subjectNotifications.js.
 *
 * @param {object}  offering      The course offering row
 * @param {object[]} allOfferings All offerings (for conflict detection)
 * @param {Set<string>} gymRoomIds  Numeric room IDs that are gym rooms (exempt from conflict)
 * @returns {object[]} Array of issue objects
 */
export function buildOfferingNotificationIssues(offering, allOfferings = [], gymRoomIds = new Set()) {
  const issues = [];

  if (isEmptyVal(offering.code)) {
    issues.push({ field_name: 'code', severity: 'high', message: 'Course code is required', issue_type: 'missing' });
  }
  if (isEmptyVal(offering.course_no)) {
    issues.push({ field_name: 'course_no', severity: 'high', message: 'Course number is required', issue_type: 'missing' });
  }

  const mthSchedule = !isEmptyVal(offering.mth_schedule);
  const mthRoom = !isEmptyVal(offering.mth_room_id);
  const tfsSchedule = !isEmptyVal(offering.tfs_schedule);
  const tfsRoom = !isEmptyVal(offering.tfs_room_id);

  if (!(mthSchedule && mthRoom) && !(tfsSchedule && tfsRoom)) {
    if (!mthSchedule && !tfsSchedule) {
      issues.push({ field_name: 'mth_schedule', severity: 'high', message: 'No schedule assigned', issue_type: 'missing' });
    } else if (!mthRoom && !tfsRoom) {
      if (mthSchedule) issues.push({ field_name: 'mth_room_id', severity: 'high', message: 'MTH schedule is missing room assignment', issue_type: 'missing' });
      if (tfsSchedule) issues.push({ field_name: 'tfs_room_id', severity: 'high', message: 'TFS schedule is missing room assignment', issue_type: 'missing' });
    } else {
      if (mthSchedule && !mthRoom) issues.push({ field_name: 'mth_room_id', severity: 'medium', message: 'MTH schedule is missing room assignment', issue_type: 'missing' });
      if (tfsSchedule && !tfsRoom) issues.push({ field_name: 'tfs_room_id', severity: 'medium', message: 'TFS schedule is missing room assignment', issue_type: 'missing' });
      if (!mthSchedule && mthRoom) issues.push({ field_name: 'mth_schedule', severity: 'medium', message: 'MTH room assigned but no schedule', issue_type: 'missing' });
      if (!tfsSchedule && tfsRoom) issues.push({ field_name: 'tfs_schedule', severity: 'medium', message: 'TFS room assigned but no schedule', issue_type: 'missing' });
    }
  }

  if (isEmptyVal(offering.descriptive_title)) issues.push({ field_name: 'descriptive_title', severity: 'medium', message: 'Course title is missing', issue_type: 'missing' });
  if (isEmptyVal(offering.department_id)) issues.push({ field_name: 'department_id', severity: 'medium', message: 'Department is not assigned', issue_type: 'missing' });
  if (isEmptyVal(offering.curr_id)) issues.push({ field_name: 'curr_id', severity: 'medium', message: 'Curriculum ID is missing', issue_type: 'missing' });
  if (isEmptyVal(offering.units)) issues.push({ field_name: 'units', severity: 'medium', message: 'Credit units are not specified', issue_type: 'missing' });

  const hasLectureHours = !isEmptyVal(offering.lec_hrs);
  const hasLabHours = !isEmptyVal(offering.lab_hrs);
  if (!hasLectureHours && !hasLabHours) {
    issues.push({ field_name: 'hours', severity: 'medium', message: 'Either lecture hours or lab hours must be specified', issue_type: 'missing' });
  }

  const isMthRoomGym = gymRoomIds.has(String(offering.mth_room_id)) || isRoomGym(offering.mth_room_id);
  const isTfsRoomGym = gymRoomIds.has(String(offering.tfs_room_id)) || isRoomGym(offering.tfs_room_id);

  const conflicts = findConflictingSchedules(offering, allOfferings, false, gymRoomIds);
  for (const conflict of conflicts) {
    if ((conflict.schedule === 'MTH' && !isMthRoomGym) || (conflict.schedule === 'TFS' && !isTfsRoomGym)) {
      issues.push({
        field_name: 'schedule_conflict',
        severity: 'high',
        message: `${conflict.schedule} schedule conflicts with ${conflict.entityCode} (${conflict.room}) on ${conflict.conflictingDays.join('/')}`,
        issue_type: 'conflict',
        conflicting_offering_id: conflict.entityId,
        conflicting_code: conflict.entityCode || null,
        conflict_room_id: conflict.room || null,
        conflict_schedule_type: conflict.schedule || null,
        conflict_days: conflict.conflictingDays || null,
        conflict_entity_schedule: conflict.schedule === 'MTH' ? (offering.mth_schedule || null) : (offering.tfs_schedule || null),
      });
    }
  }

  // Escalate: 4+ issues with no high severity → all become high
  const hasHigh = issues.some((i) => i.severity === 'high');
  if (!hasHigh && issues.length >= 4) {
    issues.forEach((i) => { i.severity = 'high'; });
  }

  return issues;
}

/**
 * Wrap issues into DB-ready row objects for data_quality_notifications.
 * Mirrors buildSubjectNotificationRows in subjectNotifications.js.
 */
export function buildOfferingNotificationRows(offering, allOfferings = [], gymRoomIds = new Set()) {
  const issues = buildOfferingNotificationIssues(offering, allOfferings, gymRoomIds);
  const now = new Date().toISOString();

  return issues.map((issue) => ({
    entity_type: 'course_offering',
    entity_id: offering.id,
    field_name: issue.field_name,
    issue_type: issue.issue_type,
    severity: issue.severity,
    message: issue.message,
    details: {
      offering_id: offering.id,
      code: offering.code || null,
      conflicting_offering_id: issue.conflicting_offering_id || null,
      conflicting_code: issue.conflicting_code || null,
      conflict_room_id: issue.conflict_room_id || null,
      conflict_schedule_type: issue.conflict_schedule_type || null,
      conflict_days: issue.conflict_days || null,
      conflict_entity_schedule: issue.conflict_entity_schedule || null,
    },
    is_resolved: false,
    created_at: now,
    updated_at: now,
  }));
}

/**
 * Delete existing unresolved notifications for one offering, recompute, insert,
 * then cascade to any offerings that had conflict notifications pointing at it.
 * Mirrors upsertSubjectNotificationCache in subjectNotifications.js.
 */
export async function upsertOfferingNotificationCache(offeringId) {
  const id = Number(offeringId);
  if (!id) throw new Error('Invalid offering id');

  const { data: rows, error: fetchErr } = await supabaseAdmin
    .from('course_offerings')
    .select('id, code, course_no, descriptive_title, department_id, curr_id, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id')
    .eq('id', id)
    .limit(1);

  if (fetchErr) throw new Error(fetchErr.message);
  const offering = rows?.[0];
  if (!offering) throw new Error('Offering not found');

  const { data: allOfferings, error: allFetchErr } = await supabaseAdmin
    .from('course_offerings')
    .select('id, code, course_no, descriptive_title, curr_id, department_id, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id');

  if (allFetchErr) throw new Error(allFetchErr.message);

  const gymRoomIds = await getGymRoomIds();

  const { error: delErr } = await supabaseAdmin
    .from('data_quality_notifications')
    .delete()
    .eq('entity_type', 'course_offering')
    .eq('entity_id', id)
    .eq('is_resolved', false);

  if (delErr) throw new Error(delErr.message);

  const inserts = buildOfferingNotificationRows(offering, allOfferings || [], gymRoomIds);
  let inserted = [];

  if (inserts.length > 0) {
    const { data: insertedRows, error: insertErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .insert(inserts)
      .select();

    if (insertErr) throw new Error(insertErr.message);
    inserted = insertedRows ?? [];
  }

  // Cascade: re-sync offerings that had a conflict notification pointing at this offering
  const { data: staleConflictNotifs } = await supabaseAdmin
    .from('data_quality_notifications')
    .select('entity_id')
    .eq('entity_type', 'course_offering')
    .eq('field_name', 'schedule_conflict')
    .eq('is_resolved', false)
    .filter('details->>conflicting_offering_id', 'eq', String(id));

  const affectedIds = [...new Set((staleConflictNotifs || []).map((r) => r.entity_id))];

  for (const affectedId of affectedIds) {
    const { data: affectedRows } = await supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, descriptive_title, curr_id, department_id, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id')
      .eq('id', affectedId)
      .limit(1);

    const affected = affectedRows?.[0];
    if (!affected) continue;

    await supabaseAdmin
      .from('data_quality_notifications')
      .delete()
      .eq('entity_type', 'course_offering')
      .eq('entity_id', affectedId)
      .eq('is_resolved', false);

    const affectedInserts = buildOfferingNotificationRows(affected, allOfferings || [], gymRoomIds);
    if (affectedInserts.length > 0) {
      await supabaseAdmin.from('data_quality_notifications').insert(affectedInserts);
    }
  }

  return { updated: inserted.length, issues: inserted };
}

/**
 * Wipe all unresolved CO notifications and rebuild from scratch.
 * Mirrors rescanAllSubjectNotifications in subjectNotifications.js.
 *
 * @param {{ force?: boolean }} options  force=true skips the "already has data" check
 */
export async function rescanAllOfferingNotifications({ force = false } = {}) {
  const { count: existingCount, error: countErr } = await supabaseAdmin
    .from('data_quality_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', 'course_offering')
    .eq('is_resolved', false);

  if (countErr) throw new Error(countErr.message);

  if (!force && (existingCount ?? 0) > 0) {
    return { skipped: true, count: existingCount, scanned: 0, inserted: 0 };
  }

  if ((existingCount ?? 0) > 0) {
    const { error: wipeErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .delete()
      .eq('entity_type', 'course_offering')
      .eq('is_resolved', false);

    if (wipeErr) throw new Error(wipeErr.message);
  }

  const gymRoomIds = await getGymRoomIds();

  const { data: offerings, error: fetchErr } = await supabaseAdmin
    .from('course_offerings')
    .select('id, code, course_no, descriptive_title, department_id, curr_id, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id');

  if (fetchErr) throw new Error(fetchErr.message);

  const inserts = [];
  for (const offering of offerings || []) {
    const rows = buildOfferingNotificationRows(offering, offerings || [], gymRoomIds);
    inserts.push(...rows);
  }

  const scanned = (offerings || []).length;

  if (inserts.length === 0) {
    return { skipped: false, scanned, inserted: 0 };
  }

  const BATCH = 200;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const { error: insertErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .insert(inserts.slice(i, i + BATCH));

    if (insertErr) throw new Error(insertErr.message);
  }

  return { skipped: false, scanned, inserted: inserts.length };
}
