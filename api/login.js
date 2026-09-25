// api/login.js — POST /api/login { email } -> { token, email }
// Email-only sign-in (no code): the email must be @ALLOWED_DOMAIN AND either be in
// FULL_ACCESS_EMAILS or appear anywhere in the LRM_TL_MAP tab. The session token carries the
// EMAIL ONLY — role and scope are re-derived from LRM_TL_MAP on every dashboard request, so a
// mapping change in the Sheet applies within the roster cache TTL (60 s), no re-login needed.
// Someone removed from the Sheet is refused on their next request (dashboard.js -> 403).
import { readSheet } from './_sheets.js';
import { cachedRead } from './_sheetcache.js';
import { authConfigured, allowedDomain, fullAccessEmails, normEmail, signSession, SESSION_HOURS } from './_auth.js';

async function knownEmails() {
  const rows = await cachedRead(readSheet, 'LRM_TL_MAP');
  const set = new Set();
  (rows || []).forEach(r => (r || []).forEach(c => { const v = normEmail(c); if (/^[^\s@]+@[^\s@]+$/.test(v)) set.add(v); }));
  return set;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!authConfigured()) return res.status(400).json({ error: 'auth-not-configured' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = normEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'bad-email' });
  if (!email.endsWith('@' + allowedDomain())) return res.status(403).json({ error: 'wrong-domain' });
  let known = fullAccessEmails().has(email);
  if (!known) {
    try { known = (await knownEmails()).has(email); }
    catch (e) { console.error('login roster read', e); return res.status(503).json({ error: 'roster-unavailable' }); }
  }
  if (!known) return res.status(403).json({ error: 'not-mapped' });
  return res.status(200).json({ ok: true, token: signSession(email), email, expiresIn: SESSION_HOURS * 3600 });
}
