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
    let message = `Request failed (${response.status})`;
    try {
      const json = await response.json();
      message = json.error || json.message || message;
    } catch {
      const text = await response.text().catch(() => '');
      if (text) message = text;
    }
    throw new Error(message);
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
  const { mode = 'BACKUP_THEN_UPDATE' } = options;

  return request('/api/ga/automatic/update-course-offering', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}