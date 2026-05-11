const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  return response.json();
}

export async function fetchGaPreFlight() {
  return request('/api/ga/pre-flight');
}

export async function runFacultyLoading(options = {}) {
  const { dryRun = false, ...constraints } = options;
  const query = dryRun ? '?dry_run=true' : '';

  return request(`/api/ga/run/faculty${query}`, {
    method: 'POST',
    body: JSON.stringify({ ...constraints, dry_run: dryRun }),
  });
}