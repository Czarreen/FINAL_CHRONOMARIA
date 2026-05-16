import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query, withPgClient } from '../lib/postgres.js';

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
    if (part === 'TFS') {
      days.add('TUE');
      days.add('FRI');
      days.add('SAT');
      continue;
    }
    if (part.includes('SAT')) days.add('SAT');
    if (part.includes('MON')) days.add('MON');
    if (part.includes('TH')) days.add('THU');
    if (part.includes('TUE')) days.add('TUE');
    if (part.includes('FRI')) days.add('FRI');
  }

  if (days.size === 0) {
    if (group === 'MTH') {
      days.add('MON');
      days.add('THU');
    } else if (group === 'TFS') {
      days.add('TUE');
      days.add('FRI');
      days.add('SAT');
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
    const assignedFaculty = assignment?.faculty || null;

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
      load_status: assignment ? 'loaded' : isGeneral ? 'general' : problematic ? 'needs_attention' : 'unassigned',
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
        problem: 'TFS schedule is missing a resolvable room',
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

  // CS and IT department IDs for fallback logic
  const CS_DEPT = 11;
  const IT_DEPT = 7;

  // Calculate unit needs for each department
  const deptUnitNeeds = new Map();
  for (const departmentId of departmentsWithOfferings) {
    const unitNeeds = calculateDepartmentUnitNeeds(departmentId, assignableOfferings);
    deptUnitNeeds.set(departmentId, unitNeeds);
  }

  // Process departments for cross-reference issues with CS/IT fallback logic
  const processedDepartments = new Set();
  for (const departmentId of departmentsWithOfferings) {
    if (processedDepartments.has(departmentId)) continue;

    const unitNeeds = deptUnitNeeds.get(departmentId) || 0;
    const hasSufficient = hasSufficientFaculty(departmentId, activeFacultyByDepartment, unitNeeds);
    const hasActiveFaculty = (activeFacultyByDepartment.get(departmentId) || []).length > 0;

    // Check if this is CS or IT
    const isCSorIT = departmentId === CS_DEPT || departmentId === IT_DEPT;
    const otherDeptId = departmentId === CS_DEPT ? IT_DEPT : CS_DEPT;
    const otherHasOfferings = departmentsWithOfferings.has(otherDeptId);

    if (isCSorIT && otherHasOfferings) {
      // Both CS and IT have offerings - use OR logic (bidirectional fallback)
      const otherUnitNeeds = deptUnitNeeds.get(otherDeptId) || 0;
      const otherHasSufficient = hasSufficientFaculty(otherDeptId, activeFacultyByDepartment, otherUnitNeeds);

      // Only flag error if BOTH departments are insufficient
      if (!hasSufficient && !otherHasSufficient) {
        issues.push({
          type: 'cross_reference',
          id: departmentId,
          severity: 'high',
          problem: `${describeDepartment(departmentId, departmentLookup)} has course offerings but insufficient faculty (no fallback available)`,
          entity_label: describeDepartment(departmentId, departmentLookup),
        });
      }

      // Mark both as processed to avoid duplicate checks
      processedDepartments.add(departmentId);
      processedDepartments.add(otherDeptId);
    } else {
      // Single department or non-CS/IT departments - regular check
      if (!hasActiveFaculty) {
        issues.push({
          type: 'cross_reference',
          id: departmentId,
          severity: 'high',
          problem: `${describeDepartment(departmentId, departmentLookup)} has course offerings but no active faculty`,
          entity_label: describeDepartment(departmentId, departmentLookup),
        });
      }
      processedDepartments.add(departmentId);
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
      select facloading_id, curr_id, faculty_id, code, course_no, department_id, section, descriptive_title, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id, merged
      from public.faculty_loading
      order by facloading_id asc
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
  const preflightProblematic = preFlight.problematic_offerings || [];
  
  // Filter to non-general offerings from assignable list
  const validOfferings = preflightAssignable.filter((o) => !Boolean(o.is_general));

  // If no valid offerings, still throw error
  if (validOfferings.length === 0 && preflightAssignable.length === 0) {
    const error = new Error('No assignable offerings available for GA execution');
    error.statusCode = 400;
    error.preFlight = preFlight;
    throw error;
  }

  const normalizedConstraints = {
    population_size: Number(constraints.population_size || 72),
    max_generations: Number(constraints.max_generations || 120),
    mutation_rate: Number(constraints.mutation_rate || 0.12),
    max_runtime_seconds: Number(constraints.max_runtime_seconds || 20),
    random_seed: Number.isFinite(Number(constraints.random_seed)) ? Number(constraints.random_seed) : 123,
    dry_run: Boolean(dryRun || constraints.dry_run),
  };

  // Use validOfferings from preflight categorization
  const assignableOfferings = validOfferings;

  const runId = buildRunId(subjectDrivenSnapshot, normalizedConstraints);
  const payload = {
    faculty: snapshot.faculty,
    offerings: assignableOfferings,
    rooms: snapshot.rooms,
    subjects: snapshot.subjects,
    faculty_loading: snapshot.faculty_loading || [],
    constraints: normalizedConstraints,
    run_id: runId,
  };

  const optimizerResult = await callPythonOptimizer(payload);
  const mergedResult = {
    ...optimizerResult,
    run_id: optimizerResult.run_id || runId,
    preflight: preFlight,
  };

  if (!dryRun) {
    mergedResult.persistence = await persistFacultyLoading(optimizerResult.assignments || [], subjectDrivenSnapshot);
  } else {
    mergedResult.persistence = { persisted: 0, dry_run: true };
  }

  const generatedRows = buildFacultyLoadingDisplayRows(subjectDrivenSnapshot, optimizerResult.assignments || [], preFlight);
  mergedResult.report = {
    ...(mergedResult.report || {}),
    generated_rows: generatedRows,
    assignable_offerings: preFlight.assignable_offerings || [],
    problematic_offerings: preFlight.problematic_offerings || [],
    general_offerings: preFlight.general_offerings || [],
  };

  return mergedResult;
}

export async function getGaPreFlight(_req, res) {
  try {
    const snapshot = await fetchSnapshot();
    const subjectDrivenOfferings = mapSubjectsToGaOfferings(snapshot.subjects, snapshot.offerings);
    const subjectDrivenSnapshot = { ...snapshot, offerings: subjectDrivenOfferings };
    return res.json(buildPreflight(subjectDrivenSnapshot));
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
      return res.status(400).json(error.preFlight);
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
           a.merged, d.department_name
    from public.automatic_scheduler a
    left join public.departments d on d.department_id = a.department_id
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
    existing_tfs_room_id: resolveRoomReference(subject.tfs_room, roomLookup).roomId,
    // infer preferred pattern from existing schedules when available
    preferred_pattern: (() => {
      const hasMth = Boolean(normalizeText(subject.mth_schedule));
      const hasTfs = Boolean(normalizeText(subject.tfs_schedule));
      if (hasMth && !hasTfs) return 'MTH';
      if (hasTfs && !hasMth) return 'TFS';
      return null;
    })(),
  };
}

function buildAutomaticSchedulerPreflight(snapshot) {
  const departmentLookup = buildDepartmentLookup(snapshot.departments);
  const roomLookup = buildRoomLookup(snapshot.rooms);
  const issues = [];

  const activeRooms = (snapshot.rooms || []).filter((room) => isRoomActive(room));
  const inactiveRooms = (snapshot.rooms || []).filter((room) => !isRoomActive(room));

  const candidates = (snapshot.subjects || []).map((subject) => toAutomaticCandidateFromSubject(subject, roomLookup));

  const generalSubjects = candidates.filter((row) => row.is_general);
  const mergedSubjects = candidates.filter((row) => row.merged);
  const excluded = new Set([
    ...generalSubjects.map((row) => row.subject_id),
    ...mergedSubjects.map((row) => row.subject_id),
  ]);

  const assignable = candidates.filter((row) => !excluded.has(row.subject_id));

  for (const room of inactiveRooms) {
    issues.push({
      type: 'room',
      severity: 'medium',
      id: room.room_id,
      problem: `Room ${normalizeText(room.room_name) || room.room_id} is inactive and excluded from automation.`,
      entity_label: describeRoom(room),
    });
  }

  for (const row of assignable) {
    // Missing identity fields and zero-hours are important but non-blocking.
    // Per PRE-1 the GA should attempt to include and fix subjects with missing fields
    // (only merged subjects are excluded). Mark these as 'medium' so the preflight
    // reports them but does not block the run.
    if (!row.code || !row.course_no || !row.department_id || !row.section || !row.descriptive_title) {
      issues.push({
        type: 'subject',
        severity: 'medium',
        id: row.subject_id,
        problem: 'Missing required subject identity fields.',
        entity_label: `${row.code || '-'} ${row.course_no || '-'} ${row.section || '-'}`.trim(),
        department_name: describeDepartment(row.department_id, departmentLookup),
      });
    }
    if ((row.total_hrs || 0) <= 0) {
      issues.push({
        type: 'subject',
        severity: 'medium',
        id: row.subject_id,
        problem: 'subject_lec_hrs + subject_lab_hrs must be greater than 0.',
        entity_label: `${row.code || '-'} ${row.course_no || '-'} ${row.section || '-'}`.trim(),
        department_name: describeDepartment(row.department_id, departmentLookup),
      });
    }
  }

  // Determine status: only treat true blocking high-severity issues as 'blocked'.
  // Any reported issues (medium or high) should mark the preflight as 'partial'
  // to indicate the GA can still run and will attempt fixes.
  const hasHigh = issues.some((i) => i.severity === 'high');
  const hasAny = issues.length > 0;
  const status = hasHigh && assignable.length === 0 ? 'blocked' : hasAny ? 'partial' : 'ok';

  return {
    status,
    room_count: snapshot.rooms.length,
    active_room_count: activeRooms.length,
    subject_count: snapshot.subjects.length,
    assignable_count: assignable.length,
    excluded_general_count: generalSubjects.length,
    excluded_merged_count: mergedSubjects.length,
    issues,
    assignable_subjects: assignable,
    excluded_general_subjects: generalSubjects,
    excluded_merged_subjects: mergedSubjects,
    suggested_next_step:
      status === 'blocked'
        ? 'Resolve high-severity data issues before running automatic scheduler.'
        : 'Automatic scheduler can run. Excluded general/merged subjects remain user-managed.',
  };
}

function formatTimeFromMinutes(totalMinutes) {
  const hh24 = Math.floor(totalMinutes / 60);
  const mm = String(totalMinutes % 60).padStart(2, '0');
  const suffix = hh24 >= 12 ? 'PM' : 'AM';
  let hh12 = hh24 % 12;
  if (hh12 === 0) hh12 = 12;
  return `${hh12}:${mm} ${suffix}`;
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

function buildAutomaticAssignments(assignableSubjects, activeRooms) {
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
      scheduleText: `${pattern} ${buildScheduleLabel(daySlots[0].start, daySlots[0].end)}`,
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
    return sum % 2 === 0 ? 'MTH' : 'TFS';
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
        merged: false,
        source_subject_id: subject.subject_id,
      };

      if (hasMthAssignment) {
        out.mth_schedule = subject.existing_mth_schedule;
        out.mth_room_id = String(subject.existing_mth_room_id);
        out.tfs_schedule = null;
        out.tfs_room_id = null;
      } else if (hasTfsAssignment) {
        out.tfs_schedule = subject.existing_tfs_schedule;
        out.tfs_room_id = String(subject.existing_tfs_room_id);
        out.mth_schedule = null;
        out.mth_room_id = null;
      }

      assignments.push(out);
      continue;
    }

    // Otherwise, try to allocate a new slot
    const pattern = subject.preferred_pattern || choosePatternForSection(subject.section);
    const alloc = allocatePattern(subject, pattern);

    if (!alloc.ok) {
      unresolved.push({
        subject_id: subject.subject_id,
        code: subject.code,
        course_no: subject.course_no,
        section: subject.section,
        descriptive_title: subject.descriptive_title,
        reasons: [alloc.reason].filter(Boolean),
        suggestions: {
          room_conflict: 'Show available rooms or indicate no available rooms (need to add more rooms).',
          time_conflict: 'Show available time slots and possible adjustments.',
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
      merged: false,
      source_subject_id: subject.subject_id,
    };

    if (alloc && alloc.scheduleText && pattern === 'MTH') {
      out.mth_schedule = alloc.scheduleText;
      out.mth_room_id = String(alloc.roomId);
      out.tfs_schedule = null;
      out.tfs_room_id = null;
    } else if (alloc && alloc.scheduleText && pattern === 'TFS') {
      out.tfs_schedule = alloc.scheduleText;
      out.tfs_room_id = String(alloc.roomId);
      out.mth_schedule = null;
      out.mth_room_id = null;
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
          row.mth_room_id,
          row.tfs_schedule,
          row.tfs_room_id,
          String(Boolean(row.merged)),
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

async function buildAutomaticSchedulerExportRows() {
  const rows = await fetchAutomaticSchedulerRows();
  return rows.map((row) => ({
    id: row.id,
    curr_id: row.curr_id,
    code: row.code,
    course_no: row.course_no,
    department_id: row.department_id,
    section: row.section,
    descriptive_title: row.descriptive_title,
    units: row.units,
    lec_hrs: row.lec_hrs,
    lab_hrs: row.lab_hrs,
    mth_schedule: row.mth_schedule,
    mth_room_id: row.mth_room_id,
    tfs_schedule: row.tfs_schedule,
    tfs_room_id: row.tfs_room_id,
    merged: row.merged,
  }));
}

async function updateCourseOfferingFromAutomaticScheduler({ backupFirst = false }) {
  const rows = await buildAutomaticSchedulerExportRows();
  if (rows.length === 0) {
    return { updated: 0, backup: null };
  }

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
          row.mth_room_id,
          row.tfs_schedule,
          row.tfs_room_id,
          String(Boolean(row.merged)),
        );
      });

      await client.query(
        `INSERT INTO public.course_offerings (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
        values
      );

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

export async function postRunAutomaticScheduler(req, res) {
  try {
    const dryRun = String(req.query.dry_run || req.body?.dry_run || 'false').toLowerCase() === 'true';
    const snapshot = await fetchSnapshot();
    const preflight = buildAutomaticSchedulerPreflight(snapshot);

    if (preflight.assignable_count === 0) {
      return res.status(400).json({
        ...preflight,
        error: 'No assignable subjects available for automatic scheduling.',
      });
    }

    const activeRooms = (snapshot.rooms || []).filter((room) => isRoomActive(room));
    const result = buildAutomaticAssignments(preflight.assignable_subjects, activeRooms);

    let persistence = { persisted: 0, dry_run: true };
    if (!dryRun) {
      persistence = await persistAutomaticScheduler(result.assignments);
    }

    return res.json({
      status: 'completed',
      dry_run: dryRun,
      fitness_overall: result.fitness_overall,
      fitness_hard: result.fitness_hard,
      fitness_soft: result.fitness_soft,
      assignments: result.assignments,
      unresolved_issues: result.unresolved,
      preflight,
      persistence,
      report: {
        generated_rows: result.assignments,
        unresolved_issues: result.unresolved,
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
