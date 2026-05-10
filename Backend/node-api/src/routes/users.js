import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import crypto from 'crypto';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = req.query.search?.trim() || '';

    let query = supabaseAdmin
      .from('users')
      .select('user_id, username, email, role, status, created_at, updated_at', { count: 'exact' });

    if (search) {
      query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, error, count } = await query
      .order('user_id', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Users query error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      page,
      limit,
      total: count ?? 0,
      rows: data ?? [],
    });
  } catch (err) {
    console.error('Users route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('user_id, username, email, role, status, created_at, updated_at')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      console.error('User fetch error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('User fetch route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, email, password, role, status } = req.body;

    // Validation
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'password is required' });
    }

    // Hash password using SHA-256
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    const userData = {
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      password_hash: passwordHash,
      role: role || 'staff',
      status: status || 'active',
    };

    const { data, error } = await supabaseAdmin
      .from('users')
      .insert(userData)
      .select('user_id, username, email, role, status, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation
        return res.status(409).json({ error: 'Username or email already exists' });
      }
      console.error('User creation error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('User creation route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { username, email, role, status } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const updateData = {};
    if (username !== undefined) updateData.username = username.trim();
    if (email !== undefined) updateData.email = email.trim();
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) updateData.status = status;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('user_id', userId)
      .select('user_id, username, email, role, status, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Username or email already exists' });
      }
      console.error('User update error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('User update route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { status } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ status })
      .eq('user_id', userId)
      .select('user_id, username, email, role, status, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      console.error('User status update error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('User status update route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('user_id', userId);

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      console.error('User deletion error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('User deletion route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.patch('/:id/password', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { password } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Hash password using SHA-256
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('user_id', userId)
      .select('user_id, username, email, role, status, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      console.error('User password update error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('User password update route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
