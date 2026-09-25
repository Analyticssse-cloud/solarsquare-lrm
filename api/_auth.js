// api/_auth.js — email sign-in (no code). Files prefixed "_" are not deployed as endpoints.
//
// Flow: /api/login {email} checks domain + LRM_TL_MAP / FULL_ACCESS_EMAILS and
// returns a signed SESSION token -> the browser sends it as "Authorization: Bearer <token>".
// No database: challenges and sessions are HMAC-signed with AUTH_SECRET, so any serverless
// instance can verify them.
//
// Env vars:
//   AUTH_SECRET        — long random string (>= 32 chars). Setting it TURNS THE GATE ON.
//   ALLOWED_DOMAIN     — default solarsquare.in (homes.solarsquare.in is normalised to it).
//   FULL_ACCESS_EMAILS — comma/space list of leadership/ops who see the whole floor.
//   SESSION_HOURS      — default 12 (one shift).
//
// If AUTH_SECRET is NOT set, auth is treated as not configured and requests pass as an
// anonymous viewer — same behaviour as before, so a deploy never locks everyone out.
import crypto from 'crypto';

export const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);

export function authConfigured() {
  return String(process.env.AUTH_SECRET || '').length >= 16;
}

export const normEmail = (v) => String(v || '').trim().toLowerCase().replace('@homes.solarsquare.in', '@solarsquare.in');

export function allowedDomain() {
  return String(process.env.ALLOWED_DOMAIN || 'solarsquare.in').toLowerCase();
}

export function fullAccessEmails() {
  return new Set(String(process.env.FULL_ACCESS_EMAILS || '').split(/[\s,;]+/).map(normEmail).filter(Boolean));
}

const b64u = (s) => Buffer.from(s).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString('utf8');
export function hmac(data) {
  return crypto.createHmac('sha256', process.env.AUTH_SECRET || '').update(data).digest('base64url');
}
export function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function signSession(email) {
  const body = b64u(JSON.stringify({ e: email, x: Date.now() + SESSION_HOURS * 3600e3, t: 'sess' }));
  return body + '.' + hmac('sess|' + body);
}

function readSession(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !safeEq(sig, hmac('sess|' + body))) return null;
  try {
    const p = JSON.parse(unb64u(body));
    if (p.t !== 'sess' || !p.e || !(p.x > Date.now())) return null;
    return p;
  } catch (e) { return null; }
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
  const p = readSession(token);
  if (!p) return { ok: false, status: 401, reason: 'invalid-token', configured: true };
  const email = normEmail(p.e);
  if (!email.endsWith('@' + allowedDomain())) return { ok: false, status: 403, reason: 'wrong-domain', configured: true };
  return { ok: true, configured: true, user: { email, name: '' },
           fullAccess: fullAccessEmails().has(email) };
}

// Standard refusal. authError:true tells the frontend to show the login screen rather than
// silently falling back to demo data.
export function deny(res, r) {
  return res.status(r.status || 401).json({ error: r.reason || 'unauthorized', authError: true });
}
