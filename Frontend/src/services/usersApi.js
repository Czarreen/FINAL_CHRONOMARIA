const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

async function parseApiError(response) {
  const body = await response.text();
  throw new Error(`API error (${response.status}): ${body}`);
}

export async function fetchUsers({ page = 1, limit = 50, search = '', status = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  if (status) params.status = String(status);

  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE_URL}/api/users?${query.toString()}`);

  if (!response.ok) {
    await parseApiError(response);
  }

  const payload = await response.json();
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    total: Number(payload.total ?? payload.rows?.length ?? 0),
    page: Number(payload.page ?? 1),
    limit: Number(payload.limit ?? 50),
  };
}

export async function createUser(userData) {
  const response = await fetch(`${API_BASE_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}

export async function updateUser(userId, updates) {
  const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}

export async function deleteUser(userId) {
  const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}