import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { recordAuditLog } from '../lib/auditLogger.js';

const router = Router();
const COURSE_OFFERING_AUDIT_MODULE = 'course_offerings';

const HEADER_TO_FIELD = {
  currid: 'curr_id',
  curriculumid: 'curr_id',
  code: 'code',
  courseno: 'course_no',
  course: 'course_no',
  dept: 'department_code',
  department: 'department_code',
  departmentcode: 'department_code',
  departmentid: 'department_id',
  section: 'section',
  descriptivetitle: 'descriptive_title',
  title: 'descriptive_title',
  units: 'units',
  lechrs: 'lec_hrs',
  lecturehrs: 'lec_hrs',
  labhrs: 'lab_hrs',
  mthschedule: 'mth_schedule',
  mthroomid: 'mth_room_id',
  mthroom: 'mth_room_id',
  tfsschedule: 'tfs_schedule',
  tfsroomid: 'tfs_room_id',
  tfsroom: 'tfs_room_id',
  departmentname: 'department_code',
  merged: 'merged',
};

const REQUIRED_FIELDS = ['curr_id', 'course_no', 'section'];

function formatOfferingAuditLabel(offering = {}) {
  const code = normalizeCell(offering.code);
  const courseNo = normalizeCell(offering.course_no);
  const section = normalizeCell(offering.section);
  const label = [code, courseNo, section ? `Section ${section}` : null].filter(Boolean).join(' - ');
  return label || `#${offering.id}`;
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeCell(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'null' || lowered === 'n/a' || lowered === 'na' || lowered === '-') return null;
  return trimmed;
}

function parseNumber(value, field) {
  const normalized = normalizeCell(value);
  if (normalized === null) return { value: null };
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return { error: `Invalid number for ${field}: "${value}"` };
  }
  return { value: parsed };
}

function parseBoolean(value, field) {
  const normalized = normalizeCell(value);
  if (normalized === null) return { value: null };

  const lowered = normalized.toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(lowered)) return { value: true };
  if (['false', '0', 'no', 'n'].includes(lowered)) return { value: false };

  return { error: `Invalid boolean for ${field}: "${value}"` };
}

function parseDate(value, field) {
  const normalized = normalizeCell(value);
  if (normalized === null) return { value: null };

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `Invalid date for ${field}: "${value}"` };
  }

  return { value: parsed.toISOString().slice(0, 10) };
}

function parseCsv(csvText) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') {
        i += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function buildHeaderMapping(headerRow) {
  const mapped = [];
  let roomIndex = 0;
  for (let index = 0; index < headerRow.length; index += 1) {
    const raw = headerRow[index];
    const normalized = normalizeHeader(raw);
    let targetField = HEADER_TO_FIELD[normalized] || null;

    if (!targetField && normalized === 'room') {
      roomIndex += 1;
      targetField = roomIndex === 1 ? 'mth_room_id' : roomIndex === 2 ? 'tfs_room_id' : null;
    }

    mapped.push({ index, raw, normalized, targetField });
  }
  return mapped;
}

function isHeaderRowCandidate(candidateRow) {
  const normals = (candidateRow || []).map((c) => normalizeHeader(c));
  return normals.includes('currid') && normals.includes('courseno') && normals.includes('section');
}

function deriveDepartmentCodeCandidates(row) {
  const candidates = new Set();

  const push = (value) => {
    const normalized = normalizeCell(value);
    if (normalized) candidates.add(normalized.toUpperCase());
  };

  push(row.dept_code);
  push(row.department_code);
  push(row.department_program);
  push(row.department_name);

  if (row.department_name) {
    const words = String(row.department_name).split(/\s+/).filter(Boolean);

    const initials = words.map((word) => word[0]).join('').toUpperCase();
    push(initials);

    // Filtered initials without conjunctions/prepositions — fixes e.g. "Library and Information Science" → "LIS"
    const SKIP_WORDS = new Set(['AND', 'OF', 'THE', 'FOR', 'IN', 'AT', 'TO']);
    const filteredInitials = words
      .filter((word) => !SKIP_WORDS.has(word.toUpperCase()))
      .map((word) => word[0])
      .join('')
      .toUpperCase();
    if (filteredInitials !== initials) push(filteredInitials);
  }

  return candidates;
}

function normalizeLookupKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function getFirstMeaningfulCell(rowCells) {
  for (const cell of rowCells || []) {
    const normalized = normalizeCell(cell);
    if (normalized !== null) return normalized;
  }
  return null;
}

function shouldSkipNonDataRow(rowCells) {
  const firstValue = normalizeLookupKey(getFirstMeaningfulCell(rowCells) || '');
  if (!firstValue) return true;

  const skipMarkers = new Set([
    'TOTAL',
    'SUBMITTEDBY',
    'PREPAREDBY',
    'CHECKEDBY',
    'NOTEDBY',
    'APPROVEDBY',
    'SUBMITTEDBY:',
    'PREPAREDBY:',
    'CHECKEDBY:',
    'NOTEDBY:',
    'APPROVEDBY:',
  ]);

  if (skipMarkers.has(firstValue)) return true;

  return /SUBMITTED BY:|PREPARED BY:|CHECKED BY:|NOTED BY:|APPROVED BY:/i.test(
    rowCells.join(' ')
  );
}

const DEPARTMENT_CODE_HINTS = {
  AR: ['ARCHITECTURE', 'ARCHITECTURAL'],
  CE: ['CIVIL ENGINEERING', 'CIVIL'],
  IT: ['INFORMATION TECHNOLOGY', 'INFO TECH'],
  CS: ['COMPUTER SCIENCE'],
  CPE: ['COMPUTER ENGINEERING', 'COMPUTER ENGINEER'],
  ECE: [
    'ELECTRONICS ENGINEERING',
    'ELECTRONICS AND COMMUNICATIONS',
    'ELECTRONICS AND COMMUNICATION',
    'ELECTRICAL COMMUNICATIONS ENGINEERING',
    'ELECTRICAL COMMUNICATIONS',
    'COMMUNICATIONS ENGINEERING',
    'COMMUNICATION ENGINEERING',
    'ELECTRONICS',
  ],
  EE: ['ELECTRICAL ENGINEERING', 'ELECTRICAL'],
  LIS: ['LIBRARY AND INFORMATION SCIENCE', 'LIBRARY INFORMATION SCIENCE', 'LIBRARY INFORMATION', 'LIBRARY', 'INFORMATION SCIENCE'],
};

const DEPARTMENT_CODE_DEFAULT_NAMES = {
  AR: 'Architecture',
  CE: 'Civil Engineering',
  IT: 'Information Technology',
  CS: 'Computer Science',
  CPE: 'Computer Engineering',
  ECE: 'Electronics Engineering',
  EE: 'Electrical Engineering',
  LIS: 'Library and Information Science',
};

function toUpperJoinedText(...values) {
  return values
    .map((value) => normalizeCell(value))
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}

async function fetchDepartmentLookup(options = {}) {
  const autoCreateCodes = options.autoCreateCodes instanceof Set ? options.autoCreateCodes : new Set();

  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('*');

  if (error) {
    throw new Error(`Failed to load departments: ${error.message}`);
  }

  const byId = new Map();
  const byCode = new Map();
  const bestHintByCode = new Map();

  for (const row of data ?? []) {
    byId.set(Number(row.department_id), row);
    for (const candidate of deriveDepartmentCodeCandidates(row)) {
      byCode.set(candidate, Number(row.department_id));
    }

    const rowText = toUpperJoinedText(
      row.department_name,
      row.department_program,
      row.dept_code,
      row.department_code
    );
    const nameText = toUpperJoinedText(row.department_name);
    const programText = toUpperJoinedText(row.department_program, row.dept_code, row.department_code);
    const rowId = Number(row.department_id);
    const nameLengthScore = Math.max(0, 30 - nameText.length);

    for (const [code, phrases] of Object.entries(DEPARTMENT_CODE_HINTS)) {
      const matchesCode = phrases.some((phrase) => rowText.includes(phrase));
      if (!matchesCode) continue;

      let score = 0;
      if (programText === code) score += 100;
      if (nameText === String(DEPARTMENT_CODE_DEFAULT_NAMES[code] || '').toUpperCase()) score += 80;
      if (nameText.includes(code)) score += 20;
      if (programText.includes(code)) score += 25;

      // Prefer specific department names over umbrella names.
      if (nameText.includes('SCHOOL OF')) score -= 25;
      score += nameLengthScore;

      const currentBest = bestHintByCode.get(code);
      if (!currentBest || score > currentBest.score) {
        bestHintByCode.set(code, { id: rowId, score });
      }
    }
  }

  for (const [code, best] of bestHintByCode.entries()) {
    byCode.set(code, best.id);
  }

  for (const code of autoCreateCodes) {
    if (byCode.has(code)) continue;

    const defaultName = DEPARTMENT_CODE_DEFAULT_NAMES[code];
    if (!defaultName) continue;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('departments')
      .insert({
        department_name: defaultName,
        department_program: code,
      })
      .select('department_id,department_name,department_program')
      .single();

    if (insertError || !inserted) {
      continue;
    }

    const insertedId = Number(inserted.department_id);
    byId.set(insertedId, inserted);
    byCode.set(code, insertedId);

    for (const candidate of deriveDepartmentCodeCandidates(inserted)) {
      byCode.set(candidate, insertedId);
    }
  }

  return { byId, byCode };
}

async function fetchRoomLookup() {
  const { data, error } = await supabaseAdmin
    .from('rooms')
    .select('room_id,room_name');

  if (error) {
    throw new Error(`Failed to load rooms: ${error.message}`);
  }

  const byId = new Map();
  const byName = new Map();

  for (const row of data ?? []) {
    const roomId = Number(row.room_id);
    const roomName = normalizeCell(row.room_name);
    if (!Number.isFinite(roomId) || !roomName) continue;

    byId.set(roomId, roomId);
    byName.set(normalizeLookupKey(roomName), roomId);
  }

  return { byId, byName };
}

// Short all-letters words that ARE valid room names despite having no digits.
// Everything else with no digit is treated as a department/label, not a room.
// SEAIT, AR, CE, IT, etc. are department codes — they are NOT in this list.
const KNOWN_DIGIT_FREE_ROOMS = new Set([
  'GYM', 'AVR', 'LAB', 'CHAPEL', 'LIBRARY', 'CANTEEN', 'CLINIC',
  'AUDITORIUM', 'THEATER', 'THEATRE', 'COURT', 'POOL', 'FIELD',
  'LOBBY', 'HALLWAY', 'ATRIUM',
]);

// A valid room identifier must pass ALL of the following:
//   1. Non-empty, at most 30 characters
//   2. Contains at least one alphanumeric character
//   3. Does NOT contain a colon  (e.g. "Submitted by:")
//   4. No more than 3 space-separated words  (blocks "OIC-Office of the Dean", full names)
//   5. Does NOT look like a dotted name abbreviation (e.g. "ENGR. S. MALLILLIN")
//   6. Contains at least one digit  OR  is in KNOWN_DIGIT_FREE_ROOMS
//      → blocks pure-letter acronyms like SEAIT, AR, CE, IT that are departments, not rooms
//
// Examples that pass:  D101, E-103, S110, AP101, AVR, Gym, Lab, Room 2B
// Examples that fail:  SEAIT, AR, ENGR. CARINA S. MALLILLIN, OIC-Office of the Dean, Submitted by:
function isValidRoomName(token) {
  if (!token || token.length > 30) return false;
  if (!/[A-Za-z0-9]/.test(token)) return false;
  if (token.includes(':')) return false;

  const words = token.trim().split(/\s+/);
  if (words.length > 3) return false;

  // Reject dotted name abbreviation patterns: >2 dot-segments where any segment is ≤2 chars
  const dotSegments = token.split('.');
  if (dotSegments.length > 2 && dotSegments.some((s) => s.trim().length <= 2)) return false;

  // Must contain a digit OR be a known digit-free room word
  if (!/\d/.test(token) && !KNOWN_DIGIT_FREE_ROOMS.has(token.trim().toUpperCase())) return false;

  return true;
}

// Extract individual room name tokens from a raw cell value.
// Splits on / and , — so "A101/A102" → ["A101", "A102"]
// Filters out tokens that do not look like real room identifiers.
function extractRoomTokens(rawValue) {
  const normalized = normalizeCell(rawValue);
  if (!normalized) return [];
  return normalized
    .split(/\s*[,/]\s*/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && isValidRoomName(t));
}

// Resolve a raw room cell to a slash-joined string of room IDs using the prebuilt lookup.
// All rooms are guaranteed to exist in roomLookup by the time this is called.
// Resolve a raw room cell value to a slash-joined string of room IDs.
// Tokens that are pure numbers are validated against byId (treated as room_id references).
// All other tokens are matched by name against byName.
// Any token that does not match an existing room produces a hard validation error.
function resolveRoomIds(roomValue, roomLookup) {
  const tokens = extractRoomTokens(roomValue);
  if (tokens.length === 0) return { roomIds: null, errors: [] };

  const roomIds = [];
  const errors = [];

  for (const token of tokens) {
    // Pure numeric token → treat as a direct room_id reference
    if (/^\d+$/.test(token)) {
      const numericId = Number(token);
      if (roomLookup.byId.has(numericId)) {
        roomIds.push(numericId);
      } else {
        errors.push(`Room ID ${numericId} does not exist in the rooms table.`);
      }
      continue;
    }

    // Text token → match by room name
    const lookupKey = normalizeLookupKey(token);
    const id = roomLookup.byName.get(lookupKey);
    if (id) {
      roomIds.push(id);
    } else {
      errors.push(`Room "${token}" was not found in the rooms table. Add it to the rooms list first.`);
    }
  }

  const uniqueRoomIds = [...new Set(roomIds)];
  return {
    roomIds: uniqueRoomIds.length > 0 ? uniqueRoomIds.join('/') : null,
    errors,
  };
}

// Load all existing rooms from the database and return a read-only lookup { byId, byName }.
// The rooms table is the source of truth and is never modified by the import.
// Room names from the CSV are matched against this lookup; unmatched names produce
// per-row validation errors in resolveRoomIds rather than creating new room records.
async function preloadRooms(_dataRows, _mapping) {
  return fetchRoomLookup();
}

function normalizeRoomFieldValue(value) {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeCell(item))
      .filter(Boolean);
    if (normalized.length === 0) return null;
    return normalized.join('/');
  }

  const normalized = normalizeCell(value);
  return normalized ?? null;
}

function parseNullableNumber(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInteger(value) {
  const parsed = parseNullableNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

const SUBJECT_SYNC_FIELD_MAP = [
  ['code', 'subject_code'],
  ['course_no', 'subject_course_no'],
  ['descriptive_title', 'subject_descriptive_title'],
  ['curr_id', 'curr_id'],
  ['section', 'subject_section'],
  ['units', 'subject_units'],
  ['lec_hrs', 'subject_lec_hrs'],
  ['lab_hrs', 'subject_lab_hrs'],
  ['mth_schedule', 'mth_schedule'],
  ['tfs_schedule', 'tfs_schedule'],
  ['mth_room_id', 'mth_room'],
  ['tfs_room_id', 'tfs_room'],
];

function buildCourseOfferingPayload(input = {}, existing = null) {
  const mergedFlag =
    input.merged !== undefined
      ? input.merged === true ||
        (typeof input.merged === 'string' &&
          input.merged.trim() !== '' &&
          input.merged.trim().toLowerCase() !== 'false')
      : existing?.merged === true;

  return {
    code: normalizeCell(input.code ?? existing?.code),
    course_no: normalizeCell(input.course_no ?? existing?.course_no),
    descriptive_title: normalizeCell(input.descriptive_title ?? existing?.descriptive_title),
    curr_id: parseNullableNumber(input.curr_id ?? existing?.curr_id),
    department_id: parseNullableNumber(input.department_id ?? existing?.department_id),
    section: normalizeCell(input.section ?? existing?.section),
    units: parseNullableNumber(input.units ?? existing?.units),
    lec_hrs: parseNullableNumber(input.lec_hrs ?? existing?.lec_hrs),
    lab_hrs: parseNullableNumber(input.lab_hrs ?? existing?.lab_hrs),
    mth_schedule: normalizeCell(input.mth_schedule ?? existing?.mth_schedule),
    mth_room_id: normalizeRoomFieldValue(input.mth_room_id ?? existing?.mth_room_id),
    tfs_schedule: normalizeCell(input.tfs_schedule ?? existing?.tfs_schedule),
    tfs_room_id: normalizeRoomFieldValue(input.tfs_room_id ?? existing?.tfs_room_id),
    merged: mergedFlag,
  };
}

function buildSubjectPayloadFromCourseOffering(courseOffering) {
  return {
    subject_code: normalizeCell(courseOffering?.code),
    subject_course_no: normalizeCell(courseOffering?.course_no),
    subject_descriptive_title: normalizeCell(courseOffering?.descriptive_title),
    curr_id: parseNullableNumber(courseOffering?.curr_id),
    department_id: courseOffering?.department_id ?? null,
    subject_section: normalizeCell(courseOffering?.section),
    subject_units: parseNullableNumber(courseOffering?.units),
    subject_lec_hrs: parseNullableNumber(courseOffering?.lec_hrs),
    subject_lab_hrs: parseNullableNumber(courseOffering?.lab_hrs),
    mth_schedule: normalizeCell(courseOffering?.mth_schedule),
    tfs_schedule: normalizeCell(courseOffering?.tfs_schedule),
    mth_room: normalizeCell(courseOffering?.mth_room_id),
    tfs_room: normalizeCell(courseOffering?.tfs_room_id),
  };
}

function buildSubjectSyncChecks(courseOffering, subjectPayload) {
  return SUBJECT_SYNC_FIELD_MAP.map(([courseField, subjectField]) => {
    const rawCourse = courseOffering?.[courseField];
    const normalizedCourse =
      courseField === 'units' || courseField === 'lec_hrs' || courseField === 'lab_hrs' || courseField === 'curr_id'
        ? parseNullableNumber(rawCourse)
        : normalizeCell(rawCourse);

    const normalizedSubject = subjectPayload?.[subjectField] ?? null;

    return {
      courseField,
      subjectField,
      courseValue: normalizedCourse,
      subjectValue: normalizedSubject,
      matches: normalizedCourse === normalizedSubject,
    };
  });
}

async function syncSubjectFromCourseOffering(courseOffering) {
  const subjectCode = normalizeCell(courseOffering?.code);
  if (!subjectCode) {
    return { action: 'skipped', reason: 'Missing course code.' };
  }

  const subjectSection = normalizeCell(courseOffering?.section);
  const departmentId = courseOffering?.department_id ?? null;

  const subjectPayload = buildSubjectPayloadFromCourseOffering(courseOffering);
  const syncChecks = buildSubjectSyncChecks(courseOffering, subjectPayload);

  let existingSubject = null;
  const lookupErrors = [];

  if (subjectSection && departmentId !== null && departmentId !== undefined) {
    const { data: exactRows, error: exactError } = await supabaseAdmin
      .from('subjects')
      .select('subject_id,subject_status,subject_code,subject_section,department_id')
      .eq('subject_code', subjectCode)
      .eq('subject_section', subjectSection)
      .eq('department_id', departmentId)
      .limit(1);

    if (!exactError && Array.isArray(exactRows) && exactRows.length > 0) {
      existingSubject = exactRows[0];
    } else if (exactError) {
      lookupErrors.push(`Exact lookup error: ${exactError.message}`);
    }
  }

  if (!existingSubject && subjectSection) {
    const { data: codeSectionRows, error: codeSectionError } = await supabaseAdmin
      .from('subjects')
      .select('subject_id,subject_status,subject_code,subject_section,department_id')
      .eq('subject_code', subjectCode)
      .eq('subject_section', subjectSection)
      .limit(1);

    if (!codeSectionError && Array.isArray(codeSectionRows) && codeSectionRows.length > 0) {
      existingSubject = codeSectionRows[0];
    } else if (codeSectionError) {
      lookupErrors.push(`Code+section lookup error: ${codeSectionError.message}`);
    }
  }

  if (!existingSubject && departmentId !== null && departmentId !== undefined) {
    const { data: codeDeptRows, error: codeDeptError } = await supabaseAdmin
      .from('subjects')
      .select('subject_id,subject_status,subject_code,subject_section,department_id')
      .eq('subject_code', subjectCode)
      .eq('department_id', departmentId)
      .limit(1);

    if (!codeDeptError && Array.isArray(codeDeptRows) && codeDeptRows.length > 0) {
      existingSubject = codeDeptRows[0];
    } else if (codeDeptError) {
      lookupErrors.push(`Code+department lookup error: ${codeDeptError.message}`);
    }
  }

  if (!existingSubject) {
    const { data: codeOnlyRows, error: codeOnlyError } = await supabaseAdmin
      .from('subjects')
      .select('subject_id,subject_status,subject_code,subject_section,department_id')
      .eq('subject_code', subjectCode)
      .limit(1);

    if (!codeOnlyError && Array.isArray(codeOnlyRows) && codeOnlyRows.length > 0) {
      existingSubject = codeOnlyRows[0];
    } else if (codeOnlyError) {
      lookupErrors.push(`Code-only lookup error: ${codeOnlyError.message}`);
    }
  }

  if (lookupErrors.length > 0 && !existingSubject) {
    throw new Error(`Subject lookup failed for ${subjectCode}: ${lookupErrors.join(' | ')}`);
  }

  if (existingSubject) {
    const { error: updateError } = await supabaseAdmin
      .from('subjects')
      .update({
        ...subjectPayload,
        subject_status: existingSubject.subject_status || 'active',
      })
      .eq('subject_id', existingSubject.subject_id);

    if (updateError) {
      throw new Error(`Subject sync update failed for ${subjectCode}: ${updateError.message}`);
    }

    return { action: 'updated', subject_id: existingSubject.subject_id, syncChecks };
  }

  const { data: insertedSubject, error: insertError } = await supabaseAdmin
    .from('subjects')
    .insert({
      ...subjectPayload,
      subject_status: 'active',
    })
    .select('subject_id')
    .single();

  if (insertError) {
    throw new Error(`Subject sync insert failed for ${subjectCode}: ${insertError.message}`);
  }

  return { action: 'inserted', subject_id: insertedSubject?.subject_id ?? null, syncChecks };
}

async function syncRoomsFromCourseOffering(courseOffering) {
  const roomValues = [
    normalizeCell(courseOffering?.mth_room_id),
    normalizeCell(courseOffering?.tfs_room_id),
  ].filter(Boolean);

  if (roomValues.length === 0) {
    return { action: 'skipped', reason: 'No room values.' };
  }

  const roomTokens = roomValues
    .flatMap((val) => val.split('/').map((t) => t.trim()))
    .filter(Boolean);

  const results = [];

  for (const token of roomTokens) {
    if (/^\d+$/.test(token)) {
      const roomId = Number(token);
      const { data: roomById, error: idLookupError } = await supabaseAdmin
        .from('rooms')
        .select('room_id,room_name')
        .eq('room_id', roomId)
        .limit(1);

      if (idLookupError) {
        throw new Error(`Room lookup by ID failed for "${token}": ${idLookupError.message}`);
      }

      if (roomById && roomById.length > 0) {
        results.push({ action: 'exists', room_id: roomId, room_name: roomById[0].room_name ?? null });
      } else {
        results.push({ action: 'skipped', reason: `Room ID ${roomId} not found.` });
      }
      continue;
    }

    const roomName = normalizeCell(token);
    if (!roomName) continue;

    const { data: existingRows, error: lookupError } = await supabaseAdmin
      .from('rooms')
      .select('room_id')
      .eq('room_name', roomName)
      .limit(1);

    if (lookupError) {
      throw new Error(`Room lookup failed for "${roomName}": ${lookupError.message}`);
    }

    if (existingRows && existingRows.length > 0) {
      results.push({ action: 'exists', room_id: existingRows[0].room_id, room_name: roomName });
      continue;
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('rooms')
      .insert({ room_name: roomName, room_status: 'available' })
      .select('room_id')
      .single();

    if (insertError) {
      throw new Error(`Room sync insert failed for "${roomName}": ${insertError.message}`);
    }

    results.push({ action: 'inserted', room_id: inserted?.room_id ?? null, room_name: roomName });
  }

  return { action: 'synced', results };
}

async function pruneOrphanRoomsFromCourseOffering(courseOffering) {
  const roomValues = [
    normalizeCell(courseOffering?.mth_room_id),
    normalizeCell(courseOffering?.tfs_room_id),
  ].filter(Boolean);

  if (roomValues.length === 0) {
    return { action: 'skipped', reason: 'No room values to prune.' };
  }

  const candidateRoomIds = [
    ...new Set(
      roomValues
        .flatMap((val) => val.split('/').map((t) => t.trim()))
        .filter((token) => /^\d+$/.test(token))
        .map((token) => Number(token))
        .filter((id) => Number.isFinite(id))
    ),
  ];

  if (candidateRoomIds.length === 0) {
    return { action: 'skipped', reason: 'No numeric room IDs to prune.' };
  }

  const pruned = [];
  const retained = [];

  for (const roomId of candidateRoomIds) {
    const idToken = String(roomId);

    const { data: offeringRefRows, error: offeringRefError } = await supabaseAdmin
      .from('course_offerings')
      .select('id')
      .or(`mth_room_id.ilike.%${idToken}%,tfs_room_id.ilike.%${idToken}%`)
      .limit(1);

    if (offeringRefError) {
      throw new Error(`Failed checking course_offerings room references for room ${roomId}: ${offeringRefError.message}`);
    }

    if (offeringRefRows && offeringRefRows.length > 0) {
      retained.push({ room_id: roomId, reason: 'Still referenced in course_offerings.' });
      continue;
    }

    const { data: subjectRefRows, error: subjectRefError } = await supabaseAdmin
      .from('subjects')
      .select('subject_id')
      .or(`mth_room.ilike.%${idToken}%,tfs_room.ilike.%${idToken}%`)
      .limit(1);

    if (subjectRefError) {
      throw new Error(`Failed checking subjects room references for room ${roomId}: ${subjectRefError.message}`);
    }

    if (subjectRefRows && subjectRefRows.length > 0) {
      retained.push({ room_id: roomId, reason: 'Still referenced in subjects.' });
      continue;
    }

    const { error: deleteRoomError } = await supabaseAdmin
      .from('rooms')
      .delete()
      .eq('room_id', roomId);

    if (deleteRoomError) {
      throw new Error(`Failed deleting orphan room ${roomId}: ${deleteRoomError.message}`);
    }

    pruned.push({ room_id: roomId });
  }

  return { action: 'completed', pruned, retained };
}

function toRowObject(rowCells, mapping) {
  const record = {};
  for (const mapped of mapping) {
    if (!mapped.targetField) continue;
    record[mapped.targetField] = rowCells[mapped.index];
  }
  return record;
}

function sanitizeRow(row, departmentLookup, roomLookup) {
  const errors = [];
  const warnings = [];

  const currId = parseNumber(row.curr_id, 'curr_id');
  const units = parseNumber(row.units, 'units');
  const lecHrs = parseNumber(row.lec_hrs, 'lec_hrs');
  const labHrs = parseNumber(row.lab_hrs, 'lab_hrs');

  if (currId.error) errors.push(currId.error);
  if (units.error) errors.push(units.error);
  if (lecHrs.error) errors.push(lecHrs.error);
  if (labHrs.error) errors.push(labHrs.error);

  const parsedStartDate = parseDate(row.start_date, 'start_date');
  const parsedEndDate = parseDate(row.end_date, 'end_date');
  if (parsedStartDate.error) warnings.push(parsedStartDate.error);
  if (parsedEndDate.error) warnings.push(parsedEndDate.error);

  const payload = {
    curr_id: currId.value,
    code: normalizeCell(row.code),
    course_no: normalizeCell(row.course_no),
    section: normalizeCell(row.section),
    descriptive_title: normalizeCell(row.descriptive_title),
    units: units.value,
    lec_hrs: lecHrs.value,
    lab_hrs: labHrs.value,
    mth_schedule: normalizeCell(row.mth_schedule),
    tfs_schedule: normalizeCell(row.tfs_schedule),
  };

  const mthRoom = resolveRoomIds(row.mth_room_id, roomLookup);
  const tfsRoom = resolveRoomIds(row.tfs_room_id, roomLookup);
  if (mthRoom.errors.length > 0) errors.push(...mthRoom.errors);
  if (tfsRoom.errors.length > 0) errors.push(...tfsRoom.errors);

  payload.mth_room_id = mthRoom.roomIds;
  payload.tfs_room_id = tfsRoom.roomIds;

  const mergedValue = normalizeCell(row.merged);
  if (mergedValue !== null) {
    payload.merged = mergedValue;
  }

  let departmentId = null;
  const normalizedDepartmentId = normalizeCell(row.department_id);
  const normalizedDepartmentCode = normalizeCell(row.department_code);

  if (normalizedDepartmentId) {
    const parsedDepartmentId = Number(normalizedDepartmentId);
    if (!Number.isFinite(parsedDepartmentId) || !departmentLookup.byId.has(parsedDepartmentId)) {
      errors.push(`Unknown department_id: "${normalizedDepartmentId}"`);
    } else {
      departmentId = parsedDepartmentId;
    }
  } else if (normalizedDepartmentCode) {
    const matchedDepartment = departmentLookup.byCode.get(normalizedDepartmentCode.toUpperCase());
    if (!matchedDepartment) {
      errors.push(`Unknown department code: "${normalizedDepartmentCode}"`);
    } else {
      departmentId = matchedDepartment;
    }
  } else {
    errors.push('Missing department information (DEPT or department_id).');
  }

  payload.department_id = departmentId;

  for (const field of REQUIRED_FIELDS) {
    if (payload[field] === null || payload[field] === undefined || payload[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (payload.department_id === null || payload.department_id === undefined) {
    errors.push('Missing required field: department_id');
  }

  return { payload, errors, warnings };
}

async function preloadSubjectLookups() {
  const { data, error } = await supabaseAdmin
    .from('subjects')
    .select('subject_id, subject_code, subject_section, department_id, subject_status');

  if (error) throw new Error(`Preload subjects failed: ${error.message}`);

  const byExact = new Map();
  const byCodeSection = new Map();
  const byCodeDept = new Map();
  const byCode = new Map();

  for (const row of data ?? []) {
    const code = String(row.subject_code ?? '').trim();
    const section = String(row.subject_section ?? '').trim();
    const deptId = row.department_id;
    const entry = { subject_id: row.subject_id, subject_status: row.subject_status };

    if (code && section && deptId != null) byExact.set(`${code}|${section}|${deptId}`, entry);
    if (code && section) byCodeSection.set(`${code}|${section}`, entry);
    if (code && deptId != null) byCodeDept.set(`${code}|${deptId}`, entry);
    if (code) byCode.set(code, entry);
  }

  return { byExact, byCodeSection, byCodeDept, byCode };
}

function lookupSubjectInMaps(subjectCode, subjectSection, departmentId, maps) {
  if (subjectSection && departmentId != null) {
    const hit = maps.byExact.get(`${subjectCode}|${subjectSection}|${departmentId}`);
    if (hit) return hit;
  }
  if (subjectSection) {
    const hit = maps.byCodeSection.get(`${subjectCode}|${subjectSection}`);
    if (hit) return hit;
  }
  if (departmentId != null) {
    const hit = maps.byCodeDept.get(`${subjectCode}|${departmentId}`);
    if (hit) return hit;
  }
  return maps.byCode.get(subjectCode) ?? null;
}

// GET /api/course-offerings/check-code/:code - Check for duplicate course codes
router.get('/check-code/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code) {
      return res.json({ exists: false, suggestions: [] });
    }

    // Search for matching course codes (exact or partial)
    const { data: matches, error } = await supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, descriptive_title, section, units, departments(department_name)')
      .ilike('code', `%${code}%`)
      .order('id', { ascending: false })
      .limit(3);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const exists = matches?.some((m) => m.code?.toUpperCase() === code) ?? false;
    const suggestions = (matches || []).map((m) => ({
      id: m.id,
      code: m.code,
      course_no: m.course_no,
      descriptive_title: m.descriptive_title,
      section: m.section,
      units: m.units,
      department_name: m.departments?.department_name || null,
    }));

    return res.json({ exists, suggestions });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/audit/export', async (req, res) => {
  try {
    const fileName = normalizeCell(req.body?.fileName) || 'course-offerings.csv';
    const rowCount = Math.max(0, Number(req.body?.rowCount || 0));
    const columnCount = Array.isArray(req.body?.columns) ? req.body.columns.length : 0;

    await recordAuditLog(req, {
      action: 'course_offerings_exported',
      module: COURSE_OFFERING_AUDIT_MODULE,
      description: `Exported ${rowCount} course offering row(s) to ${fileName}`,
      changes_after: {
        fileName,
        rowCount,
        columnCount,
        columns: Array.isArray(req.body?.columns) ? req.body.columns : [],
        filters: req.body?.filters || {},
        sort: req.body?.sort || {},
        usedCurrentPageFallback: req.body?.usedCurrentPageFallback === true,
      },
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(10000, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Sort parameters
    const sortBy = String(req.query.sortBy || 'id').toLowerCase();
    const sortOrder = String(req.query.sortOrder || 'asc').toLowerCase();

    // Allowed sort columns
    const allowedSortColumns = [
      'id',
      'code',
      'course_no',
      'descriptive_title',
      'units',
      'lec_hrs',
      'lab_hrs',
      'curr_id',
      'department_id',
      'section',
      'mth_schedule',
      'tfs_schedule',
      'merged',
    ];

    // Validate sort column
    const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
    const validSortOrder = sortOrder === 'desc' ? 'desc' : 'asc';

    // Search parameters
    const search = String(req.query.search || '').trim();
    const searchCol = String(req.query.searchCol || '').toLowerCase();

    // Searchable columns (maps frontend key → DB column)
    const searchableColumns = {
      code: 'code',
      course_no: 'course_no',
      descriptive_title: 'descriptive_title',
      section: 'section',
      curr_id: 'curr_id',
      mth_schedule: 'mth_schedule',
      tfs_schedule: 'tfs_schedule',
      mth_room_id: 'mth_room_id',
      tfs_room_id: 'tfs_room_id',
    };

    let query = supabaseAdmin
      .from('course_offerings')
      .select(
        '*,departments!course_offerings_department_id_fkey(department_id,department_name)',
        { count: 'exact' }
      )
      .order(validSortBy, { ascending: validSortOrder === 'asc' });

    // Secondary sort by id keeps the order stable when rows share the same
    // primary sort value (e.g. many offerings with code = null). This MUST
    // match the secondary sort in /:id/page so the page calculation is correct.
    if (validSortBy !== 'id') {
      query = query.order('id', { ascending: true });
    }

    query = query.range(from, to);

    if (search) {
      const dbCol = searchableColumns[searchCol];
      if (dbCol) {
        // Column-specific search
        query = query.ilike(dbCol, `%${search}%`);
      } else {
        // Broad search across key text columns
        query = query.or(
          `code.ilike.%${search}%,course_no.ilike.%${search}%,descriptive_title.ilike.%${search}%,section.ilike.%${search}%,mth_schedule.ilike.%${search}%,tfs_schedule.ilike.%${search}%`
        );
      }
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      page,
      limit,
      total: count ?? 0,
      rows: data ?? [],
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /api/course-offerings/:id/page — returns which page this offering falls on
// Uses only the id column (lightweight) to avoid fetching full row data
router.get('/:id/page', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid offering ID' });
    }

    const pageSize = Math.max(1, Number(req.query.pageSize || 50));
    const sortBy = String(req.query.sortBy || 'code').toLowerCase();
    const sortOrder = String(req.query.sortOrder || 'asc').toLowerCase();

    const allowedSortColumns = [
      'id', 'code', 'course_no', 'descriptive_title', 'units',
      'lec_hrs', 'lab_hrs', 'curr_id', 'department_id', 'section',
      'mth_schedule', 'tfs_schedule', 'merged',
    ];
    const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'code';
    const ascending = sortOrder !== 'desc';

    // Fetch only IDs in sorted order — much lighter than full rows
    let idsQuery = supabaseAdmin
      .from('course_offerings')
      .select('id')
      .order(validSortBy, { ascending });

    // Only add the secondary id sort when the primary is not already id
    // (must match the secondary sort in the main listing route)
    if (validSortBy !== 'id') {
      idsQuery = idsQuery.order('id', { ascending: true });
    }

    const { data: sortedIds, error } = await idsQuery;

    if (error) return res.status(500).json({ error: error.message });

    const index = (sortedIds || []).findIndex((r) => r.id === id);
    if (index === -1) return res.status(404).json({ error: 'Offering not found' });

    return res.json({ page: Math.ceil((index + 1) / pageSize) });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid offering ID' });
    }

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .select(
        '*,departments!course_offerings_department_id_fkey(department_id,department_name)'
      )
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.post('/import-csv', async (req, res) => {
  try {
    const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'upload.csv';
    const replaceMode = req.body?.replaceMode === true;

    if (!csvText.trim()) {
      return res.status(400).json({
        error: 'csvText is required and must be a non-empty string.',
      });
    }

    const csvRows = parseCsv(csvText);
    if (csvRows.length < 2) {
      return res.status(400).json({
        error: 'CSV must include a header row and at least one data row.',
      });
    }

    // auto-detect header row (some exported sheets include metadata before the header)
    let headerIndex = -1;
    for (let i = 0; i < Math.min(csvRows.length, 20); i += 1) {
      if (isHeaderRowCandidate(csvRows[i])) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      // fallback to first row as header if detection failed
      headerIndex = 0;
    }

    const headerRow = csvRows[headerIndex];
    const dataRows = csvRows.slice(headerIndex + 1);
    const mapping = buildHeaderMapping(headerRow);

    const mappedFields = new Set(mapping.map((entry) => entry.targetField).filter(Boolean));
    const requiredForFile = [...REQUIRED_FIELDS, 'department_code'];
    const missingHeaders = requiredForFile.filter((field) => !mappedFields.has(field) && field !== 'department_code');
    const hasDepartmentSource = mappedFields.has('department_code') || mappedFields.has('department_id');

    if (!hasDepartmentSource) {
      missingHeaders.push('department_code/department_id');
    }

    if (missingHeaders.length > 0) {
      return res.status(400).json({
        error: 'CSV is missing required headers.',
        missingHeaders,
        supportedHeaders: Object.keys(HEADER_TO_FIELD),
      });
    }

    const departmentCodeColumn = mapping.find((entry) => entry.targetField === 'department_code');
    const autoCreateCodes = new Set();

    if (departmentCodeColumn) {
      for (const rowCells of dataRows) {
        const code = normalizeCell(rowCells[departmentCodeColumn.index]);
        if (!code) continue;
        autoCreateCodes.add(code.toUpperCase());
      }
    }

    const departmentLookup = await fetchDepartmentLookup({ autoCreateCodes });

    const summary = {
      fileName,
      replaceMode,
      totalRows: dataRows.length,
      processedRows: 0,
      insertedRows: 0,
      updatedRows: 0,
      syncedSubjectRows: 0,
      failedSubjectSyncRows: 0,
      failedRows: 0,
      skippedRows: 0,
      errors: [],
      warnings: [],
    };

    // In replace mode: wipe subjects → course_offerings before inserting fresh data.
    // The rooms table is NOT touched — it is managed separately and is the source of truth.
    if (replaceMode) {
      const { error: delSubjectsError } = await supabaseAdmin
        .from('subjects')
        .delete()
        .neq('subject_id', 0);

      if (delSubjectsError) {
        return res.status(500).json({ error: `Replace mode: failed to clear subjects: ${delSubjectsError.message}` });
      }

      const { error: delOfferingsError } = await supabaseAdmin
        .from('course_offerings')
        .delete()
        .neq('id', 0);

      if (delOfferingsError) {
        return res.status(500).json({ error: `Replace mode: failed to clear course offerings: ${delOfferingsError.message}` });
      }
    }

    // Load the rooms table into a lookup (name→id, id→id).
    // The rooms table is the source of truth and is never modified by the import.
    // Room names in the CSV are matched against existing rooms; unmatched names
    // produce per-row validation errors rather than creating new room records.
    const roomLookup = await preloadRooms(dataRows, mapping);

    // Preload existing offerings into a Map for O(1) insert-vs-update decisions.
    // In replace mode the table was just cleared so the map stays empty (all rows are inserts).
    // Key: "curr_id|course_no|section|department_id" → offering id
    const existingOfferingMap = new Map();
    if (!replaceMode) {
      const { data: existingOfferings, error: ofFetchErr } = await supabaseAdmin
        .from('course_offerings')
        .select('id, curr_id, course_no, section, department_id');

      if (ofFetchErr) {
        return res.status(500).json({ error: `Preload offerings failed: ${ofFetchErr.message}` });
      }

      for (const row of existingOfferings ?? []) {
        const key = `${row.curr_id}|${String(row.course_no ?? '').trim()}|${String(row.section ?? '').trim()}|${row.department_id}`;
        existingOfferingMap.set(key, row.id);
      }
    }

    // Collect validated rows into insert/update buckets — no DB queries in this loop.
    const toInsert = []; // { rowNumber, payload }
    const toUpdate = []; // { rowNumber, payload, id }

    for (let index = 0; index < dataRows.length; index += 1) {
      const rowCells = dataRows[index];
      const rowNumber = index + 2;

      if (!rowCells.some((cell) => normalizeCell(cell) !== null)) {
        summary.skippedRows += 1;
        continue;
      }

      if (shouldSkipNonDataRow(rowCells)) {
        summary.skippedRows += 1;
        continue;
      }

      const rawRow = toRowObject(rowCells, mapping);
      const { payload, errors, warnings } = sanitizeRow(rawRow, departmentLookup, roomLookup);

      if (warnings.length > 0) {
        summary.warnings.push({
          row: rowNumber,
          messages: warnings,
        });
      }

      if (errors.length > 0) {
        summary.failedRows += 1;
        summary.errors.push({
          row: rowNumber,
          key: {
            curr_id: normalizeCell(rawRow.curr_id),
            course_no: normalizeCell(rawRow.course_no),
            section: normalizeCell(rawRow.section),
            department_code: normalizeCell(rawRow.department_code),
          },
          messages: errors,
        });
        continue;
      }

      const offeringKey = `${payload.curr_id}|${String(payload.course_no ?? '').trim()}|${String(payload.section ?? '').trim()}|${payload.department_id}`;
      const existingId = existingOfferingMap.get(offeringKey);

      if (existingId != null) {
        toUpdate.push({ rowNumber, payload, id: existingId });
      } else {
        toInsert.push({ rowNumber, payload });
        // Mark as pending insert so duplicate rows in the same CSV are detected and skipped
        existingOfferingMap.set(offeringKey, -1);
      }
    }

    // Track successfully processed offerings for subject sync
    const successfulOfferings = []; // { rowNumber, payload }

    // Batch insert new offerings in chunks of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      const { error: insertError } = await supabaseAdmin
        .from('course_offerings')
        .insert(chunk.map((r) => r.payload));

      if (insertError) {
        for (const r of chunk) {
          summary.failedRows += 1;
          summary.errors.push({
            row: r.rowNumber,
            messages: [`Insert failed: ${insertError.message}`],
          });
        }
      } else {
        summary.insertedRows += chunk.length;
        summary.processedRows += chunk.length;
        for (const r of chunk) {
          successfulOfferings.push({ rowNumber: r.rowNumber, payload: r.payload });
        }
      }
    }

    // Parallel update existing offerings in batches of 50
    const UPDATE_CONCURRENCY = 50;
    for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
      const chunk = toUpdate.slice(i, i + UPDATE_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(({ id, payload }) =>
          supabaseAdmin.from('course_offerings').update(payload).eq('id', id)
        )
      );

      for (let j = 0; j < chunk.length; j += 1) {
        const r = chunk[j];
        const result = results[j];
        const errMsg = result.status === 'rejected'
          ? (result.reason?.message ?? 'Unknown error')
          : (result.value?.error?.message ?? null);

        if (errMsg) {
          summary.failedRows += 1;
          summary.errors.push({
            row: r.rowNumber,
            id: r.id,
            messages: [`Update failed: ${errMsg}`],
          });
        } else {
          summary.updatedRows += 1;
          summary.processedRows += 1;
          successfulOfferings.push({ rowNumber: r.rowNumber, payload: r.payload });
        }
      }
    }

    // Preload subjects immediately before the sync phase so the map reflects the
    // true DB state after all offering inserts/updates are complete.
    // In replace mode: if the delete was clean the map is empty → all syncs are inserts.
    // If any subjects survived the delete, the 4-level fallback routes them to UPDATE
    // instead of a duplicate INSERT, preventing stale rows from being duplicated.
    // In non-replace mode: map has all pre-existing subjects at this point in time,
    // including any that were updated or created during the offering insert phase.
    const subjectMaps = await preloadSubjectLookups();

    // Batch subject sync using preloaded maps.
    // Deduplicate by subject key so the same logical subject is only written once
    // (last row with that key wins, matching the original sequential update behaviour).
    const pendingSubjectKeys = new Map(); // pendingKey → index in subjectInserts
    const subjectToInsert = []; // { pendingKey, subjectPayload }
    const subjectToUpdate = []; // { subject_id, subject_status, subjectPayload }

    for (const { payload } of successfulOfferings) {
      const subjectCode = normalizeCell(payload.code);
      if (!subjectCode) continue;

      const subjectPayload = buildSubjectPayloadFromCourseOffering(payload);
      const section = normalizeCell(payload.section) ?? '';
      const deptId = payload.department_id;

      const existing = lookupSubjectInMaps(subjectCode, section, deptId, subjectMaps);

      if (existing) {
        subjectToUpdate.push({
          subject_id: existing.subject_id,
          subject_status: existing.subject_status,
          subjectPayload,
        });
        continue;
      }

      // Check if this subject is already queued for insert by a previous row in this CSV
      const pendingKey = `${subjectCode}|${section}|${deptId ?? ''}`;
      if (pendingSubjectKeys.has(pendingKey)) {
        // Last row wins — overwrite the payload in the existing insert entry
        const existingIdx = pendingSubjectKeys.get(pendingKey);
        subjectToInsert[existingIdx].subjectPayload = subjectPayload;
      } else {
        pendingSubjectKeys.set(pendingKey, subjectToInsert.length);
        subjectToInsert.push({ pendingKey, subjectPayload });
      }
    }

    // Batch insert new subjects
    for (let i = 0; i < subjectToInsert.length; i += CHUNK_SIZE) {
      const chunk = subjectToInsert.slice(i, i + CHUNK_SIZE);
      const { data: insertedSubjects, error: subjectInsertError } = await supabaseAdmin
        .from('subjects')
        .insert(chunk.map((e) => ({ ...e.subjectPayload, subject_status: 'active' })))
        .select('subject_id, subject_code, subject_section, department_id');

      if (subjectInsertError) {
        summary.failedSubjectSyncRows += chunk.length;
        summary.warnings.push({
          messages: [`Subject sync batch insert failed: ${subjectInsertError.message}`],
        });
      } else {
        summary.syncedSubjectRows += chunk.length;
        // Update in-memory maps so later lookup calls in this same import find newly inserted subjects
        if (insertedSubjects) {
          for (const row of insertedSubjects) {
            const code = String(row.subject_code ?? '').trim();
            const sec = String(row.subject_section ?? '').trim();
            const dept = row.department_id;
            const entry = { subject_id: row.subject_id, subject_status: 'active' };
            if (code && sec && dept != null) subjectMaps.byExact.set(`${code}|${sec}|${dept}`, entry);
            if (code && sec) subjectMaps.byCodeSection.set(`${code}|${sec}`, entry);
            if (code && dept != null) subjectMaps.byCodeDept.set(`${code}|${dept}`, entry);
            if (code) subjectMaps.byCode.set(code, entry);
          }
        }
      }
    }

    // Parallel update existing subjects in batches of 50
    for (let i = 0; i < subjectToUpdate.length; i += UPDATE_CONCURRENCY) {
      const chunk = subjectToUpdate.slice(i, i + UPDATE_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(({ subject_id, subject_status, subjectPayload }) =>
          supabaseAdmin
            .from('subjects')
            .update({ ...subjectPayload, subject_status: subject_status || 'active' })
            .eq('subject_id', subject_id)
        )
      );

      for (const result of results) {
        const errMsg = result.status === 'rejected'
          ? (result.reason?.message ?? 'Unknown error')
          : (result.value?.error?.message ?? null);

        if (errMsg) {
          summary.failedSubjectSyncRows += 1;
          summary.warnings.push({
            messages: [`Subject sync update failed: ${errMsg}`],
          });
        } else {
          summary.syncedSubjectRows += 1;
        }
      }
    }

    await recordAuditLog(req, {
      action: 'course_offerings_imported',
      module: COURSE_OFFERING_AUDIT_MODULE,
      description: `Imported course offerings from ${fileName || 'CSV'} (${summary.processedRows} processed, ${summary.insertedRows} inserted, ${summary.updatedRows} updated)`,
      changes_after: {
        fileName,
        replaceMode,
        summary,
      },
    });

    return res.json({
      success: true,
      summary,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error during CSV import.',
    });
  }
});

// POST - Bulk sync subjects from all course offerings
router.post('/sync-subjects', async (req, res) => {
  try {
    const { data: allOfferings, error: coError } = await supabaseAdmin
      .from('course_offerings')
      .select('*');

    if (coError) throw new Error(`Failed to fetch course offerings: ${coError.message}`);

    const offerings = Array.isArray(allOfferings) ? allOfferings : [];
    if (offerings.length === 0) {
      return res.json({ synced: 0, created: 0, failed: 0 });
    }

    const subjectMaps = await preloadSubjectLookups();

    const CHUNK_SIZE = 500;
    const UPDATE_CONCURRENCY = 50;
    const subjectToInsert = [];
    const subjectToUpdate = [];
    const pendingSubjectKeys = new Map();

    for (const offering of offerings) {
      const subjectCode = normalizeCell(offering.code);
      if (!subjectCode) continue;

      const subjectPayload = buildSubjectPayloadFromCourseOffering(offering);
      const section = normalizeCell(offering.section) ?? '';
      const deptId = offering.department_id;
      const existing = lookupSubjectInMaps(subjectCode, section, deptId, subjectMaps);

      if (existing) {
        subjectToUpdate.push({ subject_id: existing.subject_id, subject_status: existing.subject_status, subjectPayload });
        continue;
      }

      const pendingKey = `${subjectCode}|${section}|${deptId ?? ''}`;
      if (pendingSubjectKeys.has(pendingKey)) {
        subjectToInsert[pendingSubjectKeys.get(pendingKey)].subjectPayload = subjectPayload;
      } else {
        pendingSubjectKeys.set(pendingKey, subjectToInsert.length);
        subjectToInsert.push({ subjectPayload });
      }
    }

    let created = 0;
    let synced = 0;
    let failed = 0;

    for (let i = 0; i < subjectToInsert.length; i += CHUNK_SIZE) {
      const chunk = subjectToInsert.slice(i, i + CHUNK_SIZE);
      const { error: insertError } = await supabaseAdmin
        .from('subjects')
        .insert(chunk.map((e) => ({ ...e.subjectPayload, subject_status: 'active' })));

      if (insertError) {
        failed += chunk.length;
      } else {
        created += chunk.length;
      }
    }

    for (let i = 0; i < subjectToUpdate.length; i += UPDATE_CONCURRENCY) {
      const chunk = subjectToUpdate.slice(i, i + UPDATE_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(({ subject_id, subject_status, subjectPayload }) =>
          supabaseAdmin
            .from('subjects')
            .update({ ...subjectPayload, subject_status: subject_status || 'active' })
            .eq('subject_id', subject_id)
        )
      );

      for (const result of results) {
        const errMsg = result.status === 'rejected'
          ? (result.reason?.message ?? 'Unknown error')
          : (result.value?.error?.message ?? null);
        if (errMsg) { failed += 1; } else { synced += 1; }
      }
    }

    return res.json({ synced, created, failed });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error during subject sync.',
    });
  }
});

// POST - Create new course offering
router.post('/', async (req, res) => {
  try {
    const { code, course_no, descriptive_title, curr_id, department_id, section, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id, merged } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Course code is required' });
    }

    const payload = buildCourseOfferingPayload({
      code,
      course_no,
      descriptive_title,
      curr_id,
      department_id,
      section,
      units,
      lec_hrs,
      lab_hrs,
      mth_schedule,
      mth_room_id,
      tfs_schedule,
      tfs_room_id,
      merged,
    });

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .insert([payload])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const inserted = data?.[0] ?? {};

    let subjectSync = { action: 'skipped' };
    let roomSync = { action: 'skipped' };

    try {
      subjectSync = await syncSubjectFromCourseOffering(inserted);
    } catch (syncError) {
      console.error('Subject sync error:', syncError);
      subjectSync = {
        action: 'failed',
        error: syncError instanceof Error ? syncError.message : 'Unknown subject sync error',
      };
    }

    try {
      roomSync = await syncRoomsFromCourseOffering(inserted);
    } catch (syncError) {
      console.error('Room sync error:', syncError);
      roomSync = {
        action: 'failed',
        error: syncError instanceof Error ? syncError.message : 'Unknown room sync error',
      };
    }

    await recordAuditLog(req, {
      action: 'course_offering_created',
      module: COURSE_OFFERING_AUDIT_MODULE,
      description: `Created course offering ${formatOfferingAuditLabel(inserted)}`,
      changes_after: {
        ...inserted,
        subjectSync,
        roomSync,
      },
    });

    return res.status(201).json({
      ...inserted,
      subjectSync,
      roomSync,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// PUT - Update course offering
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, course_no, descriptive_title, curr_id, department_id, section, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id, merged } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Course code is required' });
    }

    const { data: existingOfferingRows, error: existingOfferingError } = await supabaseAdmin
      .from('course_offerings')
      .select('*')
      .eq('id', id)
      .limit(1);

    if (existingOfferingError) {
      return res.status(500).json({ error: existingOfferingError.message });
    }

    if (!existingOfferingRows || existingOfferingRows.length === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    const existingOffering = existingOfferingRows[0];

    const payload = buildCourseOfferingPayload({
      code,
      course_no,
      descriptive_title,
      curr_id,
      department_id,
      section,
      units,
      lec_hrs,
      lab_hrs,
      mth_schedule,
      mth_room_id,
      tfs_schedule,
      tfs_room_id,
      merged,
    }, existingOffering);

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .update(payload)
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    const updated = data[0];

    let subjectSync = { action: 'skipped' };
    let roomSync = { action: 'skipped' };

    try {
      subjectSync = await syncSubjectFromCourseOffering(updated);
    } catch (syncError) {
      console.error('Subject sync error:', syncError);
      subjectSync = {
        action: 'failed',
        error: syncError instanceof Error ? syncError.message : 'Unknown subject sync error',
      };
    }

    try {
      roomSync = await syncRoomsFromCourseOffering(updated);
    } catch (syncError) {
      console.error('Room sync error:', syncError);
      roomSync = {
        action: 'failed',
        error: syncError instanceof Error ? syncError.message : 'Unknown room sync error',
      };
    }

    await recordAuditLog(req, {
      action: 'course_offering_updated',
      module: COURSE_OFFERING_AUDIT_MODULE,
      description: `Updated course offering ${formatOfferingAuditLabel(updated)}`,
      changes_before: existingOffering,
      changes_after: {
        ...updated,
        subjectSync,
        roomSync,
      },
    });

    return res.json({
      ...updated,
      subjectSync,
      roomSync,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// DELETE - Delete course offering
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('course_offerings')
      .select('*')
      .eq('id', id)
      .limit(1);

    if (existingError) {
      return res.status(500).json({ error: existingError.message });
    }

    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    const target = existingRows[0];

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    let subjectDelete = { action: 'skipped', reason: 'No subject match found.' };
    let roomPrune = { action: 'skipped' };

    const subjectCode = normalizeCell(target?.code);
    if (subjectCode) {
      try {
        const { data: deletedSubjects, error: subjectDeleteError } = await supabaseAdmin
          .from('subjects')
          .delete()
          .eq('subject_code', subjectCode)
          .select('subject_id,subject_code');

        if (subjectDeleteError) {
          subjectDelete = {
            action: 'failed',
            error: subjectDeleteError.message,
          };
        } else {
          subjectDelete = {
            action: 'deleted',
            count: deletedSubjects?.length ?? 0,
            rows: deletedSubjects ?? [],
          };
        }
      } catch (subjectErr) {
        subjectDelete = {
          action: 'failed',
          error: subjectErr instanceof Error ? subjectErr.message : 'Unknown subject delete error',
        };
      }
    } else {
      const subjectCourseNo = normalizeCell(target?.course_no);
      const subjectTitle = normalizeCell(target?.descriptive_title);
      const subjectSection = normalizeCell(target?.section);
      const subjectCurrId = Number(target?.curr_id);
      const subjectDepartmentId = target?.department_id ?? null;

      const canFallbackDelete =
        subjectCourseNo &&
        subjectSection &&
        Number.isFinite(subjectCurrId);

      if (canFallbackDelete) {
        try {
          let deleteQuery = supabaseAdmin
            .from('subjects')
            .delete()
            .ilike('subject_course_no', subjectCourseNo)
            .eq('curr_id', subjectCurrId)
            .ilike('subject_section', subjectSection);

          if (subjectTitle) {
            deleteQuery = deleteQuery.ilike('subject_descriptive_title', subjectTitle);
          }
          if (subjectDepartmentId !== null && subjectDepartmentId !== undefined) {
            deleteQuery = deleteQuery.eq('department_id', subjectDepartmentId);
          }

          const { data: deletedSubjects, error: subjectDeleteError } = await deleteQuery
            .select('subject_id,subject_code,subject_course_no');

          if (subjectDeleteError) {
            subjectDelete = {
              action: 'failed',
              error: subjectDeleteError.message,
            };
          } else {
            subjectDelete = {
              action: 'deleted',
              count: deletedSubjects?.length ?? 0,
              rows: deletedSubjects ?? [],
              matchedBy: 'course_no+curr+section',
            };
          }
        } catch (subjectErr) {
          subjectDelete = {
            action: 'failed',
            error: subjectErr instanceof Error ? subjectErr.message : 'Unknown subject delete error',
          };
        }
      } else {
        subjectDelete = {
          action: 'skipped',
          reason: 'Missing subject code and insufficient fallback fields (need course_no, curr_id, section).',
        };
      }
    }

    try {
      roomPrune = await pruneOrphanRoomsFromCourseOffering(target);
    } catch (roomErr) {
      roomPrune = {
        action: 'failed',
        error: roomErr instanceof Error ? roomErr.message : 'Unknown room prune error',
      };
    }

    await recordAuditLog(req, {
      action: 'course_offering_deleted',
      module: COURSE_OFFERING_AUDIT_MODULE,
      description: `Deleted course offering ${formatOfferingAuditLabel(target)}`,
      changes_before: target,
      changes_after: {
        deleted: data[0],
        subjectDelete,
        roomPrune,
      },
    });

    return res.json({ success: true, deleted: data[0], subjectDelete, roomPrune });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export {
  parseCsv,
  buildHeaderMapping,
  isHeaderRowCandidate,
  shouldSkipNonDataRow,
  normalizeHeader,
  normalizeCell,
};

export default router;
