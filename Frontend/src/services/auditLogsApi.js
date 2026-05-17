import { getAuthHeaders } from './authContext.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

async function parseApiError(response) {
  const body = await response.text();
  throw new Error(`API error (${response.status}): ${body}`);
}

export async function fetchAuditLogs({
  page = 1,
  limit = 25,
  search = '',
  module = '',
  action = '',
  status = '',
  sortBy = 'timestamp',
  sortOrder = 'desc',
} = {}) {
  const params = {
    page: String(page),
    limit: String(limit),
    sortBy: String(sortBy),
    sortOrder: String(sortOrder),
  };

  if (search) params.search = String(search);
  if (module) params.module = String(module);
  if (action) params.action = String(action);
  if (status) params.status = String(status);

  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE_URL}/api/audit-logs?${query.toString()}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  const payload = await response.json();
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    total: Number(payload.total ?? 0),
    page: Number(payload.page ?? 1),
    limit: Number(payload.limit ?? limit),
    summary: payload.summary || {},
    options: payload.options || { modules: [], actions: [] },
  };
}

export async function recordLogout() {
  const response = await fetch(`${API_BASE_URL}/api/audit-logs/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}

export async function deleteAuditLogsOlderThan30Days() {
  const response = await fetch(`${API_BASE_URL}/api/audit-logs/older-than-30-days`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}
