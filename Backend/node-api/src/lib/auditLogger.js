import { supabaseAdmin } from './supabase.js';

const SENSITIVE_KEYS = new Set(['password', 'password_hash']);

function toHeaderString(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function cleanChanges(value) {
  if (value === undefined || value === null) return null;

  if (Array.isArray(value)) {
    return value.map((item) => cleanChanges(item));
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) continue;
      output[key] = cleanChanges(nestedValue);
    }
    return output;
  }

  return value;
}

function getClientIp(req) {
  const forwarded = toHeaderString(req.headers['x-forwarded-for']);
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

export function getAuditActor(req) {
  const username =
    toHeaderString(req.headers['x-username']) ||
    toHeaderString(req.headers['x-user-name']) ||
    toHeaderString(req.body?.actor?.username) ||
    toHeaderString(req.query?.actor_username) ||
    'system';

  const role =
    toHeaderString(req.headers['x-user-role']) ||
    toHeaderString(req.body?.actor?.role) ||
    toHeaderString(req.query?.actor_role) ||
    null;

  return { username, role };
}

export function requireSuperAdmin(req, res, next) {
  const { role } = getAuditActor(req);
  if (role !== 'super-admin') {
    return res.status(403).json({ error: 'Super-admin access required' });
  }
  return next();
}

export function sanitizeAuditChanges(value) {
  return cleanChanges(value);
}

export async function recordAuditLog(req, entry = {}) {
  try {
    const actor = getAuditActor(req);
    const username = toHeaderString(entry.username) || actor.username;
    const role = entry.role === undefined ? actor.role : toHeaderString(entry.role) || null;

    const payload = {
      username,
      role,
      action: toHeaderString(entry.action) || 'unknown',
      module: toHeaderString(entry.module) || 'system',
      status: toHeaderString(entry.status) || 'success',
      ip_address: getClientIp(req),
      description: toHeaderString(entry.description) || null,
      changes_before: cleanChanges(entry.changes_before),
      changes_after: cleanChanges(entry.changes_after),
      user_agent: toHeaderString(req.headers['user-agent']) || null,
    };

    const { error } = await supabaseAdmin.from('audit_logs').insert(payload);
    if (error) {
      console.error('[audit] insert failed:', error.message);
    }
  } catch (error) {
    console.error('[audit] insert failed:', error);
  }
}
