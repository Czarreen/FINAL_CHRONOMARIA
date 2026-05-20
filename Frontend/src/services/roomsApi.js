import { getAuthHeaders } from './authContext.js';

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

// CREATE - Add a new room
export async function createRoom({ room_name, room_type, room_status = 'available', room_department_id } = {}) {
  const response = await fetch(`${API_BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ room_name, room_type, room_status, room_department_id }),
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
export async function updateRoom(room_id, { room_name, room_type, room_status, room_department_id } = {}) {
  const response = await fetch(`${API_BASE_URL}/api/rooms/${room_id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ room_name, room_type, room_status, room_department_id }),
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
  const response = await fetch(`${API_BASE_URL}/api/rooms/${room_id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
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

// GET - All room bookings across both tables for conflict detection
export async function fetchRoomBookings() {
  const response = await fetch(`${API_BASE_URL}/api/rooms/bookings`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.rows) ? payload.rows : [];
}

// GET - Fetch all course offerings for a room
export async function fetchRoomOfferings(room_id) {
  const response = await fetch(`${API_BASE_URL}/api/rooms/${room_id}/offerings`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.rows) ? payload.rows : [];
}
