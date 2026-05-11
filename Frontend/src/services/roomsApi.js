import { apiFetch, API_BASE_URL } from './apiClient.js';

export async function fetchRoomsPage(page = 1, limit = 50) {
  return fetchRooms({ page, limit });
}

export async function fetchRooms({ page = 1, limit = 50, search = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  const query = new URLSearchParams(params);
  const response = await apiFetch(`/api/rooms?${query.toString()}`);

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

// CREATE - Add a new room
export async function createRoom({ room_name, room_type, room_status = 'available' } = {}) {
  const response = await apiFetch(`/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_name, room_type, room_status }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  if (!payload.success) {
    throw new Error(payload.error || 'Failed to create room');
  }

  return payload.data;
}

// UPDATE - Update a room
export async function updateRoom(room_id, { room_name, room_type, room_status } = {}) {
  const response = await apiFetch(`/api/rooms/${room_id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_name, room_type, room_status }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  if (!payload.success) {
    throw new Error(payload.error || 'Failed to update room');
  }

  return payload.data;
}

// DELETE - Delete a room
export async function deleteRoom(room_id) {
  const response = await apiFetch(`/api/rooms/${room_id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  if (!payload.success) {
    throw new Error(payload.error || 'Failed to delete room');
  }

  return payload;
}
