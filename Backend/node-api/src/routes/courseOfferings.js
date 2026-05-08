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
const IMPORT_EDITABLE_FIELDS = new Set([
  'curr_id',
  'code',
  'course_no',
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
  'department_id',
  'department_code',
]);
const IMPORT_COMPARE_FIELDS = [
  'curr_id',
  'code',
  'course_no',
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
  'department_id',
];
const IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;
const importPreviewStore = new Map();

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

function resolveRoomIds(roomValue, roomLookup) {
  const normalized = normalizeCell(roomValue);
  if (normalized === null) return { roomIds: null, errors: [] };

  const tokens = normalized
    .split(/\s*[,/]\s*/)
    .map((token) => token.trim())
    .filter(Boolean);

  const roomIds = [];
  const errors = [];

  for (const token of tokens) {
    const numeric = Number(token);
    if (Number.isFinite(numeric) && roomLookup.byId.has(numeric)) {
      roomIds.push(numeric);
      continue;
    }

    const roomId = roomLookup.byName.get(normalizeLookupKey(token));
    if (!roomId) {
      errors.push(`Unknown room: "${token}"`);
      continue;
    }

    roomIds.push(roomId);
  }

  const uniqueRoomIds = [...new Set(roomIds)];
  return {
    roomIds: uniqueRoomIds.length > 0 ? uniqueRoomIds.join('/') : null,
    errors,
  };
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
    const mergedResult = parseBoolean(mergedValue, 'merged');
    if (mergedResult.error) {
      errors.push(mergedResult.error);
    } else {
      payload.merged = mergedResult.value;
    }
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

function sanitizeEditPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};

  const sanitized = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!IMPORT_EDITABLE_FIELDS.has(key)) continue;
    sanitized[key] = value;
  }

  return sanitized;
}

function normalizeComparable(value) {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function pickComparableOffering(row) {
  return {
    curr_id: row.curr_id ?? null,
    code: normalizeCell(row.code),
    course_no: normalizeCell(row.course_no),
    section: normalizeCell(row.section),
    descriptive_title: normalizeCell(row.descriptive_title),
    units: row.units ?? null,
    lec_hrs: row.lec_hrs ?? null,
    lab_hrs: row.lab_hrs ?? null,
    mth_schedule: normalizeCell(row.mth_schedule),
    mth_room_id: normalizeCell(row.mth_room_id),
    tfs_schedule: normalizeCell(row.tfs_schedule),
    tfs_room_id: normalizeCell(row.tfs_room_id),
    merged: row.merged ?? null,
    department_id: row.department_id ?? null,
  };
}

function buildFieldDiffs(oldValues, newValues) {
  const diffs = [];
  for (const field of IMPORT_COMPARE_FIELDS) {
    const oldValue = normalizeComparable(oldValues?.[field]);
    const newValue = normalizeComparable(newValues?.[field]);
    if (oldValue === newValue) continue;

    diffs.push({
      field,
      oldValue,
      newValue,
    });
  }
  return diffs;
}

function buildNaturalKey(payload) {
  return [
    String(payload.curr_id ?? ''),
    String(payload.course_no ?? '').toUpperCase(),
    String(payload.section ?? '').toUpperCase(),
    String(payload.department_id ?? ''),
  ].join('::');
}

async function findExistingOffering(payload) {
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('course_offerings')
    .select('*')
    .eq('curr_id', payload.curr_id)
    .eq('course_no', payload.course_no)
    .eq('section', payload.section)
    .eq('department_id', payload.department_id)
    .limit(1);

  return {
    existingRow: existingRows && existingRows.length > 0 ? existingRows[0] : null,
    existingError,
  };
}

function cleanupExpiredPreviews() {
  const now = Date.now();
  for (const [token, value] of importPreviewStore.entries()) {
    if (now - value.createdAt > IMPORT_PREVIEW_TTL_MS) {
      importPreviewStore.delete(token);
    }
  }
}

function toPreviewSummary(fileName, rows, headerRowIndex) {
  const summary = {
    fileName,
    headerRowIndex,
    totalRows: rows.length,
    validRows: 0,
    errorRows: 0,
    warningRows: 0,
    insertRows: 0,
    updateRows: 0,
    skippedRows: 0,
  };

  for (const row of rows) {
    if (row.status === 'skipped') {
      summary.skippedRows += 1;
      continue;
    }
    if (row.errors.length > 0) {
      summary.errorRows += 1;
      continue;
    }

    summary.validRows += 1;
    if (row.warnings.length > 0) {
      summary.warningRows += 1;
    }
    if (row.action === 'insert') summary.insertRows += 1;
    if (row.action === 'update') summary.updateRows += 1;
  }

  return summary;
}

async function buildImportPreview({ csvText, fileName }) {
  const csvRows = parseCsv(csvText);
  if (csvRows.length < 2) {
    throw new Error('CSV must include a header row and at least one data row.');
  }

  let headerIndex = -1;
  for (let i = 0; i < Math.min(csvRows.length, 20); i += 1) {
    if (isHeaderRowCandidate(csvRows[i])) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
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
    const err = new Error('CSV is missing required headers.');
    err.missingHeaders = missingHeaders;
    err.supportedHeaders = Object.keys(HEADER_TO_FIELD);
    throw err;
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
  const roomLookup = await fetchRoomLookup();
  const rows = [];
  const seenValidKeys = new Set();

  for (let index = 0; index < dataRows.length; index += 1) {
    const rowCells = dataRows[index];
    const csvRowNumber = headerIndex + index + 2;
    const previewRowId = `row-${index + 1}`;

    if (!rowCells.some((cell) => normalizeCell(cell) !== null) || shouldSkipNonDataRow(rowCells)) {
      rows.push({
        previewRowId,
        csvRowNumber,
        action: 'skip',
        status: 'skipped',
        key: null,
        rawValues: {},
        oldValues: null,
        newValues: null,
        fieldDiffs: [],
        errors: [],
        warnings: [],
        editable: false,
      });
      continue;
    }

    const rawRow = toRowObject(rowCells, mapping);
    const { payload, errors, warnings } = sanitizeRow(rawRow, departmentLookup, roomLookup);

    if (errors.length > 0) {
      rows.push({
        previewRowId,
        csvRowNumber,
        action: 'error',
        status: 'error',
        key: {
          curr_id: normalizeCell(rawRow.curr_id),
          course_no: normalizeCell(rawRow.course_no),
          section: normalizeCell(rawRow.section),
          department_code: normalizeCell(rawRow.department_code),
        },
        rawValues: rawRow,
        oldValues: null,
        newValues: payload,
        fieldDiffs: [],
        errors,
        warnings,
        editable: true,
      });
      continue;
    }

    const naturalKey = buildNaturalKey(payload);
    if (seenValidKeys.has(naturalKey)) {
      rows.push({
        previewRowId,
        csvRowNumber,
        action: 'error',
        status: 'error',
        key: {
          curr_id: payload.curr_id,
          course_no: payload.course_no,
          section: payload.section,
          department_id: payload.department_id,
        },
        rawValues: rawRow,
        oldValues: null,
        newValues: payload,
        fieldDiffs: [],
        errors: ['Duplicate key found in CSV batch.'],
        warnings,
        editable: true,
      });
      continue;
    }
    seenValidKeys.add(naturalKey);

    const { existingRow, existingError } = await findExistingOffering(payload);
    if (existingError) {
      rows.push({
        previewRowId,
        csvRowNumber,
        action: 'error',
        status: 'error',
        key: {
          curr_id: payload.curr_id,
          course_no: payload.course_no,
          section: payload.section,
          department_id: payload.department_id,
        },
        rawValues: rawRow,
        oldValues: null,
        newValues: payload,
        fieldDiffs: [],
        errors: [`Lookup failed: ${existingError.message}`],
        warnings,
        editable: true,
      });
      continue;
    }

    const oldValues = existingRow ? pickComparableOffering(existingRow) : null;
    const action = existingRow ? 'update' : 'insert';
    rows.push({
      previewRowId,
      csvRowNumber,
      action,
      status: warnings.length > 0 ? 'warning' : 'valid',
      key: {
        curr_id: payload.curr_id,
        course_no: payload.course_no,
        section: payload.section,
        department_id: payload.department_id,
      },
      rawValues: rawRow,
      oldValues,
      newValues: payload,
      fieldDiffs: buildFieldDiffs(oldValues, payload),
      errors: [],
      warnings,
      editable: true,
    });
  }

  return {
    fileName,
    headerRowIndex: headerIndex,
    mapping,
    rows,
    summary: toPreviewSummary(fileName, rows, headerIndex),
  };
}

function buildEditMap(edits) {
  if (!edits) return new Map();

  const map = new Map();

  if (Array.isArray(edits)) {
    for (const entry of edits) {
      const rowId = normalizeCell(entry?.previewRowId);
      if (!rowId) continue;
      map.set(rowId, sanitizeEditPatch(entry?.changes || entry?.values || {}));
    }
    return map;
  }

  if (typeof edits === 'object') {
    for (const [rowId, patch] of Object.entries(edits)) {
      map.set(rowId, sanitizeEditPatch(patch));
    }
  }

  return map;
}

async function confirmImportFromPreview(previewData, editsMap) {
  const departmentLookup = await fetchDepartmentLookup();
  const roomLookup = await fetchRoomLookup();

  const summary = {
    fileName: previewData.fileName,
    totalRows: previewData.summary.totalRows,
    processedRows: 0,
    insertedRows: 0,
    updatedRows: 0,
    failedRows: 0,
    skippedRows: previewData.rows.filter((row) => row.status === 'skipped').length,
    errors: [],
    warnings: [],
  };

  const candidates = [];
  for (const row of previewData.rows) {
    if (!row.editable) continue;

    const editPatch = editsMap.get(row.previewRowId) || {};
    const mergedRaw = {
      ...(row.rawValues || {}),
      ...editPatch,
    };

    const { payload, errors, warnings } = sanitizeRow(mergedRaw, departmentLookup, roomLookup);
    if (warnings.length > 0) {
      summary.warnings.push({ row: row.csvRowNumber, messages: warnings });
    }

    if (errors.length > 0) {
      summary.failedRows += 1;
      summary.errors.push({ row: row.csvRowNumber, messages: errors });
      continue;
    }

    candidates.push({
      csvRowNumber: row.csvRowNumber,
      payload,
      key: buildNaturalKey(payload),
    });
  }

  const seenCandidateKeys = new Set();
  const uniqueCandidates = [];
  for (const candidate of candidates) {
    if (seenCandidateKeys.has(candidate.key)) {
      summary.failedRows += 1;
      summary.errors.push({
        row: candidate.csvRowNumber,
        messages: ['Duplicate key found in reviewed rows.'],
      });
      continue;
    }
    seenCandidateKeys.add(candidate.key);
    uniqueCandidates.push(candidate);
  }

  for (const candidate of uniqueCandidates) {
    const { payload, csvRowNumber } = candidate;
    const { existingRow, existingError } = await findExistingOffering(payload);

    if (existingError) {
      summary.failedRows += 1;
      summary.errors.push({
        row: csvRowNumber,
        messages: [`Lookup failed: ${existingError.message}`],
      });
      continue;
    }

    if (existingRow) {
      const { error: updateError } = await supabaseAdmin
        .from('course_offerings')
        .update(payload)
        .eq('id', existingRow.id);

      if (updateError) {
        summary.failedRows += 1;
        summary.errors.push({
          row: csvRowNumber,
          id: existingRow.id,
          messages: [`Update failed: ${updateError.message}`],
        });
        continue;
      }

      summary.updatedRows += 1;
      summary.processedRows += 1;
      continue;
    }

    const { error: insertError } = await supabaseAdmin
      .from('course_offerings')
      .insert(payload);

    if (insertError) {
      summary.failedRows += 1;
      summary.errors.push({
        row: csvRowNumber,
        messages: [`Insert failed: ${insertError.message}`],
      });
      continue;
    }

    summary.insertedRows += 1;
    summary.processedRows += 1;
  }

  return summary;
}

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('course_offerings')
      .select(
        '*,departments!course_offerings_department_id_fkey(department_id,department_name)',
        { count: 'exact' }
      )
      .order('id', { ascending: true })
      .range(from, to);

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

router.post('/import-csv/preview', async (req, res) => {
  try {
    const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'upload.csv';

    if (!csvText.trim()) {
      return res.status(400).json({
        error: 'csvText is required and must be a non-empty string.',
      });
    }

    const preview = await buildImportPreview({ csvText, fileName });

    cleanupExpiredPreviews();
    const importToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    importPreviewStore.set(importToken, {
      createdAt: Date.now(),
      preview,
    });

    return res.json({
      success: true,
      preview: {
        importToken,
        fileName: preview.fileName,
        summary: preview.summary,
        rows: preview.rows,
      },
    });
  } catch (err) {
    if (Array.isArray(err?.missingHeaders)) {
      return res.status(400).json({
        error: err.message,
        missingHeaders: err.missingHeaders,
        supportedHeaders: err.supportedHeaders,
      });
    }

    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error during CSV import.',
    });
  }
});

router.post('/import-csv/confirm', async (req, res) => {
  try {
    const importToken = typeof req.body?.importToken === 'string' ? req.body.importToken.trim() : '';
    if (!importToken) {
      return res.status(400).json({ error: 'importToken is required.' });
    }

    cleanupExpiredPreviews();
    const storedPreview = importPreviewStore.get(importToken);
    if (!storedPreview) {
      return res.status(410).json({
        error: 'Preview token expired or was not found. Please preview the CSV again.',
      });
    }

    const editsMap = buildEditMap(req.body?.edits);
    const summary = await confirmImportFromPreview(storedPreview.preview, editsMap);
    importPreviewStore.delete(importToken);

    return res.json({ success: true, summary });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error during CSV import confirmation.',
    });
  }
});

router.post('/import-csv', async (req, res) => {
  try {
    const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'upload.csv';

    if (!csvText.trim()) {
      return res.status(400).json({
        error: 'csvText is required and must be a non-empty string.',
      });
    }

    const preview = await buildImportPreview({ csvText, fileName });
    const summary = await confirmImportFromPreview(preview, new Map());

    return res.json({
      success: true,
      summary,
    });
  } catch (err) {
    if (Array.isArray(err?.missingHeaders)) {
      return res.status(400).json({
        error: err.message,
        missingHeaders: err.missingHeaders,
        supportedHeaders: err.supportedHeaders,
      });
    }

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

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .insert([{
        code: code || null,
        course_no: course_no || null,
        descriptive_title: descriptive_title || null,
        curr_id: curr_id ? Number(curr_id) : null,
        department_id: department_id ? Number(department_id) : null,
        section: section || null,
        units: units ? Number(units) : null,
        lec_hrs: lec_hrs ? Number(lec_hrs) : null,
        lab_hrs: lab_hrs ? Number(lab_hrs) : null,
        mth_schedule: mth_schedule || null,
        mth_room_id: mth_room_id || null,
        tfs_schedule: tfs_schedule || null,
        tfs_room_id: tfs_room_id || null,
        merged: merged === true || merged === 'true' ? true : false,
      }])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data?.[0] ?? {});
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

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .update({
        code: code || null,
        course_no: course_no || null,
        descriptive_title: descriptive_title || null,
        curr_id: curr_id ? Number(curr_id) : null,
        department_id: department_id ? Number(department_id) : null,
        section: section || null,
        units: units ? Number(units) : null,
        lec_hrs: lec_hrs ? Number(lec_hrs) : null,
        lab_hrs: lab_hrs ? Number(lab_hrs) : null,
        mth_schedule: mth_schedule || null,
        mth_room_id: mth_room_id || null,
        tfs_schedule: tfs_schedule || null,
        tfs_room_id: tfs_room_id || null,
        merged: merged === true || merged === 'true' ? true : false,
      })
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    return res.json(data[0]);
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

    return res.json({ success: true, deleted: data[0] });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
