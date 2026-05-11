import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Middleware to verify JWT token from Authorization header
 * Attaches decoded user info to req.user
 */
export function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    // Verify token using secret key
    const decoded = jwt.verify(token, env.jwtSecret || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification error:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware to enforce admin/super-admin role requirement
 * Must be used after verifyToken middleware
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const allowedRoles = ['admin', 'super-admin'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions. Admin access required.' });
  }

  next();
}
