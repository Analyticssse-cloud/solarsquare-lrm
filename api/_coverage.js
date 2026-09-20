/* ════════════════════════════════════════════════════════════════════════════
   _coverage.js — the Coverage feed (`coverage` + `coverage_leads`).

   COVERAGE IS THE THIRD METRIC, and the only one that can see a lead NOBODY
   DIALLED:
     Connect %            per DIAL   — of the calls made, how many answered.
     First Response Time  per ASSIGNED lead — how fast the first dial went out.
     Coverage (this)      per CREATED lead — did we ever reach this person.
   A lead counts against the day it was CREATED, so every row is a COHORT, and
   that is the one thing every consumer has to respect: a cohort keeps changing
   after its day ends. A lead created Monday can be connected Thursday.

   WHERE THE DATA LIVES
   --------------------
   The SAME spreadsheet as every other feed — "Ozonetel Report" (user, 20 Sep).
   Coverage.gs is bound to that file, so `coverage` and `coverage_leads` sit
   beside `Ozontel`, `speed` and the rest, and are read through the dashboard's
   own cached tab reader. They are prefetched with the other tabs in
   dashboard.js, so this module normally costs NO extra Sheets read.

   COVERAGE_SHEET_ID stays supported but is an ESCAPE HATCH, not the setup: set
   it only if the feed is ever moved to its own file (then share that file with
   GOOGLE_SA_EMAIL as Viewer and redeploy — env is read at cold start).

   These are ordinary Date x dimension tables, so there is no matrix to unpivot
   and no header hunting: row 0 is the header. What this module adds is the
   tab-title tolerance (`Coverage` vs `coverage`) a batchGet needs on the
   external path — a wrong range throws "Unable to parse range", which reads
   exactly like an empty feed.
   ════════════════════════════════════════════════════════════════════════════ */

import { sheetsApi } from './_connlive.js';

const sq = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');

export const COVERAGE_TABS = { daily: 'coverage', leads: 'coverage_leads' };

/* Title candidates per feed, most specific FIRST. `coverageleads` has to be
   tested before `coverage` or the substring match would hand the daily feed the
   worklist tab. */
const CANDS = {
  daily: ['coverage', 'coveragedaily', 'leadcoverage'],
  leads: ['coverageleads', 'coveragelead', 'uncoveredleads', 'coverageworklist'],
};

const CACHE_OK_MS = 300000;    // the sheet changes hourly at most
const CACHE_ERR_MS = 20000;    // a throttled minute must not become a retry storm
let cache = null;

function pickTitle(titles, kind) {
  const bySq = {};
  titles.forEach((t) => { bySq[sq(t)] = t; });
  for (const c of CANDS[kind]) if (bySq[c]) return bySq[c];
  // substring fallback, but never let the daily feed match the worklist tab
  for (const t of titles) {
    const k = sq(t);
    if (kind === 'daily' && k.indexOf('lead') >= 0) continue;
    if (CANDS[kind].some((c) => k.indexOf(c) >= 0)) return t;
  }
  return '';
}

async function readExternal(sheetId) {
  const api = await sheetsApi();
  const meta = await api.spreadsheets.get({
    spreadsheetId: sheetId, fields: 'sheets.properties.title',
  });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  const want = { daily: pickTitle(titles, 'daily'), leads: pickTitle(titles, 'leads') };
  const ranges = [];
  if (want.daily) ranges.push("'" + want.daily.replace(/'/g, "''") + "'");
  if (want.leads) ranges.push("'" + want.leads.replace(/'/g, "''") + "'");

  if (!ranges.length) {
    return { daily: [], leads: [], titles, tabs: want,
      error: 'The coverage spreadsheet is readable, but it has no `coverage` tab. Tabs found: '
           + (titles.join(', ') || '(none)') + '.' };
  }

  /* ONE batchGet, not two reads. Every read counts against "read requests per
     minute per user", a budget the whole dashboard shares. */
  const res = await api.spreadsheets.values.batchGet({ spreadsheetId: sheetId, ranges });
  const got = res.data.valueRanges || [];
  let i = 0;
  const daily = want.daily ? (got[i++] || {}).values || [] : [];
  const leads = want.leads ? (got[i++] || {}).values || [] : [];
  return { daily, leads, titles, tabs: want, error: '' };
}

/**
 * Both coverage tabs for one render. `readTab` is the dashboard's own cached
 * reader and is the NORMAL path — the tabs live in the dashboard's spreadsheet.
 * Always resolves: a missing feed is a state the tab renders, not a crash.
 */
export async function readCoverage(readTab) {
  const ext = String(process.env.COVERAGE_SHEET_ID || '').trim();
  const key = ext || 'self';
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < cache.ttl) return cache.value;

  let daily = [], leads = [], error = '', titles = null, tabs = null;

  if (ext) {
    try {
      const r = await readExternal(ext);
      daily = r.daily; leads = r.leads; titles = r.titles; tabs = r.tabs; error = r.error || '';
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/^CREDS:/.test(msg)) error = msg.replace(/^CREDS:\s*/, '');
      else if (/quota|rate|429/i.test(msg)) error = 'Google Sheets read quota exceeded — coverage will reappear within a minute.';
      else if (/permission|403/i.test(msg)) error = 'The coverage sheet is not shared with the service account — share it with GOOGLE_SA_EMAIL as Viewer.';
      else if (/not found|404|Requested entity/i.test(msg)) error = 'No spreadsheet with the id in COVERAGE_SHEET_ID — check the id.';
      else error = 'Coverage sheet read failed: ' + msg;
      console.warn('Coverage read failed: ' + msg);
    }
  } else {
    try { daily = await readTab(COVERAGE_TABS.daily); } catch (e) { /* absent */ }
    try { leads = await readTab(COVERAGE_TABS.leads); } catch (e) { /* absent */ }
    if (!daily.length) {
      // The tabs live in this spreadsheet, so an empty read means the feed has
      // not been built yet — NOT a misconfiguration. Say the thing that is
      // actually true, or the next person goes hunting for an env var.
      error = 'No `coverage` tab in the dashboard sheet yet — set the two card ids in '
            + 'Coverage.gs and run covRunBackfill().';
    }
  }

  const value = {
    daily, leads, external: !!ext, error,
    diag: { external: !!ext, titles, tabs,
            dailyRows: Math.max(0, daily.length - 1), leadRows: Math.max(0, leads.length - 1) },
  };
  cache = { key, at: now, ttl: (!error && daily.length) ? CACHE_OK_MS : CACHE_ERR_MS, value };
  return value;
}
