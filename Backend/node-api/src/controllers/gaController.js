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

function mapSubjectsToGaOfferings(subjects) {
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
      merged: rows.length > 1,
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
  const roomLookup = buildRoomLookup(snapshot.rooms);
  const roomReservations = new Map();
  const activeFacultyByDepartment = new Map();
  const allOfferings = Array.isArray(snapshot.offerings) ? snapshot.offerings : [];
  const assignableOfferings = allOfferings.filter((offering) => !Boolean(offering.is_general));

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
        });
      }
    }
  }

  for (const offering of allOfferings) {
    const missing = REQUIRED_OFFERING_FIELDS.filter((field) => isEmptyValue(offering[field]));
    if (missing.length > 0) {
      for (const field of missing) {
        issues.push({
          type: 'subject',
          id: offering.id,
          field,
          severity: ['department_id', 'units', 'lec_hrs', 'descriptive_title'].includes(field) ? 'high' : 'medium',
          problem: `Missing ${field.replace(/_/g, ' ')} in subject-derived workload`,
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
      });
    }

    if (hasTfsSchedule && !tfsRoom.roomId) {
      issues.push({
        type: 'subject',
        id: offering.id,
        field: 'tfs_room_id',
        severity: 'high',
        problem: 'TFS schedule is missing a resolvable room',
      });
    }

    if (!hasMthSchedule && !hasTfsSchedule) {
      issues.push({
        type: 'subject',
        id: offering.id,
        field: 'schedule',
        severity: 'high',
        problem: 'Subject has no schedule assigned',
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
          offeringDeptName: offering.department_name || offering.department_id || null,
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
          problem: `Department ${departmentId} has course offerings but insufficient faculty (no fallback available)`,
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
          problem: `Department ${departmentId} has course offerings but no active faculty`,
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
        problem: `Room conflict detected for ${roomKey}${details}`,
      });
    }
  }

  return {
    status: issues.some((issue) => issue.severity === 'high') ? 'blocked' : 'ok',
    faculty_count: snapshot.faculty.length,
    offering_count: snapshot.offerings.length,
    room_count: snapshot.rooms.length,
    subject_count: snapshot.subjects.length,
    issues,
    suggested_next_step: issues.some((issue) => issue.severity === 'high')
      ? 'Resolve the listed issues in Faculty, Subjects, or Rooms before running GA.'
      : 'Data is ready for GA execution.',
  };
}

async function fetchSnapshot() {
  const [facultyResp, offeringResp, roomResp, subjectResp] = await Promise.all([
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
  ]);

  return {
    faculty: facultyResp.rows,
    offerings: offeringResp.rows,
    rooms: roomResp.rows,
    subjects: subjectResp.rows,
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
  const subjectDrivenOfferings = mapSubjectsToGaOfferings(snapshot.subjects);
  const subjectDrivenSnapshot = { ...snapshot, offerings: subjectDrivenOfferings };
  const preFlight = buildPreflight(subjectDrivenSnapshot);

  if (preFlight.status === 'blocked') {
    const error = new Error('Data quality issues prevent GA execution');
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

  const assignableOfferings = subjectDrivenOfferings.filter((offering) => !Boolean(offering.is_general));

  const runId = buildRunId(subjectDrivenSnapshot, normalizedConstraints);
  const payload = {
    faculty: snapshot.faculty,
    offerings: assignableOfferings,
    rooms: snapshot.rooms,
    subjects: snapshot.subjects,
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

  return mergedResult;
}

export async function getGaPreFlight(_req, res) {
  try {
    const snapshot = await fetchSnapshot();
    const subjectDrivenOfferings = mapSubjectsToGaOfferings(snapshot.subjects);
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

export async function runFacultyLoadingBackfill() {
  return runFacultyLoadingWorkflow({ dryRun: false });
}
