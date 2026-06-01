import { getAuthHeaders } from './authContext.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export async function fetchCourseOfferingNotifications({ page = 1, limit = 500, unresolvedOnly = true } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (unresolvedOnly) params.set('is_resolved', 'false');

  const res = await fetch(`${API_BASE_URL}/api/notifications/course-offerings?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to fetch notifications: ${res.status}`);
  }
  return res.json();
}

export async function resolveCourseOfferingNotification(id) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/course-offerings/${id}/resolve`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to resolve notification: ${res.status}`);
  }
  return res.json();
}

export async function rescanAllCourseOfferingNotifications(force = false) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/course-offerings/rescan-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ force }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to rescan notifications: ${res.status}`);
  }
  return res.json();
}

export async function rescanAllEntities(force = false) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/rescan-all-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ force }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to rescan all entities: ${res.status}`);
  }
  return res.json();
}

export async function syncCourseOfferingNotifications(offeringId) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/course-offerings/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ offering_id: offeringId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to sync notifications: ${res.status}`);
  }
  return res.json();
}

export default { fetchCourseOfferingNotifications };

export async function fetchFacultyNotifications({ page = 1, limit = 500 } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));

  const res = await fetch(`${API_BASE_URL}/api/notifications/faculty?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to fetch faculty notifications: ${res.status}`);
  }
  return res.json();
}

export async function fetchSubjectNotifications({ page = 1, limit = 500 } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));

  const res = await fetch(`${API_BASE_URL}/api/notifications/subjects?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to fetch subject notifications: ${res.status}`);
  }

  const data = await res.json();

  return data;
}

export async function rescanAllSubjectNotifications() {
  const res = await fetch(`${API_BASE_URL}/api/notifications/subjects/rescan-all`, { method: 'POST' });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to rescan subject notifications: ${res.status}`);
  }
  return res.json();
}

export async function syncSubjectNotifications(subjectId) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/subjects/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject_id: subjectId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to sync subject notifications: ${res.status}`);
  }
  return res.json();
}

export async function fetchPersistedSubjectNotifications({ page = 1, limit = 200, unresolvedOnly = true } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (unresolvedOnly) params.set('is_resolved', 'false');

  const res = await fetch(`${API_BASE_URL}/api/notifications/subjects/persisted?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to fetch persisted subject notifications: ${res.status}`);
  }
  return res.json();
}

export async function resolveSubjectNotification(id) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/subjects/${id}/resolve`, { method: 'PATCH' });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to resolve subject notification: ${res.status}`);
  }
  return res.json();
}
export async function fetchPersistedFacultyNotifications({ page = 1, limit = 200, unresolvedOnly = true } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (unresolvedOnly) params.set('is_resolved', 'false');

  const res = await fetch(`${API_BASE_URL}/api/notifications/faculty/persisted?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to fetch persisted faculty notifications: ${res.status}`);
  }
  const data = await res.json();

  // Transform snake_case from DB to camelCase for component, and parse JSON fields
  const transformed = {
    ...data,
    rows: (data.rows || []).map((row) => ({
      id: row.id,
      faculty_id: row.faculty_id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      missingFields: row.missing_fields ? JSON.parse(row.missing_fields) : [],
      issues: (row.issues ? JSON.parse(row.issues) : []).map((issue) => ({
        message: issue.message || issue.msg || '',
        details: issue.details ?? issue.meta ?? null,
        field: issue.field || (row.field_name ?? null) || (row.missing_fields ? (JSON.parse(row.missing_fields)[0] || null) : null),
      })),
      is_resolved: row.is_resolved,
      metadata: row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };

  return transformed;
}

export async function resolveFacultyNotification(id) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/faculty/${id}/resolve`, { method: 'PATCH' });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to resolve notification: ${res.status}`);
  }
  return res.json();
}

export async function syncFacultyNotifications(facultyId) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/faculty/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ faculty_id: facultyId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to sync faculty notifications: ${res.status}`);
  }
  return res.json();
}

export async function fetchRoomNotifications({ page = 1, limit = 200, unresolvedOnly = true } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (unresolvedOnly) params.set('is_resolved', 'false');

  const res = await fetch(`${API_BASE_URL}/api/notifications/rooms?${params.toString()}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to fetch room notifications: ${res.status}`);
  }

  return res.json();
}

export async function rescanAllRoomNotifications(force = false) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/rooms/rescan-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ force }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to rescan room notifications: ${res.status}`);
  }
  return res.json();
}

export async function resolveRoomNotification(id) {
  const res = await fetch(`${API_BASE_URL}/api/notifications/rooms/${id}/resolve`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to resolve notification: ${res.status}`);
  }
  return res.json();
}

export async function clearAllNotifications() {
  const res = await fetch(`${API_BASE_URL}/api/notifications/clear-all`, { method: 'DELETE' });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to clear notifications: ${res.status}`);
  }
  return res.json();
}
