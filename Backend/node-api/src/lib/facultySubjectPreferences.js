/**
 * Faculty Subject Preferences Library
 * Handles CRUD operations for faculty subject preferences with auto-generation from specialization
 */

import { supabaseAdmin } from './supabase.js';

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
 * @param {string} keyword - Single keyword from specialization
 * @param {Object} subject - Subject object with code, title, course_no
 * @returns {number} Match score (0-40)
 */
export function scoreSubjectMatch(keyword, subject) {
  let score = 0;
  const lowerKeyword = keyword.toLowerCase().trim();
  const lowerCode = (subject.code || '').toLowerCase();
  const lowerTitle = (subject.title || '').toLowerCase();
  const lowerCourseNo = (subject.course_no || '').toLowerCase();

  // Exact match in title (24 points)
  if (lowerTitle === lowerKeyword) {
    score += 24;
  }

  // Exact match in code (16 points)
  if (lowerCode === lowerKeyword) {
    score += 16;
  }

  // Exact match in course_no (14 points)
  if (lowerCourseNo === lowerKeyword) {
    score += 14;
  }

  // Partial matches (10 points each)
  if (lowerTitle.includes(lowerKeyword)) {
    score += 10;
  }
  if (lowerCode.includes(lowerKeyword)) {
    score += 10;
  }
  if (lowerCourseNo.includes(lowerKeyword)) {
    score += 10;
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

    const { faculty_specialization: specialization, department_id: departmentId } = facultyData;
    const prepLimit = derivePrepLimitFromMaxUnits(facultyData?.faculty_max_units);

    if (!specialization || specialization.trim() === '') {
      return []; // No specialization, no auto-generation
    }

    // Extract keywords from specialization
    const keywords = specialization
      .split(/[,;/|]/g) // Split by common delimiters
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length >= 2 && /^[a-z0-9]+$/i.test(k)); // Keep 2+ chars, alphanumeric

    if (keywords.length === 0) {
      return [];
    }

    // Fetch all subjects from the faculty's department
    const { data: subjectsData, error: subjectsError } = await supabaseAdmin
      .from('subjects')
      .select('subject_code, subject_descriptive_title, department_id, subject_units')
      .eq('department_id', departmentId);

    if (subjectsError) {
      throw new Error(`Error fetching subjects: ${subjectsError.message}`);
    }

    const subjects = subjectsData || [];

    // Score and tag subjects
    const uniqueSubjects = new Map(); // Track subjects to avoid duplicates

    for (const subject of subjects) {
      let maxScore = 0;

      for (const keyword of keywords) {
        const score = scoreSubjectMatch(keyword, subject);
        maxScore = Math.max(maxScore, score);
      }

      if (maxScore > 0) {
        // Determine priority based on score
        let priorityLevel = 3; // Fallback
        if (maxScore >= 30) {
          priorityLevel = 1; // High
        } else if (maxScore >= 15) {
          priorityLevel = 2; // Capable
        }

        // Use subject code as the tag
        const subjectTag = (subject.subject_code || '').trim().toUpperCase();
        if (subjectTag) {
          uniqueSubjects.set(subjectTag, {
            faculty_id: facultyId,
            subject_tag: subjectTag,
            priority_level: priorityLevel,
            match_score: maxScore,
            subject_units: Number(subject.subject_units || 0),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    if (uniqueSubjects.size === 0) {
      return []; // No matches found
    }

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('faculty_subject_tags')
      .select('subject_tag')
      .eq('faculty_id', facultyId);

    if (existingError) {
      throw existingError;
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
      const candUnits = Number(cand.subject_units || 0);
      if (candUnits <= remainingUnits && remainingUnits > 0) {
        limitedNew.push(cand);
        remainingUnits -= candUnits;
      }
      if (remainingUnits <= 0) break;
    }

    // Upsert existing matches (priority refresh) + capped number of new tags.
    const tagsArray = [...existingMatches, ...limitedNew].map(({ match_score, ...row }) => row);
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

    return data || [];
  } catch (err) {
    console.error('autoGenerateFacultySubjectPreferences error:', err);
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
    console.log(`[fetchAvailableSubjectsForFaculty] Starting for facultyId=${facultyId}`);
    
    const { data: subjectsData, error: subjectsError } = await supabaseAdmin
      .from('subjects')
      .select('subject_code, subject_descriptive_title, subject_status, subject_units')
      .eq('subject_status', 'active')
      .order('subject_code', { ascending: true });

    if (subjectsError) {
      console.error(`[fetchAvailableSubjectsForFaculty] Database error:`, subjectsError);
      throw subjectsError;
    }
    
    console.log(`[fetchAvailableSubjectsForFaculty] Found ${subjectsData?.length || 0} active subjects`);
    
    if (!subjectsData || subjectsData.length === 0) {
      console.warn(`[fetchAvailableSubjectsForFaculty] No ACTIVE subjects found in database`);
      const { data: allSubjects, error: allError } = await supabaseAdmin
        .from('subjects')
        .select('subject_code, subject_status')
        .limit(5);
      console.log(`[fetchAvailableSubjectsForFaculty] All subjects sample:`, allSubjects);
    }

    return subjectsData || [];
  } catch (err) {
    console.error('[fetchAvailableSubjectsForFaculty] error:', err);
    throw err;
  }
}
