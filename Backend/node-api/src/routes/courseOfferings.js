import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

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
  tfsschedule: 'tfs_schedule',
  tfsroomid: 'tfs_room_id',
  merged: 'merged',
};

const REQUIRED_FIELDS = ['curr_id', 'course_no', 'section'];

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
    const initials = String(row.department_name)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
    push(initials);
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
  CE: ['CIVIL', 'CIVIL ENGINEERING'],
  IT: ['INFORMATION TECHNOLOGY', 'INFO TECH'],
  CS: ['COMPUTER SCIENCE'],
  CPE: ['COMPUTER ENGINEERING', 'COMPUTER ENGINEER'],
  ECE: ['ELECTRONICS', 'COMMUNICATION ENGINEERING'],
  EE: ['ELECTRICAL ENGINEERING', 'ELECTRICAL'],
  LIS: ['LIBRARY', 'INFORMATION SCIENCE'],
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
function resolveRoomIds(roomValue, roomLookup) {
  const tokens = extractRoomTokens(roomValue);
  if (tokens.length === 0) return { roomIds: null, errors: [] };

  const roomIds = [];
  const errors = [];

  for (const token of tokens) {
    const lookupKey = normalizeLookupKey(token);
    const id = roomLookup.byName.get(lookupKey);
    if (id) {
      roomIds.push(id);
    } else {
      // Should never happen after preloadRooms — log as warning, not hard error
      errors.push(`Room not found in lookup: "${token}"`);
    }
  }

  const uniqueRoomIds = [...new Set(roomIds)];
  return {
    roomIds: uniqueRoomIds.length > 0 ? uniqueRoomIds.join('/') : null,
    errors,
  };
}

// Scan every data row for room values, deduplicate room names, then bulk-upsert into
// the rooms table. Returns a fully populated roomLookup { byId, byName }.
// This runs BEFORE the main import loop so every room exists by the time we process rows.
async function preloadRooms(dataRows, mapping) {
  // Find the column indices that carry room values
  const roomColumnIndices = mapping
    .filter((entry) => entry.targetField === 'mth_room_id' || entry.targetField === 'tfs_room_id')
    .map((entry) => entry.index);

  // Collect every unique room name from all data rows
  const uniqueRoomNames = new Set();
  for (const rowCells of dataRows) {
    for (const colIndex of roomColumnIndices) {
      for (const token of extractRoomTokens(rowCells[colIndex])) {
        // Skip bare numeric values — they are already IDs and handled by the ID path
        if (!/^\d+$/.test(token)) {
          uniqueRoomNames.add(token);
        }
      }
    }
  }

  if (uniqueRoomNames.size === 0) {
    // No room names in CSV — load existing rooms and return
    return fetchRoomLookup();
  }

  // Load all rooms currently in the database
  const { data: existingRooms, error: fetchError } = await supabaseAdmin
    .from('rooms')
    .select('room_id,room_name');

  if (fetchError) {
    throw new Error(`Failed to load rooms before import: ${fetchError.message}`);
  }

  const byId = new Map();
  const byName = new Map();

  for (const row of existingRooms ?? []) {
    const id = Number(row.room_id);
    const name = normalizeCell(row.room_name);
    if (!Number.isFinite(id) || !name) continue;
    byId.set(id, id);
    byName.set(normalizeLookupKey(name), id);
  }

  // Determine which room names are new (not yet in DB)
  const toInsert = [...uniqueRoomNames].filter(
    (name) => !byName.has(normalizeLookupKey(name))
  );

  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('rooms')
      .insert(toInsert.map((name) => ({ room_name: name, room_status: 'available' })))
      .select('room_id,room_name');

    if (insertError) {
      throw new Error(`Failed to pre-populate rooms: ${insertError.message}`);
    }

    for (const row of inserted ?? []) {
      const id = Number(row.room_id);
      const name = normalizeCell(row.room_name);
      if (!Number.isFinite(id) || !name) continue;
      byId.set(id, id);
      byName.set(normalizeLookupKey(name), id);
    }
  }

  return { byId, byName };
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
      ? input.merged === true || input.merged === 'true'
      : existing?.merged === true || existing?.merged === 'true';

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
      courseField === 'units' || courseField === 'lec_hrs' || courseField === 'lab_hrs'
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

    let query = supabaseAdmin
      .from('course_offerings')
      .select(
        '*,departments!course_offerings_department_id_fkey(department_id,department_name)',
        { count: 'exact' }
      )
      .order(validSortBy, { ascending: validSortOrder === 'asc' })
      .range(from, to);

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

    // In replace mode: wipe subjects → rooms → course_offerings before inserting fresh data.
    // roomLookup is built AFTER the deletes so it starts empty and rooms are recreated from CSV.
    if (replaceMode) {
      const { error: delSubjectsError } = await supabaseAdmin
        .from('subjects')
        .delete()
        .neq('subject_id', 0);

      if (delSubjectsError) {
        return res.status(500).json({ error: `Replace mode: failed to clear subjects: ${delSubjectsError.message}` });
      }

      const { error: delRoomsError } = await supabaseAdmin
        .from('rooms')
        .delete()
        .neq('room_id', 0);

      if (delRoomsError) {
        return res.status(500).json({ error: `Replace mode: failed to clear rooms: ${delRoomsError.message}` });
      }

      const { error: delOfferingsError } = await supabaseAdmin
        .from('course_offerings')
        .delete()
        .neq('id', 0);

      if (delOfferingsError) {
        return res.status(500).json({ error: `Replace mode: failed to clear course offerings: ${delOfferingsError.message}` });
      }
    }

    // Pre-populate rooms table from CSV BEFORE processing course offering rows.
    // This scans all room columns, deduplicates names (A101/A102 split into A101 and A102),
    // bulk-inserts any new rooms, then returns a complete name→id lookup.
    // In replace mode the rooms table was just cleared so all CSV rooms are treated as new.
    const roomLookup = await preloadRooms(dataRows, mapping);

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

      const { data: existingRows, error: existingError } = await supabaseAdmin
        .from('course_offerings')
        .select('id')
        .eq('curr_id', payload.curr_id)
        .eq('course_no', payload.course_no)
        .eq('section', payload.section)
        .eq('department_id', payload.department_id)
        .limit(1);

      if (existingError) {
        summary.failedRows += 1;
        summary.errors.push({
          row: rowNumber,
          messages: [`Lookup failed: ${existingError.message}`],
        });
        continue;
      }

      if (existingRows && existingRows.length > 0) {
        const targetId = existingRows[0].id;
        const { error: updateError } = await supabaseAdmin
          .from('course_offerings')
          .update(payload)
          .eq('id', targetId);

        if (updateError) {
          summary.failedRows += 1;
          summary.errors.push({
            row: rowNumber,
            id: targetId,
            messages: [`Update failed: ${updateError.message}`],
          });
          continue;
        }

        summary.updatedRows += 1;
        summary.processedRows += 1;

        try {
          await syncSubjectFromCourseOffering(payload);
          summary.syncedSubjectRows += 1;
        } catch (syncError) {
          summary.failedSubjectSyncRows += 1;
          summary.warnings.push({
            row: rowNumber,
            id: targetId,
            messages: [
              `Subject sync failed after update: ${syncError instanceof Error ? syncError.message : 'Unknown error'}`,
            ],
          });
        }
      } else {
        const { error: insertError } = await supabaseAdmin
          .from('course_offerings')
          .insert(payload);

        if (insertError) {
          summary.failedRows += 1;
          summary.errors.push({
            row: rowNumber,
            messages: [`Insert failed: ${insertError.message}`],
          });
          continue;
        }

        summary.insertedRows += 1;
        summary.processedRows += 1;

        try {
          await syncSubjectFromCourseOffering(payload);
          summary.syncedSubjectRows += 1;
        } catch (syncError) {
          summary.failedSubjectSyncRows += 1;
          summary.warnings.push({
            row: rowNumber,
            messages: [
              `Subject sync failed after insert: ${syncError instanceof Error ? syncError.message : 'Unknown error'}`,
            ],
          });
        }
      }
    }

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

    let subjectDelete = { action: 'skipped', reason: 'No subject code.' };
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
    }

    try {
      roomPrune = await pruneOrphanRoomsFromCourseOffering(target);
    } catch (roomErr) {
      roomPrune = {
        action: 'failed',
        error: roomErr instanceof Error ? roomErr.message : 'Unknown room prune error',
      };
    }

    return res.json({ success: true, deleted: data[0], subjectDelete, roomPrune });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
