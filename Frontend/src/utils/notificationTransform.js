import { normalizeNotificationSeverity } from './notificationUtils';

// Maps human-readable notification field names → editingData keys used in the edit forms.
// Both CourseOfferingView and SubjectsView import this for notification-driven edit mode.
export const NOTIFICATION_FIELD_TO_KEY = {
  'Course Code': 'code',
  'Course Number': 'course_no',
  'Course Title': 'descriptive_title',
  'Department': 'department_id',
  'Curriculum': 'curr_id',
  'Credit Units': 'units',
  'Lecture Hours': ['lec_hrs', 'lab_hrs'],
  'Lecture/Lab Hours': ['lec_hrs', 'lab_hrs'],
  'Schedule': ['mth_schedule', 'tfs_schedule'],
  'Room Assignment': ['mth_room_id', 'tfs_room_id'],
  'MTH Room': 'mth_room_id',
  'TFS Room': 'tfs_room_id',
  'MTH Schedule': 'mth_schedule',
  'TFS Schedule': 'tfs_schedule',
};

// Maps backend snake_case field names → human-readable display names.
export const BACKEND_FIELD_TO_DISPLAY_NAME = {
  code: 'Course Code',
  course_no: 'Course Number',
  descriptive_title: 'Course Title',
  department_id: 'Department',
  curr_id: 'Curriculum',
  units: 'Credit Units',
  lec_hrs: 'Lecture/Lab Hours',
  hours: 'Lecture/Lab Hours',
  mth_schedule: 'MTH Schedule',
  tfs_schedule: 'TFS Schedule',
  mth_room_id: 'MTH Room',
  tfs_room_id: 'TFS Room',
};

/**
 * Dispatch transform based on entity type.
 * @param {'course_offering'|'subject'} type
 * @param {object[]} rows  Raw DB notification rows
 * @returns {NotificationItem[]}
 */
export function transformRows(type, rows) {
  if (type === 'course_offering') return transformCourseOfferingRows(rows);
  return transformSubjectRows(rows);
}

/**
 * Deduplicates schedule-conflict pairs so that a conflict between entity A and B
 * appears as ONE item instead of two.
 *
 * Rules:
 * - If peer has ONLY conflict issues (no missing-field issues), absorb the peer into
 *   `item.conflictPeer` and remove it from the output list.
 * - If peer also has non-conflict issues, leave it as its own item (it needs attention
 *   independently); the current item still records the conflict for display purposes.
 *
 * @param {object[]} items     Already-grouped notification items (one per entity)
 * @param {string}   peerIdKey Key inside `issue.details` that holds the peer's entity id
 *                             e.g. 'conflicting_offering_id' or 'conflicting_subject_id'
 * @returns {object[]}
 */
export function deduplicateConflictPairs(items, peerIdKey) {
  const byId = new Map(items.map((item) => [String(item.entity_id), item]));
  const consumed = new Set();

  const result = [];
  for (const item of items) {
    const id = String(item.entity_id);
    if (consumed.has(id)) continue;

    const conflictIssues = (item.issues || []).filter((i) =>
      String(i.field || '').includes('conflict')
    );

    for (const ci of conflictIssues) {
      const peerId = String(ci.details?.[peerIdKey] || '');
      if (!peerId || consumed.has(peerId)) continue;

      const peer = byId.get(peerId);
      if (!peer) continue;

      const peerNonConflict = (peer.issues || []).filter(
        (i) => !String(i.field || '').includes('conflict')
      );

      if (peerNonConflict.length === 0) {
        consumed.add(peerId);
        item.conflictPeer = peer;
      }
    }

    result.push(item);
  }

  return result;
}

/**
 * Transform raw data_quality_notifications rows (entity_type='course_offering')
 * into grouped NotificationItems — one item per offering, containing all its issues.
 */
export function transformCourseOfferingRows(rows) {
  const byOffering = {};

  (rows || []).forEach((row) => {
    const key = row.entity_id;
    if (!byOffering[key]) {
      const _code = row.details?.code || '';
      const _cno = row.details?.course_no || '';
      byOffering[key] = {
        id: row.entity_id,
        rowId: row.entity_id,
        offeringId: row.entity_id,
        entity_id: row.entity_id,
        title: _code ? (_cno ? `${_code} ${_cno}` : _code) : `Offering #${row.entity_id}`,
        description: row.message,
        severity: normalizeNotificationSeverity(row.severity),
        issues: [],
        missingFields: [],
        dbIds: [],
      };
    }

    const displayFieldName = BACKEND_FIELD_TO_DISPLAY_NAME[row.field_name] || row.field_name;
    byOffering[key].issues.push({ field: displayFieldName, message: row.message, details: row.details });
    byOffering[key].missingFields.push(displayFieldName);
    byOffering[key].dbIds.push(row.id);

    if (normalizeNotificationSeverity(row.severity) === 'critical') {
      byOffering[key].severity = 'critical';
    }
  });

  return deduplicateConflictPairs(Object.values(byOffering), 'conflicting_offering_id');
}

/**
 * Transform raw subject_notifications rows into grouped NotificationItems —
 * one item per subject, containing all its issues (mirrors course offering grouping).
 * Stale "hours" notifications are pruned when the subject already has a value filled in.
 */
export function transformSubjectRows(rows) {
  const bySubject = {};

  (rows || []).forEach((row) => {
    const key = row.entity_id;
    const dbSubject = row.subject || null;

    if (!bySubject[key]) {
      const _sc = row.subject_code || dbSubject?.subject_code || '';
      const _scn = row.subject_course_no || dbSubject?.subject_course_no || '';
      bySubject[key] = {
        id: row.entity_id,
        rowId: row.entity_id,
        offeringId: row.entity_id,
        entity_id: row.entity_id,
        title: _sc ? (_scn ? `${_sc} ${_scn}` : _sc) : `Subject #${row.entity_id}`,
        description:
          row.subject_descriptive_title ||
          dbSubject?.subject_descriptive_title ||
          null,
        severity: normalizeNotificationSeverity(row.severity),
        issues: [],
        missingFields: [],
        dbIds: [],
        subject: dbSubject,
      };
    }

    const entry = bySubject[key];
    const field = row.field_name || null;
    const msg = String(row.message || '');

    // Prune stale "hours" notification when the subject already has at least one value
    const hasLectureHours = Number(entry.subject?.subject_lec_hrs ?? 0) > 0;
    const hasLabHours = Number(entry.subject?.subject_lab_hrs ?? 0) > 0;
    const isStaleHoursIssue =
      (field === 'subject_lec_hrs' || field === 'subject_lecture_hours') &&
      msg.toLowerCase().includes('either lecture hours or lab hours') &&
      (hasLectureHours || hasLabHours);
    if (isStaleHoursIssue) return;

    entry.issues.push({ field, message: msg, details: row.details });
    entry.missingFields.push(field);
    entry.dbIds.push(row.id);

    if (normalizeNotificationSeverity(row.severity) === 'critical') {
      entry.severity = 'critical';
    }
  });

  return deduplicateConflictPairs(
    Object.values(bySubject).filter((item) => item.issues.length > 0),
    'conflicting_subject_id'
  );
}
