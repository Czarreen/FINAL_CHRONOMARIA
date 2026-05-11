const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export async function fetchDepartments() {
  const response = await fetch(`${API_BASE_URL}/api/departments`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.rows) ? payload.rows : [];
}
