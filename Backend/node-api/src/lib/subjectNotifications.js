import { supabaseAdmin } from './supabase.js';
import { findConflictingSchedules, isRoomGym } from './scheduleConflictChecker.js';

function normalizeSubjectText(value) {
  return value == null ? '' : String(value).trim();
}

export function buildSubjectNotificationIssues(subject, allSubjects = []) {
  const issues = [];

  if (!normalizeSubjectText(subject?.subject_code)) {
    issues.push({
      field_name: 'subject_code',
      issue_type: 'missing',
      severity: 'high',
      message: 'Missing subject code',
    });
  }

  if (!normalizeSubjectText(subject?.subject_descriptive_title)) {
    issues.push({
      field_name: 'subject_descriptive_title',
      issue_type: 'missing',
      severity: 'high',
      message: 'Missing descriptive title',
    });
  }

  if (subject?.subject_units == null || Number(subject.subject_units) <= 0) {
    issues.push({
      field_name: 'subject_units',
      issue_type: 'missing',
      severity: 'high',
      message: 'Units not set or zero',
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
      severity: 'medium',
      message: 'No schedule set (MTH/TFS)',
    });
  }

  if (hasMthSchedule && !hasMthRoom) {
    issues.push({
      field_name: 'mth_room',
      issue_type: 'missing',
      severity: 'medium',
      message: 'Missing room assignment for MTH schedule',
    });
  }

  if (hasTfsSchedule && !hasTfsRoom) {
    issues.push({
      field_name: 'tfs_room',
      issue_type: 'missing',
      severity: 'medium',
      message: 'Missing room assignment for TFS schedule',
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

  const rows = buildSubjectNotificationRows(subject);
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
    .select('subject_id, subject_code, subject_descriptive_title, subject_units, mth_schedule, tfs_schedule, mth_room, tfs_room')
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