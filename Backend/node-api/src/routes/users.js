import { Router } from 'express';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();
const ALLOWED_ROLES = new Set(['super-admin', 'admin', 'staff']);

function normalizeUserRow(row) {
  return {
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ALLOWED_ROLES.has(normalized) ? normalized : null;
}

function buildSearchFilter(search) {
  if (!search) return '';
  return `username.ilike.%${search}%,email.ilike.%${search}%,role.ilike.%${search}%,status.ilike.%${search}%`;
}

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();

    let query = supabaseAdmin.from('users').select('user_id, username, email, role, status, created_at, updated_at', { count: 'exact' });

    const searchFilter = buildSearchFilter(search);
    if (searchFilter) {
      query = query.or(searchFilter);
    }
    if (status) {
      query = query.ilike('status', status);
    }

    const { data, error, count } = await query.order('user_id', { ascending: true }).range(from, from + limit - 1);

    if (error) {
      console.error('Users query error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      page,
      limit,
      total: Number(count ?? 0),
      rows: (data || []).map(normalizeUserRow),
    });
  } catch (err) {
    console.error('Users route error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const email = req.body?.email ? String(req.body.email).trim() : null;
    const role = normalizeRole(req.body?.role) || 'staff';
    const status = String(req.body?.status || 'active').trim() || 'active';
    const password = String(req.body?.password || '');

    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    if (!password.trim()) {
      return res.status(400).json({ error: 'password is required' });
    }

    if (req.body?.role && !normalizeRole(req.body.role)) {
      return res.status(400).json({ error: 'role must be super-admin, admin, or staff' });
    }

    const password_hash = hashPassword(password.trim());

    const { data, error } = await supabaseAdmin
      .from('users')
      .insert({ username, email, password_hash, role, status })
      .select('user_id, username, email, role, status, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505' || String(error.message || '').includes('users_username_key')) {
        return res.status(409).json({ error: 'username already exists' });
      }
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(normalizeUserRow(data));
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.patch('/:user_id', async (req, res) => {
  try {
    const userId = Number(req.params.user_id);
    if (!userId) {
      return res.status(400).json({ error: 'invalid user_id' });
    }

    const updates = [];
    const values = [];
    const addField = (field, value) => {
      values.push(value);
      updates.push(`${field} = $${values.length}`);
    };

    if (typeof req.body?.username === 'string' && req.body.username.trim()) {
      addField('username', req.body.username.trim());
    }
    if (typeof req.body?.email === 'string') {
      addField('email', req.body.email.trim() || null);
    }
    if (typeof req.body?.role === 'string' && req.body.role.trim()) {
      const role = normalizeRole(req.body.role);
      if (!role) {
        return res.status(400).json({ error: 'role must be super-admin, admin, or staff' });
      }
      addField('role', role);
    }
    if (typeof req.body?.status === 'string' && req.body.status.trim()) {
      addField('status', req.body.status.trim());
    }
    if (typeof req.body?.password === 'string' && req.body.password.trim()) {
      addField('password_hash', hashPassword(req.body.password.trim()));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updateData = {};
    if (typeof req.body?.username === 'string' && req.body.username.trim()) updateData.username = req.body.username.trim();
    if (typeof req.body?.email === 'string') updateData.email = req.body.email.trim() || null;
    if (typeof req.body?.role === 'string' && req.body.role.trim()) {
      const role = normalizeRole(req.body.role);
      if (!role) {
        return res.status(400).json({ error: 'role must be super-admin, admin, or staff' });
      }
      updateData.role = role;
    }
    if (typeof req.body?.status === 'string' && req.body.status.trim()) updateData.status = req.body.status.trim();
    if (typeof req.body?.password === 'string' && req.body.password.trim()) updateData.password_hash = hashPassword(req.body.password.trim());

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('user_id, username, email, role, status, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (error.code === '23505' || String(error.message || '').includes('users_username_key')) {
        return res.status(409).json({ error: 'username already exists' });
      }
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(normalizeUserRow(data));
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/:user_id', async (req, res) => {
  try {
    const userId = Number(req.params.user_id);
    if (!userId) {
      return res.status(400).json({ error: 'invalid user_id' });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('user_id', userId)
      .select('user_id');

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;