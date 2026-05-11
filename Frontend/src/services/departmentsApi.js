import { apiFetch, API_BASE_URL } from './apiClient.js';


export async function fetchDepartments() {
  const response = await apiFetch(`/api/departments`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.rows) ? payload.rows : [];
}
