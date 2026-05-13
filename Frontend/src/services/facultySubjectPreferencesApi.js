const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export async function fetchFacultySubjectPreferences(facultyId) {
  const response = await fetch(`${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function addFacultySubjectPreference(facultyId, { subjectId, priorityLevel = 2 }) {
  const response = await fetch(`${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subject_id: subjectId, priority_level: priorityLevel }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function deleteFacultySubjectPreference(facultyId, subjectId) {
  const response = await fetch(
    `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/${subjectId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function autoGenerateFacultySubjectPreferences(facultyId) {
  const response = await fetch(
    `${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences/auto-generate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function updateFacultySubjectPreferencePriority(facultyId, subjectId, priorityLevel) {
  const response = await fetch(`${API_BASE_URL}/api/faculty/${facultyId}/subject-preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subject_id: subjectId, priority_level: priorityLevel }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}
