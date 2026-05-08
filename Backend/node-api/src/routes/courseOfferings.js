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

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('course_offerings')
      .select(
        'id,curr_id,code,course_no,department_id,section,descriptive_title,units,lec_hrs,lab_hrs,mth_schedule,mth_room_id,tfs_schedule,tfs_room_id,departments!course_offerings_department_id_fkey(department_id,department_name)',
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

router.post('/import-csv', async (req, res) => {
  try {
    const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'upload.csv';

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
    const roomLookup = await fetchRoomLookup();

    const summary = {
      fileName,
      totalRows: dataRows.length,
      processedRows: 0,
      insertedRows: 0,
      updatedRows: 0,
      failedRows: 0,
      skippedRows: 0,
      errors: [],
      warnings: [],
    };

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

export default router;
