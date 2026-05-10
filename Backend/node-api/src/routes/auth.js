import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import crypto from 'crypto';

const router = Router();

// Hash password using SHA-256 (same as frontend)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Fetch user from database
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('user_id, username, email, role, status, password_hash')
      .eq('username', username.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    // Verify password
    const hashedPassword = hashPassword(password);
    if (user.password_hash !== hashedPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Return user info with role
    return res.json({
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      role: user.role,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Login failed',
    });
  }
});

export default router;
