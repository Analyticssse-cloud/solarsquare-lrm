// api/_auth.js — sign-in enforcement. Files prefixed "_" are not deployed as endpoints.
//
// The browser sends the signed-in user's Google ID token as "Authorization: Bearer <token>".
// requireUser() verifies it with Google and applies two gates, both from env vars:
//
//   GOOGLE_CLIENT_ID  — the OAuth client the token must have been minted for.
//   ALLOWED_DOMAIN    — only accept accounts on this Workspace domain (e.g. solarsquare.in).
//
// IMPORTANT: if GOOGLE_CLIENT_ID is NOT set, auth is treated as NOT YET CONFIGURED and the
// request is allowed through as an anonymous viewer. That keeps the dashboard working the
// moment you deploy, before the OAuth client exists. Set GOOGLE_CLIENT_ID to turn the gate on.

export function authConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID);
}

function bearer(req) {
  const raw = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1] : '';
}

export async function requireUser(req) {
  if (!authConfigured()) {
    return { ok: true, configured: false, user: { email: '', name: '', anonymous: true } };
  }

  const token = bearer(req);
  if (!token) return { ok: false, status: 401, reason: 'not-signed-in', configured: true };

  let p;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
    if (!r.ok) return { ok: false, status: 401, reason: 'invalid-token', configured: true };
    p = await r.json();
  } catch (e) {
    return { ok: false, status: 401, reason: 'verify-failed', configured: true };
  }

  const aud = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  if (aud && p.aud && p.aud !== aud) return { ok: false, status: 401, reason: 'wrong-audience', configured: true };
  if (p.email_verified === false || p.email_verified === 'false') {
    return { ok: false, status: 401, reason: 'email-unverified', configured: true };
  }

  const email = String(p.email || '').toLowerCase();
  if (!email) return { ok: false, status: 401, reason: 'no-email', configured: true };

  const domain = String(process.env.ALLOWED_DOMAIN || '').toLowerCase();
  if (domain && p.hd !== domain && !email.endsWith('@' + domain)) {
    return { ok: false, status: 403, reason: 'wrong-domain', configured: true };
  }

  return { ok: true, configured: true, user: { email, name: p.name || '', picture: p.picture || '' } };
}

// Standard refusal. authError:true tells the frontend to show the login screen rather than
// silently falling back to demo data.
export function deny(res, r) {
  return res.status(r.status || 401).json({ error: r.reason || 'unauthorized', authError: true });
}
