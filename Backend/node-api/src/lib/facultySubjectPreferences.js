/**
 * Faculty Subject Preferences Library
 * Handles CRUD operations for faculty subject preferences with auto-generation from specialization
 */

import { supabaseAdmin } from './supabase.js';

const SPECIALIZATION_STOP_WORDS = new Set([
  'AND',
  'THE',
  'OF',
  'IN',
  'ON',
  'FOR',
  'TO',
  'A',
  'AN',
  'BY',
  'WITH',
  'IS',
  'ARE',
  'FROM',
  'AT',
  'AS',
  'OR',
  'DESIGN',
  'ANALYSIS',
  'ENGINEERING',
  'ENGINEER',
  'SYSTEM',
  'SYSTEMS',
  'TECHNOLOGY',
  'TECHNOLOGIES',
  'METHOD',
  'METHODS',
  'PROJECT',
  'PROJECTS',
  'RESEARCH',
  'STUDY',
  'STUDIES',
  'INTRODUCTION',
  'INTRODUCTORY',
  'FUNDAMENTAL',
  'FUNDAMENTALS',
  'CAPSTONE',
  'PRACTICE',
  'APPLICATION',
  'APPLICATIONS',
  'ADVANCED',
  'SPECIALIZATION',
]);

const SPECIALIZATION_SYNONYMS = new Map([
  ['ARCHITECTURAL', 'ARCHITECTURE'],
  ['ARCHITECTURE', 'ARCHITECTURE'],
  ['MATHEMATICS', 'MATH'],
  ['MATH', 'MATH'],
  ['STATISTICS', 'STATISTICS'],
  ['STATISTICAL', 'STATISTICS'],
]);

function normalizeSpecializationToken(token) {
  const cleaned = String(token || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned || cleaned.length < 2 || SPECIALIZATION_STOP_WORDS.has(cleaned)) {
    return '';
  }
  return SPECIALIZATION_SYNONYMS.get(cleaned) || cleaned;
}

function extractMeaningfulKeywords(value) {
  const out = new Set();
  const text = String(value || '').trim().toUpperCase();
  if (!text) {
    return out;
  }

  for (const segment of text.split(/[,;/|]+/)) {
    const words = segment
      .replace(/&/g, ' ')
      .split(/\s+/)
      .map(normalizeSpecializationToken)
      .filter(Boolean);

    for (const word of words) {
      out.add(word);
    }
  }

  return out;
}

export function derivePrepLimitFromMaxUnits(maxUnits) {
  const numeric = Number(maxUnits || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 4;
  // F-H8 dynamic cap: min(4, floor(max_units / 3)), at least 1.
  return Math.max(1, Math.min(4, Math.floor(numeric / 3)));
}

export async function fetchFacultyPrepLimit(facultyId) {
  const { data, error } = await supabaseAdmin
    .from('faculty')
    .select('faculty_max_units')
    .eq('faculty_id', facultyId)
    .single();

  if (error) throw error;
  const facultyMaxUnits = Number(data?.faculty_max_units || 0);
  const prepLimit = derivePrepLimitFromMaxUnits(facultyMaxUnits);
  // Compute current tagged units for this faculty
  const { data: tagsData, error: tagsErr } = await supabaseAdmin
    .from('faculty_subject_tags')
    .select('subject_tag')
    .eq('faculty_id', facultyId);

  if (tagsErr) throw tagsErr;

  const tagged = (tagsData || []).map((r) => String(r.subject_tag || '').toUpperCase());
  let usedTaggedUnits = 0.0;
  if (tagged.length > 0) {
    const { data: subjRows, error: subjErr } = await supabaseAdmin
      .from('subjects')
      .select('subject_code, subject_units')
      .in('subject_code', tagged);
    if (!subjErr && subjRows) {
      const map = {};
      for (const s of subjRows) map[String(s.subject_code || '').toUpperCase()] = Number(s.subject_units || 0);
      for (const t of tagged) usedTaggedUnits += Number(map[t] || 0);
    }
  }

  const remainingUnits = Math.max(0, facultyMaxUnits - usedTaggedUnits);
  return { facultyMaxUnits, prepLimit, usedTaggedUnits, remainingUnits };
}

/**
 * Fetch all subject preferences for a specific faculty member
 * @param {number} facultyId - Faculty ID
 * @returns {Promise<Array>} Array of subject preferences with subject details
 */
/**
 * Fetch all subject preferences for every faculty in one query.
 * Returns a map: { [facultyId]: [{ subject_tag, priority_level }] }
 */
export async function fetchAllFacultySubjectPreferences() {
  try {
    const { data, error } = await supabaseAdmin
      .from('faculty_subject_tags')
      .select('faculty_id, subject_tag, priority_level')
      .order('faculty_id', { ascending: true })
      .order('priority_level', { ascending: true });

    if (error) throw error;

    const map = {};
    for (const row of data || []) {
      const key = String(row.faculty_id);
      if (!map[key]) map[key] = [];
      map[key].push({ subject_tag: row.subject_tag, priority_level: row.priority_level });
    }
    return map;
  } catch (err) {
    console.error('fetchAllFacultySubjectPreferences error:', err);
    throw err;
  }
}

export async function fetchFacultySubjectPreferencesForFaculty(facultyId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('faculty_subject_tags')
      .select(
        `
        faculty_id,
        subject_tag,
        priority_level,
        created_at,
        updated_at
        `
      )
      .eq('faculty_id', facultyId)
      .order('priority_level', { ascending: true });

    if (error) {
      console.error('Error fetching faculty subject preferences:', error);
      throw error;
    }

    const rows = data || [];
    // Attach subject_units where possible
    const codes = rows.map((r) => String(r.subject_tag || '').toUpperCase()).filter(Boolean);
    let subjMap = {};
    if (codes.length > 0) {
      const { data: subjRows, error: subjErr } = await supabaseAdmin
        .from('subjects')
        .select('subject_code, subject_units')
        .in('subject_code', codes);
      if (!subjErr && subjRows) {
        for (const s of subjRows) subjMap[String(s.subject_code || '').toUpperCase()] = Number(s.subject_units || 0);
      }
    }
    return rows.map((r) => ({
      ...r,
      subject_units: Number(subjMap[String(r.subject_tag || '').toUpperCase()] || 0),
    }));
  } catch (err) {
    console.error('fetchFacultySubjectPreferencesForFaculty error:', err);
    throw err;
  }
}

export async function fetchFacultyPreferenceRecordsForFaculty(facultyId, { limit = 20, offset = 0 } = {}) {
  try {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const { data, error, count } = await supabaseAdmin
      .from('faculty_preference_records')
      .select('id, faculty_id, subject_tag, priority_level, source_table, record_action, created_at', { count: 'exact' })
      .eq('faculty_id', facultyId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1);

    if (error) {
      throw error;
    }

    const rows = data || [];
    const codes = rows.map((r) => String(r.subject_tag || '').toUpperCase()).filter(Boolean);
    let subjMap = {};

    if (codes.length > 0) {
      const { data: subjRows, error: subjErr } = await supabaseAdmin
        .from('subjects')
        .select('subject_code, subject_descriptive_title, subject_units')
        .in('subject_code', codes);

      if (!subjErr && subjRows) {
        for (const s of subjRows) {
          subjMap[String(s.subject_code || '').toUpperCase()] = {
            title: s.subject_descriptive_title || null,
            units: Number(s.subject_units || 0),
          };
        }
      }
    }

    const totalCount = Number(count ?? rows.length);

    return {
      records: rows.map((row) => {
        const meta = subjMap[String(row.subject_tag || '').toUpperCase()] || {};
        return {
          ...row,
          subject_descriptive_title: meta.title,
          subject_units: meta.units ?? 0,
        };
      }),
      count: totalCount,
      limit: safeLimit,
      offset: safeOffset,
      hasMore: safeOffset + rows.length < totalCount,
    };
  } catch (err) {
    console.error('fetchFacultyPreferenceRecordsForFaculty error:', err);
    throw err;
  }
}

export async function recordFacultyPreferenceRecord({ facultyId, subjectTag, priorityLevel, sourceTable = 'faculty_subject_tags', recordAction = 'upsert' }) {
  try {
    const payload = {
      faculty_id: facultyId,
      subject_tag: String(subjectTag || '').trim().toUpperCase(),
      priority_level: Number(priorityLevel) || 2,
      source_table: sourceTable,
      record_action: recordAction,
      created_at: new Date().toISOString(),
    };

    const upsertResult = await supabaseAdmin
      .from('faculty_preference_records')
      .upsert(payload, { onConflict: 'faculty_id,subject_tag' })
      .select('id, faculty_id, subject_tag, priority_level, source_table, record_action, created_at')
      .single();

    if (!upsertResult.error) {
      return upsertResult.data || null;
    }

    const message = String(upsertResult.error?.message || '').toLowerCase();
    const code = String(upsertResult.error?.code || '');

    const conflictMissing =
      code === '42P10' ||
      message.includes('no unique or exclusion constraint matching the on conflict specification');

    if (!conflictMissing) {
      if (code === '42P01' || message.includes('does not exist')) {
        return null;
      }
      throw upsertResult.error;
    }

    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from('faculty_preference_records')
      .select('id')
      .eq('faculty_id', payload.faculty_id)
      .eq('subject_tag', payload.subject_tag)
      .limit(1);

    if (existingErr) {
      throw existingErr;
    }

    if (existingRows && existingRows.length > 0) {
      const { data: updatedRows, error: updateErr } = await supabaseAdmin
        .from('faculty_preference_records')
        .update(payload)
        .eq('id', existingRows[0].id)
        .select('id, faculty_id, subject_tag, priority_level, source_table, record_action, created_at');

      if (updateErr) {
        throw updateErr;
      }

      return updatedRows ? updatedRows[0] : null;
    }

    const { data: insertedRows, error: insertErr } = await supabaseAdmin
      .from('faculty_preference_records')
      .insert(payload)
      .select('id, faculty_id, subject_tag, priority_level, source_table, record_action, created_at');

    if (insertErr) {
      throw insertErr;
    }

    return insertedRows ? insertedRows[0] : null;
  } catch (err) {
    console.error('recordFacultyPreferenceRecord error:', err);
    return null;
  }
}

export async function deleteFacultyPreferenceRecord({ facultyId, recordId }) {
  try {
    const query = supabaseAdmin.from('faculty_preference_records').delete().eq('id', recordId);
    if (facultyId !== undefined && facultyId !== null) {
      query.eq('faculty_id', facultyId);
    }

    const { data, error } = await query.select('id, faculty_id, subject_tag, priority_level, source_table, record_action, created_at');

    if (error) {
      throw error;
    }

    return data ? data[0] : null;
  } catch (err) {
    console.error('deleteFacultyPreferenceRecord error:', err);
    throw err;
  }
}

/**
 * Save (upsert) a faculty subject preference with department validation
 * @param {Object} params
 * @param {number} params.facultyId - Faculty ID
 * @param {string} params.subjectTag - Subject tag/code (text, serves as history)
 * @param {number} params.priorityLevel - Priority level (1-3)
 * @returns {Promise<Object>} Created/updated preference record
 */
export async function saveFacultySubjectPreference({ facultyId, subjectTag, priorityLevel }) {
  try {
    // Validate priority level
    if (!priorityLevel || priorityLevel < 1 || priorityLevel > 3) {
      throw new Error('Priority level must be 1, 2, or 3');
    }

    if (!subjectTag || subjectTag.trim() === '') {
      throw new Error('Subject tag is required');
    }

    // Normalize subject tag
    const normalizedTag = subjectTag.trim().toUpperCase();

    // Enforce unit-sum based limit: faculty_max_units - sum(tagged subject_units)
    const prepMeta = await fetchFacultyPrepLimit(facultyId);
    const facultyMaxUnits = Number(prepMeta.facultyMaxUnits || 0);
    const usedTaggedUnits = Number(prepMeta.usedTaggedUnits || 0);

    const { data: subjRow, error: subjErr } = await supabaseAdmin
      .from('subjects')
      .select('subject_code, subject_units')
      .eq('subject_code', normalizedTag)
      .limit(1)
      .single();
    if (subjErr) {
      // If we can't find the subject units, fall back to allowing upsert but warn
      console.warn('Could not fetch subject units for', normalizedTag, subjErr.message || subjErr);
    }
    const subjectUnits = Number(subjRow?.subject_units || 0);

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('faculty_subject_tags')
      .select('subject_tag')
      .eq('faculty_id', facultyId);

    if (existingError) {
      throw existingError;
    }

    const existing = existingRows || [];
    const alreadyTagged = existing.some((row) => String(row.subject_tag || '').toUpperCase() === normalizedTag);
    if (!alreadyTagged) {
      const remainingUnits = Math.max(0, facultyMaxUnits - usedTaggedUnits);
      if (facultyMaxUnits > 0 && subjectUnits > remainingUnits) {
        throw new Error(`Cannot add ${normalizedTag}: subject units (${subjectUnits}) exceed remaining faculty units (${remainingUnits}).`);
      }
    }

    // Upsert preference
    const { data, error } = await supabaseAdmin
      .from('faculty_subject_tags')
      .upsert(
        {
          faculty_id: facultyId,
          subject_tag: normalizedTag,
          priority_level: priorityLevel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'faculty_id,subject_tag' }
      )
      .select();

    if (error) {
      throw error;
    }

    if (data && data[0]) {
      await recordFacultyPreferenceRecord({
        facultyId,
        subjectTag: data[0].subject_tag,
        priorityLevel: data[0].priority_level,
        sourceTable: 'faculty_subject_tags',
        recordAction: 'upsert',
      });
    }

    return data ? data[0] : null;
  } catch (err) {
    console.error('saveFacultySubjectPreference error:', err);
    throw err;
  }
}

/**
 * Delete a faculty subject preference
 * @param {Object} params
 * @param {number} params.facultyId - Faculty ID
 * @param {string} params.subjectTag - Subject tag/code
 * @returns {Promise<Object>} Deleted record
 */
export async function deleteFacultySubjectPreference({ facultyId, subjectTag }) {
  try {
    const normalizedTag = subjectTag.trim().toUpperCase();

    const { data, error } = await supabaseAdmin
      .from('faculty_subject_tags')
      .delete()
      .eq('faculty_id', facultyId)
      .eq('subject_tag', normalizedTag)
      .select();

    if (error) {
      throw error;
    }

    return data ? data[0] : null;
  } catch (err) {
    console.error('deleteFacultySubjectPreference error:', err);
    throw err;
  }
}

/**
 * Calculate match score for subject matching against specialization keywords
 * @param {string} keyword - Specialization text or seed subject title/code
 * @param {Object} subject - Subject object with code, title, course_no
 * @returns {number} Match score (0-40)
 */
export function scoreSubjectMatch(keyword, subject) {
  const sourceText = String(keyword || '').trim().toUpperCase();
  if (!sourceText) {
    return 0;
  }

  const targetCode = String(subject.code || subject.subject_code || '').trim().toUpperCase();
  const targetTitle = String(subject.title || subject.subject_descriptive_title || '').trim().toUpperCase();
  const targetCourseNo = String(subject.course_no || subject.subject_course_no || '').trim().toUpperCase();
  const targetText = [targetCode, targetTitle, targetCourseNo].filter(Boolean).join(' ');

  const sourceTerms = extractMeaningfulKeywords(sourceText);
  const targetTerms = extractMeaningfulKeywords(targetText);

  if (sourceTerms.size === 0) {
    return 0;
  }

  let score = 0;

  for (const term of sourceTerms) {
    if (targetTerms.has(term)) {
      score += term.includes(' ') ? 18 : 8;
    }
  }

  // Exact match in title (24 points)
  if (targetTitle === sourceText) {
    score += 24;
  }

  // Exact match in code (16 points)
  if (targetCode === sourceText) {
    score += 16;
  }

  // Exact match in course_no (14 points)
  if (targetCourseNo === sourceText) {
    score += 14;
  }

  // Partial matches (10 points each)
  if (targetTitle.includes(sourceText)) {
    score += 10;
  }
  if (targetCode.includes(sourceText)) {
    score += 10;
  }
  if (targetCourseNo.includes(sourceText)) {
    score += 10;
  }

  if (sourceText.length >= 4 && targetText.includes(sourceText)) {
    score += 6;
  }

  return score;
}

/**
 * Auto-generate faculty subject preferences from specialization field
 * Uses subject code as the tag for historical reference
 * @param {number} facultyId - Faculty ID
 * @returns {Promise<Array>} Auto-generated preference records
 */
export async function autoGenerateFacultySubjectPreferences(facultyId) {
  try {
    // Fetch faculty record with specialization
    const { data: facultyData, error: facultyError } = await supabaseAdmin
      .from('faculty')
      .select('faculty_specialization, department_id, faculty_max_units')
      .eq('faculty_id', facultyId)
      .single();

    if (facultyError) {
      throw new Error(`Faculty not found: ${facultyError.message}`);
    }

    if (!facultyData) {
      throw new Error('Faculty not found');
    }

    const prepLimit = derivePrepLimitFromMaxUnits(facultyData?.faculty_max_units);

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('faculty_subject_tags')
      .select('subject_tag, priority_level')
      .eq('faculty_id', facultyId);

    if (existingError) {
      throw existingError;
    }

    const specialization = String(facultyData.faculty_specialization || '').trim();

    const existingCodes = (existingRows || [])
      .map((row) => String(row.subject_tag || '').trim().toUpperCase())
      .filter(Boolean);

    const existingTitleSeeds = [];
    if (existingCodes.length > 0) {
      const { data: seedRows, error: seedError } = await supabaseAdmin
        .from('subjects')
        .select('subject_code, subject_descriptive_title')
        .in('subject_code', existingCodes);

      if (seedError) {
        throw seedError;
      }

      for (const row of seedRows || []) {
        if (row?.subject_code) {
          existingTitleSeeds.push(String(row.subject_code || '').trim());
        }
        if (row?.subject_descriptive_title) {
          existingTitleSeeds.push(String(row.subject_descriptive_title || '').trim());
        }
      }
    }

    const seedTexts = [specialization, ...existingTitleSeeds].filter(Boolean);

    const keywords = seedTexts;

    if (keywords.length === 0) {
      return [];
    }

    const fetchSubjects = async (activeOnly) => {
      const query = supabaseAdmin
        .from('subjects')
        .select('subject_code, subject_descriptive_title, department_id, subject_units, subject_status');

      if (activeOnly) {
        query.eq('subject_status', 'active');
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Error fetching subjects: ${error.message}`);
      }
      return data || [];
    };

    const scoreSubjects = (subjects) => {
      const uniqueSubjects = new Map();

      for (const subject of subjects) {
        let maxScore = 0;

        for (const keyword of keywords) {
          const score = scoreSubjectMatch(keyword, subject);
          maxScore = Math.max(maxScore, score);
        }

        if (maxScore > 0) {
          let priorityLevel = 3;
          if (maxScore >= 45) {
            priorityLevel = 1;
          } else if (maxScore >= 20) {
            priorityLevel = 2;
          }

          const subjectTag = (subject.subject_code || '').trim().toUpperCase();
          if (subjectTag) {
            uniqueSubjects.set(subjectTag, {
              faculty_id: facultyId,
              subject_tag: subjectTag,
              priority_level: priorityLevel,
              match_score: maxScore,
              _subject_units: Number(subject.subject_units || 0),
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      return uniqueSubjects;
    };

    // Prefer active subjects first so generated preferences stay aligned with
    // what the UI can already show. If that yields nothing, fall back to the
    // full subject table so inactive-but-valid matches do not get lost.
    let uniqueSubjects = scoreSubjects(await fetchSubjects(true));
    if (uniqueSubjects.size === 0) {
      uniqueSubjects = scoreSubjects(await fetchSubjects(false));
    }

    if (uniqueSubjects.size === 0) {
      return []; // No matches found
    }

    const existingTagSet = new Set((existingRows || []).map((r) => String(r.subject_tag || '').toUpperCase()));
    const allGenerated = Array.from(uniqueSubjects.values());
    const existingMatches = allGenerated.filter((r) => existingTagSet.has(r.subject_tag));
    const newCandidates = allGenerated
      .filter((r) => !existingTagSet.has(r.subject_tag))
      .sort((a, b) => (b.match_score - a.match_score) || (a.priority_level - b.priority_level) || a.subject_tag.localeCompare(b.subject_tag));

    // Convert prepLimit/count-based slot to remaining units-based generation
    const prepMeta = await fetchFacultyPrepLimit(facultyId);
    const facultyMaxUnits = Number(prepMeta.facultyMaxUnits || 0);
    const usedTaggedUnits = Number(prepMeta.usedTaggedUnits || 0);
    let remainingUnits = Math.max(0, facultyMaxUnits - usedTaggedUnits);

    const limitedNew = [];
    for (const cand of newCandidates) {
      const candUnits = Number(cand._subject_units || 0);
      if (candUnits <= remainingUnits && remainingUnits > 0) {
        limitedNew.push(cand);
        remainingUnits -= candUnits;
      }
      if (remainingUnits <= 0) break;
    }

    // Upsert existing matches (priority refresh) + capped number of new tags.
    const tagsArray = [...existingMatches, ...limitedNew].map(({ match_score, _subject_units, ...row }) => row);
    if (tagsArray.length === 0) {
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from('faculty_subject_tags')
      .upsert(tagsArray, { onConflict: 'faculty_id,subject_tag' })
      .select();

    if (error) {
      throw error;
    }

    await Promise.all((data || []).map((row) => recordFacultyPreferenceRecord({
      facultyId,
      subjectTag: row.subject_tag,
      priorityLevel: row.priority_level,
      sourceTable: 'faculty_subject_tags',
      recordAction: 'auto-generate',
    })));

    return data || [];
  } catch (err) {
    console.error('autoGenerateFacultySubjectPreferences error:', err);
    throw err;
  }
}

/**
 * Auto-generate specialization keywords from a faculty's selected subject preferences
 * Produces canonicalized variants for each selected subject descriptive title.
 * Example: "Discrete Mathematics" -> ["DISCRETE MATHEMATICS","DISCRETE MATH","MATH"]
 * @param {number} facultyId
 * @returns {Promise<Array<string>>} Array of generated specialization keyword strings
 */
export async function autoGenerateSpecializationFromPreferences(facultyId) {
  try {
    const prefs = await fetchFacultySubjectPreferencesForFaculty(facultyId);
    if (!prefs || prefs.length === 0) return [];

    const codes = prefs
      .map((p) => String(p.subject_tag || '').trim().toUpperCase())
      .filter(Boolean);

    if (codes.length === 0) return [];

    const { data: subjRows, error: subjErr } = await supabaseAdmin
      .from('subjects')
      .select('subject_code, subject_descriptive_title')
      .in('subject_code', codes);

    if (subjErr) {
      throw subjErr;
    }

    const generated = new Set();

    for (const s of subjRows || []) {
      const rawTitle = String(s.subject_descriptive_title || '').trim();
      if (!rawTitle) continue;

      // Original descriptive title (cleaned)
      const orig = rawTitle.toUpperCase().replace(/\s+/g, ' ').trim();
      if (orig) generated.add(orig);

      // Tokenize and normalize each word (uses synonyms map)
      const words = orig.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
      const mapped = words.map((w) => SPECIALIZATION_SYNONYMS.get(w) || w);

      if (mapped.length > 0) {
        // Mapped full phrase (e.g., DISCRETE MATH)
        generated.add(mapped.join(' '));

        // Single-term variants (e.g., MATH)
        for (const token of mapped) {
          if (token && token.length >= 2 && !SPECIALIZATION_STOP_WORDS.has(token)) {
            generated.add(token);
          }
        }
      }
    }

    return Array.from(generated);
  } catch (err) {
    console.error('autoGenerateSpecializationFromPreferences error:', err);
    throw err;
  }
}

/**
 * Build a dictionary/map of faculty preferences for efficient GA lookups
 * Format: { [facultyId]: { [subjectTag]: priorityLevel } }
 * @param {Array} rows - Rows from faculty_subject_tags table
 * @returns {Object} Dictionary with faculty IDs as keys
 */
export function buildFacultyPreferenceMap(rows) {
  const map = {};

  for (const row of rows) {
    if (!map[row.faculty_id]) {
      map[row.faculty_id] = {};
    }
    map[row.faculty_id][row.subject_tag] = row.priority_level;
  }

  return map;
}

/**
 * Fetch all faculty subject preferences as a dictionary for GA use
 * @returns {Promise<Object>} Dictionary format: { [facultyId]: { [subjectTag]: priorityLevel } }
 */
export async function fetchFacultyPreferenceMapForGA() {
  try {
    const { data, error } = await supabaseAdmin
      .from('faculty_subject_tags')
      .select('faculty_id, subject_tag, priority_level');

    if (error) {
      throw error;
    }

    return buildFacultyPreferenceMap(data || []);
  } catch (err) {
    console.error('fetchFacultyPreferenceMapForGA error:', err);
    throw err;
  }
}

/**
 * Get all available subjects for a faculty member's department
 * Used for populating subject selector in UI
 * Note: Returns current semester subjects; tags are preserved as text for history
 * @param {number} facultyId - Faculty ID
 * @returns {Promise<Array>} Array of subjects from faculty's department
 */
export async function fetchAvailableSubjectsForFaculty(facultyId) {
  try {
    // Fetch all active subjects across all departments
    
    const { data: subjectsData, error: subjectsError } = await supabaseAdmin
      .from('subjects')
      .select('subject_code, subject_descriptive_title, subject_status, subject_units')
      .eq('subject_status', 'active')
      .order('subject_code', { ascending: true });

    if (subjectsError) {
      console.error(`[fetchAvailableSubjectsForFaculty] Database error:`, subjectsError);
      throw subjectsError;
    }
    
    
    if (!subjectsData || subjectsData.length === 0) {
      console.warn(`[fetchAvailableSubjectsForFaculty] No ACTIVE subjects found in database`);
      const { data: allSubjects, error: allError } = await supabaseAdmin
        .from('subjects')
        .select('subject_code, subject_status')
        .limit(5);
    }

    return subjectsData || [];
  } catch (err) {
    console.error('[fetchAvailableSubjectsForFaculty] error:', err);
    throw err;
  }
}
