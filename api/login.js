// api/login.js — POST /api/login { email } -> { token, email }
// Email-only sign-in (no code). ALLOWED ONLY IF the email is @ALLOWED_DOMAIN AND either
//   (a) listed in FULL_ACCESS_EMAILS, or
//   (b) present in one of the IDENTITY columns of LRM_TL_MAP (LRM email, TL email, ZSM email,
//       ADOS email) — the same columns dashboard.js uses to derive role/scope.
// Fails CLOSED: no AUTH_SECRET, unreadable roster, or missing email headers = nobody signs in.
// The token carries the email only; role/scope are re-derived on every dashboard request.
import { readSheet } from './_sheets.js';
import { cachedRead } from './_sheetcache.js';
import { authConfigured, allowedDomain, fullAccessEmails, normEmail, signSession, SESSION_HOURS } from './_auth.js';

const ID_COLS = [
  ['Email IDs', 'Email ID', 'LRM Email', 'Agent Id'],
  ['LRM TL Email ID', 'TL Email'],
  ['LRM DZSM Email ID', 'DZSM Email', 'ZSM Email', 'DZSM', 'ZSM'],
  ['ADOS Email ID', 'LRM ADOS Email ID', 'ADOS Email', 'ADOS'],
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rosterEmails() {
  const rows = await cachedRead(readSheet, 'LRM_TL_MAP');
  const hdr = ((rows && rows[0]) || []).map(h => String(h || '').trim().toLowerCase());
  const idx = ID_COLS.map(c => hdr.findIndex(h => c.some(n => n.toLowerCase() === h))).filter(i => i >= 0);
  if (!idx.length) throw new Error('LRM_TL_MAP: no email columns found in header row');
  const set = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    idx.forEach(j => { const v = normEmail(r[j]); if (EMAIL_RE.test(v)) set.add(v); });
  }
  if (!set.size) throw new Error('LRM_TL_MAP: roster is empty');
  return set;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!authConfigured()) return res.status(503).json({ error: 'auth-not-configured' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const email = normEmail(body.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'bad-email' });
  if (!email.endsWith('@' + allowedDomain())) return res.status(403).json({ error: 'wrong-domain' });

  let via = fullAccessEmails().has(email) ? 'full-access' : '';
  if (!via) {
    let roster;
    try { roster = await rosterEmails(); }
    catch (e) { console.error('login roster read', e); return res.status(503).json({ error: 'roster-unavailable' }); }
    if (roster.has(email)) via = 'lrm-tl-map';
  }
  if (!via) { console.warn('login refused (not mapped):', email); return res.status(403).json({ error: 'not-mapped' }); }
  console.log('login ok:', email, 'via', via);
  return res.status(200).json({ ok: true, token: signSession(email), email, via, expiresIn: SESSION_HOURS * 3600 });
}
