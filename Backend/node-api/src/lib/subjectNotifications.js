import { supabaseAdmin } from './supabase.js';
import { findConflictingSchedules, isRoomGym } from './scheduleConflictChecker.js';

function normalizeSubjectText(value) {
  return value == null ? '' : String(value).trim();
}

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === '' || Number(value) === 0;
}

export function buildSubjectNotificationIssues(subject, allSubjects = []) {
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

  const isMthRoomGym = isRoomGym(subject?.mth_room);
  const isTfsRoomGym = isRoomGym(subject?.tfs_room);

  const conflicts = findConflictingSchedules(subject, allSubjects, false);
  for (const conflict of conflicts) {
    if ((conflict.schedule === 'MTH' && !isMthRoomGym) || (conflict.schedule === 'TFS' && !isTfsRoomGym)) {
      issues.push({
        field_name: 'schedule_conflict',
        issue_type: 'conflict',
        severity: 'high',
        message: `${conflict.schedule} schedule conflicts with ${conflict.entityCode} (${conflict.room}) on ${conflict.conflictingDays.join('/')}`,
        conflicting_subject_id: conflict.entityId,
      });
    }
  }

  const hasHigh = issues.some((i) => i.severity === 'high');
  if (!hasHigh && issues.length >= 4) {
    issues.forEach((i) => { i.severity = 'high'; });
  }

  return issues;
}

export function buildSubjectNotificationRows(subject, allSubjects = []) {
  const issues = buildSubjectNotificationIssues(subject, allSubjects);

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

  // Fetch all subjects so conflict detection can compare against peers.
  const { data: allSubjects, error: allFetchError } = await supabaseAdmin
    .from('subjects')
    .select('subject_id, subject_code, mth_schedule, tfs_schedule, mth_room, tfs_room, curr_id, department_id, subject_course_no');

  if (allFetchError) {
    throw new Error(allFetchError.message);
  }

  const rows = buildSubjectNotificationRows(subject, allSubjects || []);
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
  const { data: subjects, error: fetchError } = await supabaseAdmin
    .from('subjects')
    .select('subject_id, subject_code, subject_descriptive_title, subject_units, mth_schedule, tfs_schedule, mth_room, tfs_room, curr_id, department_id, subject_course_no')
    .order('subject_id', { ascending: true });

  if (fetchError) {
    throw new Error(fetchError.message);
  }

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
    const rows = buildSubjectNotificationRows(subject, subjects || []);
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