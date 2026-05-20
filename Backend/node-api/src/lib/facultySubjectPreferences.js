/**
 * Faculty Subject Preferences Library
 * Handles CRUD operations for faculty subject preferences with auto-generation from specialization
 */

import { supabaseAdmin } from './supabase.js';

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

    return data || [];
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
      .select('faculty_specialization, department_id')
      .eq('faculty_id', facultyId)
      .single();

    if (facultyError) {
      throw new Error(`Faculty not found: ${facultyError.message}`);
    }

    if (!facultyData) {
      throw new Error('Faculty not found');
    }

    const { faculty_specialization: specialization, department_id: departmentId } = facultyData;

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
      .select('subject_code, subject_descriptive_title, department_id')
      .eq('department_id', departmentId);

    if (subjectsError) {
      throw new Error(`Error fetching subjects: ${subjectsError.message}`);
    }

    const subjects = subjectsData || [];

    // Score and tag subjects
    const tagsToCreate = [];
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
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    if (uniqueSubjects.size === 0) {
      return []; // No matches found
    }

    // Upsert all tags
    const tagsArray = Array.from(uniqueSubjects.values());
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
      .select('subject_code, subject_descriptive_title, subject_status')
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
