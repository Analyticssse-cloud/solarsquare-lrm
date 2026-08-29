// api/config.js — GET /api/config
// Public, non-secret config the login screen needs. Safe to expose: a Google OAuth
// client id is a public identifier, and the real gate lives in _auth.js server-side.
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
  return res.status(200).json({
    clientId,
    allowedDomain: process.env.ALLOWED_DOMAIN || '',
    // false = auth not configured yet; the frontend then skips the login screen.
    authRequired: !!clientId,
  });
}
