/* ════════════════════════════════════════════════════════════════════════════
   _msscore.js — the MS Score feed (LRM_View tab, a SEPARATE spreadsheet).

   WHAT THE SOURCE LOOKS LIKE (read 18 Sep 2026, file 1VgIky3…)
   -----------------------------------------------------------
   `LRM_View` is a WIDE MATRIX, not the Date x LRM rows every other feed in this
   dashboard uses:

       row 1   (blank)
       row 2   |        | MS Score |          |  …        <- a title, not a header
       row 3   | LRM    | 1-Sep-26 | 2-Sep-26 |  …        <- the real header
       row 4+  | sai.pujitha@… | 59 | 55 | 52 | …

   So there are three things nothing else here has to deal with:
     · TWO PREAMBLE ROWS. The header row is FOUND (see findHeader) rather than
       assumed to be row 0 — a hard-coded index 0 would read "MS Score" as the
       email column and return nothing.
     · The email header is `LRM ` WITH A TRAILING SPACE, so it is matched on a
       squashed key, never on equality.
     · The dates are COLUMNS. They are unpivoted here, so the rest of the
       dashboard keeps seeing one number per LRM and never learns about this
       shape.

   The tab TITLE is discovered from the file's metadata and matched, for the
   same reason `_connlive.js` does it: a batchGet on a wrong range throws
   "Unable to parse range", which reads exactly like an empty feed. The file
   also holds a lead-level tab with its own `MS Score` column, so the match
   deliberately prefers an `LRM_View`-shaped title and then verifies the shape
   (an email column + at least three parseable date columns) before using it.

   AGGREGATION (user, 18 Sep 2026: each cell IS that day's score)
   -------------------------------------------------------------
   A score is a RATE, so a window is the MEAN over the days that LRM was
   scored — never a sum, and never a mean of means. Blank days do not vote:
   they are missing, not zero, and the user's rule for the Today column is to
   show blank rather than carry the previous score forward. That is automatic
   here — a one-day window with no cell simply has n = 0.

   Coverage is PARTIAL by nature (78 LRMs scored against ~190 on the floor), so
   `scored` / `lrms` come back in the payload for the card to state.

   SETUP — two steps outside the code, same as CONN_SHEET_ID:
     1. share the MS Score spreadsheet with GOOGLE_SA_EMAIL as Viewer;
     2. set MS_SHEET_ID in Vercel and redeploy (env is read at cold start).
   With MS_SHEET_ID unset this falls back to a tab of the same name in the
   dashboard's own sheet, and says which of the two happened — "not configured"
   and "configured but empty" must never look the same.
   ════════════════════════════════════════════════════════════════════════════ */

import { sheetsApi } from './_connlive.js';

const sq = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const normEmail = (v) => String(v || '').trim().toLowerCase()
  .replace('@homes.solarsquare.in', '@solarsquare.in');

/* Title candidates, best first. `lrmview` leads because that is the tab the
   user named; the generic `msscore` spellings follow. */
const TAB_CANDS = ['lrmview', 'lrmsview', 'lrm', 'msscore', 'msscorelrm', 'msscores', 'scorelrm'];
export const MS_TAB_NAMES = ['LRM_View', 'LRM View', 'LRM_view', 'lrm_view', 'MS Score', 'MS_Score'];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                 jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => (n < 10 ? '0' + n : String(n));

/* Date header -> yyyy-mm-dd, or '' if the cell is not a date.
   FOUR shapes, because which one arrives depends on how the column was typed
   and on whether Sheets hands back the formatted string or the serial:
     '1-Sep-26' / '01-Sep-2026'   the sheet's own format
     '2026-09-01'                 ISO
     '09/01/2026'                 US, as the lead-level tab uses
     45900                        a Sheets serial (epoch 1899-12-30) */
export function headerDate(cell) {
  if (cell === null || cell === undefined || cell === '') return '';
  if (typeof cell === 'number' && isFinite(cell)) return serialToISO(cell);
  const s = String(cell).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  m = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mo) return '';
    let y = +m[3];
    if (y < 100) y += 2000;
    return y + '-' + pad(mo) + '-' + pad(+m[1]);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + pad(+m[1]) + '-' + pad(+m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 30000 && n < 80000) return serialToISO(n);
  }
  return '';
}
function serialToISO(n) {
  const ms = Math.round((n - 25569) * 86400000);   // 25569 = 1970-01-01 as a serial
  const d = new Date(ms);
  if (isNaN(d)) return '';
  return d.toISOString().slice(0, 10);
}

/* The header row is the FIRST row that both names an email/LRM column and
   carries at least three date columns. Both tests matter: row 2 of the real
   sheet has the word "MS Score" and no dates, and a stray date row with no
   email column would give every score to nobody. */
export function findHeader(values) {
  for (let i = 0; i < Math.min(values.length, 12); i++) {
    const row = values[i] || [];
    let emailCol = -1, dates = 0;
    row.forEach((c, j) => {
      const k = sq(c);
      if (emailCol < 0 && (k === 'lrm' || k === 'lrmemail' || k === 'lrmname'
          || k === 'email' || k === 'agentid' || k === 'lrmid')) emailCol = j;
      if (headerDate(c)) dates++;
    });
    if (emailCol < 0 && String(row[0] || '').includes('@')) emailCol = 0;
    if (emailCol >= 0 && dates >= 3) return { row: i, emailCol, dateCount: dates };
  }
  return null;
}

/* Unpivot one matrix into { email -> { sum, n, mean, last, lastDate } } for the
   window. Values outside [from..to] are ignored here rather than filtered
   later, so a 30-column month costs nothing on a one-day view. */
export function unpivot(values, from, to) {
  const h = findHeader(values);
  if (!h) return { byEmail: {}, diag: { headerFound: false } };
  const hdr = values[h.row] || [];
  const cols = [];
  hdr.forEach((c, j) => {
    if (j === h.emailCol) return;
    const d = headerDate(c);
    if (d && d >= from && d <= to) cols.push({ j: j, d: d });
  });
  const byEmail = {};
  let cells = 0, rows = 0;
  for (let i = h.row + 1; i < values.length; i++) {
    const r = values[i] || [];
    const em = normEmail(r[h.emailCol]);
    if (!em || em.indexOf('@') < 0) continue;
    rows++;
    cols.forEach(({ j, d }) => {
      const raw = r[j];
      if (raw === null || raw === undefined || String(raw).trim() === '') return;
      const v = Number(String(raw).replace(/[, %]/g, ''));
      if (!isFinite(v)) return;
      const a = byEmail[em] || (byEmail[em] = { sum: 0, n: 0, last: null, lastDate: '' });
      a.sum += v; a.n += 1;
      if (d >= a.lastDate) { a.last = v; a.lastDate = d; }
      cells++;
    });
  }
  Object.keys(byEmail).forEach((k) => {
    const a = byEmail[k];
    a.mean = a.n ? a.sum / a.n : null;
  });
  return { byEmail, diag: { headerFound: true, headerRow: h.row, emailHeader: String(hdr[h.emailCol] || ''),
                            dateColumns: h.dateCount, columnsInWindow: cols.length, lrmRows: rows, cells } };
}

/* Read + translate, cached per (sheet, window). The matrix changes at most
   daily, so 5 minutes costs nothing and keeps this off the 60-reads-a-minute
   budget the whole dashboard shares. Failures are cached briefly too, so a
   throttled minute cannot become a retry storm. */
const CACHE_OK_MS = 300000;
const CACHE_ERR_MS = 20000;
let cache = null;

async function readExternal(sheetId) {
  const api = await sheetsApi();
  const meta = await api.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  const bySq = {};
  titles.forEach((t) => { bySq[sq(t)] = t; });
  const order = [];
  TAB_CANDS.forEach((c) => { if (bySq[c] && order.indexOf(bySq[c]) < 0) order.push(bySq[c]); });
  titles.forEach((t) => {
    const k = sq(t);
    if (order.indexOf(t) < 0 && TAB_CANDS.some((c) => k.indexOf(c) >= 0)) order.push(t);
  });
  titles.forEach((t) => { if (order.indexOf(t) < 0) order.push(t); });   // last resort: try them all
  const rangeOf = (t) => "'" + String(t).replace(/'/g, "''") + "'";
  /* Shape-verified pick: the first title whose values actually unpivot. The
     file also has a lead-level tab with an `MS Score` column, and that one has
     no date columns, so findHeader rejects it on its own. */
  for (const t of order.slice(0, 6)) {
    const res = await api.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeOf(t) });
    const values = res.data.values || [];
    if (findHeader(values)) return { values, tab: t, titles };
  }
  return { values: [], tab: '', titles,
    error: 'The MS Score sheet is readable, but no tab has an LRM column plus date columns. Tabs found: '
         + (titles.join(', ') || '(none)') + '.' };
}

export async function readMSScores(readTab, from, to) {
  const ext = String(process.env.MS_SHEET_ID || '').trim();
  const key = (ext || 'self') + '|' + from + '|' + to;
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < cache.ttl) return cache.value;

  let values = [], tab = '', error = '', titles = null;
  if (ext) {
    try {
      const r = await readExternal(ext);
      values = r.values; tab = r.tab; titles = r.titles; error = r.error || '';
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/^CREDS:/.test(msg)) error = msg.replace(/^CREDS:\s*/, '');
      else if (/quota|rate|429/i.test(msg)) error = 'Google Sheets read quota exceeded — the MS score will reappear within a minute.';
      else if (/permission|403/i.test(msg)) error = 'The MS Score sheet is not shared with the service account — share it with GOOGLE_SA_EMAIL as Viewer.';
      else if (/not found|404|Requested entity/i.test(msg)) error = 'No spreadsheet with the id in MS_SHEET_ID — check the id.';
      else error = 'MS Score sheet read failed: ' + msg;
      console.warn('MS Score read failed: ' + msg);
    }
  } else {
    for (const t of MS_TAB_NAMES) {
      try {
        const v = await readTab(t);
        if (v && findHeader(v)) { values = v; tab = t; break; }
      } catch (e) { /* wrong spelling or absent — try the next */ }
    }
    if (!values.length) {
      error = 'MS_SHEET_ID is not set in this deployment, and the dashboard sheet has no LRM_View tab.';
    }
  }

  const out = values.length ? unpivot(values, from, to) : { byEmail: {}, diag: {} };
  const value = {
    byEmail: out.byEmail,
    external: !!ext,
    error: error,
    diag: { tab: tab || null, external: !!ext, titles: titles, window: from + '..' + to, ...out.diag },
  };
  cache = { key, at: now, ttl: (!error && values.length) ? CACHE_OK_MS : CACHE_ERR_MS, value };
  return value;
}
