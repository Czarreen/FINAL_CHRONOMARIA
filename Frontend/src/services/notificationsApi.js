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
