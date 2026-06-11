import { getAuthHeaders } from './authContext.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export async function checkDuplicateCode(code) {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/check-code/${encodeURIComponent(code)}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function fetchCourseOfferingsPage(page = 1, limit = 50, sortBy = 'id', sortOrder = 'asc') {
  return fetchCourseOfferings({ page, limit, sortBy, sortOrder });
}

export async function fetchCourseOfferings({ page = 1, limit = 50, search = '', searchCol = '', sortBy = 'id', sortOrder = 'asc' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  if (search && searchCol && searchCol !== 'all') params.searchCol = String(searchCol);
  if (sortBy) params.sortBy = String(sortBy);
  if (sortOrder) params.sortOrder = String(sortOrder);
  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE_URL}/api/course-offerings?${query.toString()}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    total: Number(payload.total ?? payload.rows?.length ?? 0),
  };
}

export async function createCourseOffering(data) {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function updateCourseOffering(id, data) {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function deleteCourseOffering(id) {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function recordCourseOfferingExportAudit(data = {}) {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/audit/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function importCourseOfferingsCsv({ csvText, fileName, replaceMode = false }) {
  // 10 minute timeout — large CSV + replace mode can take a long time
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/course-offerings/import-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ csvText, fileName, replaceMode }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Import timed out after 10 minutes. Try a smaller file or check your connection.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function fetchCourseOfferingPageNumber(id, { sortBy = 'code', sortOrder = 'asc', pageSize = 50 } = {}) {
  const params = new URLSearchParams({ sortBy, sortOrder, pageSize: String(pageSize) });
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/${id}/page?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return typeof payload.page === 'number' ? payload.page : null;
}

export async function fetchCourseOfferingById(id) {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/${id}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function syncSubjectsFromOfferings() {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/sync-subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }
  return response.json();
}

export async function applyGeneralTagsToSubjects() {
  const response = await fetch(`${API_BASE_URL}/api/course-offerings/apply-general-tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }
  return response.json();
}
