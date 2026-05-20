/**
 * Faculty Subject Preferences API Service
 * Handles all API calls for faculty subject preferences feature
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Fetch all subject preferences for a faculty member
 * @param {number} facultyId - Faculty ID
 * @returns {Promise<Array>} Array of subject preferences
 */
export async function fetchFacultySubjectPreferences(facultyId) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return {
      preferences: Array.isArray(payload.preferences) ? payload.preferences : [],
      count: Number(payload.count ?? 0),
    };
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`
      );
    }
    throw err;
  }
}

/**
 * Fetch available subjects for a faculty member (filtered by department)
 * @param {number} facultyId - Faculty ID
 * @returns {Promise<Array>} Array of available subjects
 */
export async function fetchAvailableSubjectsForFaculty(facultyId) {
  try {
    const url = `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/available`;
    console.log('🔍 Fetching available subjects from:', url);
    
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      console.error('❌ API Error Response:', { status: response.status, body });
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    console.log('✅ Available subjects response:', payload);
    
    return {
      subjects: Array.isArray(payload.subjects) ? payload.subjects : [],
      count: Number(payload.count ?? 0),
    };
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/available`
      );
    }
    throw err;
  }
}

/**
 * Add or update a subject preference for a faculty member
 * @param {number} facultyId - Faculty ID
 * @param {Object} params - Preference data
 * @param {string} params.subjectTag - Subject tag/code (text)
 * @param {number} params.priorityLevel - Priority level (1-3)
 * @returns {Promise<Object>} Created/updated preference
 */
export async function addFacultySubjectPreference(facultyId, { subjectTag, priorityLevel }) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subjectTag,
          priorityLevel,
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return payload.preference || null;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`
      );
    }
    throw err;
  }
}

/**
 * Delete a subject preference for a faculty member
 * @param {number} facultyId - Faculty ID
 * @param {string} subjectTag - Subject tag/code
 * @returns {Promise<Object>} Deleted preference
 */
export async function deleteFacultySubjectPreference(facultyId, subjectTag) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/${encodeURIComponent(subjectTag)}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return payload.deleted || null;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/${subjectTag}`
      );
    }
    throw err;
  }
}

/**
 * Auto-generate subject preferences from faculty specialization
 * @param {number} facultyId - Faculty ID
 * @returns {Promise<Array>} Auto-generated preferences
 */
export async function autoGenerateFacultySubjectPreferences(facultyId) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/auto-generate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return {
      generated: Array.isArray(payload.generated) ? payload.generated : [],
      count: Number(payload.count ?? 0),
    };
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/auto-generate`
      );
    }
    throw err;
  }
}

/**
 * Update the priority level of an existing subject preference
 * @param {number} facultyId - Faculty ID
 * @param {string} subjectTag - Subject tag/code
 * @param {number} priorityLevel - New priority level (1-3)
 * @returns {Promise<Object>} Updated preference
 */
export async function updateFacultySubjectPreferencePriority(
  facultyId,
  subjectTag,
  priorityLevel
) {
  // Reuse the add function since it supports upsert
  return addFacultySubjectPreference(facultyId, { subjectTag, priorityLevel });
}
