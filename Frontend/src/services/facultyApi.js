const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export async function fetchFacultyPage(page = 1, limit = 50) {
  return fetchFaculty({ page, limit });
}

export async function fetchFaculty({ page = 1, limit = 50, search = '', status = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  if (status) params.status = String(status);
  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE_URL}/api/faculty?${query.toString()}`);

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

export async function fetchFacultyById(id) {
  const response = await fetch(`${API_BASE_URL}/api/faculty/${id}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function createFaculty(facultyData) {
  const response = await fetch(`${API_BASE_URL}/api/faculty`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(facultyData),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function updateFaculty(id, updates) {
  const response = await fetch(`${API_BASE_URL}/api/faculty/${id}`, {
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

export async function updateFacultyStatus(id, status) {
  return updateFaculty(id, { faculty_status: status });
}

export async function deleteFaculty(id) {
  const response = await fetch(`${API_BASE_URL}/api/faculty/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}
