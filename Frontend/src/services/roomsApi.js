const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export async function fetchRoomsPage(page = 1, limit = 50) {
  return fetchRooms({ page, limit });
}

export async function fetchRooms({ page = 1, limit = 50, search = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE_URL}/api/rooms?${query.toString()}`);

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
