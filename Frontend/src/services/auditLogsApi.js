const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Compares two objects and returns a human-readable summary of what changed.
 * fieldLabels: { fieldKey: 'Display Name' } — only listed fields are checked.
 */
export function buildChangeSummary(before, after, fieldLabels) {
  const changes = [];
  for (const [key, label] of Object.entries(fieldLabels)) {
    const oldVal = before?.[key];
    const newVal = after?.[key];
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      const displayOld = oldVal ?? '—';
      const displayNew = newVal ?? '—';
      changes.push(` ${label}: "${displayOld}" -> "${displayNew}"`);
    }
  }
  return changes.length ? changes.join('\n') : 'No changes detected';
}

export async function fetchAuditLogs({ page = 1, limit = 50, search = '', user = '', role = '', module = '', status = '', startDate = '', endDate = '' } = {}) {
  const params = { page: String(page), limit: String(limit) };
  if (search) params.search = String(search);
  if (user) params.user = String(user);
  if (role) params.role = String(role);
  if (module) params.module = String(module);
  if (status) params.status = String(status);
  if (startDate) params.startDate = String(startDate);
  if (endDate) params.endDate = String(endDate);
  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE_URL}/api/audit-logs?${query.toString()}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    total: Number(payload.total ?? payload.rows?.length ?? 0),
    page: Number(payload.page ?? 1),
    limit: Number(payload.limit ?? 50),
  };
}

export async function fetchAuditLogById(id) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/audit-logs/${id}`);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at ${API_BASE_URL}/api/audit-logs/${id}`);
    }
    throw err;
  }
}

export async function exportAuditLogs({ format = 'csv', startDate = '', endDate = '' } = {}) {
  try {
    const params = { format };
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    const query = new URLSearchParams(params);
    const response = await fetch(`${API_BASE_URL}/api/audit-logs/export?${query.toString()}`);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.blob();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at ${API_BASE_URL}/api/audit-logs/export`);
    }
    throw err;
  }
}

export async function createAuditLog({ action, module, description = '', status = 'success', changesBefore = null, changesAfter = null } = {}) {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const body = {
      username: user.username || 'unknown',
      role: user.role || 'staff',
      action,
      module,
      status,
      description,
      changes_before: changesBefore,
      changes_after: changesAfter,
    };
    const response = await fetch(`${API_BASE_URL}/api/audit-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    return response.json();
  } catch {
    // silently ignore — audit logging must never break the UI
  }
}

export async function clearOldAuditLogs(daysOld = 90) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/audit-logs/clear`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daysOld: Number(daysOld) }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to reach API at ${API_BASE_URL}/api/audit-logs/clear`);
    }
    throw err;
  }
}
