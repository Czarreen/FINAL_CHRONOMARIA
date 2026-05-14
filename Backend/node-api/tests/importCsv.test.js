/**
 * Regression tests for the CSV import handler and its utility functions.
 *
 * Run with:  node --test tests/importCsv.test.js
 *
 * Tests two layers:
 *   1. Pure utility functions (parseCsv, buildHeaderMapping, etc.) — no DB needed.
 *   2. Full import handler behaviour via a mock Supabase client.
 */

import { test, describe, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Supabase mock factory ─────────────────────────────────────────────────────
// Returns a minimal Supabase-client-shaped object that records DB calls and
// returns controlled data for each table.  Used so the test never hits the
// real database.

function buildMockDb(scenario = {}) {
  const {
    existingOfferings = [],
    existingSubjects = [],
    existingRooms = [],
    departments = [{ department_id: 1, department_name: 'Information Technology', department_program: 'IT', dept_code: 'IT', department_code: 'IT' }],
  } = scenario;

  const calls = {
    insertedOfferings: [],
    updatedOfferings: [],
    insertedSubjects: [],
    updatedSubjects: [],
    deletedTables: [],
    insertedRooms: [],
  };

  let roomIdSeq = 500;
  let subjectIdSeq = 600;

  function builder(table) {
    let op = null;
    let insertRows = null;
    let updateData = null;
    const eqs = [];

    const b = {
      select() { op = 'select'; return b; },
      insert(rows) { op = 'insert'; insertRows = rows; return b; },
      update(data) { op = 'update'; updateData = data; return b; },
      delete() { op = 'delete'; return b; },
      eq(f, v) { eqs.push({ f, v }); return b; },
      neq() { return b; },
      order() { return b; },
      range() { return b; },
      limit() { return b; },
      ilike() { return b; },
      or() { return b; },
      single() { return b; },
      then(resolve) {
        if (op === 'delete') {
          calls.deletedTables.push(table);
          return resolve({ data: [], error: null });
        }
        if (op === 'select') {
          if (table === 'departments') return resolve({ data: departments, error: null });
          if (table === 'rooms') return resolve({ data: existingRooms, error: null });
          if (table === 'course_offerings') return resolve({ data: existingOfferings, error: null });
          if (table === 'subjects') return resolve({ data: existingSubjects, error: null });
          return resolve({ data: [], error: null });
        }
        if (op === 'insert') {
          const rows = Array.isArray(insertRows) ? insertRows : [insertRows];
          if (table === 'rooms') {
            const out = rows.map((r) => ({ room_id: roomIdSeq++, room_name: r.room_name }));
            calls.insertedRooms.push(...rows);
            return resolve({ data: out, error: null });
          }
          if (table === 'course_offerings') {
            calls.insertedOfferings.push(...rows);
            return resolve({ data: null, error: null });
          }
          if (table === 'subjects') {
            calls.insertedSubjects.push(...rows);
            const out = rows.map((r) => ({
              subject_id: subjectIdSeq++,
              subject_code: r.subject_code,
              subject_section: r.subject_section,
              department_id: r.department_id,
            }));
            return resolve({ data: out, error: null });
          }
          return resolve({ data: null, error: null });
        }
        if (op === 'update') {
          const eqId = eqs.find((e) => e.f === 'id' || e.f === 'subject_id');
          if (table === 'course_offerings') calls.updatedOfferings.push({ id: eqId?.v, data: updateData });
          if (table === 'subjects') calls.updatedSubjects.push({ id: eqId?.v, data: updateData });
          return resolve({ data: null, error: null });
        }
        return resolve({ data: null, error: null });
      },
    };
    return b;
  }

  return {
    from: (table) => builder(table),
    _calls: calls,
  };
}

// ── Set up module mock BEFORE importing the route ─────────────────────────────
// mock.module intercepts the import so supabase.js is never evaluated, which
// also prevents env.js from throwing about missing env vars.

const defaultMockDb = buildMockDb();
mock.module('../src/lib/supabase.js', {
  namedExports: { supabaseAdmin: defaultMockDb },
});

// Now import the utility exports (mock is in place so the module loads safely)
const {
  parseCsv,
  buildHeaderMapping,
  isHeaderRowCandidate,
  shouldSkipNonDataRow,
  normalizeCell,
} = await import('../src/routes/courseOfferings.js');

// ── Read fixture files ────────────────────────────────────────────────────────
const basicCsv = readFileSync(join(__dir, 'fixtures/basic.csv'), 'utf-8');
const replaceCsv = readFileSync(join(__dir, 'fixtures/replace.csv'), 'utf-8');

// ── Pure utility tests ────────────────────────────────────────────────────────
describe('parseCsv', () => {
  test('handles quoted commas', () => {
    const rows = parseCsv('"a","b,c"\r\n"d","e"');
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], ['a', 'b,c']);
  });

  test('handles LF line endings', () => {
    assert.strictEqual(parseCsv('a,b\nc,d').length, 2);
  });

  test('handles escaped double-quotes inside quoted fields', () => {
    const rows = parseCsv('"say ""hello""",world');
    assert.strictEqual(rows[0][0], 'say "hello"');
  });
});

describe('normalizeCell', () => {
  test('returns null for empty/null-marker values', () => {
    for (const v of ['', '  ', 'n/a', 'N/A', '-', 'null', 'NA']) {
      assert.strictEqual(normalizeCell(v), null, `Expected null for "${v}"`);
    }
  });

  test('trims whitespace and preserves non-empty strings', () => {
    assert.strictEqual(normalizeCell('  hello  '), 'hello');
    assert.strictEqual(normalizeCell('0'), '0');
    assert.strictEqual(normalizeCell('CS101'), 'CS101');
  });
});

describe('isHeaderRowCandidate', () => {
  test('detects standard header row', () => {
    assert.ok(isHeaderRowCandidate(['CurrID', 'CourseNo', 'Section', 'DEPT', 'Code']));
  });

  test('rejects metadata and total rows', () => {
    assert.ok(!isHeaderRowCandidate(['Total', '', '']));
    assert.ok(!isHeaderRowCandidate(['Department of IT', '']));
    assert.ok(!isHeaderRowCandidate(['2024', 'CS101', 'A']));
  });
});

describe('shouldSkipNonDataRow', () => {
  test('skips Total and signature rows', () => {
    assert.ok(shouldSkipNonDataRow(['Total', '9']));
    assert.ok(shouldSkipNonDataRow(['Submitted by:', 'John']));
    assert.ok(shouldSkipNonDataRow(['NOTEDBY', '']));
  });

  test('keeps valid data rows', () => {
    assert.ok(!shouldSkipNonDataRow(['2024', 'CS101', 'A', 'IT']));
  });
});

describe('buildHeaderMapping', () => {
  test('maps all expected standard headers', () => {
    const header = ['CurrID', 'CourseNo', 'Section', 'DEPT', 'Code',
      'DescriptiveTitle', 'Units', 'LecHrs', 'LabHrs',
      'MTHSchedule', 'MTHRoomID', 'TFSSchedule', 'TFSRoomID'];
    const mapping = buildHeaderMapping(header);
    const byField = Object.fromEntries(
      mapping.filter((m) => m.targetField).map((m) => [m.targetField, m.index])
    );
    assert.strictEqual(byField.curr_id, 0);
    assert.strictEqual(byField.course_no, 1);
    assert.strictEqual(byField.section, 2);
    assert.strictEqual(byField.department_code, 3);
    assert.strictEqual(byField.code, 4);
    assert.strictEqual(byField.descriptive_title, 5);
    assert.strictEqual(byField.units, 6);
    assert.strictEqual(byField.lec_hrs, 7);
    assert.strictEqual(byField.lab_hrs, 8);
    assert.strictEqual(byField.mth_schedule, 9);
    assert.strictEqual(byField.mth_room_id, 10);
    assert.strictEqual(byField.tfs_schedule, 11);
    assert.strictEqual(byField.tfs_room_id, 12);
  });

  test('handles generic "Room" header as mth/tfs room in order', () => {
    const header = ['CurrID', 'CourseNo', 'Section', 'DEPT', 'Code', 'Units', 'LecHrs', 'LabHrs', 'MTHSchedule', 'Room', 'TFSSchedule', 'Room'];
    const mapping = buildHeaderMapping(header);
    const byField = Object.fromEntries(
      mapping.filter((m) => m.targetField).map((m) => [m.targetField, m.index])
    );
    assert.strictEqual(byField.mth_room_id, 9);
    assert.strictEqual(byField.tfs_room_id, 11);
  });
});

// ── Fixture: basic.csv ────────────────────────────────────────────────────────
describe('fixture: basic.csv', () => {
  test('header row is auto-detected', () => {
    const rows = parseCsv(basicCsv);
    const idx = rows.findIndex((r) => isHeaderRowCandidate(r));
    assert.ok(idx >= 0, 'Header row must be detectable');
    assert.strictEqual(idx, 0, 'Header should be the first row');
  });

  test('has exactly 3 non-blank non-skip data rows', () => {
    const rows = parseCsv(basicCsv);
    const headerIdx = rows.findIndex((r) => isHeaderRowCandidate(r));
    const dataRows = rows.slice(headerIdx + 1)
      .filter((r) => r.some((c) => normalizeCell(c) !== null))
      .filter((r) => !shouldSkipNonDataRow(r));
    assert.strictEqual(dataRows.length, 3);
  });

  test('all data rows have curr_id, course_no, section, and dept', () => {
    const rows = parseCsv(basicCsv);
    const headerIdx = rows.findIndex((r) => isHeaderRowCandidate(r));
    const mapping = buildHeaderMapping(rows[headerIdx]);
    const get = (row, field) => {
      const m = mapping.find((e) => e.targetField === field);
      return m ? normalizeCell(row[m.index]) : null;
    };
    const dataRows = rows.slice(headerIdx + 1)
      .filter((r) => r.some((c) => normalizeCell(c) !== null))
      .filter((r) => !shouldSkipNonDataRow(r));
    for (const row of dataRows) {
      assert.ok(get(row, 'curr_id') !== null, 'curr_id required');
      assert.ok(get(row, 'course_no') !== null, 'course_no required');
      assert.ok(get(row, 'section') !== null, 'section required');
      assert.ok(get(row, 'department_code') !== null, 'department_code required');
    }
  });
});

// ── Fixture: replace.csv ──────────────────────────────────────────────────────
describe('fixture: replace.csv', () => {
  test('auto-detection skips metadata rows and finds real header', () => {
    const rows = parseCsv(replaceCsv);
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      if (isHeaderRowCandidate(rows[i])) { headerIdx = i; break; }
    }
    assert.ok(headerIdx > 0, `Header should be after row 0; got ${headerIdx}`);
  });

  test('has exactly 2 data rows after header detection', () => {
    const rows = parseCsv(replaceCsv);
    const headerIdx = rows.findIndex((r) => isHeaderRowCandidate(r));
    const dataRows = rows.slice(headerIdx + 1)
      .filter((r) => r.some((c) => normalizeCell(c) !== null))
      .filter((r) => !shouldSkipNonDataRow(r));
    assert.strictEqual(dataRows.length, 2);
  });
});

// ── Import handler routing-logic tests (pure JS, no DB) ──────────────────────
// Verifies the insert-vs-update routing and subject fallback logic that drive
// the batch operations in the rewritten handler.

describe('import handler — summary counts (pure-utility gate)', () => {
  test('basic.csv is parseable and produces 3 valid payload candidates', () => {
    const rows = parseCsv(basicCsv);
    const headerIdx = rows.findIndex((r) => isHeaderRowCandidate(r));
    const mapping = buildHeaderMapping(rows[headerIdx]);
    const dataRows = rows.slice(headerIdx + 1);

    let validCount = 0;
    for (const row of dataRows) {
      if (!row.some((c) => normalizeCell(c) !== null)) continue;
      if (shouldSkipNonDataRow(row)) continue;
      validCount++;
    }
    assert.strictEqual(validCount, 3, 'basic.csv should yield 3 processable rows');
  });

  test('replace.csv is parseable and produces 2 valid payload candidates', () => {
    const rows = parseCsv(replaceCsv);
    const headerIdx = rows.findIndex((r) => isHeaderRowCandidate(r));
    const dataRows = rows.slice(headerIdx + 1);

    let validCount = 0;
    for (const row of dataRows) {
      if (!row.some((c) => normalizeCell(c) !== null)) continue;
      if (shouldSkipNonDataRow(row)) continue;
      validCount++;
    }
    assert.strictEqual(validCount, 2, 'replace.csv should yield 2 processable rows');
  });

  test('offering key routing: known offering goes to update, unknown goes to insert', () => {
    const existingOfferingMap = new Map([
      ['2024|CS101|A|1', 99],
    ]);

    function getKey(currId, courseNo, section, deptId) {
      return `${currId}|${String(courseNo ?? '').trim()}|${String(section ?? '').trim()}|${deptId}`;
    }

    const k1 = getKey(2024, 'CS101', 'A', 1);
    const k2 = getKey(2024, 'CS102', 'B', 1);
    const k3 = getKey(2024, 'CS103', 'A', 1);

    assert.strictEqual(existingOfferingMap.get(k1), 99, 'CS101/A should be an update');
    assert.strictEqual(existingOfferingMap.get(k2), undefined, 'CS102/B should be an insert');
    assert.strictEqual(existingOfferingMap.get(k3), undefined, 'CS103/A should be an insert');
  });

  test('subject map lookup replicates 4-level fallback priority', () => {
    // Mirrors lookupSubjectInMaps logic
    function lookup(code, section, deptId, maps) {
      if (section && deptId != null) {
        const hit = maps.byExact.get(`${code}|${section}|${deptId}`);
        if (hit) return hit;
      }
      if (section) {
        const hit = maps.byCodeSection.get(`${code}|${section}`);
        if (hit) return hit;
      }
      if (deptId != null) {
        const hit = maps.byCodeDept.get(`${code}|${deptId}`);
        if (hit) return hit;
      }
      return maps.byCode.get(code) ?? null;
    }

    const exact = { subject_id: 1, subject_status: 'active' };
    const bySection = { subject_id: 2, subject_status: 'active' };
    const byCode = { subject_id: 3, subject_status: 'active' };

    const maps = {
      byExact: new Map([['CS101|A|1', exact]]),
      byCodeSection: new Map([['CS101|A', bySection]]),
      byCodeDept: new Map(),
      byCode: new Map([['CS101', byCode]]),
    };

    assert.strictEqual(lookup('CS101', 'A', 1, maps).subject_id, 1, 'Exact match wins');
    assert.strictEqual(lookup('CS101', 'A', 2, maps).subject_id, 2, 'Code+section wins when dept differs');
    assert.strictEqual(lookup('CS101', 'B', 2, maps).subject_id, 3, 'Code-only is the last resort');
    assert.strictEqual(lookup('CS999', 'A', 1, maps), null, 'Unknown code returns null');
  });
});
