// api/config.js — GET /api/config
// Public, non-secret config the login screen needs. The real gate lives in _auth.js.
import { authConfigured, allowedDomain } from './_auth.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  return res.status(200).json({
    method: 'email',
    allowedDomain: allowedDomain(),
    // false = AUTH_SECRET not set yet; the frontend then skips the login screen.
    authRequired: authConfigured(),
  });
}
