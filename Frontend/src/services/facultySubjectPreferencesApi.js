import { getAuthHeaders } from './authContext.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Fetch all subject preferences for a faculty member
 * @param {number} facultyId - Faculty ID
 * @returns {Promise<Array>} Array of subject preferences
 */
export async function fetchAllFacultySubjectPreferences() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/faculty/subject-preferences/all`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }
    const payload = await response.json();
    // Returns { [facultyId]: [{ subject_tag, priority_level }] }
    return payload.preferences || {};
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/subject-preferences/all`);
    }
    throw err;
  }
}

export async function fetchFacultySubjectPreferences(facultyId) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return {
      preferences: Array.isArray(payload.preferences) ? payload.preferences : [],
      prepLimit: Number(payload.prepLimit ?? 4),
      facultyMaxUnits: Number(payload.facultyMaxUnits ?? 0),
      usedTaggedUnits: Number(payload.usedTaggedUnits ?? 0),
      remainingUnits: Number(payload.remainingUnits ?? 0),
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
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
        headers: getAuthHeaders(),
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

export async function fetchFacultyPreferenceRecords(facultyId, { limit = 20, offset = 0 } = {}) {
  try {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));

    const response = await fetch(
      `${API_BASE_URL}/api/faculty/${facultyId}/preference-records?${params.toString()}`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return {
      records: Array.isArray(payload.records) ? payload.records : [],
      count: Number(payload.count ?? 0),
      facultyId: Number(payload.facultyId ?? facultyId),
      limit: Number(payload.limit ?? limit),
      offset: Number(payload.offset ?? offset),
      hasMore: Boolean(payload.hasMore),
    };
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/preference-records`
      );
    }
    throw err;
  }
}

export async function deleteFacultyPreferenceRecord(facultyId, recordId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/faculty/${facultyId}/preference-records/${recordId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    return payload.deleted || null;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/preference-records/${recordId}`
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
      saved: typeof payload.saved === 'string' ? payload.saved : null,
      saveError: typeof payload.saveError === 'string' ? payload.saveError : null,
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
 * Auto-generate specialization keywords from faculty's selected subject preferences
 * @param {number} facultyId
 * @returns {Promise<Object>} { generated: Array<string>, count: number }
 */
export async function autoGenerateSpecializationFromPreferences(facultyId) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/faculty/${facultyId}/specialization/auto-generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
        `Network error: Unable to reach API at ${API_BASE_URL}/api/faculty/${facultyId}/specialization/auto-generate`
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
