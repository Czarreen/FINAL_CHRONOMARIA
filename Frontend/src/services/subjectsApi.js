import { apiFetch, API_BASE_URL } from './apiClient.js';


export async function fetchSubjects({ page = 1, limit = 50, search = '', status = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  if (status) params.status = String(status);
  const query = new URLSearchParams(params);
  const response = await apiFetch(`/api/subjects?${query.toString()}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    total: Number(payload.total ?? payload.rows?.length ?? 0),
    activeCount: Number(payload.activeCount ?? 0),
    page: Number(payload.page ?? 1),
    limit: Number(payload.limit ?? 50),
  };
}

export async function fetchSubjectById(id) {
  const response = await apiFetch(`/api/subjects/${id}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function updateSubjectStatus(id, status) {
  const response = await apiFetch(`/api/subjects/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subject_status: status }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function updateSubject(id, updates) {
  const response = await apiFetch(`/api/subjects/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function deleteSubject(id) {
  const response = await apiFetch(`/api/subjects/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function activateAllSubjects() {
  const response = await apiFetch(`/api/subjects/bulk/activate-all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function createSubject(subjectData) {
  const response = await apiFetch(`/api/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(subjectData),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}
