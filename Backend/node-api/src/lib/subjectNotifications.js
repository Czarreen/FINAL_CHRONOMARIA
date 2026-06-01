import { supabaseAdmin } from './supabase.js';
import { findConflictingSchedules, isRoomGym } from './scheduleConflictChecker.js';

function normalizeSubjectText(value) {
  return value == null ? '' : String(value).trim();
}

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === '' || Number(value) === 0;
}

/**
 * Fetch gym room IDs and room-name lookup from the DB in a single query.
 * Mirrors getGymRoomIds() in courseOfferingNotifications.js, but also
 * builds the roomNameById map needed for cross-type room normalisation.
 */
async function getRoomData() {
  const { data: allRooms } = await supabaseAdmin.from('rooms').select('room_id, room_name');
  const gymRoomIds = new Set(
    (allRooms || []).filter((r) => isRoomGym(r.room_name)).map((r) => String(r.room_id))
  );
  const roomNameById = new Map(
    (allRooms || []).map((r) => [String(r.room_id), r.room_name || ''])
  );
  return { gymRoomIds, roomNameById };
}

/**
 * Re-map a course_offerings row so its room values are room NAMES (strings)
 * instead of numeric IDs.  This lets findConflictingSchedules compare
 * offering rooms against subject rooms on the same basis (both use names).
 */
function normalizeOfferingRooms(offering, roomNameById) {
  return {
    ...offering,
    // Clear the numeric ID fields so expandEntityToRecords falls back to mth_room/tfs_room.
    mth_room_id: undefined,
    tfs_room_id: undefined,
    mth_room: roomNameById.get(String(offering.mth_room_id ?? '')) || offering.mth_room || '',
    tfs_room: roomNameById.get(String(offering.tfs_room_id ?? '')) || offering.tfs_room || '',
  };
}

export function buildSubjectNotificationIssues(subject, allSubjects = [], gymRoomIds = new Set(), allOfferings = []) {
  const issues = [];

  if (!normalizeSubjectText(subject?.subject_code)) {
    issues.push({
      field_name: 'subject_code',
      issue_type: 'missing',
      severity: 'high',
      message: 'Subject code is required',
    });
  }

  if (!normalizeSubjectText(subject?.subject_descriptive_title)) {
    issues.push({
      field_name: 'subject_descriptive_title',
      issue_type: 'missing',
      severity: 'high',
      message: 'Subject title is missing',
    });
  }

  if (subject?.subject_units == null || Number(subject.subject_units) <= 0) {
    issues.push({
      field_name: 'subject_units',
      issue_type: 'missing',
      severity: 'high',
      message: 'Subject units are not specified',
    });
  }

  if (isEmptyValue(subject?.department_id)) {
    issues.push({
      field_name: 'department_id',
      issue_type: 'missing',
      severity: 'medium',
      message: 'Department is not assigned',
    });
  }

  if (isEmptyValue(subject?.curr_id)) {
    issues.push({
      field_name: 'curr_id',
      issue_type: 'missing',
      severity: 'medium',
      message: 'Curriculum ID is missing',
    });
  }

  const hasLectureHours = !isEmptyValue(subject?.subject_lec_hrs);
  const hasLabHours = !isEmptyValue(subject?.subject_lab_hrs);
  if (!hasLectureHours && !hasLabHours) {
    issues.push({
      field_name: 'subject_lec_hrs',
      issue_type: 'missing',
      severity: 'medium',
      message: 'Either lecture hours or lab hours must be specified',
    });
  }

  const hasMthSchedule = normalizeSubjectText(subject?.mth_schedule) !== '';
  const hasTfsSchedule = normalizeSubjectText(subject?.tfs_schedule) !== '';
  const hasMthRoom = normalizeSubjectText(subject?.mth_room) !== '';
  const hasTfsRoom = normalizeSubjectText(subject?.tfs_room) !== '';

  if (!hasMthSchedule && !hasTfsSchedule) {
    issues.push({
      field_name: 'schedule',
      issue_type: 'missing',
      severity: 'high',
      message: 'No schedule assigned',
    });
  }

  if (hasMthSchedule && !hasMthRoom) {
    issues.push({
      field_name: 'mth_room',
      issue_type: 'missing',
      severity: 'medium',
      message: 'MTH schedule is missing room assignment',
    });
  }

  if (hasTfsSchedule && !hasTfsRoom) {
    issues.push({
      field_name: 'tfs_room',
      issue_type: 'missing',
      severity: 'medium',
      message: 'TFS schedule is missing room assignment',
    });
  }

  // Use DB-backed gymRoomIds set (same as courseOfferingNotifications.js) so numeric
  // room-ID values are properly recognised as gym rooms, not just name-string checks.
  const isMthRoomGym = gymRoomIds.has(String(subject?.mth_room)) || isRoomGym(subject?.mth_room);
  const isTfsRoomGym = gymRoomIds.has(String(subject?.tfs_room)) || isRoomGym(subject?.tfs_room);

  // ── Subject vs Subject conflicts ──────────────────────────────────────────
  const conflicts = findConflictingSchedules(subject, allSubjects, false, gymRoomIds);
  for (const conflict of conflicts) {
    if ((conflict.schedule === 'MTH' && !isMthRoomGym) || (conflict.schedule === 'TFS' && !isTfsRoomGym)) {
      issues.push({
        field_name: 'schedule_conflict',
        issue_type: 'conflict',
        severity: 'high',
        message: `${conflict.schedule} schedule conflicts with ${conflict.entityCode} (${conflict.room}) on ${conflict.conflictingDays.join('/')}`,
        conflicting_subject_id: conflict.entityId,
        conflicting_offering_id: null,
        conflicting_code: conflict.entityCode || null,
        conflict_room_id: conflict.room || null,
        conflict_schedule_type: conflict.schedule || null,
        conflict_days: conflict.conflictingDays || null,
        conflict_entity_schedule: conflict.schedule === 'MTH' ? (subject.mth_schedule || null) : (subject.tfs_schedule || null),
      });
    }
  }

  // ── Subject vs Course-Offering cross-type conflicts ───────────────────────
  // Subjects use room names; offerings use numeric room IDs.  allOfferings has
  // already been normalised (room IDs replaced with room names) by the caller
  // so findConflictingSchedules can match on the same room-name basis.
  if (allOfferings.length > 0) {
    const crossConflicts = findConflictingSchedules(subject, allOfferings, false, gymRoomIds);
    for (const conflict of crossConflicts) {
      if ((conflict.schedule === 'MTH' && !isMthRoomGym) || (conflict.schedule === 'TFS' && !isTfsRoomGym)) {
        issues.push({
          field_name: 'schedule_conflict',
          issue_type: 'conflict',
          severity: 'high',
          message: `${conflict.schedule} schedule conflicts with offering ${conflict.entityCode} (${conflict.room}) on ${conflict.conflictingDays.join('/')}`,
          conflicting_subject_id: null,
          conflicting_offering_id: conflict.entityId,
          conflicting_code: conflict.entityCode || null,
          conflict_room_id: conflict.room || null,
          conflict_schedule_type: conflict.schedule || null,
          conflict_days: conflict.conflictingDays || null,
          conflict_entity_schedule: conflict.schedule === 'MTH' ? (subject.mth_schedule || null) : (subject.tfs_schedule || null),
        });
      }
    }
  }

  const hasHigh = issues.some((i) => i.severity === 'high');
  if (!hasHigh && issues.length >= 4) {
    issues.forEach((i) => { i.severity = 'high'; });
  }

  return issues;
}

export function buildSubjectNotificationRows(subject, allSubjects = [], gymRoomIds = new Set(), allOfferings = []) {
  const issues = buildSubjectNotificationIssues(subject, allSubjects, gymRoomIds, allOfferings);

  return issues.map((issue) => ({
    entity_id: subject.subject_id,
    field_name: issue.field_name,
    issue_type: issue.issue_type,
    severity: issue.severity,
    message: issue.message,
    details: {
      subject_id: subject.subject_id,
      subject_code: normalizeSubjectText(subject.subject_code) || null,
      subject_descriptive_title: normalizeSubjectText(subject.subject_descriptive_title) || null,
      conflicting_subject_id: issue.conflicting_subject_id || null,
      conflicting_offering_id: issue.conflicting_offering_id || null,
      conflicting_code: issue.conflicting_code || null,
      conflict_room_id: issue.conflict_room_id || null,
      conflict_schedule_type: issue.conflict_schedule_type || null,
      conflict_days: issue.conflict_days || null,
      conflict_entity_schedule: issue.conflict_entity_schedule || null,
    },
  }));
}

export async function upsertSubjectNotificationCache(subject) {
  const subjectId = Number(subject?.subject_id);
  if (!subjectId) {
    throw new Error('Invalid subject_id');
  }

  const { error: deleteError } = await supabaseAdmin
    .from('subject_notifications')
    .delete()
    .eq('entity_id', subjectId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  // Fetch room data, all subjects (peers), and all course offerings (cross-type peers)
  // in parallel to keep rescan fast.
  const [
    { gymRoomIds, roomNameById },
    { data: allSubjects, error: allFetchError },
    { data: rawOfferings, error: offeringFetchError },
  ] = await Promise.all([
    getRoomData(),
    supabaseAdmin
      .from('subjects')
      .select('subject_id, subject_code, subject_descriptive_title, mth_schedule, tfs_schedule, mth_room, tfs_room, curr_id, department_id, subject_course_no'),
    supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, descriptive_title, curr_id, department_id, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id, merged'),
  ]);

  if (allFetchError) throw new Error(allFetchError.message);
  if (offeringFetchError) throw new Error(offeringFetchError.message);

  // Normalise offering room IDs → room names so conflict detection can compare
  // on the same basis as subject room values (which are stored as names).
  const allOfferings = (rawOfferings || []).map((o) => normalizeOfferingRooms(o, roomNameById));

  const rows = buildSubjectNotificationRows(subject, allSubjects || [], gymRoomIds, allOfferings);
  if (rows.length === 0) {
    return { updated: 0, issues: [] };
  }

  const now = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    is_resolved: false,
    created_at: now,
    updated_at: now,
  }));

  const { data, error } = await supabaseAdmin
    .from('subject_notifications')
    .insert(payload)
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return { updated: data?.length ?? 0, issues: data ?? [] };
}

export async function rescanAllSubjectNotifications() {
  // Fetch subjects, room data, and course offerings in parallel for speed.
  const [
    { data: subjects, error: fetchError },
    { gymRoomIds, roomNameById },
    { data: rawOfferings, error: offeringFetchError },
  ] = await Promise.all([
    supabaseAdmin
      .from('subjects')
      .select('subject_id, subject_code, subject_descriptive_title, subject_units, mth_schedule, tfs_schedule, mth_room, tfs_room, curr_id, department_id, subject_course_no')
      .order('subject_id', { ascending: true }),
    getRoomData(),
    supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, descriptive_title, curr_id, department_id, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id, merged'),
  ]);

  if (fetchError) throw new Error(fetchError.message);
  if (offeringFetchError) throw new Error(offeringFetchError.message);

  // Normalise offering room IDs → room names (same basis as subjects).
  const allOfferings = (rawOfferings || []).map((o) => normalizeOfferingRooms(o, roomNameById));

  const { error: deleteError } = await supabaseAdmin
    .from('subject_notifications')
    .delete()
    .gte('id', 0);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const now = new Date().toISOString();
  const inserts = [];

  for (const subject of subjects || []) {
    const rows = buildSubjectNotificationRows(subject, subjects || [], gymRoomIds, allOfferings);
    if (rows.length === 0) {
      continue;
    }

    rows.forEach((row) => {
      inserts.push({
        ...row,
        is_resolved: false,
        created_at: now,
        updated_at: now,
      });
    });
  }

  if (inserts.length === 0) {
    return { scanned: subjects?.length ?? 0, inserted: 0 };
  }

  const BATCH = 200;
  for (let index = 0; index < inserts.length; index += BATCH) {
    const { error } = await supabaseAdmin
      .from('subject_notifications')
      .insert(inserts.slice(index, index + BATCH));

    if (error) {
      throw new Error(error.message);
    }
  }

  return { scanned: subjects?.length ?? 0, inserted: inserts.length };
}