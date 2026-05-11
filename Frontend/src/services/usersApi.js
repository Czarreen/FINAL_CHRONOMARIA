import { apiFetch, API_BASE_URL } from './apiClient.js';

export async function fetchUsers({ page = 1, limit = 50, search = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  const query = new URLSearchParams(params);
  const response = await apiFetch(`/api/users?${query.toString()}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    total: Number(payload.total ?? payload.rows?.length ?? 0),
    page: Number(payload.page ?? 1),
    limit: Number(payload.limit ?? 50),
  };
}

export async function fetchUserById(id) {
  try {
    const response = await apiFetch(`/api/users/${id}`);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at /api/users/${id}`);
    }
    throw err;
  }
}

export async function createUser(userData) {
  try {
    const response = await apiFetch(`/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      let message;
      try {
        const json = await response.json();
        message = json.error || `Request failed (${response.status})`;
      } catch {
        message = `Request failed (${response.status})`;
      }
      throw new Error(message);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at ${API_BASE_URL}/api/users`);
    }
    throw err;
  }
}

export async function updateUser(id, userData) {
  try {
    const response = await apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at /api/users/${id}`);
    }
    throw err;
  }
}

export async function updateUserStatus(id, status) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at ${API_BASE_URL}/api/users/${id}/status`);
    }
    throw err;
  }
}

export async function deleteUser(id) {
  try {
    const response = await apiFetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at /api/users/${id}`);
    }
    throw err;
  }
}

export async function updateUserPassword(id, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at ${API_BASE_URL}/api/users/${id}/password`);
    }
    throw err;
  }
}
