import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from '../config/env.js';
import { fetchFacultyPreferenceMapForGA } from '../lib/facultySubjectPreferences.js';
import { query, withPgClient } from '../lib/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPTIMIZER_SCHED_PATH = process.env.OPTIMIZER_SCHED_PATH ||
  path.resolve(__dirname, '../../../../GeneticAlgorithm/optimizer_sched.py');
const OPTIMIZER_PYTHON = process.env.OPTIMIZER_PYTHON || 'python';

const REQUIRED_FACULTY_FIELDS = ['faculty_name', 'department_id', 'faculty_max_units', 'faculty_role', 'faculty_status'];
const REQUIRED_OFFERING_FIELDS = ['curr_id', 'code', 'course_no', 'department_id', 'section', 'descriptive_title', 'units'];
const REQUIRED_ROOM_FIELDS = ['room_name', 'room_status'];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = normalizeUpper(value);
  if (['TRUE', 'T', 'YES', 'Y', '1'].includes(normalized)) return true;
  if (['FALSE', 'F', 'NO', 'N', '0'].includes(normalized)) return false;
  return null;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function splitList(value) {
  return normalizeText(value)
    .split(/[,;/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const DAY_ALIASES = new Map([
  ['M', 'MON'],
  ['MON', 'MON'],
  ['MONDAY', 'MON'],
  ['T', 'TUE'],
  ['TU', 'TUE'],
  ['TUE', 'TUE'],
  ['TUES', 'TUE'],
  ['TUESDAY', 'TUE'],
  ['W', 'WED'],
  ['WED', 'WED'],
  ['WEDNESDAY', 'WED'],
  ['TH', 'THU'],
  ['THU', 'THU'],
  ['THUR', 'THU'],
  ['THURS', 'THU'],
  ['THURSDAY', 'THU'],
  ['F', 'FRI'],
  ['FRI', 'FRI'],
  ['FRIDAY', 'FRI'],
  ['SAT', 'SAT'],
  ['SATURDAY', 'SAT'],
  ['S', 'SAT'],
]);

function parseDaysFromSchedule(scheduleText, group) {
  const text = normalizeUpper(scheduleText);
  const compact = text.replace(/[^A-Z]/g, ' ').trim();
  const parts = compact ? compact.split(/\s+/) : [];
  const days = new Set();

  for (const part of parts) {
    if (DAY_ALIASES.has(part)) {
      days.add(DAY_ALIASES.get(part));
      continue;
    }
    if (part === 'MTH') {
      days.add('MON');
      days.add('THU');
      continue;
    }
    if (part === 'TF' || part === 'TFS') {  // TFS is legacy alias; TF is the automated pattern (Tue/Fri only)
      days.add('TUE');
      days.add('FRI');
      continue;
    }
    // SAT is user-defined only — not added to automated day sets
    if (part.includes('MON')) days.add('MON');
    if (part.includes('TH')) days.add('THU');
    if (part.includes('TUE')) days.add('TUE');
    if (part.includes('FRI')) days.add('FRI');
  }

  if (days.size === 0) {
    if (group === 'MTH') {
      days.add('MON');
      days.add('THU');
    } else if (group === 'TF' || group === 'TFS') {  // TFS is legacy alias
      days.add('TUE');
      days.add('FRI');
    }
  }

  return [...days];
}

function parseScheduleText(scheduleText) {
  const text = normalizeUpper(scheduleText).replace(/[.]/g, ' ');
  const match = text.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
  if (!match) return null;

  const parseMinutes = (token, isEnd = false) => {
    const cleaned = normalizeUpper(token).replace(/\s+/g, '');
    const timeMatch = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)?$/i);
    if (!timeMatch) return null;

    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || '0');
    const meridiem = timeMatch[3] ? timeMatch[3].toUpperCase() : null;

    if (meridiem === 'AM') {
      if (hour === 12) hour = 0;
    } else if (meridiem === 'PM') {
      if (hour !== 12) hour += 12;
    } else if (!isEnd && hour < 7) {
      hour += 12;
    }

    return hour * 60 + minute;
  };

  const start = parseMinutes(match[1], false);
  const end = parseMinutes(match[2], true);
  if (start === null || end === null || end <= start) return null;

  return { start, end, duration: end - start };
}

function buildRoomLookup(rooms) {
  const byId = new Map();
  const byName = new Map();

  for (const room of rooms) {
    const roomId = toNumber(room.room_id);
    const roomName = normalizeUpper(room.room_name).replace(/[^A-Z0-9]/g, '');
    if (roomId !== null) byId.set(roomId, room);
    if (roomName) byName.set(roomName, room);
  }

  return { byId, byName };
}

function resolveRoomReference(value, roomLookup) {
  const raw = normalizeText(value);
  if (!raw) return { roomId: null, roomName: null };

  const tokens = splitList(raw);
  const firstToken = tokens[0] || raw;
  const numeric = toNumber(firstToken);

  if (numeric !== null && roomLookup.byId.has(numeric)) {
    const room = roomLookup.byId.get(numeric);
    return { roomId: Number(room.room_id), roomName: room.room_name };
  }

  const roomKey = normalizeUpper(firstToken).replace(/[^A-Z0-9]/g, '');
  if (roomLookup.byName.has(roomKey)) {
    const room = roomLookup.byName.get(roomKey);
    return { roomId: Number(room.room_id), roomName: room.room_name };
  }

  return { roomId: null, roomName: null };
}

function resolveAllRoomIds(value, roomLookup) {
  const raw = normalizeText(value);
  if (!raw) return [];
  return splitList(raw)
    .map((token) => {
      const numeric = toNumber(token);
      if (numeric !== null && roomLookup.byId.has(numeric)) return Number(roomLookup.byId.get(numeric).room_id);
      const key = normalizeUpper(token).replace(/[^A-Z0-9]/g, '');
      if (roomLookup.byName.has(key)) return Number(roomLookup.byName.get(key).room_id);
      return null;
    })
    .filter((id) => id !== null);
}

function buildScheduleBlocks(offering) {
  const blocks = [];
  for (const group of ['mth', 'tfs']) {
    const scheduleText = normalizeText(offering[`${group}_schedule`]);
    if (!scheduleText) continue;

    const parsed = parseScheduleText(scheduleText);
    if (!parsed) continue;

    blocks.push({
      group: group.toUpperCase(),
      days: parseDaysFromSchedule(scheduleText, group.toUpperCase()),
      scheduleText,
      ...parsed,
      roomId: toNumber(offering[`${group}_room_id`]),
    });
  }

  return blocks;
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function formatMinutesAsTime(totalMinutes) {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  return `${hours12}:${minutes} ${suffix}`;
}

function buildDepartmentLookup(departments) {
  const lookup = new Map();

  for (const department of Array.isArray(departments) ? departments : []) {
    const departmentId = toNumber(department.department_id);
    if (departmentId === null) continue;
    lookup.set(departmentId, normalizeText(department.department_name) || `Department ${departmentId}`);
  }

  return lookup;
}

function describeDepartment(departmentId, lookup) {
  const numericDepartmentId = toNumber(departmentId);
  if (numericDepartmentId === null) return 'Unassigned department';
  return lookup.get(numericDepartmentId) || `Department ${numericDepartmentId}`;
}

function describeFaculty(faculty) {
  if (!faculty) return 'Unassigned faculty';
  return normalizeText(faculty.faculty_name) || `Faculty ${faculty.faculty_id ?? ''}`.trim();
}

function describeOffering(offering) {
  if (!offering) return 'Offering';
  const code = normalizeText(offering.code);
  const courseNo = normalizeText(offering.course_no);
  const title = normalizeText(offering.descriptive_title);
  const shortLabel = [code, courseNo].filter(Boolean).join(' ');
  return shortLabel || title || `Offering ${offering.id ?? ''}`.trim();
}

function describeRoom(room) {
  if (!room) return 'Room';
  return normalizeText(room.room_name) || `Room ${room.room_id ?? ''}`.trim();
}

function describeRoomKey(roomKey, roomLookup) {
  const roomToken = String(roomKey || '').split('|')[1] || '';
  const roomId = toNumber(roomToken);
  if (roomId !== null && roomLookup.byId.has(roomId)) {
    return describeRoom(roomLookup.byId.get(roomId));
  }
  return roomToken || roomKey;
}

function buildFacultyLoadingDisplayRows(snapshot, assignments, preflight) {
  const assignmentByOfferingId = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const offeringId = Number(assignment?.offering?.id);
    if (Number.isFinite(offeringId)) {
      assignmentByOfferingId.set(offeringId, assignment);
    }
  }

  const problematicByOfferingId = new Map();
  for (const item of Array.isArray(preflight?.problematic_offerings) ? preflight.problematic_offerings : []) {
    const offeringId = Number(item?.id);
    if (Number.isFinite(offeringId)) {
      problematicByOfferingId.set(offeringId, item);
    }
  }

  const rows = [];
  for (const offering of Array.isArray(snapshot?.offerings) ? snapshot.offerings : []) {
    const offeringId = Number(offering?.id);
    const assignment = assignmentByOfferingId.get(offeringId);
    const problematic = problematicByOfferingId.get(offeringId);
    const isGeneral = Boolean(offering?.is_general);
    const assignedFaculty = isGeneral ? null : (assignment?.faculty || null);

    rows.push({
      id: offeringId,
      curr_id: offering.curr_id ?? null,
      department_id: offering.department_id ?? null,
      department_name: normalizeText(offering.department_name) || null,
      section: offering.section ?? null,
      code: offering.code ?? null,
      course_no: offering.course_no ?? null,
      descriptive_title: offering.descriptive_title ?? null,
      units: offering.units ?? null,
      lec_hrs: offering.lec_hrs ?? null,
      lab_hrs: offering.lab_hrs ?? null,
      mth_schedule: offering.mth_schedule ?? null,
      tfs_schedule: offering.tfs_schedule ?? null,
      merged: Boolean(offering.merged),
      faculty_id: assignedFaculty ? assignedFaculty.faculty_id ?? null : null,
      faculty_name: assignedFaculty ? normalizeText(assignedFaculty.faculty_name) || null : null,
      faculty_role: assignedFaculty ? normalizeText(assignedFaculty.faculty_role) || null : null,
      load_status: isGeneral ? 'general' : assignment ? 'loaded' : problematic ? 'needs_attention' : 'unassigned',
      issue_reasons: problematic?.reasons || [],
      is_general: isGeneral,
      source: 'subject',
      source_subject_id: offering.source_subject_id ?? null,
      display_label: describeOffering(offering),
    });
  }

  return rows;
}

function areMergedOfferings(leftOffering, rightOffering) {
  if (!leftOffering || !rightOffering) return false;
  // Two offerings are merged if they have identical schedules and rooms (same physical class, different curricula)
  const normMthLeft = normalizeUpper(leftOffering.mth_schedule || '');
  const normMthRight = normalizeUpper(rightOffering.mth_schedule || '');
  const normTfsLeft = normalizeUpper(leftOffering.tfs_schedule || '');
  const normTfsRight = normalizeUpper(rightOffering.tfs_schedule || '');
  
  const mthRoomLeft = normalizeText(leftOffering.mth_room_id || '');
  const mthRoomRight = normalizeText(rightOffering.mth_room_id || '');
  const tfsRoomLeft = normalizeText(leftOffering.tfs_room_id || '');
  const tfsRoomRight = normalizeText(rightOffering.tfs_room_id || '');
  
  // Must have exactly the same schedule structure (both must have the same set of schedules)
  const leftHasMth = !!normMthLeft;
  const rightHasMth = !!normMthRight;
  const leftHasTfs = !!normTfsLeft;
  const rightHasTfs = !!normTfsRight;
  
  // If schedule structure differs, they're not merged
  if ((leftHasMth !== rightHasMth) || (leftHasTfs !== rightHasTfs)) {
    return false;
  }
  
  // If both offerings have an MTH schedule, they must match exactly (days + time)
  if (leftHasMth && rightHasMth && (normMthLeft !== normMthRight || mthRoomLeft !== mthRoomRight)) {
    return false;
  }
  
  // If both offerings have a TFS schedule, they must match exactly (days + time)
  if (leftHasTfs && rightHasTfs && (normTfsLeft !== normTfsRight || tfsRoomLeft !== tfsRoomRight)) {
    return false;
  }
  
  // If we got here, they have matching schedules and rooms (and the same structure)
  return leftHasMth || leftHasTfs;
}

function calculateDepartmentUnitNeeds(departmentId, gaOfferings) {
  return gaOfferings
    .filter((offering) => toNumber(offering.department_id) === departmentId)
    .reduce((sum, offering) => sum + (toNumber(offering.units) || 0), 0);
}

function hasSufficientFaculty(departmentId, activeFacultyByDepartment, unitNeeds) {
  const faculty = activeFacultyByDepartment.get(departmentId);
  // No faculty at all
  if (!faculty || faculty.length === 0) {
    return false;
  }
  // Calculate total available capacity
  const totalMaxUnits = faculty.reduce((sum, f) => sum + (toNumber(f.faculty_max_units) || 0), 0);
  // Check if capacity is sufficient
  return totalMaxUnits >= unitNeeds;
}

function buildOfferingKey(offering) {
  return [
    toNumber(offering.department_id) ?? '',
    normalizeUpper(offering.code),
    normalizeUpper(offering.course_no),
    normalizeUpper(offering.section),
  ].join('|');
}

function buildAutomaticAssignmentKey(row) {
  return [
    normalizeUpper(row.code),
    normalizeUpper(row.course_no),
    toNumber(row.department_id) ?? '',
    normalizeUpper(row.section),
  ].join('|');
}

function resolveRoomNamesFromIdText(roomIdText, roomLookup) {
  const roomTokens = splitList(roomIdText);
  if (roomTokens.length === 0) return null;

  const names = [];
  for (const token of roomTokens) {
    const numericId = toNumber(token);
    if (numericId === null) continue;
    const room = roomLookup.byId.get(numericId);
    const roomName = normalizeText(room?.room_name);
    if (roomName && !names.includes(roomName)) {
      names.push(roomName);
    }
  }

  return names.length > 0 ? names.join(' / ') : null;
}

function enrichAutomaticAssignments(assignments, assignableSubjects, activeRooms) {
  const roomLookup = buildRoomLookup(activeRooms);
  const subjectById = new Map();
  const subjectByKey = new Map();

  for (const subject of Array.isArray(assignableSubjects) ? assignableSubjects : []) {
    const subjectId = toNumber(subject.subject_id);
    if (subjectId !== null) {
      subjectById.set(subjectId, subject);
    }
    subjectByKey.set(buildAutomaticAssignmentKey(subject), subject);
  }

  return (Array.isArray(assignments) ? assignments : []).map((row) => {
    const sourceSubjectId = toNumber(row?.source_subject_id ?? row?.subject_id);
    const subject =
      (sourceSubjectId !== null ? subjectById.get(sourceSubjectId) : null) ||
      subjectByKey.get(buildAutomaticAssignmentKey(row)) ||
      null;

    const departmentId = toNumber(row?.department_id ?? subject?.department_id);
    const explicitDepartmentName = normalizeText(row?.department_name);
    const derivedDepartmentName = normalizeText(subject?.department_name);
    const departmentName = explicitDepartmentName || derivedDepartmentName || (departmentId !== null ? `Department ${departmentId}` : null);

    const rawMthRoomName = normalizeText(row?.mth_room_name);
    const rawTfsRoomName = normalizeText(row?.tfs_room_name);
    const mthRoomId = normalizeText(row?.mth_room_id);
    const tfsRoomId = normalizeText(row?.tfs_room_id);

    const mthRoomName = rawMthRoomName || resolveRoomNamesFromIdText(mthRoomId, roomLookup) || null;
    const tfsRoomName = rawTfsRoomName || resolveRoomNamesFromIdText(tfsRoomId, roomLookup) || null;

    return {
      ...row,
      department_id: departmentId,
      department_name: departmentName,
      mth_room_name: mthRoomName,
      tfs_room_name: tfsRoomName,
    };
  });
}

function buildSubjectIndex(subjects) {
  const index = new Map();
  for (const subject of subjects) {
    const key = [
      toNumber(subject.department_id) ?? '',
      normalizeUpper(subject.subject_code),
      normalizeUpper(subject.subject_course_no),
      normalizeUpper(subject.subject_section),
    ].join('|');
    if (!index.has(key)) index.set(key, subject);
  }
  return index;
}

function normalizeDedupeText(value) {
  return normalizeUpper(value).replace(/\s+/g, ' ').trim();
}

function normalizeDedupeNumber(value) {
  const num = toNumber(value);
  if (num === null) return '';
  return Number.isInteger(num) ? String(num) : String(num);
}

function buildMergedOfferingKey(subject) {
  return [
    normalizeDedupeText(subject.subject_code),
    normalizeDedupeText(subject.subject_course_no),
    normalizeDedupeText(subject.subject_descriptive_title),
    normalizeDedupeText(subject.mth_schedule),
    normalizeDedupeText(subject.tfs_schedule),
    normalizeDedupeText(subject.mth_room),
    normalizeDedupeText(subject.tfs_room),
    normalizeDedupeNumber(subject.subject_units),
    normalizeDedupeNumber(subject.subject_lec_hrs),
    normalizeDedupeNumber(subject.subject_lab_hrs),
  ].join('|');
}

function buildDbMergeKeyFromSubject(subject) {
  return [
    normalizeDedupeText(subject.subject_code),
    normalizeDedupeText(subject.subject_course_no),
    normalizeDedupeText(subject.subject_section),
    normalizeDedupeText(subject.subject_descriptive_title),
    normalizeDedupeText(subject.mth_schedule),
    normalizeDedupeText(subject.tfs_schedule),
    normalizeDedupeNumber(subject.subject_units),
    normalizeDedupeNumber(subject.subject_lec_hrs),
    normalizeDedupeNumber(subject.subject_lab_hrs),
  ].join('|');
}

function buildDbMergeKeyFromOffering(offering) {
  return [
    normalizeDedupeText(offering.code),
    normalizeDedupeText(offering.course_no),
    normalizeDedupeText(offering.section),
    normalizeDedupeText(offering.descriptive_title),
    normalizeDedupeText(offering.mth_schedule),
    normalizeDedupeText(offering.tfs_schedule),
    normalizeDedupeNumber(offering.units),
    normalizeDedupeNumber(offering.lec_hrs),
    normalizeDedupeNumber(offering.lab_hrs),
  ].join('|');
}

function mapSubjectsToGaOfferings(subjects, courseOfferings = []) {
  const mergedKeysFromDb = new Set(
    (Array.isArray(courseOfferings) ? courseOfferings : [])
      .filter((offering) => toBoolean(offering?.merged))
      .map((offering) => buildDbMergeKeyFromOffering(offering))
  );

  const grouped = new Map();

  for (const subject of subjects) {
    const key = buildMergedOfferingKey(subject);
    const bucket = grouped.get(key) || [];
    bucket.push(subject);
    grouped.set(key, bucket);
  }

  const offerings = [];
  for (const rows of grouped.values()) {
    const representative = rows[0];
    const sourceSubjectIds = rows.map((row) => Number(row.subject_id)).filter((id) => Number.isFinite(id));
    const sourceCurrIds = rows
      .map((row) => toNumber(row.curr_id))
      .filter((value) => value !== null);
    const sourceDepartmentIds = rows
      .map((row) => toNumber(row.department_id))
      .filter((value) => value !== null);

    offerings.push({
      id: Number(representative.subject_id),
      curr_id: toNumber(representative.curr_id) ?? Number(representative.subject_id),
      code: normalizeText(representative.subject_code) || null,
      course_no: normalizeText(representative.subject_course_no) || null,
      department_id: toNumber(representative.department_id),
      section: normalizeText(representative.subject_section) || null,
      descriptive_title: normalizeText(representative.subject_descriptive_title) || null,
      units: toNumber(representative.subject_units),
      lec_hrs: toNumber(representative.subject_lec_hrs),
      lab_hrs: toNumber(representative.subject_lab_hrs),
      is_general: Boolean(representative.is_general),
      mth_schedule: normalizeText(representative.mth_schedule) || null,
      mth_room_id: normalizeText(representative.mth_room) || null,
      tfs_schedule: normalizeText(representative.tfs_schedule) || null,
      tfs_room_id: normalizeText(representative.tfs_room) || null,
      merged: rows.length > 1 || mergedKeysFromDb.has(buildDbMergeKeyFromSubject(representative)),
      duplicate_count: rows.length,
      source_subject_ids: sourceSubjectIds,
      source_curr_ids: sourceCurrIds,
      source_department_ids: sourceDepartmentIds,
      department_name: representative.department_name || null,
      source: 'subject',
      source_subject_id: Number(representative.subject_id),
    });
  }

  return offerings;
}

function buildPreflight(snapshot) {
  const issues = [];
  const departmentLookup = buildDepartmentLookup(snapshot.departments);
  const roomLookup = buildRoomLookup(snapshot.rooms);
  const roomReservations = new Map();
  const activeFacultyByDepartment = new Map();
  const allOfferings = Array.isArray(snapshot.offerings) ? snapshot.offerings : [];
  const assignableOfferings = allOfferings.filter((offering) => !Boolean(offering.is_general));
  
  // New: Track assignable vs problematic offerings for partial loading
  const assignableOfferingsList = [];
  const problematicOfferingsMap = new Map(); // offeringId -> reason

  for (const faculty of snapshot.faculty) {
    const missing = REQUIRED_FACULTY_FIELDS.filter((field) => isEmptyValue(faculty[field]));
    if (missing.length > 0) {
      for (const field of missing) {
        issues.push({
          type: 'faculty',
          id: faculty.faculty_id,
          field,
          severity: field === 'faculty_name' || field === 'department_id' || field === 'faculty_max_units' ? 'high' : 'medium',
          problem: `Missing ${field.replace(/_/g, ' ')}`,
          entity_label: describeFaculty(faculty),
          department_name: describeDepartment(faculty.department_id, departmentLookup),
        });
      }
    }

    if (normalizeUpper(faculty.faculty_status) !== 'ACTIVE') {
      issues.push({
        type: 'faculty',
        id: faculty.faculty_id,
        field: 'faculty_status',
        severity: 'low',
        problem: `Faculty status is ${normalizeText(faculty.faculty_status) || 'unspecified'}`,
        entity_label: describeFaculty(faculty),
        department_name: describeDepartment(faculty.department_id, departmentLookup),
      });
    } else {
      const departmentId = toNumber(faculty.department_id);
      if (departmentId !== null) {
        const list = activeFacultyByDepartment.get(departmentId) || [];
        list.push(faculty);
        activeFacultyByDepartment.set(departmentId, list);
      }
    }
  }

  for (const room of snapshot.rooms) {
    const missing = REQUIRED_ROOM_FIELDS.filter((field) => isEmptyValue(room[field]));
    if (missing.length > 0) {
      for (const field of missing) {
        issues.push({
          type: 'room',
          id: room.room_id,
          field,
          severity: field === 'room_name' ? 'high' : 'medium',
          problem: `Missing ${field.replace(/_/g, ' ')}`,
          entity_label: describeRoom(room),
        });
      }
    }
  }

  for (const offering of allOfferings) {
    // Skip general subjects from preflight issue generation — PRE-3: general subjects are out-of-scope for automatic scheduling
    if (Boolean(offering.is_general)) {
      continue;
    }
    const missing = REQUIRED_OFFERING_FIELDS.filter((field) => isEmptyValue(offering[field]));
    if (missing.length > 0) {
      for (const field of missing) {
        issues.push({
          type: 'subject',
          id: offering.id,
          field,
          severity: ['department_id', 'units', 'lec_hrs', 'descriptive_title'].includes(field) ? 'high' : 'medium',
          problem: `Missing ${field.replace(/_/g, ' ')} in subject-derived workload`,
          entity_label: describeOffering(offering),
          department_name: describeDepartment(offering.department_id, departmentLookup),
          is_general: Boolean(offering.is_general),
        });
      }
    }

    const hasLectureHours = !isEmptyValue(offering.lec_hrs);
    const hasLabHours = !isEmptyValue(offering.lab_hrs);
    if (!hasLectureHours && !hasLabHours) {
      issues.push({
        type: 'subject',
        id: offering.id,
        field: 'hours',
        severity: 'high',
        problem: 'Missing lecture/lab hours in subject-derived workload (fill at least one)',
        entity_label: describeOffering(offering),
        department_name: describeDepartment(offering.department_id, departmentLookup),
        is_general: Boolean(offering.is_general),
      });
    }

    const hasMthSchedule = !isEmptyValue(offering.mth_schedule);
    const hasTfsSchedule = !isEmptyValue(offering.tfs_schedule);
    const mthRoom = resolveRoomReference(offering.mth_room_id, roomLookup);
    const tfsRoom = resolveRoomReference(offering.tfs_room_id, roomLookup);

    if (hasMthSchedule && !mthRoom.roomId) {
      issues.push({
        type: 'subject',
        id: offering.id,
        field: 'mth_room_id',
        severity: 'high',
        problem: 'MTH schedule is missing a resolvable room',
        entity_label: describeOffering(offering),
        department_name: describeDepartment(offering.department_id, departmentLookup),
        room_label: hasMthSchedule ? normalizeText(offering.mth_room_id) || null : null,
      });
    }

    if (hasTfsSchedule && !tfsRoom.roomId) {
      issues.push({
        type: 'subject',
        id: offering.id,
        field: 'tfs_room_id',
        severity: 'high',
        problem: 'TF schedule is missing a resolvable room',
        entity_label: describeOffering(offering),
        department_name: describeDepartment(offering.department_id, departmentLookup),
        room_label: hasTfsSchedule ? normalizeText(offering.tfs_room_id) || null : null,
      });
    }

    if (!hasMthSchedule && !hasTfsSchedule) {
      issues.push({
        type: 'subject',
        id: offering.id,
        field: 'schedule',
        severity: 'high',
        problem: 'Subject has no schedule assigned',
        entity_label: describeOffering(offering),
        department_name: describeDepartment(offering.department_id, departmentLookup),
        is_general: Boolean(offering.is_general),
      });
    }

    const blocks = buildScheduleBlocks({
      ...offering,
      mth_room_id: mthRoom.roomId,
      tfs_room_id: tfsRoom.roomId,
    });

    for (const block of blocks) {
      if (block.roomId === null) continue;
      for (const day of block.days || []) {
        const roomKey = `${day}|${block.roomId}`;
        const entries = roomReservations.get(roomKey) || [];
        entries.push({
          offeringId: offering.id,
          offeringCode: offering.code || null,
          offeringCourseNo: offering.course_no || null,
          offeringSection: offering.section || null,
          offeringCurrId: offering.curr_id || null,
          offeringDeptName: normalizeText(offering.department_name) || describeDepartment(offering.department_id, departmentLookup),
          start: block.start,
          end: block.end,
          offering: offering,
        });
        roomReservations.set(roomKey, entries);
      }
    }
  }

  const departmentsWithOfferings = new Set(
    assignableOfferings
      .map((offering) => toNumber(offering.department_id))
      .filter((departmentId) => departmentId !== null)
  );

  // Calculate unit needs for each department
  const deptUnitNeeds = new Map();
  for (const departmentId of departmentsWithOfferings) {
    const unitNeeds = calculateDepartmentUnitNeeds(departmentId, assignableOfferings);
    deptUnitNeeds.set(departmentId, unitNeeds);
  }

  // CS and IT department IDs for fallback logic
  const CS_DEPT = 11;
  const IT_DEPT = 6; // dept 6 = Information Technology; dept 7 = Library Information Science

  // Process departments for cross-reference issues with CS/IT one-way fallback logic.
  // Allowed automatic fallback is IT -> CS only when CS has zero active faculty.
  for (const departmentId of departmentsWithOfferings) {
    const unitNeeds = deptUnitNeeds.get(departmentId) || 0;
    const hasSufficient = hasSufficientFaculty(departmentId, activeFacultyByDepartment, unitNeeds);
    const hasActiveFaculty = (activeFacultyByDepartment.get(departmentId) || []).length > 0;

    if (departmentId === CS_DEPT) {
      const itHasActiveFaculty = (activeFacultyByDepartment.get(IT_DEPT) || []).length > 0;
      if (!hasActiveFaculty && !itHasActiveFaculty) {
        issues.push({
          type: 'cross_reference',
          id: departmentId,
          severity: 'high',
          problem: `${describeDepartment(departmentId, departmentLookup)} has offerings but no active faculty. IT fallback is unavailable because IT also has no active faculty.`,
          entity_label: describeDepartment(departmentId, departmentLookup),
        });
      } else if (!hasActiveFaculty && itHasActiveFaculty) {
        issues.push({
          type: 'cross_reference',
          id: departmentId,
          severity: 'medium',
          problem: `${describeDepartment(departmentId, departmentLookup)} has no active faculty. Automatic fallback is limited to IT faculty only.`,
          entity_label: describeDepartment(departmentId, departmentLookup),
        });
      } else if (!hasSufficient) {
        issues.push({
          type: 'cross_reference',
          id: departmentId,
          severity: 'medium',
          problem: `${describeDepartment(departmentId, departmentLookup)} faculty units appear fully used. Subjects may remain unassigned with recommendation-only fallback.`,
          entity_label: describeDepartment(departmentId, departmentLookup),
        });
      }
      continue;
    }

    if (!hasActiveFaculty) {
      issues.push({
        type: 'cross_reference',
        id: departmentId,
        severity: 'high',
        problem: `${describeDepartment(departmentId, departmentLookup)} has course offerings but no active faculty`,
        entity_label: describeDepartment(departmentId, departmentLookup),
      });
      continue;
    }

    if (!hasSufficient) {
      issues.push({
        type: 'cross_reference',
        id: departmentId,
        severity: 'medium',
        problem: `${describeDepartment(departmentId, departmentLookup)} has active faculty but all available units may be consumed. Subject may remain unassigned with recommendation-only fallback.`,
        entity_label: describeDepartment(departmentId, departmentLookup),
      });
    }
  }

  for (const [roomKey, entries] of roomReservations.entries()) {
    const ordered = [...entries].sort((left, right) => left.start - right.start);
    let hasConflict = false;
    let firstConflict = null;
    for (let index = 1; index < ordered.length; index += 1) {
      if (overlaps(ordered[index - 1], ordered[index])) {
        // Check if the overlapping offerings are merged subjects (same schedule/room, different curricula)
        // If merged, they're the same physical class and not a real conflict
        if (areMergedOfferings(ordered[index - 1].offering, ordered[index].offering)) {
          // Skip this conflict - they're the same class
          continue;
        }
        hasConflict = true;
        firstConflict = {
          left: ordered[index - 1],
          right: ordered[index],
        };
        break;
      }
    }

    if (hasConflict) {
      const left = firstConflict?.left;
      const right = firstConflict?.right;
      const timeRange = left && right
        ? `${formatMinutesAsTime(Math.max(left.start, right.start))}-${formatMinutesAsTime(Math.min(left.end, right.end))}`
        : null;
      const leftLabel = left
        ? `${left.offeringCode || ''} ${left.offeringCourseNo || ''}${left.offeringSection ? `-${left.offeringSection}` : ''}`.trim()
        : null;
      const rightLabel = right
        ? `${right.offeringCode || ''} ${right.offeringCourseNo || ''}${right.offeringSection ? `-${right.offeringSection}` : ''}`.trim()
        : null;
      const leftMeta = left ? ` curr:${left.offeringCurrId || ''} dept:${left.offeringDeptName || ''}` : '';
      const rightMeta = right ? ` curr:${right.offeringCurrId || ''} dept:${right.offeringDeptName || ''}` : '';
      const details = left && right
        ? ` (offerings ${leftLabel || left.offeringId}${leftMeta} and ${rightLabel || right.offeringId}${rightMeta}${timeRange ? ` overlap at ${timeRange}` : ''})`
        : '';
      issues.push({
        type: 'room_conflict',
        id: roomKey,
        severity: 'high',
        problem: `Room conflict detected for ${describeRoomKey(roomKey, roomLookup)}${details}`,
        entity_label: describeRoomKey(roomKey, roomLookup),
        room_label: describeRoomKey(roomKey, roomLookup),
      });
    }
  }

// New: Categorize offerings based on issues found
  const offeringIssuesMap = new Map(); // offeringId -> array of issue reasons
  for (const issue of issues) {
    if (issue.type === 'subject' || issue.type === 'room_conflict') {
      const offeringId = issue.id;
      const existing = offeringIssuesMap.get(offeringId) || [];
      existing.push(issue.problem);
      offeringIssuesMap.set(offeringId, existing);
    }
  }
  
  // For room_conflict issues, also mark both conflicting offerings
  for (const issue of issues) {
    if (issue.type === 'room_conflict') {
      // Extract offering IDs from room_conflict details if available
      const match = issue.problem.match(/offerings (\d+)/);
      if (match) {
        const oid = Number(match[1]);
        const existing = offeringIssuesMap.get(oid) || [];
        existing.push(issue.problem);
        offeringIssuesMap.set(oid, existing);
      }
    }
  }
  
  // Categorize each assignable offering
  for (const offering of assignableOfferings) {
    const offeringIssues = offeringIssuesMap.get(offering.id) || [];
    if (offeringIssues.length === 0) {
      assignableOfferingsList.push(offering);
    } else {
      if (offering.code === '4733') {
        console.log(`[preflight-debug] Offering code=4733 marked PROBLEMATIC. Reasons:`, offeringIssues);
      }
      problematicOfferingsMap.set(offering.id, {
        offering,
        reasons: offeringIssues,
      });
    }
  }

  const hasHighSeverityIssues = issues.some((issue) => issue.severity === 'high');
  const status = hasHighSeverityIssues
    ? assignableOfferingsList.length > 0
      ? 'partial'
      : 'blocked'
    : 'ok';
  
  return {
    status,
    faculty_count: snapshot.faculty.length,
    offering_count: snapshot.offerings.length,
    room_count: snapshot.rooms.length,
    subject_count: snapshot.subjects.length,
    issues,
    general_count: allOfferings.filter((offering) => Boolean(offering.is_general)).length,
    general_offerings: allOfferings
      .filter((offering) => Boolean(offering.is_general))
      .map((offering) => ({
        id: offering.id,
        code: offering.code,
        course_no: offering.course_no,
        section: offering.section,
        department_id: offering.department_id,
        department_name: normalizeText(offering.department_name) || describeDepartment(offering.department_id, departmentLookup),
        descriptive_title: offering.descriptive_title,
        is_general: true,
      })),
    // New: Categorization for partial loading
    assignable_count: assignableOfferingsList.length,
    problematic_count: problematicOfferingsMap.size,
    assignable_offerings: assignableOfferingsList,
    problematic_offerings: Array.from(problematicOfferingsMap.values()).map((item) => ({
      id: item.offering.id,
      code: item.offering.code,
      course_no: item.offering.course_no,
      section: item.offering.section,
      department_id: item.offering.department_id,
      department_name: normalizeText(item.offering.department_name) || describeDepartment(item.offering.department_id, departmentLookup),
      descriptive_title: item.offering.descriptive_title,
      is_general: Boolean(item.offering.is_general),
      reasons: item.reasons,
    })),
    suggested_next_step: hasHighSeverityIssues
      ? assignableOfferingsList.length > 0
        ? 'GA can proceed with assignable offerings. Review problematic_offerings and general_offerings for issues that need attention.'
        : 'GA is blocked because no assignable offerings are available. Resolve the listed issues first.'
      : 'Data is ready for GA execution.',
    partial_loading_enabled: true,
  };
}

async function fetchSnapshot() {
  const [facultyResp, offeringResp, roomResp, subjectResp, departmentResp, facultyLoadingResp] = await Promise.all([
    query(`
      select f.faculty_id, f.faculty_name, f.department_id, f.faculty_email, f.faculty_specialization,
             f.faculty_max_units, f.faculty_role, f.faculty_status,
             d.department_name
      from public.faculty f
      left join public.departments d on d.department_id = f.department_id
      order by f.faculty_id asc
    `),
    query(`
      select c.id, c.curr_id, c.code, c.course_no, c.department_id, c.section, c.descriptive_title,
             c.units, c.lec_hrs, c.lab_hrs, c.mth_schedule, c.mth_room_id, c.tfs_schedule,
             c.tfs_room_id, c.merged, d.department_name
      from public.course_offerings c
      left join public.departments d on d.department_id = c.department_id
      order by c.id asc
    `),
    query(`
      select room_id, room_name, room_type, room_status
      from public.rooms
      order by room_id asc
    `),
    query(`
      select s.subject_id, s.subject_code, s.subject_course_no, s.department_id, s.subject_section,
             s.subject_descriptive_title, s.subject_units, s.subject_lec_hrs, s.subject_lab_hrs,
             s.is_general, s.subject_status, s.mth_schedule, s.tfs_schedule, s.mth_room, s.tfs_room, s.curr_id,
             d.department_name
      from public.subjects s
      left join public.departments d on d.department_id = s.department_id
      order by s.subject_id asc
    `),
    query(`
      select department_id, department_name
      from public.departments
      order by department_id asc
    `),
    query(`
      select fl.facloading_id, fl.curr_id, fl.faculty_id, fl.code, fl.course_no, fl.department_id, fl.section,
             fl.descriptive_title, fl.units, fl.lec_hrs, fl.lab_hrs, fl.mth_schedule, fl.mth_room_id,
             fl.tfs_schedule, fl.tfs_room_id, fl.merged,
             f.faculty_name,
             d.department_name,
             CASE WHEN fl.faculty_id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END AS load_status
      from public.faculty_loading fl
      left join public.faculty f on f.faculty_id = fl.faculty_id
      left join public.departments d on d.department_id = fl.department_id
      order by fl.facloading_id asc
    `),
  ]);

  return {
    faculty: facultyResp.rows,
    offerings: offeringResp.rows,
    rooms: roomResp.rows,
    subjects: subjectResp.rows,
    departments: departmentResp.rows,
    faculty_loading: facultyLoadingResp.rows,
  };
}

function buildRunId(snapshot, constraints) {
  const stablePayload = JSON.stringify({
    faculty: snapshot.faculty.map((faculty) => ({
      faculty_id: faculty.faculty_id,
      faculty_name: faculty.faculty_name,
      department_id: faculty.department_id,
      faculty_specialization: faculty.faculty_specialization,
      faculty_max_units: faculty.faculty_max_units,
      faculty_role: faculty.faculty_role,
      faculty_status: faculty.faculty_status,
    })),
    offerings: snapshot.offerings.map((offering) => ({
      id: offering.id,
      curr_id: offering.curr_id,
      code: offering.code,
      course_no: offering.course_no,
      department_id: offering.department_id,
      section: offering.section,
      descriptive_title: offering.descriptive_title,
      units: offering.units,
      lec_hrs: offering.lec_hrs,
      lab_hrs: offering.lab_hrs,
      mth_schedule: offering.mth_schedule,
      mth_room_id: offering.mth_room_id,
      tfs_schedule: offering.tfs_schedule,
      tfs_room_id: offering.tfs_room_id,
      merged: offering.merged,
    })),
    constraints,
  });

  return crypto.createHash('sha1').update(stablePayload).digest('hex').slice(0, 16);
}

async function callPythonOptimizer(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.gaRequestTimeoutMs);

  try {
    const response = await fetch(`${env.pythonServiceUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `GA service returned HTTP ${response.status}`);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callPythonScheduleGA(payload) {
  const timeoutMs = Math.max(env.gaRequestTimeoutMs || 30000, 60000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.pythonServiceUrl}/generate-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `Schedule GA service returned HTTP ${response.status}`);
    }

    const result = JSON.parse(text);

    if (result.status === 'error') {
      throw new Error(
        `GA failed: ${result.error_type}: ${result.error_message}\n` +
        `Traceback:\n${result.traceback}`
      );
    }

    // Census validation: catches silent drops at the API boundary
    if (result.census && result.census.input_count !== result.census.output_count) {
      throw new Error(
        `GA dropped subjects: ${result.census.input_count} sent, ` +
        `${result.census.output_count} returned. ` +
        `Run ID: ${result.stats && result.stats.ga_run_id}`
      );
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function persistFacultyLoading(assignments, snapshot) {
  const roomLookup = buildRoomLookup(snapshot.rooms);
  const assignmentByOfferingId = new Map();

  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const offeringId = Number(assignment?.offering?.id);
    if (Number.isFinite(offeringId)) {
      assignmentByOfferingId.set(offeringId, assignment);
    }
  }

  const rows = (Array.isArray(snapshot.offerings) ? snapshot.offerings : []).map((offering, index) => {
    const assignment = assignmentByOfferingId.get(Number(offering.id));
    const mthRoom = resolveRoomReference(offering.mth_room_id, roomLookup);
    const tfsRoom = resolveRoomReference(offering.tfs_room_id, roomLookup);

    return {
      facloading_id: index + 1,
      curr_id: toNumber(offering.curr_id),
      faculty_id: offering.is_general ? null : toNumber(assignment?.faculty?.faculty_id),
      code: normalizeText(offering.code) || null,
      course_no: normalizeText(offering.course_no) || null,
      department_id: toNumber(offering.department_id),
      section: normalizeText(offering.section) || null,
      descriptive_title: normalizeText(offering.descriptive_title) || null,
      units: toNumber(offering.units),
      lec_hrs: toNumber(offering.lec_hrs),
      lab_hrs: toNumber(offering.lab_hrs),
      mth_schedule: normalizeText(offering.mth_schedule) || null,
      mth_room_id: mthRoom.roomId,
      tfs_schedule: normalizeText(offering.tfs_schedule) || null,
      tfs_room_id: tfsRoom.roomId,
      merged: toBoolean(offering.merged),
    };
  });

  if (rows.length === 0) {
    return { persisted: 0 };
  }

  await withPgClient(async (client) => {
    const columns = [
      'facloading_id',
      'curr_id',
      'faculty_id',
      'code',
      'course_no',
      'department_id',
      'section',
      'descriptive_title',
      'units',
      'lec_hrs',
      'lab_hrs',
      'mth_schedule',
      'mth_room_id',
      'tfs_schedule',
      'tfs_room_id',
      'merged',
    ];

    const placeholders = [];
    const values = [];

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM public.faculty_loading');

      rows.forEach((row, rowIndex) => {
        const base = rowIndex * columns.length;
        placeholders.push(`(${columns.map((_, columnIndex) => `$${base + columnIndex + 1}`).join(', ')})`);
        values.push(
          row.facloading_id,
          row.curr_id,
          row.faculty_id,
          row.code,
          row.course_no,
          row.department_id,
          row.section,
          row.descriptive_title,
          row.units,
          row.lec_hrs,
          row.lab_hrs,
          row.mth_schedule,
          row.mth_room_id,
          row.tfs_schedule,
          row.tfs_room_id,
          row.merged,
        );
      });

      await client.query(
        `INSERT INTO public.faculty_loading (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
        values
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { persisted: rows.length };
}

async function runFacultyLoadingWorkflow({ dryRun = false, constraints = {} } = {}) {
  const snapshot = await fetchSnapshot();
  const subjectDrivenOfferings = mapSubjectsToGaOfferings(snapshot.subjects, snapshot.offerings);
  const subjectDrivenSnapshot = { ...snapshot, offerings: subjectDrivenOfferings };
  const preFlight = buildPreflight(subjectDrivenSnapshot);

  // New: Use assignable_offerings from preflight for partial loading instead of blocking
  const preflightAssignable = preFlight.assignable_offerings || [];
  
  // Filter to non-general offerings from assignable list
  const validOfferings = preflightAssignable.filter((o) => !Boolean(o.is_general));

  // If no valid offerings, throw — check validOfferings alone (preflightAssignable only contains non-general by construction)
  if (validOfferings.length === 0) {
    const error = new Error(
      preFlight.assignable_count === 0 && preFlight.problematic_count > 0
        ? `No assignable offerings available for GA execution. ${preFlight.problematic_count} offering(s) have issues (missing schedule, missing room, or room conflicts). Resolve them first.`
        : 'No assignable offerings available for GA execution.'
    );
    error.statusCode = 400;
    error.preFlight = preFlight;
    throw error;
  }

  const normalizedConstraints = {
    population_size: Number(constraints.population_size || 72),
    max_generations: Number(constraints.max_generations || 120),
    mutation_rate: Number(constraints.mutation_rate || 0.12),
    max_runtime_seconds: Number(constraints.max_runtime_seconds || 60),
    random_seed: Number.isFinite(Number(constraints.random_seed)) ? Number(constraints.random_seed) : 123,
    dry_run: Boolean(dryRun || constraints.dry_run),
  };

  // Use validOfferings from preflight categorization
  const assignableOfferings = validOfferings;

  // PRE-1/PRE-2 + available-units computation done once before GA run.
  const activeSubjectUnitsByKey = new Map();
  for (const subject of Array.isArray(snapshot.subjects) ? snapshot.subjects : []) {
    if (normalizeUpper(subject.subject_status) !== 'ACTIVE') continue;
    const key = [
      toNumber(subject.department_id) ?? 0,
      normalizeUpper(subject.subject_code),
      normalizeUpper(subject.subject_course_no),
      normalizeUpper(subject.subject_section),
    ].join('|');
    activeSubjectUnitsByKey.set(key, toNumber(subject.subject_units) || 0);
  }

  const assignedUnitsByFaculty = new Map();
  for (const row of Array.isArray(snapshot.faculty_loading) ? snapshot.faculty_loading : []) {
    const key = [
      toNumber(row.department_id) ?? 0,
      normalizeUpper(row.code),
      normalizeUpper(row.course_no),
      normalizeUpper(row.section),
    ].join('|');
    if (!activeSubjectUnitsByKey.has(key)) continue;
    const facultyId = toNumber(row.faculty_id);
    if (facultyId === null) continue;
    const units = activeSubjectUnitsByKey.get(key) ?? (toNumber(row.units) || 0);
    assignedUnitsByFaculty.set(facultyId, (assignedUnitsByFaculty.get(facultyId) || 0) + units);
  }

  const gaFaculty = (Array.isArray(snapshot.faculty) ? snapshot.faculty : [])
    .filter((faculty) => normalizeUpper(faculty.faculty_status) === 'ACTIVE')
    .map((faculty) => {
      const facultyId = toNumber(faculty.faculty_id);
      const maxUnits = toNumber(faculty.faculty_max_units) || 0;
      const alreadyAssignedUnits = facultyId === null ? 0 : (assignedUnitsByFaculty.get(facultyId) || 0);
      const availableUnits = maxUnits - alreadyAssignedUnits;
      return {
        ...faculty,
        already_assigned_units: alreadyAssignedUnits,
        available_units: availableUnits,
      };
    })
    .filter((faculty) => (toNumber(faculty.faculty_max_units) || 0) > 0)
    .filter((faculty) => (toNumber(faculty.available_units) || 0) > 0);

  if (gaFaculty.length === 0) {
    const totalActive = (Array.isArray(snapshot.faculty) ? snapshot.faculty : []).filter(
      (f) => normalizeUpper(f.faculty_status) === 'ACTIVE'
    ).length;
    const msg =
      totalActive === 0
        ? 'No active faculty found. Add faculty records with ACTIVE status before running GA.'
        : 'No faculty have available units. All active faculty either have faculty_max_units = 0 or are already fully loaded.';
    const error = new Error(msg);
    error.statusCode = 400;
    error.preFlight = preFlight;
    throw error;
  }

  const departmentFacultyCounts = {};
  const departmentAvailableFacultyCounts = {};

  for (const faculty of Array.isArray(snapshot.faculty) ? snapshot.faculty : []) {
    if (normalizeUpper(faculty.faculty_status) !== 'ACTIVE') continue;
    const departmentId = toNumber(faculty.department_id);
    if (departmentId === null) continue;
    const key = String(departmentId);
    departmentFacultyCounts[key] = (departmentFacultyCounts[key] || 0) + 1;
  }

  for (const faculty of gaFaculty) {
    const departmentId = toNumber(faculty.department_id);
    if (departmentId === null) continue;
    const key = String(departmentId);
    departmentAvailableFacultyCounts[key] = (departmentAvailableFacultyCounts[key] || 0) + 1;
  }

  const runId = buildRunId(subjectDrivenSnapshot, normalizedConstraints);
  const payload = {
    faculty: gaFaculty,
    offerings: assignableOfferings,
    rooms: snapshot.rooms,
    subjects: snapshot.subjects,
    faculty_loading: snapshot.faculty_loading || [],
    department_faculty_counts: departmentFacultyCounts,
    department_available_faculty_counts: departmentAvailableFacultyCounts,
    problematic_offerings: preFlight.problematic_offerings || [],
    constraints: normalizedConstraints,
    run_id: runId,
  };

  // Fetch faculty preference map for GA (optional)
  try {
    const facultyPreferences = await fetchFacultyPreferenceMapForGA();
    payload.faculty_preferences = facultyPreferences || {};
    console.log('[ga] Included faculty_preferences with', Object.keys(payload.faculty_preferences).length, 'entries');
    const offering4733 = assignableOfferings.find((o) => String(o.code) === '4733');
    console.log('[ga-debug-js] offering code=4733 in GA payload?', offering4733 ? `YES (id=${offering4733.id})` : 'NO — it is in problematic_offerings or filtered out');
    if (offering4733) {
      console.log('[ga-debug-js] offering data:', JSON.stringify({ id: offering4733.id, code: offering4733.code, tfs_schedule: offering4733.tfs_schedule, tfs_room_id: offering4733.tfs_room_id, is_general: offering4733.is_general }));
    }
    const fac7 = gaFaculty.find((f) => String(f.faculty_id) === '7');
    console.log('[ga-debug-js] faculty_id=7 in gaFaculty?', fac7 ? `YES (status=${fac7.faculty_status}, maxUnits=${fac7.faculty_max_units})` : 'NO — filtered out before GA!');
  } catch (prefErr) {
    console.warn('[ga] Warning: failed to fetch faculty preferences for GA:', prefErr && prefErr.message ? prefErr.message : prefErr);
    // continue without preferences
    payload.faculty_preferences = {};
  }

  const optimizerResult = await callPythonOptimizer(payload);
  const mergedResult = {
    ...optimizerResult,
    run_id: optimizerResult.run_id || runId,
    preflight: preFlight,
  };

  const preflightProblemMap = new Map(
    (preFlight.problematic_offerings || []).map((item) => [
      [
        String(item.code || '').toUpperCase(),
        String(item.course_no || '').toUpperCase(),
        String(item.section || '').toUpperCase(),
      ].join('|'),
      item,
    ])
  );

  if (!dryRun) {
    mergedResult.persistence = await persistFacultyLoading(optimizerResult.assignments || [], subjectDrivenSnapshot);
  } else {
    mergedResult.persistence = { persisted: 0, dry_run: true };
  }

  const generatedRows = buildFacultyLoadingDisplayRows(subjectDrivenSnapshot, optimizerResult.assignments || [], preFlight);
  const unresolvedByOfferingId = new Map();
  for (const item of Array.isArray(optimizerResult?.report?.unresolved_offerings) ? optimizerResult.report.unresolved_offerings : []) {
    const offeringId = Number(item?.offering_id);
    if (Number.isFinite(offeringId)) {
      unresolvedByOfferingId.set(offeringId, item);
    }
  }

  const generatedRowsWithIssues = generatedRows.map((row) => {
    if (row.load_status !== 'unassigned') return row;
    const unresolved = unresolvedByOfferingId.get(Number(row.id));
    if (!unresolved) return row;
    const reasons = [];
    if (unresolved.reason) reasons.push(unresolved.reason);
    if (Array.isArray(unresolved.recommendations)) {
      for (const rec of unresolved.recommendations) {
        if (rec) reasons.push(rec);
      }
    }
    return {
      ...row,
      issue_reasons: reasons,
    };
  });

  // Enrich faculty_load_balance rows with department_name using the snapshot's department list
  const reportDeptLookup = buildDepartmentLookup(snapshot.departments);
  const enrichedLoadBalance = Array.isArray(mergedResult.report?.faculty_load_balance)
    ? mergedResult.report.faculty_load_balance.map((row) => ({
        ...row,
        department_name: describeDepartment(row.department_id, reportDeptLookup),
      }))
    : [];

  mergedResult.report = {
    ...(mergedResult.report || {}),
    faculty_load_balance: enrichedLoadBalance,
    unresolved_offerings: Array.isArray(optimizerResult?.report?.unresolved_offerings)
      ? optimizerResult.report.unresolved_offerings.map((item) => ({
          ...item,
          department_name: describeDepartment(item.department_id, reportDeptLookup),
          preflight_reason: preflightProblemMap.get(
            [
              String(item.code || '').toUpperCase(),
              String(item.course_no || '').toUpperCase(),
              String(item.section || '').toUpperCase(),
            ].join('|')
          )?.reasons?.join(' | ') || null,
        }))
      : [],
    generated_rows: generatedRowsWithIssues,
    faculty_prefilter: {
      input_count: Array.isArray(snapshot.faculty) ? snapshot.faculty.length : 0,
      eligible_count: gaFaculty.length,
    },
    assignable_offerings: preFlight.assignable_offerings || [],
    problematic_offerings: preFlight.problematic_offerings || [],
    preflight_problematic_offerings: preFlight.problematic_offerings || [],
    general_offerings: preFlight.general_offerings || [],
  };

  return mergedResult;
}

export async function getGaPreFlight(_req, res) {
  try {
    const snapshot = await fetchSnapshot();
    const subjectDrivenOfferings = mapSubjectsToGaOfferings(snapshot.subjects, snapshot.offerings);
    const subjectDrivenSnapshot = { ...snapshot, offerings: subjectDrivenOfferings };
    const preflight = buildPreflight(subjectDrivenSnapshot);
    return res.json({ ...preflight, faculty_loading: snapshot.faculty_loading || [] });
  } catch (error) {
    console.error('[ga] pre-flight failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export async function postRunFacultyLoading(req, res) {
  try {
    const dryRun = String(req.query.dry_run || req.body?.dry_run || 'false').toLowerCase() === 'true';
    const result = await runFacultyLoadingWorkflow({ dryRun, constraints: req.body || {} });

    return res.json({
      status: 'completed',
      dry_run: dryRun,
      run_id: result.run_id,
      faculty_count: result.report?.faculty_load_balance?.length || 0,
      offering_count: result.assignments?.length || 0,
      fitness_overall: result.fitness_overall,
      fitness_hard: result.fitness_hard,
      fitness_soft: result.fitness_soft,
      report: result.report,
      assignments: result.assignments || [],
      persistence: result.persistence,
      preflight: result.preflight,
    });
  } catch (error) {
    if (error.statusCode === 400 && error.preFlight) {
      return res.status(400).json({ error: error.message, ...error.preFlight });
    }

    if (String(error?.message || '').includes('timed out')) {
      return res.status(504).json({ error: error.message });
    }

    console.error('[ga] run failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function fetchAutomaticSchedulerRows() {
  const response = await query(`
    select a.id, a.curr_id, a.code, a.course_no, a.department_id, a.section, a.descriptive_title,
           a.units, a.lec_hrs, a.lab_hrs, a.mth_schedule, a.mth_room_id, a.tfs_schedule, a.tfs_room_id,
           (a.merged = 'true') as merged, a.preflight_tag,
           coalesce(nullif(trim(d.department_name), ''), 'Department ' || a.department_id::text) as department_name,
           case
             when nullif(trim(a.mth_room_id), '') is null then null
             else coalesce(mr.room_names, a.mth_room_id)
           end as mth_room_name,
           case
             when nullif(trim(a.tfs_room_id), '') is null then null
             else coalesce(tr.room_names, a.tfs_room_id)
           end as tfs_room_name
    from public.automatic_scheduler a
    left join public.departments d on d.department_id = a.department_id
    left join lateral (
      select string_agg(distinct r.room_name, ' / ' order by r.room_name) as room_names
      from regexp_split_to_table(coalesce(a.mth_room_id, ''), '[^0-9]+') as token
      join public.rooms r on r.room_id = token::integer
      where token ~ '^[0-9]+$'
    ) mr on true
    left join lateral (
      select string_agg(distinct r.room_name, ' / ' order by r.room_name) as room_names
      from regexp_split_to_table(coalesce(a.tfs_room_id, ''), '[^0-9]+') as token
      join public.rooms r on r.room_id = token::integer
      where token ~ '^[0-9]+$'
    ) tr on true
    order by a.id asc
  `);
  return response.rows;
}

function parseRoomIdList(value) {
  const raw = normalizeText(value);
  if (!raw) return [];
  return splitList(raw)
    .map((token) => toNumber(token))
    .filter((v) => v !== null)
    .map((v) => Number(v));
}

function roomTypeOf(room) {
  return normalizeUpper(room?.room_type);
}

function isRoomActive(room) {
  return normalizeUpper(room?.room_status) !== 'INACTIVE';
}

function toAutomaticCandidateFromSubject(subject, roomLookup) {
  const lec = toNumber(subject.subject_lec_hrs) || 0;
  const lab = toNumber(subject.subject_lab_hrs) || 0;
  const total = lec + lab;
  const explicitUnits = toNumber(subject.subject_units);
  const units = explicitUnits !== null ? explicitUnits : total;

  return {
    subject_id: toNumber(subject.subject_id),
    curr_id: toNumber(subject.curr_id),
    code: normalizeText(subject.subject_code) || null,
    course_no: normalizeText(subject.subject_course_no) || null,
    department_id: toNumber(subject.department_id),
    department_name: normalizeText(subject.department_name) || null,
    section: normalizeText(subject.subject_section) || null,
    descriptive_title: normalizeText(subject.subject_descriptive_title) || null,
    units,
    lec_hrs: lec,
    lab_hrs: lab,
    total_hrs: total,
    is_general: Boolean(subject.is_general),
    merged: toBoolean(subject.merged) === true,
    subject_status: normalizeUpper(subject.subject_status) || null,
    existing_mth_schedule: normalizeText(subject.mth_schedule) || null,
    existing_tfs_schedule: normalizeText(subject.tfs_schedule) || null,
    existing_mth_room_id: resolveRoomReference(subject.mth_room, roomLookup).roomId,
    existing_mth_room_name: resolveRoomReference(subject.mth_room, roomLookup).roomName,
    existing_tfs_room_id: resolveRoomReference(subject.tfs_room, roomLookup).roomId,
    existing_tfs_room_name: resolveRoomReference(subject.tfs_room, roomLookup).roomName,
    existing_mth_room_ids: resolveAllRoomIds(subject.mth_room, roomLookup).join('/') || null,
    existing_tfs_room_ids: resolveAllRoomIds(subject.tfs_room, roomLookup).join('/') || null,
    raw_mth_room: normalizeText(subject.mth_room) || null,
    raw_tfs_room: normalizeText(subject.tfs_room) || null,
    // infer preferred pattern from existing schedules when available
    preferred_pattern: (() => {
      const hasMth = Boolean(normalizeText(subject.mth_schedule));
      const hasTfs = Boolean(normalizeText(subject.tfs_schedule));
      if (hasMth && !hasTfs) return 'MTH';
      if (hasTfs && !hasMth) return 'TF';
      return null;
    })(),
  };
}

// ── Scheduler helper utilities ────────────────────────────────────────────────

// Returns [{roomId: string, day: string}, ...] after splitting slash-notation room IDs.
// "1200/1195" with days ["MON","THU"] → [{roomId:"1200",day:"MON"},{roomId:"1195",day:"THU"}]
function splitRoomIdsForDays(roomIdStr, days) {
  if (!roomIdStr) return [];
  const parts = String(roomIdStr).split('/').map((s) => s.trim()).filter(Boolean);
  return days.map((day, i) => ({
    roomId: parts.length === 1 ? parts[0] : (parts[i] ?? parts[0]),
    day,
  }));
}

// Returns true if two output-row objects (mth_schedule, mth_room_id, tfs_schedule, tfs_room_id)
// share at least one room-day pair with overlapping time.
// Canonical conflict check — Time overlap AND (room overlap OR section overlap).
// Used by: pre-flight triage, Stage 1 merge checks, Stage 2 triage, Stage 3 validation.
function rowsHaveConflict(rowA, rowB) {
  for (const pat of ['mth', 'tfs']) {
    const schedA = rowA[`${pat}_schedule`];
    const schedB = rowB[`${pat}_schedule`];
    if (!schedA || !schedB) continue;
    const parsedA = parseScheduleText(schedA);
    const parsedB = parseScheduleText(schedB);
    if (!parsedA || !parsedB) continue;
    if (!overlaps(parsedA, parsedB)) continue;

    // Room axis: same day + same room
    const roomA = rowA[`${pat}_room_id`];
    const roomB = rowB[`${pat}_room_id`];
    if (roomA && roomB) {
      const pairsA = splitRoomIdsForDays(roomA, parseDaysFromSchedule(schedA, pat.toUpperCase()));
      const pairsB = splitRoomIdsForDays(roomB, parseDaysFromSchedule(schedB, pat.toUpperCase()));
      for (const a of pairsA) {
        for (const b of pairsB) {
          if (a.roomId === b.roomId && a.day === b.day) return true;
        }
      }
    }

    // Section axis: same dept + same section + time overlap on same pattern type
    const deptA = rowA.department_id != null ? String(rowA.department_id) : null;
    const deptB = rowB.department_id != null ? String(rowB.department_id) : null;
    const secA  = rowA.section || null;
    const secB  = rowB.section || null;
    if (deptA && deptB && secA && secB && deptA === deptB && secA === secB) {
      const daysA = parseDaysFromSchedule(schedA, pat.toUpperCase());
      const daysB = parseDaysFromSchedule(schedB, pat.toUpperCase());
      const daySetA = new Set(daysA);
      if (daysB.some((d) => daySetA.has(d))) return true;
    }
  }
  return false;
}

// Build reserved-slot descriptors from the discarded pile (output rows) for the Python GA.
function buildDiscardedPileSlots(discardedPile) {
  const slots = [];
  for (const row of discardedPile) {
    if (!row.source_subject_id && !row.subject_id) continue;
    slots.push({
      subject_id: row.source_subject_id ?? row.subject_id,
      section: row.section,
      department_id: row.department_id,
      mth_schedule: row.mth_schedule || null,
      mth_room_id: row.mth_room_id != null ? String(row.mth_room_id) : null,
      tfs_schedule: row.tfs_schedule || null,
      tfs_room_id: row.tfs_room_id != null ? String(row.tfs_room_id) : null,
    });
  }
  return slots;
}

// Convert a candidate object (from preflight) into an output row object.
function candidateToOutputRow(c, roomLookup, mergedVal, preflightTag) {
  return {
    source_subject_id: c.subject_id,
    curr_id: c.curr_id,
    code: c.code,
    course_no: c.course_no,
    department_id: c.department_id,
    department_name: c.department_name || null,
    section: c.section,
    descriptive_title: c.descriptive_title,
    units: c.units,
    lec_hrs: c.lec_hrs,
    lab_hrs: c.lab_hrs,
    mth_schedule: c.existing_mth_schedule || null,
    mth_room_id: c.existing_mth_room_ids || (c.existing_mth_room_id != null ? String(c.existing_mth_room_id) : null),
    mth_room_name:
      c.existing_mth_room_name ||
      (c.existing_mth_room_ids ? resolveRoomNamesFromIdText(c.existing_mth_room_ids, roomLookup) : null),
    tfs_schedule: c.existing_tfs_schedule || null,
    tfs_room_id: c.existing_tfs_room_ids || (c.existing_tfs_room_id != null ? String(c.existing_tfs_room_id) : null),
    tfs_room_name:
      c.existing_tfs_room_name ||
      (c.existing_tfs_room_ids ? resolveRoomNamesFromIdText(c.existing_tfs_room_ids, roomLookup) : null),
    merged: mergedVal,
    preflight_tag: preflightTag,
  };
}

// Return a copy of a candidate with schedule/room fields cleared (ready for GA re-scheduling).
function clearSubjectSchedule(c) {
  return {
    ...c,
    existing_mth_schedule: null,
    existing_tfs_schedule: null,
    existing_mth_room_id: null,
    existing_tfs_room_id: null,
    existing_mth_room_ids: null,
    existing_tfs_room_ids: null,
    existing_mth_room_name: null,
    existing_tfs_room_name: null,
    preferred_pattern: null,
  };
}

// Check new GA assignments against each other and against the discarded pile.
// Returns {conflictFreeNew, stillConflicted} where stillConflicted are candidates
// (cleared schedules) that need another GA iteration.
function validateGAResults(newAssignments, discardedPile, activeRooms) {
  const roomLookup = buildRoomLookup(activeRooms);
  const enriched = enrichAutomaticAssignments(newAssignments, [], activeRooms).map((r) => ({
    ...r,
    preflight_tag: null,
  }));

  const conflictedIndices = new Set();

  // Check pairs within new assignments
  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      if (rowsHaveConflict(enriched[i], enriched[j])) {
        conflictedIndices.add(i);
        conflictedIndices.add(j);
      }
    }
  }

  // Check each new assignment against discarded pile
  for (let i = 0; i < enriched.length; i++) {
    if (conflictedIndices.has(i)) continue;
    for (const pileRow of discardedPile) {
      if (rowsHaveConflict(enriched[i], pileRow)) {
        conflictedIndices.add(i);
        break;
      }
    }
  }

  const conflictFreeNew = enriched.filter((_, i) => !conflictedIndices.has(i));
  const stillConflicted = [...conflictedIndices].map((i) => {
    const row = enriched[i];
    // Rebuild a cleared candidate-like object the GA can accept
    return {
      subject_id: row.source_subject_id ?? row.subject_id,
      curr_id: row.curr_id,
      code: row.code,
      course_no: row.course_no,
      department_id: row.department_id,
      department_name: row.department_name,
      section: row.section,
      descriptive_title: row.descriptive_title,
      units: row.units,
      lec_hrs: row.lec_hrs,
      lab_hrs: row.lab_hrs,
      total_hrs: (row.lec_hrs || 0) + (row.lab_hrs || 0),
      is_general: false,
      merged: false,
      // All schedule/room fields cleared for the next GA pass
      existing_mth_schedule: null,
      existing_tfs_schedule: null,
      existing_mth_room_id: null,
      existing_tfs_room_id: null,
      existing_mth_room_ids: null,
      existing_tfs_room_ids: null,
    };
  });

  return { conflictFreeNew, stillConflicted };
}

// Fix conflicts between distinct merge groups using the GA.
// If merge group A and group B occupy the same room at overlapping times,
// one group is re-scheduled as a unit (all members get the new time+room).
async function fixMergeGroupConflicts(mergedSubjects, existingPile, activeRooms, constraints) {
  if (mergedSubjects.length === 0) return [];

  const roomLookup = buildRoomLookup(activeRooms);

  // Build groups keyed by merge_representative_id
  const groupMap = new Map();
  for (const c of mergedSubjects) {
    const rep = c.merge_representative_id ?? c.subject_id;
    if (!groupMap.has(rep)) groupMap.set(rep, []);
    groupMap.get(rep).push(c);
  }
  const groups = [...groupMap.values()];

  // Find which groups conflict with each other using their representative rows
  const groupRows = groups.map((g) => candidateToOutputRow(g[0], roomLookup, true, 'original'));
  const conflictingGroupIndices = new Set();
  for (let i = 0; i < groupRows.length; i++) {
    for (let j = i + 1; j < groupRows.length; j++) {
      if (rowsHaveConflict(groupRows[i], groupRows[j])) {
        conflictingGroupIndices.add(i);
        conflictingGroupIndices.add(j);
      }
    }
  }

  if (conflictingGroupIndices.size === 0) {
    // No inter-group conflicts — return all as-is
    return groups.flat().map((c) => candidateToOutputRow(c, roomLookup, true, 'original'));
  }

  console.log(`[preflight][merge-fix] ${conflictingGroupIndices.size} conflicting merge group(s) — calling GA to re-assign`);

  // Build GA subjects: one representative per conflicting group (schedule cleared)
  const conflictingGroups = [...conflictingGroupIndices].map((i) => groups[i]);
  const nonConflictingGroups = groups.filter((_, i) => !conflictingGroupIndices.has(i));
  const gaSubjects = conflictingGroups.map((g) => clearSubjectSchedule(g[0]));

  // Reserved slots = existing pile + non-conflicting merge groups
  const reservedForMerge = [
    ...existingPile,
    ...nonConflictingGroups.flat().map((c) => candidateToOutputRow(c, roomLookup, true, 'original')),
  ];

  let gaResult;
  try {
    gaResult = await callPythonScheduleGA({
      subjects: gaSubjects,
      rooms: activeRooms,
      reserved_slots: buildDiscardedPileSlots(reservedForMerge),
      constraints,
    });
  } catch (err) {
    console.warn('[preflight][merge-fix] GA call failed, using original merge schedules:', err.message);
    return groups.flat().map((c) => candidateToOutputRow(c, roomLookup, true, 'original'));
  }

  // Apply each GA result to all members of its conflicting group
  const result = [];
  for (const assignment of (gaResult.assignments || [])) {
    const srcId = assignment.source_subject_id ?? assignment.subject_id;
    const matchingGroup = conflictingGroups.find((g) => g[0].subject_id === toNumber(srcId));
    if (!matchingGroup) continue;
    for (const member of matchingGroup) {
      const baseRow = candidateToOutputRow(member, roomLookup, true, 'original');
      result.push({
        ...baseRow,
        mth_schedule: assignment.mth_schedule ?? null,
        mth_room_id: assignment.mth_room_id != null ? String(assignment.mth_room_id) : null,
        mth_room_name: assignment.mth_room_name ?? null,
        tfs_schedule: assignment.tfs_schedule ?? null,
        tfs_room_id: assignment.tfs_room_id != null ? String(assignment.tfs_room_id) : null,
        tfs_room_name: assignment.tfs_room_name ?? null,
      });
    }
  }

  // Non-conflicting groups go in unchanged
  for (const group of nonConflictingGroups) {
    result.push(...group.map((c) => candidateToOutputRow(c, roomLookup, true, 'original')));
  }

  // Any conflicting group whose representative wasn't in GA results goes in as-is
  for (const group of conflictingGroups) {
    const alreadyHandled = result.some((r) => r.source_subject_id === group[0].subject_id || group.some((m) => m.subject_id === r.source_subject_id));
    if (!alreadyHandled) {
      result.push(...group.map((c) => candidateToOutputRow(c, roomLookup, true, 'original')));
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildAutomaticSchedulerPreflight(snapshot) {
  const departmentLookup = buildDepartmentLookup(snapshot.departments);
  const roomLookup = buildRoomLookup(snapshot.rooms);
  const issues = [];

  const activeRooms = (snapshot.rooms || []).filter((room) => isRoomActive(room));
  const inactiveRooms = (snapshot.rooms || []).filter((room) => !isRoomActive(room));

  const candidates = (snapshot.subjects || []).map((subject) => toAutomaticCandidateFromSubject(subject, roomLookup));

  // ── Scenario detection ────────────────────────────────────────────────────────
  // Scenario 1: at least one subject already has a schedule + room assignment.
  // Scenario 2: clean slate — no existing assignments.
  const scenario = candidates.some(
    (c) =>
      (c.existing_mth_schedule && c.existing_mth_room_id) ||
      (c.existing_tfs_schedule && c.existing_tfs_room_id)
  )
    ? 'scenario_1'
    : 'scenario_2';

  // ── PRE-4  Merged Subject Detection ─────────────────────────────────────────
  //
  //  LOGIC (verbatim from spec):
  //    if (Course Number AND Descriptive Title == Course Number AND Descriptive Title)
  //        if (Schedule AND Room Assignment == Schedule AND Room Assignment)
  //            Row = Merged  →  disregard in schedule automation, leave as-is
  //        else
  //            Row = Conflict  →  flag for review
  //
  //  Implementation:
  //    1. Group candidates by identity key  = course_no + descriptive_title.
  //    2. Within each identity group, sub-group by schedule+room key.
  //    3. Sub-groups with ≥2 members AND non-empty schedule
  //         → ALL members = Merged (excluded from GA, shown in issues).
  //    4. Singleton sub-groups inside an identity group that already has a
  //       confirmed merged sub-group AND the singleton has a non-empty schedule
  //         → Conflict (excluded from GA, shown in issues for review).
  //    5. Subjects not matching any of the above → go to GA normally.
  // ─────────────────────────────────────────────────────────────────────────────

  // Step 1 — build identity groups
  const mergeIdentityGroups = new Map();
  for (const candidate of candidates) {
    const courseNorm = normalizeUpper(candidate.course_no || '').replace(/\s+/g, '');
    const titleNorm  = normalizeUpper(candidate.descriptive_title || '').replace(/\s+/g, ' ').trim();
    if (!courseNorm || !titleNorm) continue;
    const identityKey = `${courseNorm}|||${titleNorm}`;
    if (!mergeIdentityGroups.has(identityKey)) mergeIdentityGroups.set(identityKey, []);
    mergeIdentityGroups.get(identityKey).push(candidate);
  }

  // Step 2–4 — evaluate each identity group
  let mergeGroupCount = 0;
  for (const [, identityGroup] of mergeIdentityGroups.entries()) {
    if (identityGroup.length < 2) continue; // single subject — no comparison possible

    identityGroup.sort((a, b) => (a.subject_id || 0) - (b.subject_id || 0));

    // Sub-group by exact schedule + room key
    const schedRoomGroups = new Map();
    for (const c of identityGroup) {
      const mthS = normalizeUpper(c.existing_mth_schedule || '');
      const tfsS = normalizeUpper(c.existing_tfs_schedule || '');
      const mthR = c.existing_mth_room_id
        ? normalizeUpper(String(c.existing_mth_room_id))
        : normalizeUpper(String(c.raw_mth_room || '')).replace(/[^A-Z0-9]/g, '');
      const tfsR = c.existing_tfs_room_id
        ? normalizeUpper(String(c.existing_tfs_room_id))
        : normalizeUpper(String(c.raw_tfs_room || '')).replace(/[^A-Z0-9]/g, '');
      const srKey = `${mthS}|||${tfsS}|||${mthR}|||${tfsR}`;
      if (!schedRoomGroups.has(srKey)) schedRoomGroups.set(srKey, []);
      schedRoomGroups.get(srKey).push(c);
    }

    // Pass A — mark confirmed merged sub-groups (≥2 members, non-empty schedule)
    let hasMerge = false;
    for (const [srKey, srGroup] of schedRoomGroups.entries()) {
      const [mthS, tfsS] = srKey.split('|||');
      const hasSchedule = mthS.length > 0 || tfsS.length > 0;
      if (srGroup.length < 2 || !hasSchedule) continue;

      hasMerge = true;
      mergeGroupCount++;
      const repId = srGroup[0].subject_id;

      for (const c of srGroup) {
        c.merged = true;
        c.merge_representative_id = repId;
        issues.push({
          type: 'subject',
          severity: 'info',
          id: c.subject_id,
          problem: `Merged: same Course Number and Descriptive Title, Schedule, and Room as subject ID ${repId}. Excluded from automation — left as-is.`,
          entity_label: `${c.code || '-'} ${c.course_no || '-'} ${c.section || '-'}`.trim(),
          department_name: describeDepartment(c.department_id, departmentLookup),
        });
      }
      console.log(`[preflight][merge] merged sub-group (ids=[${srGroup.map((s) => s.subject_id).join(',')}])`);
    }

    // Note: singletons with different schedule/room from a merged class are NOT conflicts.
    // They are valid unique schedules — handled by the unique-clean detection pass below.
  }
  console.log(`[preflight][merge] candidates=${candidates.length}, merged sub-groups=${mergeGroupCount}`);

  // Pass B — catch subjects that share the exact same physical slot (schedule + room)
  // but were not caught by Pass A's identity-based grouping. Restricted to subjects
  // with matching descriptive titles: different-title subjects in the same slot are a
  // room conflict (handled by Python's conflict resolver), not a merge.
  const schedRoomAllGroups = new Map();
  for (const candidate of candidates) {
    const mthS = normalizeUpper(candidate.existing_mth_schedule || '');
    const tfsS = normalizeUpper(candidate.existing_tfs_schedule || '');
    const mthR = candidate.existing_mth_room_id
      ? normalizeUpper(String(candidate.existing_mth_room_id))
      : normalizeUpper(String(candidate.raw_mth_room || '')).replace(/[^A-Z0-9]/g, '');
    const tfsR = candidate.existing_tfs_room_id
      ? normalizeUpper(String(candidate.existing_tfs_room_id))
      : normalizeUpper(String(candidate.raw_tfs_room || '')).replace(/[^A-Z0-9]/g, '');
    if (!mthS && !tfsS) continue;
    if (!mthR && !tfsR) continue;
    const srKey = `${mthS}|||${tfsS}|||${mthR}|||${tfsR}`;
    if (!schedRoomAllGroups.has(srKey)) schedRoomAllGroups.set(srKey, []);
    schedRoomAllGroups.get(srKey).push(candidate);
  }
  for (const [, srGroup] of schedRoomAllGroups.entries()) {
    if (srGroup.length < 2) continue;
    const unmerged = srGroup.filter((c) => !c.merged);
    if (unmerged.length === 0) continue;
    // Only merge subjects that share the same normalized title; differing titles
    // indicate a room conflict that Python's pool conflict resolver must handle.
    const repTitle = normalizeUpper(srGroup[0].descriptive_title || '').replace(/\s+/g, ' ').trim();
    const allSameTitle = repTitle && srGroup.every(
      (c) => normalizeUpper(c.descriptive_title || '').replace(/\s+/g, ' ').trim() === repTitle
    );
    if (!allSameTitle) continue;
    srGroup.sort((a, b) => (a.subject_id || 0) - (b.subject_id || 0));
    const repId = srGroup[0].subject_id;
    for (const c of unmerged) {
      c.merged = true;
      c.merge_representative_id = repId;
      mergeGroupCount++;
      issues.push({
        type: 'subject',
        severity: 'info',
        id: c.subject_id,
        problem: `Merged: same Schedule and Room as subject ID ${repId}. Excluded from automation — left as-is.`,
        entity_label: `${c.code || '-'} ${c.course_no || '-'} ${c.section || '-'}`.trim(),
        department_name: describeDepartment(c.department_id, departmentLookup),
      });
    }
    console.log(`[preflight][merge-b] room+time merged group: ids=[${srGroup.map((s) => s.subject_id).join(',')}]`);
  }
  console.log(`[preflight][merge-b] total merged sub-groups after pass B=${mergeGroupCount}`);

  // Tag merged groups: if any member is EMPTY (no schedule or room), the whole group
  // is MERGED_NEEDS_GENERATION; otherwise it is SCHEDULED (all members have a slot).
  const mergeGroupEmpty = new Set();
  for (const c of candidates) {
    if (!c.merged) continue;
    const isEmpty = !(c.existing_mth_schedule || c.existing_tfs_schedule) ||
                    !(c.existing_mth_room_ids || c.existing_mth_room_id ||
                      c.existing_tfs_room_ids || c.existing_tfs_room_id);
    if (isEmpty) mergeGroupEmpty.add(c.merge_representative_id);
  }
  for (const c of candidates) {
    if (!c.merged) continue;
    c.pending_state = mergeGroupEmpty.has(c.merge_representative_id)
      ? 'MERGED_NEEDS_GENERATION'
      : 'SCHEDULED';
  }

  // ── Unique-clean detection (Scenario 1 only) ─────────────────────────────────
  // A subject is "unique-clean" when it already has a schedule+room assignment
  // that does not cause a room conflict with any other non-merged subject.
  // These are preserved as-is and excluded from the GA just like merged subjects.
  if (scenario === 'scenario_1') {
    // Build room+day time blocks from all subjects that have existing schedule+room.
    // Merged subjects contribute ONE block per merged group (intentional room sharing).
    const roomDayBlocks = []; // [{roomId, day, start, end, ownerId}]

    function addCandidateRoomBlocks(c, ownerId) {
      for (const pat of ['mth', 'tfs']) {
        const sched = c[`existing_${pat}_schedule`];
        const roomId = c[`existing_${pat}_room_id`];
        if (!sched || !roomId) continue;
        const parsed = parseScheduleText(sched);
        if (!parsed) continue;
        const days = parseDaysFromSchedule(sched, pat.toUpperCase());
        for (const day of days) {
          roomDayBlocks.push({ roomId: String(roomId), day, start: parsed.start, end: parsed.end, ownerId: String(ownerId) });
        }
      }
    }

    const seenMergedReps = new Set();
    for (const c of candidates) {
      if (!c.merged) continue;
      const repId = c.merge_representative_id;
      if (!repId || seenMergedReps.has(repId)) continue;
      seenMergedReps.add(repId);
      addCandidateRoomBlocks(c, `merged:${repId}`);
    }

    for (const c of candidates) {
      if (c.merged) continue;
      addCandidateRoomBlocks(c, c.subject_id);
    }

    // Mark non-merged candidates with a conflict-free schedule+room as unique-clean.
    for (const c of candidates) {
      if (c.merged) continue;
      const hasRoom = c.existing_mth_room_ids || c.existing_mth_room_id || c.existing_tfs_room_ids || c.existing_tfs_room_id;
      const hasSched = c.existing_mth_schedule || c.existing_tfs_schedule;
      if (!hasRoom || !hasSched) continue;

      let hasConflict = false;
      for (const pat of ['mth', 'tfs']) {
        if (hasConflict) break;
        const sched = c[`existing_${pat}_schedule`];
        const roomId = c[`existing_${pat}_room_id`];
        if (!sched || !roomId) continue;
        const parsed = parseScheduleText(sched);
        if (!parsed) continue;
        const days = parseDaysFromSchedule(sched, pat.toUpperCase());
        const selfId = String(c.subject_id);

        for (const day of days) {
          for (const block of roomDayBlocks) {
            if (block.ownerId === selfId) continue;
            if (block.roomId !== String(roomId) || block.day !== day) continue;
            if (overlaps(parsed, block)) {
              hasConflict = true;
              break;
            }
          }
          if (hasConflict) break;
        }
      }

      if (!hasConflict) {
        c.unique_clean = true;
      }
    }

    const uniqueCleanCount = candidates.filter((c) => c.unique_clean).length;
    console.log(`[preflight][scenario1] unique_clean=${uniqueCleanCount}`);
  }

  const mergedSubjects        = candidates.filter((row) => row.merged);
  const mergeConflictSubjects = []; // Pass B removed — singletons with different schedule are not auto-conflicts
  const uniqueCleanSubjects   = candidates.filter((row) => row.unique_clean);

  const excluded = new Set([
    ...mergedSubjects.map((row) => row.subject_id),
    ...uniqueCleanSubjects.map((row) => row.subject_id),
  ]);

  // Subjects with missing identity fields or zero hours are silently excluded from the GA.
  // They do not generate any preflight issue (high, medium, or low).
  const assignable = candidates.filter((row) => {
    if (excluded.has(row.subject_id)) return false;
    if (!row.code || !row.course_no || !row.department_id || !row.section || !row.descriptive_title) return false;
    if ((row.total_hrs || 0) <= 0) return false;
    return true;
  }).map((row) => {
    // Sub-tag each pending subject for Stage 2+3 triage
    const hasSchedule = Boolean(row.existing_mth_schedule || row.existing_tfs_schedule);
    const hasRoom = Boolean(
      row.existing_mth_room_ids || row.existing_mth_room_id ||
      row.existing_tfs_room_ids || row.existing_tfs_room_id
    );
    row.pending_state = (!hasSchedule || !hasRoom) ? 'NEEDS_GENERATION' : 'NEEDS_RESCHEDULE';
    return row;
  });

  for (const room of inactiveRooms) {
    issues.push({
      type: 'room',
      severity: 'medium',
      id: room.room_id,
      problem: `Room ${normalizeText(room.room_name) || room.room_id} is inactive and excluded from automation.`,
      entity_label: describeRoom(room),
    });
  }

  // Determine status: blocked only if high-severity issues exist AND no assignable subjects.
  const hasHigh = issues.some((i) => i.severity === 'high');
  const hasAny = issues.length > 0;
  const status = hasHigh && assignable.length === 0 ? 'blocked' : hasAny ? 'partial' : 'ok';

  const preservedSubjects = [...mergedSubjects, ...uniqueCleanSubjects];

  return {
    scenario,
    status,
    room_count: snapshot.rooms.length,
    active_room_count: activeRooms.length,
    subject_count: snapshot.subjects.length,
    assignable_count: assignable.length,
    excluded_merged_count: mergedSubjects.length,
    excluded_conflict_count: mergeConflictSubjects.length,
    preserved_merged_count: mergedSubjects.length,
    preserved_unique_count: uniqueCleanSubjects.length,
    needs_scheduling_count: assignable.length,
    issues,
    assignable_subjects: assignable,
    needs_scheduling_subjects: assignable,
    preserved_subjects: preservedSubjects,
    excluded_merged_subjects: mergedSubjects,
    excluded_unique_subjects: uniqueCleanSubjects,
    excluded_conflict_subjects: mergeConflictSubjects,
    candidates,
    suggested_next_step:
      status === 'blocked'
        ? 'Resolve high-severity data issues before running automatic scheduler.'
        : scenario === 'scenario_1'
          ? `Scenario 1: ${preservedSubjects.length} subject(s) will be preserved (${mergedSubjects.length} merged, ${uniqueCleanSubjects.length} unique-clean). ${assignable.length} subject(s) will be (re)scheduled by the GA.`
          : 'Scenario 2 (clean slate): all subjects will be scheduled by the GA.',
  };
}

// Build a list of reserved time-slot descriptors for preserved subjects.
// Used to pre-populate the GA's and greedy's room/section reservation maps
// so they schedule around already-fixed assignments.
// One representative per merged group (merged subjects share a room intentionally).
function buildReservedSlots(mergedSubjects, uniqueCleanSubjects) {
  const slots = [];

  const seenMergeReps = new Set();
  for (const c of mergedSubjects) {
    const repId = c.merge_representative_id;
    if (!repId || seenMergeReps.has(repId)) continue;
    seenMergeReps.add(repId);
    slots.push({
      subject_id: c.subject_id,
      section: c.section,
      department_id: c.department_id,
      mth_schedule: c.existing_mth_schedule || null,
      mth_room_id: c.existing_mth_room_ids || (c.existing_mth_room_id != null ? String(c.existing_mth_room_id) : null),
      tfs_schedule: c.existing_tfs_schedule || null,
      tfs_room_id: c.existing_tfs_room_ids || (c.existing_tfs_room_id != null ? String(c.existing_tfs_room_id) : null),
    });
  }

  for (const c of uniqueCleanSubjects) {
    slots.push({
      subject_id: c.subject_id,
      section: c.section,
      department_id: c.department_id,
      mth_schedule: c.existing_mth_schedule || null,
      mth_room_id: c.existing_mth_room_ids || (c.existing_mth_room_id != null ? String(c.existing_mth_room_id) : null),
      tfs_schedule: c.existing_tfs_schedule || null,
      tfs_room_id: c.existing_tfs_room_ids || (c.existing_tfs_room_id != null ? String(c.existing_tfs_room_id) : null),
    });
  }

  return slots;
}

// Convert preserved subjects (merged + unique-clean) into output row objects
// that can be concatenated with GA-assigned rows before persistence.
function buildPreservedRows(preservedSubjects, activeRooms) {
  const roomLookup = buildRoomLookup(activeRooms);
  return preservedSubjects.map((c) => ({
    source_subject_id: c.subject_id,
    curr_id: c.curr_id,
    code: c.code,
    course_no: c.course_no,
    department_id: c.department_id,
    department_name: c.department_name || null,
    section: c.section,
    descriptive_title: c.descriptive_title,
    units: c.units,
    lec_hrs: c.lec_hrs,
    lab_hrs: c.lab_hrs,
    mth_schedule: c.existing_mth_schedule || null,
    mth_room_id: c.existing_mth_room_id != null ? String(c.existing_mth_room_id) : null,
    mth_room_name:
      c.existing_mth_room_name ||
      (c.existing_mth_room_id != null
        ? resolveRoomNamesFromIdText(String(c.existing_mth_room_id), roomLookup)
        : null),
    tfs_schedule: c.existing_tfs_schedule || null,
    tfs_room_id: c.existing_tfs_room_id != null ? String(c.existing_tfs_room_id) : null,
    tfs_room_name:
      c.existing_tfs_room_name ||
      (c.existing_tfs_room_id != null
        ? resolveRoomNamesFromIdText(String(c.existing_tfs_room_id), roomLookup)
        : null),
    merged: c.merged === true ? true : 'preserved',
  }));
}

function formatTimeFromMinutes(totalMinutes) {
  const hh24 = Math.floor(totalMinutes / 60);
  const mm = String(totalMinutes % 60).padStart(2, '0');
  let hh12 = hh24 % 12;
  if (hh12 === 0) hh12 = 12;
  return `${hh12}:${mm}`;
}

function buildScheduleLabel(start, end) {
  return `${formatTimeFromMinutes(start)}-${formatTimeFromMinutes(end)}`;
}

function findNonConflictingSlot({ durationMinutes, sectionReservations, roomReservations, sectionBufferMinutes = 0 }) {
  const START = 7 * 60 + 30;
  const END = 20 * 60;
  for (let start = START; start + durationMinutes <= END; start += 30) {
    const end = start + durationMinutes;
    const candidate = { start, end };

    const sectionHasConflict = (sectionReservations || []).some((existing) => {
      const existingExpanded = { start: Math.max(0, existing.start - sectionBufferMinutes), end: existing.end + sectionBufferMinutes };
      return overlaps(existingExpanded, candidate);
    });
    if (sectionHasConflict) continue;

    const roomHasConflict = (roomReservations || []).some((existing) => overlaps(existing, candidate));
    if (roomHasConflict) continue;

    return { start, end };
  }
  return null;
}

function buildAutomaticAssignments(assignableSubjects, activeRooms, extraReservations = []) {
  const sectionDayReservations = new Map();
  const roomDayReservations = new Map();
  const roomUsage = new Map();
  const assignments = [];
  const unresolved = [];

  function dayKey(day, key) {
    return `${day}|${key}`;
  }

  function getReservations(map, key) {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  }

  // Pre-populate reservations from preserved subjects (merged + unique-clean)
  // so the greedy doesn't assign other subjects to their rooms/times.
  for (const slot of extraReservations) {
    if (slot.mth_schedule && slot.mth_room_id) {
      const parsed = parseScheduleText(slot.mth_schedule);
      if (parsed) {
        const days = parseDaysFromSchedule(slot.mth_schedule, 'MTH');
        for (const day of days) {
          const sectionKey = dayKey(day, normalizeUpper(slot.section || ''));
          const roomKey = dayKey(day, slot.mth_room_id);
          getReservations(sectionDayReservations, sectionKey).push({ start: parsed.start, end: parsed.end });
          getReservations(roomDayReservations, roomKey).push({ start: parsed.start, end: parsed.end });
        }
        roomUsage.set(slot.mth_room_id, (roomUsage.get(slot.mth_room_id) || 0) + 1);
      }
    }
    if (slot.tfs_schedule && slot.tfs_room_id) {
      const parsed = parseScheduleText(slot.tfs_schedule);
      if (parsed) {
        const days = parseDaysFromSchedule(slot.tfs_schedule, 'TF');
        for (const day of days) {
          const sectionKey = dayKey(day, normalizeUpper(slot.section || ''));
          const roomKey = dayKey(day, slot.tfs_room_id);
          getReservations(sectionDayReservations, sectionKey).push({ start: parsed.start, end: parsed.end });
          getReservations(roomDayReservations, roomKey).push({ start: parsed.start, end: parsed.end });
        }
        roomUsage.set(slot.tfs_room_id, (roomUsage.get(slot.tfs_room_id) || 0) + 1);
      }
    }
  }

  // Pre-populate reservations with existing assignments from the database
  for (const subject of assignableSubjects) {
    // Add existing MTH schedule reservations
    if (subject.existing_mth_schedule && subject.existing_mth_room_id) {
      const parsed = parseScheduleText(subject.existing_mth_schedule);
      if (parsed) {
        for (const day of ['MON', 'THU']) {
          const sectionKey = dayKey(day, normalizeUpper(subject.section));
          const roomKey = dayKey(day, subject.existing_mth_room_id);
          getReservations(sectionDayReservations, sectionKey).push({ start: parsed.start, end: parsed.end });
          getReservations(roomDayReservations, roomKey).push({ start: parsed.start, end: parsed.end });
        }
        roomUsage.set(subject.existing_mth_room_id, (roomUsage.get(subject.existing_mth_room_id) || 0) + 1);
      }
    }
    // Add existing TFS schedule reservations
    if (subject.existing_tfs_schedule && subject.existing_tfs_room_id) {
      const parsed = parseScheduleText(subject.existing_tfs_schedule);
      if (parsed) {
        for (const day of ['TUE', 'FRI']) {
          const sectionKey = dayKey(day, normalizeUpper(subject.section));
          const roomKey = dayKey(day, subject.existing_tfs_room_id);
          getReservations(sectionDayReservations, sectionKey).push({ start: parsed.start, end: parsed.end });
          getReservations(roomDayReservations, roomKey).push({ start: parsed.start, end: parsed.end });
        }
        roomUsage.set(subject.existing_tfs_room_id, (roomUsage.get(subject.existing_tfs_room_id) || 0) + 1);
      }
    }
  }

  const roomsByType = {
    LAB: activeRooms.filter((r) => roomTypeOf(r).includes('LAB')),
    LEC: activeRooms.filter((r) => !roomTypeOf(r).includes('LAB')),
  };


  function pickRooms(preferredType) {
    const first = preferredType === 'LAB' ? roomsByType.LAB : roomsByType.LEC;
    const second = preferredType === 'LAB' ? roomsByType.LEC : roomsByType.LAB;
    const merged = [...first, ...second];
    return merged.sort((a, b) => (roomUsage.get(a.room_id) || 0) - (roomUsage.get(b.room_id) || 0));
  }

  function allocatePattern(subject, pattern) {
    const days = pattern === 'MTH' ? ['MON', 'THU'] : ['TUE', 'FRI'];
    const totalHrs = (toNumber(subject.lec_hrs) || 0) + (toNumber(subject.lab_hrs) || 0);
    const dayHours = totalHrs / 2;
    const durationMinutes = Math.max(30, Math.round(dayHours * 60));

    const needsLabPriority = (toNumber(subject.lab_hrs) || 0) > 0;
    const preferredRoomType = needsLabPriority ? 'LAB' : 'LEC';
    const candidateRooms = pickRooms(preferredRoomType);

    let chosenRoom = null;
    let daySlots = null;

    for (const room of candidateRooms) {
      const proposed = [];
      let valid = true;

      for (const day of days) {
        const sectionKey = dayKey(day, normalizeUpper(subject.section));
        const roomKey = dayKey(day, room.room_id);

        const slot = findNonConflictingSlot({
          sectionKey,
          roomId: room.room_id,
          durationMinutes,
          sectionReservations: getReservations(sectionDayReservations, sectionKey),
          roomReservations: getReservations(roomDayReservations, roomKey),
          // enforce 30-minute break buffer for the same section
          sectionBufferMinutes: 30,
        });

        if (!slot) {
          valid = false;
          break;
        }

        proposed.push({ day, ...slot });
      }

      if (valid) {
        chosenRoom = room;
        daySlots = proposed;
        break;
      }
    }

    if (!chosenRoom || !daySlots) {
      return { ok: false, reason: `No available room/time slot for ${pattern}.` };
    }

    for (const slot of daySlots) {
      const sectionKey = dayKey(slot.day, normalizeUpper(subject.section));
      const roomKey = dayKey(slot.day, chosenRoom.room_id);
      getReservations(sectionDayReservations, sectionKey).push({ start: slot.start, end: slot.end });
      getReservations(roomDayReservations, roomKey).push({ start: slot.start, end: slot.end });
    }

    roomUsage.set(chosenRoom.room_id, (roomUsage.get(chosenRoom.room_id) || 0) + 1);

    return {
      ok: true,
      scheduleText: buildScheduleLabel(daySlots[0].start, daySlots[0].end),
      roomId: chosenRoom.room_id,
      roomName: chosenRoom.room_name,
    };
  }

  // helper to pick a stable pattern when none is preferred
  function choosePatternForSection(section) {
    const s = String(section || '').trim().toUpperCase();
    if (!s) return 'MTH';
    let sum = 0;
    for (let i = 0; i < s.length; i += 1) sum += s.charCodeAt(i);
    return sum % 2 === 0 ? 'MTH' : 'TF';
  }

  // Read-only diagnosis helper — called only when allocatePattern returns { ok: false }.
  // Does NOT mutate sectionDayReservations or roomDayReservations.
  function diagnoseFailure(subject, pattern) {
    const days = pattern === 'MTH' ? ['MON', 'THU'] : ['TUE', 'FRI'];
    const totalHrs = (toNumber(subject.lec_hrs) || 0) + (toNumber(subject.lab_hrs) || 0);
    const durationMinutes = Math.max(30, Math.round((totalHrs / 2) * 60));

    // 1. Section availability: what free windows does the section have ignoring rooms?
    const sectionFreeSlots = [];
    let sectionBlocked = false;
    for (const day of days) {
      const sectionKey = dayKey(day, normalizeUpper(subject.section));
      const slot = findNonConflictingSlot({
        durationMinutes,
        sectionReservations: getReservations(sectionDayReservations, sectionKey),
        roomReservations: [],
        sectionBufferMinutes: 30,
      });
      if (!slot) {
        sectionBlocked = true;
        break;
      }
      const label = `${pattern} ${buildScheduleLabel(slot.start, slot.end)}`;
      if (!sectionFreeSlots.some((s) => s.label === label)) {
        sectionFreeSlots.push({ day, label });
      }
    }

    // 2. Room availability: which rooms have at least one free slot on any pattern day
    //    (ignoring the section constraint, so we show genuine room headroom)?
    const needsLabPriority = (toNumber(subject.lab_hrs) || 0) > 0;
    const candidateRooms = pickRooms(needsLabPriority ? 'LAB' : 'LEC');
    const seenRoomIds = new Set();
    const availableRooms = [];
    for (const room of candidateRooms) {
      if (seenRoomIds.has(room.room_id)) continue;
      for (const day of days) {
        const roomKey = dayKey(day, room.room_id);
        const slot = findNonConflictingSlot({
          durationMinutes,
          sectionReservations: [],
          roomReservations: getReservations(roomDayReservations, roomKey),
          sectionBufferMinutes: 0,
        });
        if (slot) {
          seenRoomIds.add(room.room_id);
          availableRooms.push({ room_id: room.room_id, room_name: room.room_name });
          break;
        }
      }
    }

    const roomsExhausted = availableRooms.length === 0;
    let conflictType = 'room';
    if (sectionBlocked && roomsExhausted) conflictType = 'both';
    else if (sectionBlocked) conflictType = 'section';

    return {
      conflict_type: conflictType,
      available_rooms: availableRooms.slice(0, 6),
      available_time_slots: sectionFreeSlots.slice(0, 4),
      rooms_exhausted: roomsExhausted,
      section_blocked: sectionBlocked,
    };
  }

  for (const subject of assignableSubjects) {
    // Check if subject already has both MTH or both TFS assignments
    const hasMthAssignment = subject.existing_mth_schedule && subject.existing_mth_room_id;
    const hasTfsAssignment = subject.existing_tfs_schedule && subject.existing_tfs_room_id;
    const hasFullAssignment = hasMthAssignment || hasTfsAssignment;

    // If already assigned, use existing assignment directly
    if (hasFullAssignment) {
      const out = {
        curr_id: subject.curr_id,
        code: subject.code,
        course_no: subject.course_no,
        department_id: subject.department_id,
        section: subject.section,
        descriptive_title: subject.descriptive_title,
        units: subject.units,
        lec_hrs: subject.lec_hrs,
        lab_hrs: subject.lab_hrs,
        merged: Boolean(subject.merged),
        source_subject_id: subject.subject_id,
      };

      if (hasMthAssignment) {
        out.mth_schedule = subject.existing_mth_schedule;
        out.mth_room_id = String(subject.existing_mth_room_id);
        out.mth_room_name = subject.existing_mth_room_name || String(subject.existing_mth_room_id);
        out.tfs_schedule = null;
        out.tfs_room_id = null;
        out.tfs_room_name = null;
      } else if (hasTfsAssignment) {
        out.tfs_schedule = subject.existing_tfs_schedule;
        out.tfs_room_id = String(subject.existing_tfs_room_id);
        out.tfs_room_name = subject.existing_tfs_room_name || String(subject.existing_tfs_room_id);
        out.mth_schedule = null;
        out.mth_room_id = null;
        out.mth_room_name = null;
      }

      assignments.push(out);
      continue;
    }

    // Otherwise, try to allocate a new slot
    const pattern = subject.preferred_pattern || choosePatternForSection(subject.section);
    const alloc = allocatePattern(subject, pattern);

    if (!alloc.ok) {
      const diagnosis = diagnoseFailure(subject, pattern);
      unresolved.push({
        subject_id: subject.subject_id,
        code: subject.code,
        course_no: subject.course_no,
        section: subject.section,
        descriptive_title: subject.descriptive_title,
        reasons: [alloc.reason].filter(Boolean),
        conflict_type: diagnosis.conflict_type,
        available_rooms: diagnosis.available_rooms,
        available_time_slots: diagnosis.available_time_slots,
        rooms_exhausted: diagnosis.rooms_exhausted,
        section_blocked: diagnosis.section_blocked,
        suggestions: {
          room_conflict: diagnosis.rooms_exhausted
            ? 'No available rooms found. Add more rooms to the system before rerunning the scheduler.'
            : `${diagnosis.available_rooms.length} room(s) with remaining capacity: ${diagnosis.available_rooms.map((r) => r.room_name).join(', ')}.`,
          time_conflict: diagnosis.section_blocked
            ? 'No free time slots remain for this section. Manually reschedule another class in this section first.'
            : diagnosis.available_time_slots.length > 0
              ? `Possible time windows: ${diagnosis.available_time_slots.map((s) => s.label).join(', ')}.`
              : 'Time slot analysis unavailable.',
        },
      });
      continue;
    }
    // map allocation into the correct pattern fields
    const out = {
      curr_id: subject.curr_id,
      code: subject.code,
      course_no: subject.course_no,
      department_id: subject.department_id,
      section: subject.section,
      descriptive_title: subject.descriptive_title,
      units: subject.units,
      lec_hrs: subject.lec_hrs,
      lab_hrs: subject.lab_hrs,
      merged: Boolean(subject.merged),
      source_subject_id: subject.subject_id,
    };

    if (alloc && alloc.scheduleText && pattern === 'MTH') {
      out.mth_schedule = alloc.scheduleText;
      out.mth_room_id = String(alloc.roomId);
      out.mth_room_name = alloc.roomName || String(alloc.roomId);
      out.tfs_schedule = null;
      out.tfs_room_id = null;
      out.tfs_room_name = null;
    } else if (alloc && alloc.scheduleText && pattern === 'TF') {
      out.tfs_schedule = alloc.scheduleText;
      out.tfs_room_id = String(alloc.roomId);
      out.tfs_room_name = alloc.roomName || String(alloc.roomId);
      out.mth_schedule = null;
      out.mth_room_id = null;
      out.mth_room_name = null;
    }

    assignments.push(out);
  }

  const hardFitness = assignments.length + unresolved.length === 0 ? 0 : (assignments.length / (assignments.length + unresolved.length)) * 100;
  const softFitness = Math.max(0, Math.min(100, hardFitness));
  const overall = Math.round((hardFitness * 0.8 + softFitness * 0.2) * 100) / 100;

  return {
    assignments,
    unresolved,
    fitness_overall: Math.round(overall * 100) / 100,
    fitness_hard: Math.round(hardFitness * 100) / 100,
    fitness_soft: Math.round(softFitness * 100) / 100,
  };
}

async function persistAutomaticScheduler(assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { persisted: 0 };
  }

  await withPgClient(async (client) => {
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM public.automatic_scheduler');

      const columns = [
        'curr_id',
        'code',
        'course_no',
        'department_id',
        'section',
        'descriptive_title',
        'units',
        'lec_hrs',
        'lab_hrs',
        'mth_schedule',
        'mth_room_id',
        'tfs_schedule',
        'tfs_room_id',
        'merged',
        'preflight_tag',
      ];

      const values = [];
      const placeholders = [];

      assignments.forEach((row, idx) => {
        const base = idx * columns.length;
        placeholders.push(`(${columns.map((_, cIdx) => `$${base + cIdx + 1}`).join(', ')})`);
        values.push(
          row.curr_id,
          row.code,
          row.course_no,
          row.department_id,
          row.section,
          row.descriptive_title,
          row.units,
          row.lec_hrs,
          row.lab_hrs,
          row.mth_schedule,
          row.mth_room_id != null ? String(row.mth_room_id) : null,
          row.tfs_schedule,
          row.tfs_room_id != null ? String(row.tfs_room_id) : null,
          row.merged === true || row.merged === 'true' ? 'true' : row.merged === 'preserved' ? 'preserved' : 'false',
          row.preflight_tag ?? null,
        );
      });

      await client.query(
        `INSERT INTO public.automatic_scheduler (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
        values
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { persisted: assignments.length };
}

function normalizeRoomToken(value) {
  return normalizeUpper(value).replace(/\s+/g, ' ').trim();
}

function toCourseOfferingRoomIdText(value, roomLookup) {
  const tokens = splitList(value);
  if (tokens.length === 0) return null;

  const mappedIds = [];
  for (const token of tokens) {
    const numeric = toNumber(token);
    if (numeric !== null && roomLookup.byId.has(numeric)) {
      mappedIds.push(String(Number(numeric)));
      continue;
    }

    const nameKey = normalizeRoomToken(token);
    const room = roomLookup.byName.get(nameKey.replace(/[^A-Z0-9]/g, ''));
    if (room?.room_id !== undefined && room?.room_id !== null) {
      mappedIds.push(String(Number(room.room_id)));
      continue;
    }
  }

  const uniqueIds = [...new Set(mappedIds)];
  if (uniqueIds.length > 0) return uniqueIds.join('/');
  return normalizeText(value) || null;
}

async function buildAutomaticSchedulerExportRows() {
  const rows = await fetchAutomaticSchedulerRows();

  // Group merged rows by their physical slot (schedule + room IDs) so we can
  // list merge partners in the exported column instead of a plain true/false.
  const mergeGroups = new Map(); // slotKey -> row[]
  for (const row of rows) {
    if (!row.merged) continue;
    const key = `${normalizeUpper(row.mth_schedule || '')}|||${normalizeUpper(row.tfs_schedule || '')}|||${normalizeUpper(String(row.mth_room_id || ''))}|||${normalizeUpper(String(row.tfs_room_id || ''))}`;
    if (!mergeGroups.has(key)) mergeGroups.set(key, []);
    mergeGroups.get(key).push(row);
  }

  // For each merged row, build a label listing its partners (all group members except self).
  // Format: "{code} {section} ({department_name})" joined by ", ".
  const mergeLabel = new Map(); // row.id -> label string
  for (const group of mergeGroups.values()) {
    for (const row of group) {
      const partners = group.filter((r) => r.id !== row.id);
      if (partners.length === 0) continue;
      mergeLabel.set(
        row.id,
        partners
          .map((r) => `${r.code || ''} ${r.section || ''} (${r.department_name || ''})`.trim())
          .join(', '),
      );
    }
  }

  return rows.map((row) => ({
    curr_id: row.curr_id,
    code: row.code,
    course_no: row.course_no,
    department_name: row.department_name,
    section: row.section,
    descriptive_title: row.descriptive_title,
    units: row.units,
    lec_hrs: row.lec_hrs,
    lab_hrs: row.lab_hrs,
    mth_schedule: row.mth_schedule,
    mth_room: row.mth_room_name,
    tfs_schedule: row.tfs_schedule,
    tfs_room: row.tfs_room_name,
    merged: row.merged ? (mergeLabel.get(row.id) || 'true') : '',
  }));
}

async function updateCourseOfferingFromAutomaticScheduler({ backupFirst = false }) {
  const rows = await fetchAutomaticSchedulerRows();
  if (rows.length === 0) {
    return { updated: 0, backup: null };
  }

  const roomResp = await query(`
    select room_id, room_name
    from public.rooms
    order by room_id asc
  `);
  const roomLookup = buildRoomLookup(roomResp.rows || []);

  await query('DELETE FROM public.subjects');

  let backup = null;

  await withPgClient(async (client) => {
    try {
      await client.query('BEGIN');

      if (backupFirst) {
        const current = await client.query(`
          select id, curr_id, code, course_no, department_id, section, descriptive_title, units, lec_hrs, lab_hrs,
                 mth_schedule, mth_room_id, tfs_schedule, tfs_room_id, merged
          from public.course_offerings
          order by id asc
        `);
        backup = current.rows;
      }

      await client.query('DELETE FROM public.course_offerings');

      const columns = [
        'curr_id',
        'code',
        'course_no',
        'department_id',
        'section',
        'descriptive_title',
        'units',
        'lec_hrs',
        'lab_hrs',
        'mth_schedule',
        'mth_room_id',
        'tfs_schedule',
        'tfs_room_id',
        'merged',
      ];

      const values = [];
      const placeholders = [];

      rows.forEach((row, idx) => {
        const base = idx * columns.length;
        placeholders.push(`(${columns.map((_, cIdx) => `$${base + cIdx + 1}`).join(', ')})`);
        const normalizedMthRoomId = toCourseOfferingRoomIdText(row.mth_room_id, roomLookup);
        const normalizedTfsRoomId = toCourseOfferingRoomIdText(row.tfs_room_id, roomLookup);
        values.push(
          row.curr_id,
          row.code,
          row.course_no,
          row.department_id,
          row.section,
          row.descriptive_title,
          row.units,
          row.lec_hrs,
          row.lab_hrs,
          row.mth_schedule,
          normalizedMthRoomId,
          row.tfs_schedule,
          normalizedTfsRoomId,
          String(Boolean(row.merged)),
        );
      });

      await client.query(
        `INSERT INTO public.course_offerings (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
        values
      );

      // Write generated schedules back to subjects so faculty loading can read them.
      // Match by (code, course_no, department_id, section); join rooms to resolve room name.
      await client.query(`
        UPDATE public.subjects s
        SET
          mth_schedule = asch.mth_schedule,
          tfs_schedule = asch.tfs_schedule,
          mth_room     = COALESCE(rm.room_name, asch.mth_room_id),
          tfs_room     = COALESCE(rf.room_name, asch.tfs_room_id)
        FROM public.automatic_scheduler asch
        LEFT JOIN public.rooms rm ON rm.room_id::text = asch.mth_room_id
        LEFT JOIN public.rooms rf ON rf.room_id::text = asch.tfs_room_id
        WHERE lower(trim(s.subject_code))     = lower(trim(asch.code))
          AND lower(trim(s.subject_course_no)) = lower(trim(asch.course_no))
          AND s.department_id                  = asch.department_id
          AND lower(trim(s.subject_section))   = lower(trim(asch.section))
      `);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return {
    updated: rows.length,
    backup_export: backupFirst ? backup || [] : null,
    backup_created: Boolean(backupFirst),
  };
}

export async function getAutomaticSchedulerPreFlight(_req, res) {
  try {
    const snapshot = await fetchSnapshot();
    const preflight = buildAutomaticSchedulerPreflight(snapshot);
    return res.json(preflight);
  } catch (error) {
    console.error('[ga][automatic] pre-flight failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

// ── optimizer_sched.py subprocess helpers ────────────────────────────────────

function spawnOptimizerSched(payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(OPTIMIZER_PYTHON, [OPTIMIZER_SCHED_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      reject(new Error(`optimizer_sched.py timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut) return;
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`optimizer_sched.py stdout not valid JSON. stderr: ${stderr.slice(0, 500)}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn optimizer_sched.py: ${err.message}`));
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function toOptimizerSubject(subject, roomLookup) {
  const lec = toNumber(subject.subject_lec_hrs) || 0;
  const lab = toNumber(subject.subject_lab_hrs) || 0;
  const explicitUnits = toNumber(subject.subject_units);
  const units = explicitUnits !== null ? explicitUnits : (lec + lab);
  const mthRoom = resolveAllRoomIds(subject.mth_room, roomLookup).join('/') || null;
  const tfsRoom = resolveAllRoomIds(subject.tfs_room, roomLookup).join('/') || null;
  return {
    subject_id: toNumber(subject.subject_id),
    curr_id: toNumber(subject.curr_id),
    code: normalizeText(subject.subject_code) || null,
    course_no: normalizeText(subject.subject_course_no) || null,
    department_id: normalizeText(subject.department_id) || '0',
    section: normalizeText(subject.subject_section) || null,
    descriptive_title: normalizeText(subject.subject_descriptive_title) || null,
    units,
    lec_hrs: lec,
    lab_hrs: lab,
    mth_schedule: normalizeText(subject.mth_schedule) || null,
    mth_room: mthRoom,
    tfs_schedule: normalizeText(subject.tfs_schedule) || null,
    tfs_room: tfsRoom,
    is_general: Boolean(subject.is_general),
    merged_with: normalizeText(subject.merged_with) || null,
  };
}

function subjectToOutputRow(s, roomLookup) {
  const mthRoomName = resolveRoomNamesFromIdText(s.mth_room || null, roomLookup);
  const tfsRoomName = resolveRoomNamesFromIdText(s.tfs_room || null, roomLookup);
  return {
    source_subject_id: s.subject_id ?? s.curr_id,
    curr_id: s.curr_id,
    code: s.code,
    course_no: s.course_no,
    department_id: toNumber(s.department_id),
    section: s.section,
    descriptive_title: s.descriptive_title,
    units: s.units,
    lec_hrs: s.lec_hrs,
    lab_hrs: s.lab_hrs,
    mth_schedule: s.mth_schedule || null,
    mth_room_id: s.mth_room || null,
    mth_room_name: mthRoomName || null,
    tfs_schedule: s.tfs_schedule || null,
    tfs_room_id: s.tfs_room || null,
    tfs_room_name: tfsRoomName || null,
    merged: s.merged_with ? 'preserved' : 'false',
    preflight_tag: ({
      'Original':      'original',
      'Generated':     'generated',
      'Rescheduled':   'rescheduled',
      'Manual Review': 'manual_review',
      'Saturday':      'saturday',
    })[s.tag] ?? null,
  };
}

export async function postRunAutomaticScheduler(req, res) {
  try {
    const dryRun = String(req.query.dry_run || req.body?.dry_run || 'false').toLowerCase() === 'true';
    const snapshot = await fetchSnapshot();
    const preflight = buildAutomaticSchedulerPreflight(snapshot);

    const totalToProcess =
      preflight.assignable_count +
      (preflight.excluded_merged_subjects || []).length +
      (preflight.excluded_unique_subjects || []).length;

    if (totalToProcess === 0) {
      return res.status(400).json({
        ...preflight,
        error: 'No subjects available for automatic scheduling.',
      });
    }

    const activeRooms = (snapshot.rooms || []).filter((room) => isRoomActive(room));
    const roomLookup = buildRoomLookup(activeRooms);

    // --- Build preserved (merged + unique-clean) and GA-only subject lists ---
    const preservedSubjects = [
      ...(preflight.excluded_merged_subjects || []),
      ...(preflight.excluded_unique_subjects || []),
    ];
    const reservedSlots = buildReservedSlots(
      preflight.excluded_merged_subjects || [],
      preflight.excluded_unique_subjects || []
    );

    // --- Build GA constraint parameters from request body ---
    const nodeTimeoutMs = Math.max(env.gaRequestTimeoutMs || 180000, 120000);
    const globalBudgetS = Math.max(Math.floor(nodeTimeoutMs / 1000) - 30, 60);
    const normalizedConstraints = {
      population_size:        Number(req.body?.population_size        ?? 120),
      max_generations:        Number(req.body?.max_generations        ?? 250),
      mutation_rate:          Number(req.body?.mutation_rate          ?? 0.07),
      crossover_rate:         Number(req.body?.crossover_rate         ?? 0.85),
      max_runtime_seconds:    Number(req.body?.max_runtime_seconds    ?? 45),
      random_seed:            Number(req.body?.random_seed            ?? 42),
      global_budget_seconds:  Number(req.body?.global_budget_seconds  ?? globalBudgetS),
    };

    // ── OPTIMIZER_SCHED.PY PIPELINE ───────────────────────────────────────────
    const timeoutMs = Math.max(env.gaRequestTimeoutMs || 180000, 120000);

    const mergeGroupMap = new Map(
      (preflight.candidates || [])
        .filter((c) => c.merge_representative_id != null)
        .map((c) => [c.subject_id, c.merge_representative_id])
    );
    const optimizerSubjects = (snapshot.subjects || []).map((s) => ({
      ...toOptimizerSubject(s, roomLookup),
      merge_group_id: mergeGroupMap.get(Number(s.subject_id)) ?? null,
    }));
    const optimizerRooms = activeRooms.map((r) => ({
      room_id: String(r.room_id),
      room_name: r.room_name || '',
      room_type: r.room_type || 'LEC',
    }));

    const rawResult = await spawnOptimizerSched({
      subjects: optimizerSubjects,
      rooms: optimizerRooms,
      constraints: normalizedConstraints,
    }, timeoutMs);

    if (rawResult.status === 'error') {
      throw new Error(
        `Optimizer failed: ${rawResult.error_type}: ${rawResult.error_message}\n` +
        `Traceback:\n${rawResult.traceback}`
      );
    }
    if (rawResult.census && rawResult.census.input_count !== rawResult.census.output_count) {
      throw new Error(
        `Optimizer dropped subjects: ${rawResult.census.input_count} sent, ` +
        `${rawResult.census.output_count} returned. Run ID: ${rawResult.ga_run_id}`
      );
    }

    const allAssignments = (rawResult.rows || []).map((s) => subjectToOutputRow(s, roomLookup));

    const allUnresolved = (rawResult.rows || [])
      .filter((s) => s.tag === 'Manual Review' || s.tag === 'Unresolvable')
      .map((s) => ({
        ...s,
        reason: s.manual_review_reason || 'Manual assignment required.',
        reason_type: s.tag === 'Manual Review' ? 'manual_review' : 'unresolvable_conflict',
      }));

    console.log(
      `[run][automatic] total=${allAssignments.length}, ` +
      `pools=${rawResult.diagnostics?.pools_created ?? 0}, ` +
      `conflicts=${rawResult.diagnostics?.conflicts_detected ?? 0}, ` +
      `manual_review=${rawResult.diagnostics?.manual_review_count ?? 0}, ` +
      `dry_run=${dryRun}`
    );

    let persistence = { persisted: 0, dry_run: true };
    if (!dryRun) {
      persistence = await persistAutomaticScheduler(allAssignments);
      console.log(`[run][automatic] persisted=${persistence.persisted}`);
    }

    const humanReview = allUnresolved.filter((u) => u.reason_type === 'unresolvable_conflict');

    return res.json({
      status: 'completed',
      dry_run: dryRun,
      used_genetic_algorithm: true,
      fitness_overall: 0,
      fitness_hard: 0,
      fitness_soft: 0,
      generations: rawResult.stats?.generations_run ?? 0,
      runtime_ms: null,
      assignments: allAssignments,
      unresolved_issues: allUnresolved,
      human_review: humanReview,
      preflight,
      persistence,
      report: {
        generated_rows: allAssignments,
        unresolved_issues: allUnresolved,
        human_review: humanReview,
        ga_report: {
          run_id: rawResult.ga_run_id,
          census: rawResult.census,
          stats: rawResult.stats,
        },
      },
    });
  } catch (error) {
    console.error('[ga][automatic] run failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export async function getAutomaticSchedulerRows(_req, res) {
  try {
    const rows = await fetchAutomaticSchedulerRows();
    return res.json({
      count: rows.length,
      rows,
    });
  } catch (error) {
    console.error('[ga][automatic] rows fetch failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export async function exportAutomaticSchedulerRows(_req, res) {
  try {
    const rows = await buildAutomaticSchedulerExportRows();
    return res.json({
      exported_count: rows.length,
      rows,
    });
  } catch (error) {
    console.error('[ga][automatic] export failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export async function postAutomaticSchedulerUpdateCourseOffering(req, res) {
  try {
    const mode = normalizeUpper(req.body?.mode || '');
    const backupFirst = mode === 'BACKUP_THEN_UPDATE';
    const proceedNoBackup = mode === 'UPDATE_NO_BACKUP';

    if (!backupFirst && !proceedNoBackup) {
      return res.status(400).json({
        error: 'Invalid mode. Use BACKUP_THEN_UPDATE or UPDATE_NO_BACKUP.',
      });
    }

    const result = await updateCourseOfferingFromAutomaticScheduler({ backupFirst });
    return res.json({
      status: 'updated',
      ...result,
      mode,
    });
  } catch (error) {
    console.error('[ga][automatic] update course offering failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export async function runFacultyLoadingBackfill() {
  return runFacultyLoadingWorkflow({ dryRun: false });
}
