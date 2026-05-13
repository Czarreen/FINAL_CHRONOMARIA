const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export async function fetchSubjects({ page = 1, limit = 50, search = '', status = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  if (status) params.status = String(status);
  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE_URL}/api/subjects?${query.toString()}`);

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

export async function fetchSubjectPageNumber(id, { search = '', status = '', limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const response = await fetch(`${API_BASE_URL}/api/subjects/${id}/page?${params.toString()}`);
  if (!response.ok) return null;
  const payload = await response.json();
  return typeof payload.page === 'number' ? payload.page : null;
}

export async function fetchSubjectById(id) {
  const response = await fetch(`${API_BASE_URL}/api/subjects/${id}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function updateSubjectStatus(id, status) {
  const response = await fetch(`${API_BASE_URL}/api/subjects/${id}`, {
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
  const response = await fetch(`${API_BASE_URL}/api/subjects/${id}`, {
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
  const response = await fetch(`${API_BASE_URL}/api/subjects/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function activateAllSubjects() {
  const response = await fetch(`${API_BASE_URL}/api/subjects/bulk/activate-all`, {
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
  const response = await fetch(`${API_BASE_URL}/api/subjects`, {
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
