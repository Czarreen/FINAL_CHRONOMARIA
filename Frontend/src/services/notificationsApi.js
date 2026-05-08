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
      issues: row.issues ? JSON.parse(row.issues) : [],
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

export async function clearAllNotifications() {
  const res = await fetch(`${API_BASE_URL}/api/notifications/clear-all`, { method: 'DELETE' });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Failed to clear notifications: ${res.status}`);
  }
  return res.json();
}
