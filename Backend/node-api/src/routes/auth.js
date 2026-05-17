import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../lib/supabase.js';
import { recordAuditLog } from '../lib/auditLogger.js';

const router = Router();

function verifyPassword(password, storedHash) {
  const hash = String(storedHash || '');
  if (!hash) return false;

  if (hash.startsWith('scrypt$')) {
    const [, salt, expected] = hash.split('$');
    if (!salt || !expected) return false;
    const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
  }

  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    return bcrypt.compareSync(String(password), hash);
  }

  if (/^[a-f0-9]{64}$/i.test(hash)) {
    const derived = crypto.createHash('sha256').update(String(password)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  }

  return String(password) === hash;
}

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('user_id, username, email, password_hash, role, status, created_at, updated_at')
      .eq('username', username)
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        await recordAuditLog(req, {
          username,
          action: 'login',
          module: 'authentication',
          status: 'failed',
          description: 'Login failed for unknown username',
        });
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      return res.status(500).json({ error: error.message });
    }

    if (String(data.status || '').toLowerCase() !== 'active') {
      await recordAuditLog(req, {
        username: data.username,
        role: data.role,
        action: 'login',
        module: 'authentication',
        status: 'failed',
        description: 'Login blocked for inactive account',
        changes_after: {
          user_id: data.user_id,
          username: data.username,
          role: data.role,
          status: data.status,
        },
      });
      return res.status(403).json({ error: 'Login failed. Account is Inactive' });
    }

    if (!verifyPassword(password, data.password_hash)) {
      await recordAuditLog(req, {
        username: data.username,
        role: data.role,
        action: 'login',
        module: 'authentication',
        status: 'failed',
        description: 'Login failed due to invalid password',
        changes_after: {
          user_id: data.user_id,
          username: data.username,
          role: data.role,
          status: data.status,
        },
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    await recordAuditLog(req, {
      username: data.username,
      role: data.role,
      action: 'login',
      module: 'authentication',
      description: 'User logged in',
      changes_after: {
        user_id: data.user_id,
        username: data.username,
        role: data.role,
        status: data.status,
      },
    });

    return res.json({
      user: {
        user_id: data.user_id,
        username: data.username,
        email: data.email,
        password: password,
        role: data.role,
        status: data.status,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
