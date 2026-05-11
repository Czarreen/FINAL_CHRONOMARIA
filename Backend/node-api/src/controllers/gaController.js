import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query, withPgClient } from '../lib/postgres.js';

const REQUIRED_FACULTY_FIELDS = ['faculty_name', 'department_id', 'faculty_max_units', 'faculty_role', 'faculty_status'];
const REQUIRED_OFFERING_FIELDS = ['curr_id', 'code', 'course_no', 'department_id', 'section', 'descriptive_title', 'units', 'lec_hrs'];
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

function buildPreflight(snapshot) {
  const issues = [];
  const roomLookup = buildRoomLookup(snapshot.rooms);
  const roomReservations = new Map();
  const activeFacultyByDepartment = new Map();

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

  for (const offering of snapshot.offerings) {
    const missing = REQUIRED_OFFERING_FIELDS.filter((field) => isEmptyValue(offering[field]));
    if (missing.length > 0) {
      for (const field of missing) {
        issues.push({
          type: 'course_offering',
          id: offering.id,
          field,
          severity: 'high',
          problem: `Missing ${field.replace(/_/g, ' ')}`,
        });
      }
    }

    const hasMthSchedule = !isEmptyValue(offering.mth_schedule);
    const hasTfsSchedule = !isEmptyValue(offering.tfs_schedule);
    const mthRoom = resolveRoomReference(offering.mth_room_id, roomLookup);
    const tfsRoom = resolveRoomReference(offering.tfs_room_id, roomLookup);

    if (hasMthSchedule && !mthRoom.roomId) {
      issues.push({
        type: 'course_offering',
        id: offering.id,
        field: 'mth_room_id',
        severity: 'high',
        problem: 'MTH schedule is missing a resolvable room',
      });
    }

    if (hasTfsSchedule && !tfsRoom.roomId) {
      issues.push({
        type: 'course_offering',
        id: offering.id,
        field: 'tfs_room_id',
        severity: 'high',
        problem: 'TFS schedule is missing a resolvable room',
      });
    }

    if (!hasMthSchedule && !hasTfsSchedule) {
      issues.push({
        type: 'course_offering',
        id: offering.id,
        field: 'schedule',
        severity: 'high',
        problem: 'Course offering has no schedule assigned',
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
        entries.push({ offeringId: offering.id, start: block.start, end: block.end });
        roomReservations.set(roomKey, entries);
      }
    }
  }

  const departmentsWithOfferings = new Set(
    snapshot.offerings
      .map((offering) => toNumber(offering.department_id))
      .filter((departmentId) => departmentId !== null)
  );

  for (const departmentId of departmentsWithOfferings) {
    if (!activeFacultyByDepartment.has(departmentId)) {
      issues.push({
        type: 'cross_reference',
        id: departmentId,
        severity: 'high',
        problem: `Department ${departmentId} has course offerings but no active faculty`,
      });
    }
  }

  for (const [roomKey, entries] of roomReservations.entries()) {
    const ordered = [...entries].sort((left, right) => left.start - right.start);
    for (let index = 1; index < ordered.length; index += 1) {
      if (overlaps(ordered[index - 1], ordered[index])) {
        issues.push({
          type: 'room_conflict',
          id: roomKey,
          severity: 'high',
          problem: `Room conflict detected for ${roomKey}`,
        });
      }
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
      ? 'Resolve the listed issues in Faculty, Course Offerings, or Rooms before running GA.'
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
             s.subject_status, s.mth_schedule, s.tfs_schedule, s.mth_room, s.tfs_room,
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
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { persisted: 0 };
  }

  const rows = assignments.map((assignment, index) => {
    const offering = assignment.offering;
    const mthRoom = resolveRoomReference(offering.mth_room_id, buildRoomLookup(snapshot.rooms));
    const tfsRoom = resolveRoomReference(offering.tfs_room_id, buildRoomLookup(snapshot.rooms));

    return {
      facloading_id: index + 1,
      curr_id: toNumber(offering.curr_id),
      faculty_id: toNumber(assignment.faculty.faculty_id),
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
  const preFlight = buildPreflight(snapshot);

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

  const runId = buildRunId(snapshot, normalizedConstraints);
  const payload = {
    faculty: snapshot.faculty,
    offerings: snapshot.offerings,
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
    mergedResult.persistence = await persistFacultyLoading(optimizerResult.assignments || [], snapshot);
  } else {
    mergedResult.persistence = { persisted: 0, dry_run: true };
  }

  return mergedResult;
}

export async function getGaPreFlight(_req, res) {
  try {
    const snapshot = await fetchSnapshot();
    return res.json(buildPreflight(snapshot));
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
