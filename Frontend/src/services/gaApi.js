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

export async function fetchAutomaticSchedulerPreFlight() {
  return request('/api/ga/automatic/pre-flight');
}

export async function runAutomaticScheduler(options = {}) {
  const { dryRun = false, ...constraints } = options;
  const query = dryRun ? '?dry_run=true' : '';

  return request(`/api/ga/run/automatic-scheduler${query}`, {
    method: 'POST',
    body: JSON.stringify({ ...constraints, dry_run: dryRun }),
  });
}

export async function fetchAutomaticSchedulerRows() {
  return request('/api/ga/automatic/rows');
}

export async function exportAutomaticSchedulerRows() {
  return request('/api/ga/automatic/export', { method: 'GET' });
}

export async function updateCourseOfferingFromScheduler(options = {}) {
  const { backup = true } = options;
  const query = backup ? '?backup=true' : '?backup=false';

  return request(`/api/ga/automatic/update-course-offering${query}`, {
    method: 'POST',
    body: JSON.stringify({ backup }),
  });
}