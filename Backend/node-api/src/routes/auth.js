import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import bcrypt from 'bcrypt';

const router = Router();

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

    // Verify password using bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      env.jwtSecret || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Return user info with JWT token
    return res.json({
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Login failed',
    });
  }
});

export default router;
