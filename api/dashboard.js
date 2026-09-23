// api/dashboard.js
// GET /api/dashboard?from=yyyy-MM-dd&to=yyyy-MM-dd
//
// Ozontel is the single source of truth (date in col A, yyyy-MM-dd string).
// LRM_TL_MAP maps agent -> Cluster (City), TL, ZSM and ADOS.
//
// COLUMN BASIS — updated for SQL v11 (all call modes):
//   * "Total Calls" was renamed "Call Count" in the SQL. Both spellings are accepted
//     on read so an older sheet keeps working during the transition.
//   * New columns carried through: Calls <1min / 1-2min / >2min, Meeting Done,
//     MS on Calls <1min / 1-2min / >2min, MS - No Tracked Call, Real Connects.
//   * "Total Talk Time" is already in HOURS. Do not divide by 60 (an earlier bug here
//     collapsed every city's talk time to ~0).
//   * Percentages, ranks and Score are NEVER summed across days — they are recomputed
//     from aggregated totals.
//
// ROLE-BASED ACCESS:
//   City Summary / Agent View / Training Academy stay visible to everyone.
//   ADOS additionally gets an ADOS-wise, a ZSM-wise and a TL-wise rollup, scoped to their cluster.
//   ZSM additionally gets a TL-wise rollup, scoped to their TLs.
//   TL gets their own team. Role is DERIVED from the signed-in email's position in
//   LRM_TL_MAP — there is no role column to maintain.
//
// Scoping is enforced HERE, server-side. The frontend hiding a tab is only cosmetic.

import { readSheet } from './_sheets.js';
import { requireUser, deny } from './_auth.js';
import { readLiveConnectivity } from './_connlive.js';
import { readMSScores } from './_msscore.js';
import { readCoverage } from './_coverage.js';
import { cachedRead, anyStale } from './_sheetcache.js';

const norm = (v) => String(v || '').trim().toLowerCase().replace('@homes.solarsquare.in', '@solarsquare.in');
// Comma-tolerant: Metabase's CSV export formats values over 999 as '1,146.4', and a
// bare Number() on that is NaN -> 0. That would read as a 00:00 check-in on 'First Call
// Min' (i.e. the best possible start) for anyone whose first call is after 16:40.
const num  = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''))) || 0;

/* LRMs suppressed from the ENTIRE dashboard (user, 5 Sep 2026).
   Applied at the two data entry points — the LRM_TL_MAP roster and the Ozontel daily
   rows — so they vanish from every view, every rollup, every total and every export
   at once. Hourly and First Response Time rows are keyed against those two sets, so
   they drop out with no further filter; speed_leads is guarded explicitly because it
   is read straight off its own tab.
   Emails are compared through norm(), so the @homes alias is covered too.
   To restore someone, delete their line. */
const EXCLUDED_LRMS = new Set([
  'ananya.bhattacharjee@solarsquare.in',
  'balappa.patil@solarsquare.in',
  'nanda.reddy@solarsquare.in',
  'bhoomika.kalra@solarsquare.in',
  'nikita.sen@solarsquare.in',
  'nitin.thakur@solarsquare.in',
  'kushal.sahu@solarsquare.in',
  'saili.banerjee@solarsquare.in',
].map(e => norm(e)));
const isExcluded = (email) => EXCLUDED_LRMS.has(norm(email));

/* ── One person, two email IDs (13 Sep 2026) ───────────────────────────────────
   Onik S showed 159 dials in the LRM table but 365 on the Floor Board, and the
   filter reported "2 LRMs" for one search — two Ozontel `Agent Id` values for
   the same human. `norm()` already folds the @homes alias; this map is for the
   pairs it cannot know about (a second account, a renamed local part). Both
   the headcount and every total double for each person listed here, so this is
   also the first thing to check when a RANGE total reads high.

   Add `'alias@solarsquare.in': 'real@solarsquare.in'` — the alias's rows are
   then credited to the real address everywhere (totals, rollups, LRM count),
   exactly as if the sheet had one ID. Deliberately NOT inferred from names: two
   real people can share a name, and silently merging them would be worse than
   the bug. Use `/api/dashboard?diag=1` → `possibleDuplicatePeople` to find the
   pairs, confirm with the user, then list them here. */
const EMAIL_ALIASES = {
  // 'onik.sarkar@solarsquare.in': 'onik.s@solarsquare.in',
};
const canon = (v) => {
  const e = norm(v);
  return EMAIL_ALIASES[e] || e;
};

function rowDate(cell) {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim().slice(0, 10);
}
function fmtLabel(ymd) {
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(d)) return ymd;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0];
  return local.split('.').map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join(' ').trim();
}
// Tolerant header lookup: first header whose name matches any of the candidates.
function findCol(headers, candidates) {
  for (const c of candidates) {
    const i = headers.findIndex(h => h.toLowerCase() === c.toLowerCase());
    if (i >= 0) return i;
  }
  for (const c of candidates) {
    const i = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}
/* Header KEY: lowercase, alphanumerics only. 'Unanswred Calls %', 'unanswered
   calls %' and 'Unanswered_Calls_%' all collapse to one key, so a tab whose
   headers were retyped by hand cannot silently blank a column — which is the
   failure mode findCol's exact-then-substring match keeps producing.
   NOTE the '%' is dropped, so a percentage column must be NAMED apart from its
   count: 'Connected %' -> connected, 'Connected Calls' -> connectedcalls. */
const hkey = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]+/g, '');

/* A percentage cell can arrive three ways from one sheet: '71.4%' (text),
   71.4 (number) or 0.714 (a real Sheets percent format read unformatted).
   Guess ONLY on the last: a bare fraction <= 1 with no '%' in the text is
   scaled, everything else is taken as already being in points. A column that
   genuinely reads 0.8% is the one case this gets wrong, and on this feed that
   value does not occur. */
function pct(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const hadSign = s.indexOf('%') >= 0;
  const n = Number(s.replace(/[%,\s]/g, ''));
  if (!isFinite(n)) return null;
  return (!hadSign && n > 0 && n <= 1) ? n * 100 : n;
}

/* Durations -> MINUTES, server side, so the frontend never has to guess.
   hh:mm:ss and mm:ss are parsed by position; a bare number is MINUTES (the
   documented reading — hours would scale talk time by 60); a Sheets duration
   cell read unformatted arrives as a fraction of a day and is detected by
   being < 1 with decimals. */
function durMin(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  if (s.indexOf(':') >= 0) {
    const p = s.split(':').map(x => Number(x) || 0);
    if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
    if (p.length === 2) return p[0] + p[1] / 60;
  }
  const n = Number(s.replace(/,/g, ''));
  if (!isFinite(n)) return 0;
  return (n > 0 && n < 1) ? n * 1440 : n;
}

/* SECONDS -> minutes. A separate coercion from durMin because the unit is a
   PROPERTY OF THE FEED, not something to sniff per value: the `inbound_perf`
   card emits Total/Avg Talk, Wrapup and Hold in SECONDS (Code.gs says so in
   terms), while the Ozontel tab's 'Total Talk Time' is HOURS. Reading one as
   the other is a 60x error in either direction and has already bitten this
   codebase twice. hh:mm:ss text is still honoured in case the card's formatting
   changes. */
function durSec(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  if (s.indexOf(':') >= 0) return durMin(s);
  const n = Number(s.replace(/,/g, ''));
  return isFinite(n) ? n / 60 : 0;
}

/* ── Tab-name resolution ─────────────────────────────────────────────────────
   Tab names are typed by a HUMAN and the code asks for a LITERAL, so the two
   drift. `readSheet` then throws "Unable to parse range", the caller swallows
   it, and the view reads "tab not in the sheet yet" — a NAME typo presenting
   as missing data. This is the second time it has cost a debugging round (the
   first was `meeting tracker`), so the fix is structural: a feed declares the
   spellings it answers to and the first one that reads wins.
   Resolution is remembered per warm instance, so the failed attempts are paid
   once, not per request.

   A FOUND name is cached for the life of the instance: it cannot go wrong
   without someone renaming the tab, and that is a redeploy-worthy event.

   A NOT-FOUND answer is cached for NEG_TTL only, and that distinction cost a
   debugging round on 19 Sep 2026. The DID tabs were created in the Sheet while
   a Vercel instance was already warm. That instance had resolved
   `did_overall` / `did_day_on_day` to null before they existed, cached the
   null permanently, and went on serving "no tab under any known spelling"
   against a Sheet that by then held 73 and 22,032 rows. Everything upstream —
   the importer, the tabs, the headers, the permissions — was correct and the
   view still read empty, with no way to recover short of a redeploy.
   A negative is a statement about a moment, not about the Sheet, so it
   expires. */
const NEG_TTL = 120000;
const tabResolved = new Map();   // key -> { name, at }
async function resolveTab(cands) {
  const k = cands.join('|');
  const hit = tabResolved.get(k);
  if (hit && (hit.name || Date.now() - hit.at < NEG_TTL)) return hit.name;
  for (const t of cands) {
    try {
      const v = await cachedRead(readSheet, t);
      if (v && v.length) { tabResolved.set(k, { name: t, at: Date.now() }); return t; }
    } catch (e) { /* wrong spelling — try the next */ }
  }
  tabResolved.set(k, { name: null, at: Date.now() });
  return null;
}

// Read a metric from a sheet row object, accepting either header spelling.
function pick(obj, names) {
  for (const n of names) if (obj[n] !== undefined && obj[n] !== '') return obj[n];
  return '';
}

// Columns summed across days.
const SUM_COLS = [
  'Call Count', 'Connected Calls', 'Real Connects (15s+)',
  'Unique Leads Dialed', 'Unique Numbers Dialed', 'Total Talk Time', 'Ex.Call Count',
  'Calls <1min', 'Calls 1-2min', 'Calls >2min',
  'MS Today', 'MS T+0', 'MS T+1', 'MS T+2', 'MS >T+2', 'Meeting Done',
  'MS on Calls <1min', 'MS on Calls 1-2min', 'MS on Calls >2min', 'MS - No Tracked Call',
  'DS Today', 'DS T+1', 'DS T+2',
  // v15 (EODR). 'Total Talk Time' above is TALK ONLY; this one is ring+talk+wrap and
  // is therefore the LARGER number despite the humbler name. Ring/Wrap Filled are
  // fill-rate witnesses — summed so the EODR tab can compare them to Connected Calls.
  'Ring Time', 'Wrap Time', 'Total Time (T+R+W)', 'Ring Filled', 'Wrap Filled',
];
// Averaged across the days the LRM actually has a row for, not the days in the range.
// 'First Call Min' is the check-in proxy as minutes-since-midnight: a clock string
// cannot be averaged over a 30-day window, so the SQL emits both and this averages
// the number. The EODR tab formats it back to HH:MM.
const AVG_COLS = ['Avg. Talk Time', 'Avg. Handling Time', 'First Call Min'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  /* CACHING (23 Sep 2026) — this used to send `no-store, no-cache,
     must-revalidate, max-age=0` under the comment "the point of this endpoint is
     live sheet data". That comment was wrong about its own data: the Ozontel tab
     is rewritten by an Apps Script trigger every 15 MINUTES, so a 4-minute cache
     is strictly fresher than the source's own cadence and `no-store` bought
     nothing but bandwidth. It burned 308% of Vercel's 10 GB Fast Origin Transfer
     allowance and PAUSED the account.

     `private` is deliberate and load-bearing. This payload is SCOPED to the
     viewer (rosterRows._inScope, viewer.scopeSize, the canSee* flags), so it must
     never sit in a shared CDN or proxy cache where one ZSM could be served
     another ZSM's downline. The win is per-viewer anyway: repeat page loads and
     the auto-refresh timer are the bulk of the requests, and those are all the
     same browser. DO NOT change `private` to `public` (or add `s-maxage`) unless
     scoping first moves out of the payload — that is a security decision, not a
     bandwidth one. */
  res.setHeader('Cache-Control', 'private, max-age=240, stale-while-revalidate=600');
  res.setHeader('Vary', 'Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await requireUser(req);
  if (!auth.ok) return deny(res, auth);
  const viewerEmail = norm(auth.user.email);

  try {
    let { from, to } = req.query;
    from = from || '';
    to   = to   || '';
    /* The two per-lead drilldown arrays are the biggest things in this response
       and the least often looked at — `coverage_leads` alone is ~2,300 rows, and
       most viewers never open a drill at all. They ship only when asked for;
       ensureLeads() in index.html asks the first time the Coverage or FRT tab is
       opened. `leadsOmitted` in the response is what tells it to. */
    const wantLeads = String(req.query.leads || '') === '1';
    if (from && to && from > to) { const t = from; from = to; to = t; }

    // ── 1. Ozontel ────────────────────────────────────────────────────────────
    /* ALL SHEET TABS ARE FETCHED IN PARALLEL, THROUGH THE CACHE (13 Sep 2026).
       They used to be six sequential awaits — six full round-trips to Google,
       one after another, and the biggest component of load time.

       But parallel alone made the QUOTA worse, not better: "Read requests per
       minute per user" counts the SERVICE ACCOUNT, so every viewer and the
       15-minute Apps Script share one 60/min budget, and six simultaneous
       reads per page load exhausted it. `_sheetcache.js` is what makes this
       safe — per-tab TTLs, in-flight dedupe, retry on 429, and a stale copy
       served rather than failing the page. Concurrency is also capped, so a
       cold instance asks for three tabs at a time instead of six at once.

       Errors are captured per tab and re-thrown at the original call site, so
       every existing try/catch below behaves exactly as before. */
    const PRE_TABS = ['Ozontel', 'LRM_TL_MAP', 'hourly', 'speed', 'speed_leads',
                      'coverage', 'coverage_leads', 'depth',
                      'MS Schedule Inventory'];
    const pre = {};
    const queue = PRE_TABS.slice();
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        try { pre[t] = await cachedRead(readSheet, t); }
        catch (e) { pre[t] = e instanceof Error ? e : new Error(String(e)); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const read = async (t) => {
      const v = Object.prototype.hasOwnProperty.call(pre, t) ? pre[t] : await cachedRead(readSheet, t);
      if (v instanceof Error) throw v;
      return v;
    };

    const oRaw = await read('Ozontel');
    if (!oRaw.length) return res.status(200).json(emptyPayload(from, to, viewerEmail));

    const oHdr  = oRaw[0].map(h => String(h).trim());
    const oData = oRaw.slice(1);

    const availDates = {};
    oData.forEach(row => { const d = rowDate(row[0]); if (d) availDates[d] = true; });
    const sortedDates = Object.keys(availDates).sort();
    const latestDate  = sortedDates[sortedDates.length - 1] || '';

    if (!from && !to) { from = to = latestDate; }
    else if (!from)   { from = to; }
    else if (!to)     { to = from; }

    const hasInRange = oData.some(row => {
      const d = rowDate(row[0]);
      return d >= from && d <= to;
    });
    let effFrom = from, effTo = to, fellBack = false;
    if (!hasInRange) { effFrom = effTo = latestDate; fellBack = true; }

    // ── 2. Hierarchy: LRM -> City / TL / ZSM / ADOS ───────────────────────────
    const mapRaw = await read('LRM_TL_MAP');
    const mHdr   = (mapRaw[0] || []).map(h => String(h).trim());
    const iEmail   = findCol(mHdr, ['Email IDs', 'Email ID', 'LRM Email', 'Agent Id']);
    const iCluster = findCol(mHdr, ['Cluster', 'City']);
    const iTLName  = findCol(mHdr, ['Reporting Team Lead', 'TL Name']);
    const iTLEmail = findCol(mHdr, ['LRM TL Email ID', 'TL Email']);
    const iZSM     = findCol(mHdr, ['LRM DZSM Email ID', 'DZSM Email', 'ZSM Email', 'DZSM', 'ZSM']);
    const iADOS    = findCol(mHdr, ['ADOS Email ID', 'LRM ADOS Email ID', 'ADOS Email', 'ADOS']);
    const iName    = findCol(mHdr, ['LRM Name', 'LRM  Name', 'Name', 'Employee Name']);
    const iRole    = findCol(mHdr, ['Role', 'Designation', 'LRM Role']);
    const hasRoleCol = iRole >= 0;
    /* Only true LRMs count (user, 5 Sep 2026): col E Role must read LRM or LRM-pilot.
       Anything else on the mapping sheet (TL, ZSM, ADOS, support roles) is hierarchy
       context, not headcount, and must never enter the roster or the LRM count.
       If the Role column is missing the sheet is pre-role — everyone is kept. */
    const roleIsLRM = (v) => {
      const s = String(v || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
      return s === 'lrm' || s === 'lrm-pilot';
    };

    const cityMap = {}, tlMap = {}, nameMap = {};
    const adosSet = new Set(), zsmSet = new Set(), tlSet = new Set(), lrmSet2 = new Set(), mapEmails = new Set();

    for (let i = 1; i < mapRaw.length; i++) {
      const r = mapRaw[i];
      if (!r) continue;
      const email = canon(r[iEmail]);
      if (!email || !email.includes('@')) continue;
      if (isExcluded(email)) continue;   // suppressed LRM — never enters the roster
      const roleCell = iRole >= 0 ? r[iRole] : '';
      const isLRMRow = iRole < 0 || roleIsLRM(roleCell);
      const sheetName = iName >= 0 ? String(r[iName] || '').trim() : '';
      const city   = iCluster >= 0 ? String(r[iCluster] || '').trim() : '';
      const tlName = iTLName  >= 0 ? String(r[iTLName]  || '').trim() : '';
      const tlMail = iTLEmail >= 0 ? norm(r[iTLEmail]) : '';
      const zsm    = iZSM     >= 0 ? norm(r[iZSM])     : '';
      const ados   = iADOS    >= 0 ? norm(r[iADOS])    : '';
      // Hierarchy links are harvested from EVERY row (a TL row still tells us who
      // their ZSM is); only the roster/count is gated on the role.
      if (city) cityMap[email] = city;
      tlMap[email] = { tlName, tlMail, zsm, ados };
      if (sheetName) nameMap[email] = sheetName;
      if (isLRMRow) lrmSet2.add(email);
      mapEmails.add(email);
      if (tlMail) tlSet.add(tlMail);
      if (zsm)    zsmSet.add(zsm);
      if (ados)   adosSet.add(ados);
    }

    // Full onroll roster straight off the mapping sheet (independent of call data).
    const rosterAll = Array.from(lrmSet2).map(email => {
      const m = tlMap[email] || {};
      return {
        'Agent Id': email,
        'LRM Name': nameMap[email] || nameFromEmail(email),
        'City': cityMap[email] || '',
        'TL': m.tlMail || '',
        'TL Name': m.tlName || (m.tlMail ? nameFromEmail(m.tlMail) : ''),
        'ZSM': m.zsm || '', 'ZSM Name': m.zsm ? nameFromEmail(m.zsm) : '',
        'ADOS': m.ados || '', 'ADOS Name': m.ados ? nameFromEmail(m.ados) : '',
      };
    });

    // Role is derived from where the viewer sits in the hierarchy. Checked most
    // senior first so someone listed twice resolves to their highest role.
    let role = 'VIEWER';
    if (!auth.configured)            role = 'VIEWER';
    else if (adosSet.has(viewerEmail)) role = 'ADOS';
    else if (zsmSet.has(viewerEmail))  role = 'ZSM';
    else if (tlSet.has(viewerEmail))   role = 'TL';
    else if (lrmSet2.has(viewerEmail)) role = 'LRM';
    // On the sheet but not an LRM/TL/ZSM/ADOS row (a support role): scope to self
    // rather than falling through to the open VIEWER role.
    else if (mapEmails.has(viewerEmail))  role = 'LRM';

    // Which agents this viewer may see in the ROLLUPS (the flat Agent View stays open).
    const inScope = (agentEmail) => {
      const m = tlMap[agentEmail] || {};
      if (role === 'ADOS') return m.ados === viewerEmail;
      if (role === 'ZSM')  return m.zsm  === viewerEmail;
      if (role === 'TL')   return m.tlMail === viewerEmail;
      if (role === 'LRM')  return agentEmail === viewerEmail;
      return true; // VIEWER / auth not configured
    };

    // ── 3. Aggregate Ozontel per agent across the range ──────────────────────
    /* DEDUP PER (DATE, AGENT) — added 13 Sep 2026 after a month range read
       roughly DOUBLE the real call count.

       The Ozontel tab is one row per Date x LRM by construction, but two
       writers touch it (the 15-minute live window and the backfill), so a day
       can end up present twice. Summing then doubles every column AND inflates
       `_dayCount`, which silently halves everything derived per day — the same
       class of bug as the MS Plan divisor. Last row in sheet order wins: rows
       are appended, so the newest write is the one to trust.

       `dupRowsDropped` is returned in the payload rather than hidden, because a
       non-zero value means the SHEET still has duplicates and the writer needs
       fixing — this guard only stops them being counted. */
    const oiAgent = findCol(oHdr, ['Agent Id', 'LRM Email']);
    const dedup = new Map();
    let dupRowsDropped = 0;
    oData.forEach(row => {
      const d = rowDate(row[0]);
      if (!d || d < effFrom || d > effTo) return;
      const em = canon(oiAgent >= 0 ? row[oiAgent] : '');
      if (!em) return;
      const k = d + '|' + em;
      if (dedup.has(k)) dupRowsDropped++;
      dedup.set(k, row);
    });

    const bucket = {};
    /* ── ?diag=1 : per-date audit of the Ozontel tab ──────────────────────────
       Added 13 Sep 2026 because the month total still read high AFTER the
       (date, agent) dedup, which rules out the obvious duplication and means
       the shape of the sheet has to be looked at rather than guessed. Costs no
       extra sheet read (oData is already in memory) and returns instead of
       building the payload, so it is safe to hit on production. */
    if (String(req.query.diag || '') === '1') {
      const byDate = {};
      let rawRows = 0, rawCalls = 0, badDates = [];
      const iCall = findCol(oHdr, ['Call Count', 'Total Calls']);
      oData.forEach(row => {
        const d = rowDate(row[0]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          if (badDates.length < 8) badDates.push(String(row[0]));
          return;
        }
        if (d < effFrom || d > effTo) return;
        const em = canon(oiAgent >= 0 ? row[oiAgent] : '');
        const c = num(iCall >= 0 ? row[iCall] : 0);
        rawRows++; rawCalls += c;
        const b = byDate[d] || (byDate[d] = { date: d, rows: 0, calls: 0, agents: new Set(), dupPairs: 0, seen: new Set() });
        b.rows++; b.calls += c; b.agents.add(em);
        if (b.seen.has(em)) b.dupPairs++; else b.seen.add(em);
      });
      const dedupCalls = [...dedup.values()].reduce((a, row) => a + num(iCall >= 0 ? row[iCall] : 0), 0);
      // Which agents carry the most rows for a single date — the signature of a
      // row written more than once under slightly different keys.
      const perAgent = {};
      dedup.forEach((row, k) => {
        const em = k.split('|')[1];
        const a = perAgent[em] || (perAgent[em] = { email: em, dates: 0, calls: 0 });
        a.dates++; a.calls += num(iCall >= 0 ? row[iCall] : 0);
      });
      const top = Object.values(perAgent).sort((x, y) => y.calls - x.calls).slice(0, 8);
      /* THE LIKELY CULPRIT: one person under two Agent Ids. Grouped by the
         sheet's own LRM Name (falling back to the email's local part) and only
         reported — never merged automatically, because two real people can
         share a name. Confirmed pairs go in EMAIL_ALIASES at the top. */
      const iName2 = findCol(oHdr, ['LRM Name', 'Agent Name', 'Name']);
      const byName = {};
      dedup.forEach((row, k) => {
        const em = k.split('|')[1];
        const nm = (iName2 >= 0 ? String(row[iName2] || '').trim() : '') || em.split('@')[0].split('.')[0];
        const key2 = nm.toLowerCase().replace(/\s+/g, ' ');
        const g = byName[key2] || (byName[key2] = { name: nm, emails: {} });
        g.emails[em] = (g.emails[em] || 0) + num(iCall >= 0 ? row[iCall] : 0);
      });
      const dupPeople = Object.values(byName)
        .filter(g => Object.keys(g.emails).length > 1)
        .map(g => ({ name: g.name, emails: g.emails,
                     callsTotal: Object.values(g.emails).reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.callsTotal - a.callsTotal);
      return res.status(200).json({
        range: { from: effFrom, to: effTo },
        headerRow: oHdr,
        callCountColumn: iCall >= 0 ? oHdr[iCall] : '(not found)',
        agentColumn: oiAgent >= 0 ? oHdr[oiAgent] : '(not found)',
        totals: {
          rowsInRange: rawRows,
          callsRaw: rawCalls,
          callsAfterDedup: dedupCalls,
          distinctDateAgentPairs: dedup.size,
          duplicatePairsFound: dupRowsDropped,
          distinctAgents: Object.keys(perAgent).length,
          peopleWithTwoIds: dupPeople.length,
          callsOnSecondIds: dupPeople.reduce((a, g) => {
            const vals = Object.values(g.emails).sort((x, y) => y - x);
            return a + vals.slice(1).reduce((s, v) => s + v, 0);
          }, 0),
        },
        possibleDuplicatePeople: dupPeople,
        unparseableDateSamples: badDates,
        perDate: Object.keys(byDate).sort().map(d => ({
          date: d, rows: byDate[d].rows, agents: byDate[d].agents.size,
          calls: byDate[d].calls, duplicateAgentRows: byDate[d].dupPairs,
          callsPerAgent: byDate[d].agents.size ? Math.round(byDate[d].calls / byDate[d].agents.size) : 0,
        })),
        topAgentsInRange: top,
      });
    }
    dedup.forEach(row => {
      const obj = {};
      oHdr.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });

      let agt = String(obj['Agent Id'] || '').trim();
      if (!agt || !agt.includes('@') || agt.includes('->')) return;
      if (isExcluded(agt)) return;   // suppressed LRM — no calls, no totals, no rollup
      const key = canon(agt);
      /* Only Role = LRM / LRM-pilot counts. A TL or ZSM who dials has call rows in
         Ozontel; letting them through inflates the LRM count and every per-LRM
         target that multiplies by it. Gated only when the roster carries roles. */
      if (hasRoleCol && !lrmSet2.has(key)) return;

      /* Accept the pre-v11 header too, so an un-backfilled sheet still renders.
         NORMALISE ONTO `obj` AND LET SUM_COLS DO THE ADDING (15 Sep 2026).
         It used to add `callCount` on a second line, AFTER the SUM_COLS loop
         had already added `obj['Call Count']` — so every day past the first
         counted Call Count TWICE. One day looked right, and a 15-day range read
         1.93x, which is why connectivity showed 14% against the real ~27%:
         the numerator was correct and only the denominator was inflated.
         Connected Calls and talk time were never affected. */
      obj['Call Count'] = num(pick(obj, ['Call Count', 'Total Calls']));

      if (!bucket[key]) {
        bucket[key] = { ...obj, 'Agent Id': agt };
        SUM_COLS.forEach(k => { bucket[key][k] = num(obj[k]); });
        AVG_COLS.forEach(k => { bucket[key]['_sum_' + k] = num(obj[k]); });
        bucket[key]._dayCount = 1;
      } else {
        SUM_COLS.forEach(k => { bucket[key][k] = num(bucket[key][k]) + num(obj[k]); });
        AVG_COLS.forEach(k => { bucket[key]['_sum_' + k] = num(bucket[key]['_sum_' + k]) + num(obj[k]); });
        bucket[key]._dayCount++;
      }
    });

    const agentRows = Object.keys(bucket).map(k => bucket[k]);

    agentRows.forEach(r => {
      const calls = num(r['Call Count']);
      const conn  = num(r['Connected Calls']);
      const real  = num(r['Real Connects (15s+)']);
      const days  = r._dayCount || 1;

      r['Connect %']      = calls > 0 ? Math.round((conn / calls) * 10000) / 100 : 0;
      r['Real Connect %'] = calls > 0 ? Math.round((real / calls) * 10000) / 100 : 0;

      AVG_COLS.forEach(k => {
        r[k] = Math.round((num(r['_sum_' + k]) / days) * 10) / 10;
        delete r['_sum_' + k];
      });

      const target = num(r['Ex.Call Count']) || 200 * days;
      r['Ex.Call Count'] = target;
      r['Progress'] = target > 0 ? Math.round((calls / target) * 10000) / 100 : 0;
      r['Delta']    = Math.round((r['Progress'] - 100) * 100) / 100;

      const key  = norm(r['Agent Id']);
      const meta = tlMap[key] || {};
      r['LRM Name'] = r['LRM Name'] || nameFromEmail(key);
      r['City']     = cityMap[key] || '';
      r['TL']       = meta.tlMail || '';
      r['TL Name']  = meta.tlName || (meta.tlMail ? nameFromEmail(meta.tlMail) : '');
      r['ZSM']      = meta.zsm  || '';
      r['ADOS']     = meta.ados || '';
      r['ZSM Name']  = meta.zsm  ? nameFromEmail(meta.zsm)  : '';
      r['ADOS Name'] = meta.ados ? nameFromEmail(meta.ados) : '';

      const msTotal = ['MS Today', 'MS T+0', 'MS T+1', 'MS T+2', 'MS >T+2']
        .reduce((s, k) => s + num(r[k]), 0);
      r._flagLowVol = calls > 0 && calls < 30;
      r._flagIdle   = calls === 0;
      r._flagNoMeet = msTotal === 0;
      r['Avg Daily Dials'] = days > 0 ? Math.round((calls / days) * 10) / 10 : 0;
      r._inScope = inScope(key);
    });

    /* ── 3b. MS Score (LRM_View, a separate spreadsheet) ─────────────────────
       A RATE, so it is the MEAN of that LRM's scored days in the window — it
       must NOT join SUM_COLS or the totals block, and a missing day must stay
       MISSING: an empty string, never 0. A scoring row of zeroes reads as
       universal failure rather than a gap in the feed, which is why the EODR
       card draws '' as "no score" with a reason.
       An LRM scored in the sheet but absent from the Ozontel window has no row
       here to carry the score, so `scored` is reported against the headcount
       rather than averaged silently. */
    let msScore = { byEmail: {}, error: '', diag: {}, external: false };
    try { msScore = await readMSScores(read, effFrom, effTo); }
    catch (e) { msScore = { byEmail: {}, error: 'MS Score read failed: ' + String(e.message || e), diag: {}, external: false }; }
    let msScored = 0;
    agentRows.forEach(r => {
      const s = msScore.byEmail[canon(r['Agent Id'])] || msScore.byEmail[norm(r['Agent Id'])];
      if (s && s.n) { r['MS Score'] = Math.round(s.mean * 10) / 10; msScored++; }
      else r['MS Score'] = '';
    });

    // ── 4. Generic rollup, reused for City / ZSM / TL ─────────────────────────
    function rollup(rows, keyOf, labelOf, childOf) {
      const agg = {};
      rows.forEach(r => {
        const k = keyOf(r) || '(Unassigned)';
        if (!agg[k]) {
          agg[k] = {
            key: k, label: labelOf(r, k),
            callCount: 0, connected: 0, realConnects: 0, uniqueDials: 0, uniqueNumbers: 0,
            totalTTHr: 0, target: 0, activeLRM: 0, idleLRM: 0,
            msToday: 0, msT0: 0, msT1: 0, msT2: 0, msGt2: 0, meetingDone: 0,
            callsLt1: 0, calls1to2: 0, callsGt2: 0,
            msLt1: 0, ms1to2: 0, msGt2min: 0, msNoCall: 0,
            dsToday: 0, dsT1: 0, dsT2: 0,
            children: {},
          };
        }
        const a = agg[k];
        a.callCount    += num(r['Call Count']);
        a.connected    += num(r['Connected Calls']);
        a.realConnects += num(r['Real Connects (15s+)']);
        a.uniqueDials  += num(r['Unique Leads Dialed']);
        a.uniqueNumbers+= num(r['Unique Numbers Dialed']);
        a.totalTTHr    += num(r['Total Talk Time']);   // already hours
        a.target       += num(r['Ex.Call Count']);
        a.activeLRM    += 1;
        if (num(r['Call Count']) === 0) a.idleLRM += 1;
        a.msToday      += num(r['MS Today']);
        a.msT0         += num(r['MS T+0']);
        a.msT1         += num(r['MS T+1']);
        a.msT2         += num(r['MS T+2']);
        a.msGt2        += num(r['MS >T+2']);
        a.meetingDone  += num(r['Meeting Done']);
        a.callsLt1     += num(r['Calls <1min']);
        a.calls1to2    += num(r['Calls 1-2min']);
        a.callsGt2     += num(r['Calls >2min']);
        a.msLt1        += num(r['MS on Calls <1min']);
        a.ms1to2       += num(r['MS on Calls 1-2min']);
        a.msGt2min     += num(r['MS on Calls >2min']);
        a.msNoCall     += num(r['MS - No Tracked Call']);
        a.dsToday      += num(r['DS Today']);
        a.dsT1         += num(r['DS T+1']);
        a.dsT2         += num(r['DS T+2']);
        if (childOf) { const c = childOf(r); if (c) a.children[c] = true; }
      });

      return Object.keys(agg).map(k => {
        const a = agg[k];
        const msAttributed = a.msLt1 + a.ms1to2 + a.msGt2min;
        return {
          ...a,
          children: Object.keys(a.children).sort(),
          childCount: Object.keys(a.children).length,
          connectPct:     a.callCount > 0 ? Math.round((a.connected / a.callCount) * 10000) / 100 : 0,
          realConnectPct: a.callCount > 0 ? Math.round((a.realConnects / a.callCount) * 10000) / 100 : 0,
          totalTTHr:   Math.round(a.totalTTHr * 10) / 10,
          avgTalkMin:  a.realConnects > 0 ? Math.round((a.totalTTHr * 60 / a.realConnects) * 10) / 10 : 0,
          callsPerLRM: a.activeLRM > 0 ? Math.round(a.callCount / a.activeLRM) : 0,
          ttPerLRM:    a.activeLRM > 0 ? Math.round((a.totalTTHr * 60 / a.activeLRM) * 10) / 10 : 0,
          msPerLRM:    a.activeLRM > 0 ? Math.round((a.msToday / a.activeLRM) * 10) / 10 : 0,
          delta:       a.target > 0 ? Math.round((a.callCount / a.target * 100 - 100) * 100) / 100 : 0,
          // share of this group's meetings we can tie to a tracked call
          msTrackedPct: (msAttributed + a.msNoCall) > 0
            ? Math.round((msAttributed / (msAttributed + a.msNoCall)) * 10000) / 100 : 0,
        };
      }).sort((a, b) => b.callCount - a.callCount);
    }

    const cityRows = rollup(agentRows, r => r['City'], (r, k) => k, r => norm(r['Agent Id']))
      .map(c => ({ ...c, city: c.key, totalCalls: c.callCount })); // legacy keys the UI reads

    // Rollups are SCOPED to the viewer's downline.
    const scoped  = agentRows.filter(r => r._inScope);
    const adosRows = rollup(scoped, r => r['ADOS'], (r) => r['ADOS Name'] || r['ADOS'] || '(Unassigned)', r => r['ZSM']);
    const zsmRows = rollup(scoped, r => r['ZSM'], (r) => r['ZSM Name'] || r['ZSM'] || '(Unassigned)', r => r['TL']);
    const tlRows  = rollup(scoped, r => r['TL'],  (r) => r['TL Name']  || r['TL']  || '(Unassigned)', r => norm(r['Agent Id']));

    // ── 5. Totals (unscoped — matches the open Agent View) ────────────────────
    const totals = agentRows.reduce((acc, r) => {
      acc.totalCalls   += num(r['Call Count']);
      acc.uniqueDials  += num(r['Unique Leads Dialed']);
      acc.connected    += num(r['Connected Calls']);
      acc.realConnects += num(r['Real Connects (15s+)']);
      acc.totalTTHr    += num(r['Total Talk Time']);
      acc.target       += num(r['Ex.Call Count']);
      acc.msToday      += num(r['MS Today']);
      acc.msT0         += num(r['MS T+0']);
      acc.msT1         += num(r['MS T+1']);
      acc.meetingDone  += num(r['Meeting Done']);
      acc.msNoCall     += num(r['MS - No Tracked Call']);
      acc.dsToday      += num(r['DS Today']);
      return acc;
    }, { totalCalls:0, uniqueDials:0, connected:0, realConnects:0, totalTTHr:0, target:0,
         msToday:0, msT0:0, msT1:0, meetingDone:0, msNoCall:0, dsToday:0 });
    totals.connectPct     = totals.totalCalls > 0 ? Math.round((totals.connected / totals.totalCalls) * 10000) / 100 : 0;
    totals.realConnectPct = totals.totalCalls > 0 ? Math.round((totals.realConnects / totals.totalCalls) * 10000) / 100 : 0;
    totals.avgTalkMin     = totals.realConnects > 0 ? Math.round((totals.totalTTHr * 60 / totals.realConnects) * 10) / 10 : 0;
    totals.totalTTHr      = Math.round(totals.totalTTHr * 10) / 10;

    // ── 6. Slim agent rows ────────────────────────────────────────────────────
    const agentCols = [
      'Agent Id', 'City', 'TL Name',
      'Call Count', 'Connected Calls',
      'Total Talk Time', 'Avg. Talk Time',
      'First Call Min', 'Ring Time', 'Wrap Time', 'Total Time (T+R+W)',
      'Ring Filled', 'Wrap Filled',
      'MS Today', 'MS T+0', 'MS T+1', 'MS T+2', 'Meeting Done', 'MS Score',
      'Calls <1min', 'Calls 1-2min', 'Calls >2min',
      'MS on Calls <1min', 'MS on Calls 1-2min', 'MS on Calls >2min', 'MS - No Tracked Call',
      'Unique Leads Dialed', 'Unique Numbers Dialed',
      'Real Connects (15s+)', 'Real Connect %', 'Avg. Handling Time',
      'Progress', 'Delta', 'Score', 'Final Rank',
    ];
    const metaKeys = ['LRM Name','Connect %','TL','ZSM','ADOS','ZSM Name','ADOS Name','_flagLowVol','_flagIdle','_flagNoMeet','Avg Daily Dials','_dayCount','_inScope'];
    const agentRowsSlim = agentRows.map(r => {
      const obj = {};
      agentCols.forEach(k => { obj[k] = r[k] !== undefined ? r[k] : ''; });
      metaKeys.forEach(k => { obj[k] = r[k]; });
      return obj;
    }).sort((a, b) => (Number(a['Final Rank']) || 9999) - (Number(b['Final Rank']) || 9999));

    let dateLabel = effFrom === effTo ? fmtLabel(effFrom) : fmtLabel(effFrom) + ' – ' + fmtLabel(effTo);
    if (fellBack) dateLabel += ' (latest available)';

    // ── 6b. Hourly achievement (optional 'hourly' tab) ────────────────────────
    // One row per Date x Hour x Agent, written by Code.gs's autoUpdateHourly().
    // Absent tab is not an error: the Floor Board falls back to dials-by-city.
    let hourlyRows = [];
    let hourlyHasMS = false;
    try {
      const hRaw = await read('hourly');
      if (hRaw.length > 1) {
        const hHdr    = hRaw[0].map(h => String(h).trim());
        const hiDate  = findCol(hHdr, ['Date']);
        const hiHour  = findCol(hHdr, ['Hour']);
        const hiAgent = findCol(hHdr, ['Agent Id', 'LRM Email']);
        const hiCalls = findCol(hHdr, ['Call Count', 'Total Calls']);
        const hiConn  = findCol(hHdr, ['Connected Calls']);
        const hiTT    = findCol(hHdr, ['Total Talk Time']);
        // MS Scheduled = meetings BOOKED in that hour (v2 hourly card). Optional:
        // findCol returns -1 until the sheet column exists, and num(undefined) is 0,
        // so this is safe to deploy BEFORE the SQL/Code.gs push lands.
        const hiMS    = findCol(hHdr, ['MS Scheduled']);
        const known   = new Set(agentRows.map(r => norm(r['Agent Id'])));
        const acc = {};
        for (let i = 1; i < hRaw.length; i++) {
          const r = hRaw[i];
          if (!r) continue;
          const day = rowDate(r[hiDate]);
          if (day < effFrom || day > effTo) continue;
          const email = norm(r[hiAgent]);
          if (!email || !known.has(email)) continue;
          const hr = parseInt(String(r[hiHour]).slice(0, 2), 10);
          if (isNaN(hr)) continue;
          // Keyed by agent + day + hour so the frontend can re-aggregate under the
          // filter bar (ADOS / ZSM / City / TL / LRM all narrow this) AND read a
          // day x hour pattern over a multi-day range. Both existing consumers
          // (the hourly curve and the league card) sum by hour, so the finer grain
          // is safe: more rows, identical totals.
          const k = email + '|' + day + '|' + hr;
          const a = acc[k] || (acc[k] = { agent: email, date: day, hour: hr, calls: 0, connected: 0, talkHr: 0, ms: 0 });
          a.calls     += num(r[hiCalls]);
          a.connected += num(r[hiConn]);
          a.talkHr    += num(r[hiTT]);
          a.ms        += hiMS < 0 ? 0 : num(r[hiMS]);
        }
        hourlyRows = Object.keys(acc).map(k => {
          const a = acc[k];
          return { agent: a.agent, date: a.date, hour: a.hour, calls: a.calls, connected: a.connected, talkHr: Math.round(a.talkHr * 100) / 100, ms: a.ms };
        }).sort((x, y) => String(x.date).localeCompare(String(y.date)) || x.hour - y.hour || x.agent.localeCompare(y.agent));
        // hasHourlyMS tells the frontend whether to render the MS heatmap at all, so a
        // missing column shows "no hourly source" instead of a floor of honest zeroes.
        hourlyHasMS = hiMS >= 0;
      }
    } catch (e) {
      console.warn('No hourly tab: ' + e.message);
    }

    // ── 6c. First Response Time (optional 'speed' + 'speed_leads' tabs) ───────
    // 'speed'       one row per Agent x lead-ASSIGNMENT day, written by autoUpdateSpeed().
    // 'speed_leads' the actionable tail only (never called, or first call > 60 min).
    // A lead counts against the day it was ASSIGNED, so never-called leads are in the
    // denominator and read as breaches. The TAT clock is BUSINESS-HOURS adjusted in SQL
    // (assigned >= 19:00 -> next day 10:30; before 10:30 -> same day 10:30), so the
    // sheet's 'Clock Start' column, not 'Assigned At', is what TAT is measured from.
    // 'Assign Lag (min)' is the system's created -> assigned latency and is NOT in TAT. Buckets are cumulative-able counts, so summing
    // them across days is valid — the medians in the sheet are NOT summable and are only
    // read through when a single day is in view.
    // Absent tabs are not an error: the frontend shows a "no source yet" note.
    // v6 edges (user, 3 Sep): five EXCLUSIVE buckets that sum to Leads Called. Order
    // must match the SQL SELECT list and SPEED_EDGES/SPEED_LABELS in public/speed.js.
    const SPEED_BUCKETS = ['TAT 0-5', 'TAT 5-10', 'TAT 10-30', 'TAT 30-60', 'TAT >60'];
    let speedRows = [], speedLeads = [], speedHas = false;
    try {
      const sRaw = await read('speed');
      if (sRaw.length > 1) {
        speedHas = true;
        const sHdr = sRaw[0].map(h => String(h).trim());
        const si = (names) => findCol(sHdr, names);
        const siDate = si(['Date']), siAgent = si(['Agent Id', 'LRM Email']);
        const siAsg = si(['Leads Assigned']), siCalled = si(['Leads Called']), siNever = si(['Never Called']);
        const siCluster = si(['Cluster']), siLeadCity = si(['City']);
        const siMed = si(['Median TAT (min)']), siAvg = si(['Avg TAT (min)']);
        const siLag = si(['Avg Assign Lag (min)']);
        /* v9 (19 Sep 2026) columns, replacing v8's four whitelist columns. Read
           ADDITIVELY and tolerated as absent: a sheet still holding pre-v9 rows
           returns -1 here and the counters stay 0, so the tab renders as before
           rather than blanking.
             handover   leads that changed hands between assignment and the first
                        call — the row is credited to whoever HELD the lead at
                        that call, so a high value means this LRM inherited work.
             aged       leads created more than a day before they were assigned.
                        v8 DROPPED these as "stale"; v9 counts them, because an
                        old lead assigned today is a landing today.
             unresolved leads whose credited owner could not be read from the
                        audit table and fell back to the current owner.
           avgTatLead is the LEAD's clock (from the initial assignment) against
           avgTat's CREDITED-OWNER clock; they differ only on handover rows. */
        const siHandover = si(['Handover Before Call']);
        const siAged = si(['Leads Aged > 1 Day']);
        const siUnresolved = si(['Owner Unresolved']);
        const siAvgLead = si(['Avg TAT Lead (min)']);
        const siB = SPEED_BUCKETS.map(b => sHdr.findIndex(h => h.toLowerCase() === b.toLowerCase()));
        const known = new Set(rosterAll.map(r => norm(r['Agent Id'])));
        const acc = {};
        for (let i = 1; i < sRaw.length; i++) {
          const r = sRaw[i];
          if (!r) continue;
          const day = rowDate(r[siDate]);
          if (day < effFrom || day > effTo) continue;
          const email = norm(r[siAgent]);
          if (!email || !email.includes('@')) continue;
          if (known.size && !known.has(email)) continue;
          // Grain is LRM x CLUSTER (the lead's own geo, filled both ways in SQL), so a
          // cluster or city rollup is the real thing and not the LRM's roster city.
          // Each geo falls back to the other here too, in case a pre-v6 row has neither.
          const cl = siCluster < 0 ? '' : String(r[siCluster] || '').trim();
          const ct = siLeadCity < 0 ? '' : String(r[siLeadCity] || '').trim();
          const cluster = cl || ct || 'Unmapped', leadCity = ct || cl || 'Unmapped';
          const key = email + '||' + cluster;
          const a = acc[key] || (acc[key] = {
            agent: email, cluster, leadCity, assigned: 0, called: 0, never: 0,
            buckets: SPEED_BUCKETS.map(() => 0), tatSum: 0, lagSum: 0, days: 0, medianDay: null,
            handover: 0, aged: 0, unresolved: 0, tatLeadSum: 0,
          });
          const called = num(r[siCalled]);
          a.assigned += num(r[siAsg]);
          a.called   += called;
          a.never    += num(r[siNever]);
          siB.forEach((ci, k) => { a.buckets[k] += ci < 0 ? 0 : num(r[ci]); });
          // weighted so a multi-day average is by lead, not by day
          a.tatSum   += num(r[siAvg]) * called;
          // assign lag is per ASSIGNED lead (it exists even when never called)
          if (siLag >= 0) a.lagSum += num(r[siLag]) * num(r[siAsg]);
          if (siHandover >= 0) a.handover += num(r[siHandover]);
          if (siAged >= 0) a.aged += num(r[siAged]);
          if (siUnresolved >= 0) a.unresolved += num(r[siUnresolved]);
          if (siAvgLead >= 0) a.tatLeadSum += num(r[siAvgLead]) * called;
          a.days++;
          if (effFrom === effTo && siMed >= 0) a.medianDay = num(r[siMed]);
        }
        const meta = {};
        rosterAll.forEach(r => { meta[norm(r['Agent Id'])] = r; });
        speedRows = Object.keys(acc).map(k => {
          const a = acc[k], m = meta[a.agent] || {};
          return {
            ...a,
            name: m['LRM Name'] || nameFromEmail(a.agent),
            city: m['City'] || '', tl: m['TL'] || '', tlName: m['TL Name'] || '',
            zsm: m['ZSM'] || '', zsmName: m['ZSM Name'] || '',
            ados: m['ADOS'] || '', adosName: m['ADOS Name'] || '',
            avgTat: a.called > 0 ? Math.round((a.tatSum / a.called) * 10) / 10 : 0,
            avgTatLead: a.called > 0 ? Math.round((a.tatLeadSum / a.called) * 10) / 10 : 0,
            avgLag: a.assigned > 0 ? Math.round((a.lagSum / a.assigned) * 10) / 10 : 0,
            _inScope: inScope(a.agent),
          };
        }).sort((x, y) => y.assigned - x.assigned);
      }
    } catch (e) {
      console.warn('No speed tab: ' + e.message);
    }
    try {
      const lRaw = await read('speed_leads');
      if (lRaw.length > 1) {
        const lHdr = lRaw[0].map(h => String(h).trim());
        const li = (names) => findCol(lHdr, names);
        const c = {
          date: li(['Date']), agent: li(['Agent Id', 'LRM Email']), lead: li(['Lead Id']),
          cluster: li(['Cluster']), city: li(['City']), stage: li(['Stage']), status: li(['Status']),
          created: li(['Lead Created At']), asg: li(['Assigned At']), clock: li(['Clock Start']),
          call: li(['First Call At']), lag: li(['Assign Lag (min)']),
          tat: li(['TAT (min)']), flag: li(['Flag']),
          /* v9, appended LAST in the SQL so Code.gs's sortCol (13 = TAT) does not
             shift. Tolerated as absent: a pre-v9 speed_leads tab returns -1 and
             every row carries '', which the drill reads as "do not show the
             column at all" rather than a row of blanks. */
          attribution: li(['Attribution']), heldFrom: li(['Held From']),
          tatLead: li(['TAT Lead (min)']),
        };
        for (let i = 1; i < lRaw.length; i++) {
          const r = lRaw[i];
          if (!r) continue;
          const day = rowDate(r[c.date]);
          if (day < effFrom || day > effTo) continue;
          const email = norm(r[c.agent]);
          if (!email || !email.includes('@')) continue;
          if (isExcluded(email)) continue;   // suppressed LRM
          speedLeads.push({
            date: day, agent: email,
            lead: String(r[c.lead] || '').trim(),
            cluster: c.cluster < 0 ? '' : String(r[c.cluster] || '').trim(),
            city: c.city < 0 ? '' : String(r[c.city] || '').trim(),
            stage: c.stage < 0 ? '' : String(r[c.stage] || '').trim(),
            status: c.status < 0 ? '' : String(r[c.status] || '').trim(),
            createdAt: c.created < 0 ? '' : String(r[c.created] || '').trim(),
            assignedAt: String(r[c.asg] || '').trim(),
            clockStart: c.clock < 0 ? '' : String(r[c.clock] || '').trim(),
            firstCallAt: c.call < 0 ? '' : String(r[c.call] || '').trim(),
            lag: c.lag < 0 || r[c.lag] === '' ? null : num(r[c.lag]),
            tat: c.tat < 0 || r[c.tat] === '' ? null : num(r[c.tat]),
            flag: c.flag < 0 ? '' : String(r[c.flag] || '').trim(),
            attribution: c.attribution < 0 ? '' : String(r[c.attribution] || '').trim(),
            heldFrom: c.heldFrom < 0 ? '' : String(r[c.heldFrom] || '').trim(),
            tatLead: c.tatLead < 0 || r[c.tatLead] === '' ? null : num(r[c.tatLead]),
          });
        }
        // never-called first, then slowest — the drill reads top-down as a worklist
        speedLeads.sort((a, b) => (a.tat === null ? -1 : b.tat === null ? 1 : b.tat - a.tat));
        if (speedLeads.length > 4000) speedLeads = speedLeads.slice(0, 4000);
      }
    } catch (e) {
      console.warn('No speed_leads tab: ' + e.message);
    }

    /* ── 6d. Coverage (`coverage` + `coverage_leads`, usually an EXTERNAL sheet) ──
       Per CREATED lead: did we ever get this person on the phone. The only feed
       here that can see a lead nobody dialled.

       THREE THINGS THAT ARE NOT LIKE THE OTHER FEEDS:
       1. EVERY ROW IS A COHORT, dated by lead CREATION. A cohort keeps changing
          after its day ends (a lead created Monday can connect Thursday), so
          each date carries an AGE and the frontend refuses to score one younger
          than COVERAGE_MATURE_DAYS. Measured 1-18 Sep: 56% of eventual connects
          land same-day, 77% by D+1, 90% by D+3 — so a same-day figure is not a
          low score, it is an unfinished one.
       2. UNASSIGNED LEADS ARE NOT IN THE FEED (user, 20 Sep). Before the cut,
          16,275 of 51,226 leads had no LRM and 16,283 of the 19,020 never-dialled
          leads had nobody to dial them — an allocation problem with a different
          owner, which dragged the floor's coverage from 83% to 57%.
       3. The row is credited to the lead's CURRENT owner, deliberately the
          opposite of First Response Time. FRT scores a past event so it must
          credit whoever held the lead then; coverage describes a state that is
          still open, so it must point at whoever has to fix it now.

       `realConnected` (>= 15s of talk) is carried beside `connected` because the
       dialler marks IVR-busy and ring-through as answered: Chennai reads 87.7%
       connected but 64.8% really connected. A raw connect rate flatters the floor. */
    const COVERAGE_MATURE_DAYS = 1;
    let coverageRows = [], coverageLeads = [], coverageTrend = [], coverageStatus = [];
    let coverageHas = false, coverageMeta = { error: '', external: false, diag: {} };
    try {
      const cov = await readCoverage(read);
      coverageMeta = { error: cov.error || '', external: !!cov.external, diag: cov.diag || {} };
      const cRaw = cov.daily || [];
      if (cRaw.length > 1) {
        coverageHas = true;
        const cHdr = cRaw[0].map(h => String(h).trim());
        const ci = (names) => findCol(cHdr, names);
        const c = {
          date: ci(['Date']), agent: ci(['Agent Id', 'LRM Email']),
          city: ci(['City']), cluster: ci(['Cluster']), status: ci(['Status']),
          created: ci(['Leads Created']), assigned: ci(['Leads Assigned']),
          dialled: ci(['Leads Dialled']), connected: ci(['Leads Connected']),
          real: ci(['Leads Really Connected']),
          never: ci(['Never Dialled']), noAns: ci(['Dialled Not Connected']),
          d0: ci(['Connected D+0']), d1: ci(['Connected D+1']), d3: ci(['Connected D+3']),
          dials: ci(['Total Dials']), geoPin: ci(['Leads Geo From Pincode']),
        };
        const known = new Set(rosterAll.map(r => norm(r['Agent Id'])));
        const acc = {}, byDay = {}, byStatus = {};
        for (let i = 1; i < cRaw.length; i++) {
          const r = cRaw[i];
          if (!r) continue;
          const day = rowDate(r[c.date]);
          if (day < effFrom || day > effTo) continue;
          const email = norm(r[c.agent]);
          if (!email || !email.includes('@')) continue;
          if (known.size && !known.has(email)) continue;
          const cl = c.cluster < 0 ? '' : String(r[c.cluster] || '').trim();
          const ct = c.city < 0 ? '' : String(r[c.city] || '').trim();
          const cluster = cl || ct || 'Unmapped', leadCity = ct || cl || 'Unmapped';
          const v = {
            assigned: num(r[c.assigned]) || num(r[c.created]),
            dialled: num(r[c.dialled]), connected: num(r[c.connected]),
            real: c.real < 0 ? 0 : num(r[c.real]),
            never: num(r[c.never]), noAns: num(r[c.noAns]),
            d0: c.d0 < 0 ? 0 : num(r[c.d0]), d1: c.d1 < 0 ? 0 : num(r[c.d1]),
            d3: c.d3 < 0 ? 0 : num(r[c.d3]),
            dials: c.dials < 0 ? 0 : num(r[c.dials]),
            geoPin: c.geoPin < 0 ? 0 : num(r[c.geoPin]),
          };
          /* Status joins the row key (23 Sep) so the Coverage tab can filter by
             lead stage and every figure — KPIs, table, trend, stage panel —
             recomputes from the same summed cells. Still a true rollup: the
             feed's grain already includes Status. */
          const st = (c.status < 0 ? '' : String(r[c.status] || '').trim()) || '(blank)';
          const key = email + '||' + cluster + '||' + st;
          const a = acc[key] || (acc[key] = { agent: email, cluster, leadCity, status: st,
            assigned: 0, dialled: 0, connected: 0, real: 0, never: 0, noAns: 0,
            d0: 0, d1: 0, d3: 0, dials: 0, geoPin: 0 });
          Object.keys(v).forEach(k => { a[k] += v[k]; });

          /* Floor-wide daily series for the trend. Kept separate from `acc`
             because a trend must NOT be a rollup of the grain rows — the grain
             is LRM x cluster and a date has to survive every scope filter. */
          const d = byDay[day] || (byDay[day] = { date: day, assigned: 0, connected: 0, real: 0, never: 0, byStatus: {} });
          d.assigned += v.assigned; d.connected += v.connected; d.real += v.real; d.never += v.never;
          const ds = d.byStatus[st] || (d.byStatus[st] = { assigned: 0, connected: 0, real: 0, never: 0 });
          ds.assigned += v.assigned; ds.connected += v.connected; ds.real += v.real; ds.never += v.never;

          const s = byStatus[st] || (byStatus[st] = { status: st, assigned: 0, connected: 0, real: 0, never: 0 });
          s.assigned += v.assigned; s.connected += v.connected; s.real += v.real; s.never += v.never;
        }
        const meta = {};
        rosterAll.forEach(r => { meta[norm(r['Agent Id'])] = r; });
        coverageRows = Object.keys(acc).map(k => {
          const a = acc[k], m = meta[a.agent] || {};
          return { ...a,
            name: m['LRM Name'] || nameFromEmail(a.agent),
            city: m['City'] || '', tl: m['TL'] || '', tlName: m['TL Name'] || '',
            zsm: m['ZSM'] || '', zsmName: m['ZSM Name'] || '',
            ados: m['ADOS'] || '', adosName: m['ADOS Name'] || '',
            _inScope: inScope(a.agent) };
        }).sort((x, y) => y.assigned - x.assigned);

        /* Age each cohort day against TODAY, server-side. The browser's clock is
           the user's, and a laptop an hour behind would mark a mature day as
           still maturing.
           IST is computed HERE rather than read from `todayISO`: that const is
           declared ~500 lines further down, so referencing it threw a temporal
           dead-zone error that silently cost the trend and the status panel
           while leaving the table looking fine. Don't "tidy" this into the
           shared const unless this block moves below it. */
        const covTodayISO = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        const todayMs = Date.parse(covTodayISO + 'T00:00:00Z');
        coverageTrend = Object.keys(byDay).sort().map(d => {
          const row = byDay[d];
          row.age = Math.round((todayMs - Date.parse(d + 'T00:00:00Z')) / 86400000);
          row.maturing = row.age < COVERAGE_MATURE_DAYS;
          return row;
        });
        coverageStatus = Object.keys(byStatus).map(k => byStatus[k])
          .sort((x, y) => y.assigned - x.assigned);
      }

      const lRaw = cov.leads || [];
      if (lRaw.length > 1) {
        const lHdr = lRaw[0].map(h => String(h).trim());
        const li = (names) => findCol(lHdr, names);
        const q = {
          date: li(['Date']), agent: li(['Agent Id', 'LRM Email']), lead: li(['Lead Id']),
          city: li(['City']), cluster: li(['Cluster']), stage: li(['Stage']),
          status: li(['Status']), source: li(['Lead Source']),
          created: li(['Lead Created At']), asg: li(['Assigned At']),
          dials: li(['Dial Attempts']), first: li(['First Dial At']), last: li(['Last Dial At']),
          age: li(['Age (days)']), flag: li(['Flag']),
        };
        for (let i = 1; i < lRaw.length; i++) {
          const r = lRaw[i];
          if (!r) continue;
          const day = rowDate(r[q.date]);
          if (day < effFrom || day > effTo) continue;
          const email = norm(r[q.agent]);
          if (!email || !email.includes('@')) continue;
          if (isExcluded(email)) continue;
          coverageLeads.push({
            date: day, agent: email,
            lead: String(r[q.lead] || '').trim(),
            cluster: q.cluster < 0 ? '' : String(r[q.cluster] || '').trim(),
            city: q.city < 0 ? '' : String(r[q.city] || '').trim(),
            stage: q.stage < 0 ? '' : String(r[q.stage] || '').trim(),
            status: q.status < 0 ? '' : String(r[q.status] || '').trim(),
            source: q.source < 0 ? '' : String(r[q.source] || '').trim(),
            createdAt: q.created < 0 ? '' : String(r[q.created] || '').trim(),
            assignedAt: q.asg < 0 ? '' : String(r[q.asg] || '').trim(),
            dials: q.dials < 0 ? 0 : num(r[q.dials]),
            firstDial: q.first < 0 ? '' : String(r[q.first] || '').trim(),
            lastDial: q.last < 0 ? '' : String(r[q.last] || '').trim(),
            age: q.age < 0 ? null : num(r[q.age]),
            flag: q.flag < 0 ? '' : String(r[q.flag] || '').trim(),
          });
        }
        /* The SQL already ordered this as a QUEUE — never dialled first, then
           oldest. Re-sorting here would destroy that, so the only thing applied
           is the same order and the cap truncates the TAIL, never the head. */
        coverageLeads.sort((a, b) => (a.dials === 0 ? -1 : b.dials === 0 ? 1 : 0)
                                  || (a.date < b.date ? -1 : a.date > b.date ? 1 : b.dials - a.dials));
        if (coverageLeads.length > 15000) coverageLeads = coverageLeads.slice(0, 15000);
      }
    } catch (e) {
      console.warn('Coverage feed failed: ' + e.message);
      coverageMeta = { error: 'Coverage read failed: ' + String(e.message || e), external: false, diag: {} };
    }

    /* ── 6e. Calling depth (`depth` tab, written by Depth.gs) ─────────────────
       Per Date x LRM, from connectivity-lrm-daily-v2.sql. The metric is the
       DEPTH-ADJUSTED CONNECT INDEX: every attempt is scored against the answer
       rate of its attempt band, so a caller working a pile of 11th attempts is
       not marked down for it.

       THREE RULES THIS BLOCK EXISTS TO ENFORCE, all of them easy to break later:

       1. NEVER AVERAGE THE INDEX. Only `connects` and `expected` are summed;
          the index is recomputed as 100 x connects / expected at EVERY level.
          Averaging the per-day index weights a 40-call day like a 400-call one,
          and that is precisely the mix error the whole metric was built to fix.
       2. SHORTFALL IS IN CONVERSATIONS, so it adds across a team and is the
          only figure here a TL can act on directly. Kept as a raw sum.
       3. THE INDEX IS ESTATE-RELATIVE. It reads ~100 when the whole floor
          degrades together, so `connectPct` ships beside it and the frontend
          never shows one without the other.

       `Baseline Days` rides along per row: a row pulled inside a bisected chunk
       was baselined over a shorter span, and the tab marks it rather than
       quietly mixing yardsticks. */
    let depthRows = [], depthTrend = [], depthHas = false;
    try {
      const dRaw = await read('depth');
      if (dRaw.length > 1) {
        depthHas = true;
        const dHdr = dRaw[0].map(h => String(h).trim());
        const di = (names) => findCol(dHdr, names);
        const c = {
          date: di(['Date']), agent: di(['LRM Email', 'Agent Id']), name: di(['LRM Name']),
          calls: di(['Calls']), uniq: di(['Unique Numbers']),
          fresh: di(['Fresh Numbers']), connects: di(['Connects']),
          expected: di(['Expected Connects']), shortfall: di(['Shortfall']),
          real: di(['Real Conversations']),
          a13: di(['Attempts 1-3']), a410: di(['Attempts 4-10']), a11: di(['Attempts 11+']),
          depth: di(['Avg Attempt Depth']), base: di(['Baseline Days']),
        };
        const num = (r, i) => (i < 0 ? 0 : Number(r[i]) || 0);
        const acc = {}, byDay = {};
        for (let i = 1; i < dRaw.length; i++) {
          const r = dRaw[i];
          const day = String(r[c.date] || '').trim().slice(0, 10);
          const email = norm(r[c.agent]);
          if (!day || !email || !email.includes('@')) continue;
          if (isExcluded(email)) continue;
          const v = {
            calls: num(r, c.calls), uniq: num(r, c.uniq), fresh: num(r, c.fresh),
            connects: num(r, c.connects), expected: num(r, c.expected),
            real: num(r, c.real),
            a13: num(r, c.a13), a410: num(r, c.a410), a11: num(r, c.a11),
          };
          const a = acc[email] || (acc[email] = { agent: email, days: 0, depthWSum: 0,
            baseMin: null, calls: 0, uniq: 0, fresh: 0, connects: 0, expected: 0,
            real: 0, a13: 0, a410: 0, a11: 0 });
          Object.keys(v).forEach(k => { a[k] += v[k]; });
          a.days += 1;
          /* Weighted by calls, not a mean of means: a 12-call day and a 400-call
             day do not describe the same work. */
          a.depthWSum += num(r, c.depth) * v.calls;
          const bd = num(r, c.base);
          if (bd && (a.baseMin === null || bd < a.baseMin)) a.baseMin = bd;

          const d = byDay[day] || (byDay[day] = { date: day, calls: 0, connects: 0,
            expected: 0, fresh: 0, real: 0, uniq: 0, lrms: 0, depthWSum: 0, baseMin: null });
          d.calls += v.calls; d.connects += v.connects; d.expected += v.expected;
          d.fresh += v.fresh; d.real += v.real; d.uniq += v.uniq; d.lrms += 1;
          d.depthWSum += num(r, c.depth) * v.calls;
          if (bd && (d.baseMin === null || bd < d.baseMin)) d.baseMin = bd;
        }

        const meta = {};
        rosterAll.forEach(r => { meta[norm(r['Agent Id'])] = r; });
        depthRows = Object.keys(acc).map(k => {
          const a = acc[k], m = meta[a.agent] || {};
          return { ...a,
            name: m['LRM Name'] || nameFromEmail(a.agent),
            city: m['City'] || '', cluster: m['Cluster'] || m['City'] || '',
            tl: m['TL'] || '', tlName: m['TL Name'] || '',
            zsm: m['ZSM'] || '', zsmName: m['ZSM Name'] || '',
            ados: m['ADOS'] || '', adosName: m['ADOS Name'] || '',
            avgDepth: a.calls ? a.depthWSum / a.calls : 0,
            _inScope: inScope(a.agent) };
        }).sort((x, y) => y.calls - x.calls);

        depthTrend = Object.keys(byDay).sort().map(d => {
          const row = byDay[d];
          row.avgDepth = row.calls ? row.depthWSum / row.calls : 0;
          return row;
        });
      }
    } catch (e) {
      console.warn('No depth tab: ' + e.message);
    }

    /* MS Schedule Inventory — the burn-down feed for the Action Center MS Plan
       (sql/ms-inventory-lead-snapshot.sql). One row per Cluster x City x
       Assigned LRM for one schedule date (tomorrow, typically). Optional tab —
       degrades to an empty array (Plan falls back to full-target math) if the
       sheet hasn't been wired yet. */
    let msScheduleRows = [];
    try {
      const iRaw = await read('MS Schedule Inventory');
      if (iRaw.length > 1) {
        const iHdr = iRaw[0].map(h => String(h).trim());
        const ii = (names) => findCol(iHdr, names);
        const c = {
          cluster: ii(['Cluster']), city: ii(['City']), agent: ii(['Assigned LRM', 'LRM Email']),
          sched: ii(['Schedule Date']), daysOut: ii(['Days Out']), cohort: ii(['Cohort']),
          ms: ii(['MS Scheduled']), ct: ii(['Confirmed Today']), ce: ii(['Confirmed Earlier']),
          ncs: ii(['No Confirm Stamp']), leads: ii(['Distinct Leads']),
        };
        for (let i = 1; i < iRaw.length; i++) {
          const r = iRaw[i];
          if (!r) continue;
          const email = c.agent < 0 ? '' : norm(r[c.agent]);
          if (email && isExcluded(email)) continue;   // suppressed LRM
          const ms = c.ms < 0 ? 0 : num(r[c.ms]);
          if (!ms) continue;
          msScheduleRows.push({
            'Schedule Date': c.sched < 0 ? '' : String(r[c.sched] || '').trim(),
            'Days Out': c.daysOut < 0 ? null : num(r[c.daysOut]),
            'Cohort': c.cohort < 0 ? '' : String(r[c.cohort] || '').trim(),
            'Cluster': c.cluster < 0 ? '' : String(r[c.cluster] || '').trim(),
            'City': c.city < 0 ? '' : String(r[c.city] || '').trim(),
            'Assigned LRM': email,
            'MS Scheduled': ms,
            'Confirmed Today': c.ct < 0 ? 0 : num(r[c.ct]),
            'Confirmed Earlier': c.ce < 0 ? 0 : num(r[c.ce]),
            'No Confirm Stamp': c.ncs < 0 ? 0 : num(r[c.ncs]),
            'Distinct Leads': c.leads < 0 ? ms : num(r[c.leads]),
          });
        }
      }
    } catch (e) {
      console.warn('No MS Schedule Inventory tab: ' + e.message);
    }

    /* ── 6e. Connectivity & anomaly feeds (five optional tabs) ────────────────
       Written by Code.gs from sql/connectivity-*.sql, sql/did-reputation-v2.sql
       and sql/inbound-routing-v1.sql. All five are OPTIONAL: an absent tab
       yields an empty array and the matching view renders a "no source yet"
       note. Never a floor of honest zeroes — absence is not zero.

       These are read as PASS-THROUGH rows (header name -> value) rather than
       mapped onto agentCols, because they carry columns the Ozontel tab has no
       shape for: Baseline Days, Owner, Shape, Cohort, Confidence. Widening the
       Ozontel tab would have meant touching Code.gs's MASTER_HEADERS, which
       silently blanks columns when it drifts out of step with the SQL.

       Excluded LRMs are filtered here, exactly as everywhere else, via norm().
       The DID and inbound-routing feeds have no agent column, so nothing to
       filter.

       THREE ADDITIONS (18 Sep 2026), all optional — the five legacy callers
       below pass none of them and behave exactly as before:
         o.tabs   — candidate tab SPELLINGS, tried in order (see resolveTab).
         o.fields — canonical field map; adds row._c without touching row keys.
         o.diag   — an object this fills in, so a view can say WHY it is empty.
       Reads now go through cachedRead rather than readSheet: these tabs were
       the only ones still spending an uncached quota read per request. */
    const passThrough = async (tab, opts) => {
      const o = opts || {};
      const dg = o.diag || {};
      const name = o.tabs ? await resolveTab(o.tabs) : tab;
      dg.tab = name || null;
      if (!name) { dg.error = 'no tab under any known spelling: ' + (o.tabs || [tab]).join(', '); return []; }
      try {
        const raw = await cachedRead(readSheet, name);
        dg.rows = Math.max(0, raw.length - 1);
        if (raw.length < 2) return [];
        const hdr = raw[0].map(h => String(h).trim());
        dg.headers = hdr.filter(Boolean);
        const emailIdx = o.emailCol ? findCol(hdr, o.emailCol) : -1;
        /* Canonical index: first header whose KEY is listed for the field.
           Unmatched fields are simply absent from _c — never 0, because a
           column the sheet does not have and a column that reads zero are
           different facts and the card states them differently. */
        /* KEY ORDER WINS, not header order (18 Sep 2026). The old form scanned
           the HEADERS and took the first one whose key was listed anywhere, so a
           field could never state a preference: `inbound_perf` carries BOTH
           'Talk Time' and 'Talk Time (s)' and the earlier column won, which is
           how a seconds field got read as whatever the other column happened to
           be. Now each field's key list is a priority order. */
        const cIdx = {}, cMiss = [];
        if (o.fields) Object.keys(o.fields).forEach(f => {
          const spec = o.fields[f], keys = spec.keys || spec;
          let i = -1;
          for (const k of keys) { i = hdr.findIndex(h => hkey(h) === k); if (i >= 0) break; }
          if (i < 0) i = hdr.findIndex(h => keys.indexOf(hkey(h)) >= 0);
          if (i >= 0) cIdx[f] = { i, kind: spec.kind || 'text', header: hdr[i] }; else cMiss.push(f);
        });
        if (o.fields) { dg.mapped = Object.keys(cIdx).map(f => f + ' ← ' + cIdx[f].header); dg.unmapped = cMiss; }
        const out = [];
        let dropped = 0;
        for (let i = 1; i < raw.length; i++) {
          const r = raw[i];
          if (!r || !r.length) continue;
          if (emailIdx >= 0) {
            const em = norm(r[emailIdx]);
            if (!em || isExcluded(em)) { dropped++; continue; }
          }
          const obj = {};
          hdr.forEach((h, j) => {
            if (!h) return;
            const v = r[j];
            // numeric columns arrive from Sheets as strings with thousands
            // separators; num() strips them. Text columns stay text.
            obj[h] = (o.numeric && o.numeric.indexOf(h) >= 0) ? num(v)
                   : (typeof v === 'string' ? v.trim() : v);
          });
          if (o.fields) {
            const c = {};
            Object.keys(cIdx).forEach(f => {
              const m = cIdx[f], v = r[m.i];
              c[f] = m.kind === 'num' ? num(v) : m.kind === 'pct' ? pct(v)
                   : m.kind === 'dur' ? durMin(v) : m.kind === 'sec' ? durSec(v)
                   : (typeof v === 'string' ? v.trim() : v);
            });
            obj._c = c;
          }
          if (emailIdx >= 0) obj._email = norm(r[emailIdx]);
          out.push(obj);
        }
        dg.excluded = dropped;
        dg.kept = out.length;
        return out;
      } catch (e) {
        dg.error = e.message;
        console.warn('No ' + name + ' tab: ' + e.message);
        return [];
      }
    };

    const CONN_NUM = ['Calls', 'Unique Numbers', 'Fresh Numbers', 'Fresh %', 'Connects',
      'Connect %', 'Expected Connects', 'Index', 'Shortfall', 'Real Conversations',
      'Real Conv %', 'Talk Min', 'Median Talk s', 'Agent Cuts', 'Agent Cut %',
      'Early Hangups', 'Early Hangup %', 'Median Patience s', 'Fair Wait %',
      'Median Ring s', 'Short Connects', 'Short Connect %', 'Customers Over 3',
      'Calls Beyond Cap', 'Rapid Redials', 'Rapid Redial %', 'Attempts 1-3',
      'Attempts 4-10', 'Attempts 11+', 'Avg Attempt Depth', 'Baseline Days'];

    /* When CONN_SHEET_ID is set the live tabs ARE the source, so the five
       legacy card tabs are not read at all. That is not just tidiness: each
       read counts against "Sheets read requests per minute per user", one
       dashboard request already spends six on the main sheet, and five
       speculative reads for tabs that do not exist is what tipped it over on
       13 Sep. Unset the env var and the legacy path returns unchanged. */
    /* ── inbound perf — REBUILT 18 Sep 2026 ──────────────────────────────────
       PER-LRM PER-DAY inbound handling, a different grain from `inbound_route`
       (floor-wide routing, no agent column) — a separate feed, not a
       replacement, and NOT gated by CONN_SHEET_ID: it lives in the main Ozonetel
       sheet and has nothing to do with the live connectivity file.

       WHY THIS WAS REBUILT: the tab is called `inbound_perf` — lowercase, an
       UNDERSCORE (confirmed against Code.gs's INBOUND_PERF_SHEET_NAME, card
       3301). The code originally asked for `Inbound_perf` with a capital I, so
       every read threw, the error was swallowed, and the card said "No
       Inbound_perf tab in the sheet yet" while the data sat there. Nothing about
       the numbers was wrong; the tab was never opened. Hence resolveTab + the
       canonical field map: neither the tab's name nor a header's spelling can
       take the view down again, and inboundDiag reports which name answered and
       which columns bound, so the next mismatch is visible instead of silent.

       THE UNIT, WHICH IS NOT GUESSABLE AND WAS GOT WRONG ONCE: Total Talk Time,
       Avg. Talk Time, Avg. Wrapup Time and Avg. Hold Time are SECONDS on this
       card (Code.gs states it, and warns not to cross-reconcile with the Ozontel
       tab's 'Total Talk Time', which is HOURS). They are coerced with durSec,
       not durMin. Reading seconds as minutes inflates talk time 60x.

       The feed writes one row per Date × LRM on its own 1-minute trigger, and
       previous days are hard-pasted by the backfill — so a day's row is stable
       once written, and only today moves.

       Three caveats travel with every figure here and are printed on the card,
       not just in this comment: the per-LRM answer rate is "of calls that RANG
       me" (~35.5% of inbound legs reach no agent and have no owner); the dialler
       posts RETRY LEGS, so a call count can be inflated by a dialler /
       availability defect, never LRM behaviour; and inbound talk time only
       exists since Ozonetel fixed the call-end leg on 4 Sep, at 41% floor-wide
       coverage — a floor, not a total. */
    /* Real name first: resolveTab tries these in order and a wrong name costs a
       failed read, so the spelling Code.gs actually writes leads. */
    const INBOUND_TABS = ['inbound_perf', 'inbound perf', 'Inbound_perf', 'Inbound Perf',
                          'Inbound perf', 'InboundPerf', 'inbound-perf'];
    /* Canonical fields. Keys are HEADER KEYS (hkey: lowercase, alphanumerics
       only), so casing, spacing, underscores and a trailing % are all irrelevant
       and the sheet's own typos sit beside the corrected spelling.
       kind drives coercion: num | pct | dur (-> MINUTES) | text. */
/* KEYS ARE A PRIORITY ORDER (see passThrough). The real header row, read off
       the live tab on 18 Sep 2026, is:
         Date · LRM email · Total Calls Received · Answered Calls ·
         Not Answered Calls · Talk Time · Not Answered Reasons · Agent Name ·
         Rang & Missed · Not Routed - Owner Busy · Not Routed - Other ·
         Pickup % (when rang) · Answered % (overall) · Talk Time (s) ·
         Avg. Talk Time (s) · Avg. Wrapup Time (s) · Avg. Hold Time (s) ·
         Customer Disconnect
       Two things that cost a round each: 'Total Calls Received' was bound by
       nothing (the map only knew 'Total Calls'), so the whole tab read as
       call-less; and the tab carries BOTH 'Talk Time' and 'Talk Time (s)', so
       the (s) spellings must lead their key lists — they are the ones the card
       documents as seconds. The routing counts (Rang & Missed, Not Routed …)
       are the per-LRM view of the losses that used to be visible only
       floor-wide on the routing feed. */
    const INBOUND_FIELDS = {
      date:       { kind: 'text', keys: ['date', 'calldate', 'day'] },
      email:      { kind: 'text', keys: ['lrmemail', 'lrmemailid', 'agentid', 'agentemail', 'email', 'emailid'] },
      name:       { kind: 'text', keys: ['agentname', 'lrmname', 'name', 'employeename'] },
      calls:      { kind: 'num',  keys: ['totalcallsreceived', 'callsreceived', 'totalcalls', 'calls', 'callsrung', 'inboundcalls', 'callcount'] },
      answered:   { kind: 'num',  keys: ['answeredcalls', 'answered', 'connectedcalls'] },
      answerPct:  { kind: 'pct',  keys: ['answeredoverall', 'answeredpctoverall', 'answeredpct', 'connected', 'answerrate', 'connectedpercentage'] },
      pickupPct:  { kind: 'pct',  keys: ['pickupwhenrang', 'pickuppctwhenrang', 'pickup', 'pickuprate'] },
      unanswered: { kind: 'num',  keys: ['notansweredcalls', 'unansweredcalls', 'unanswredcalls', 'missedcalls', 'missed'] },
      unansPct:   { kind: 'pct',  keys: ['notansweredoverall', 'unansweredcallspct', 'unanswredcallspct', 'unanswered', 'unanswred', 'missedpct'] },
      rangMissed: { kind: 'num',  keys: ['rangmissed', 'rangandmissed', 'rungmissed'] },
      nrBusy:     { kind: 'num',  keys: ['notroutedownerbusy', 'ownerbusy', 'notroutedbusy'] },
      nrOther:    { kind: 'num',  keys: ['notroutedother', 'notroutedothers', 'notroutedrest'] },
      reasons:    { kind: 'text', keys: ['notansweredreasons', 'notansweredreason', 'unansweredreasons'] },
      talk:       { kind: 'sec',  keys: ['talktimes', 'totaltalktimes', 'totaltalktime', 'talktime', 'totaltalk'] },
      avgTalk:    { kind: 'sec',  keys: ['avgtalktimes', 'averagetalktimes', 'avgtalktime', 'averagetalktime', 'avgtalk'] },
      wrap:       { kind: 'sec',  keys: ['avgwrapuptimes', 'averagewrapuptimes', 'avgwrapuptime', 'averagewrapuptime', 'avgwrapup', 'wrapuptime'] },
      hold:       { kind: 'sec',  keys: ['avgholdtimes', 'averageholdtimes', 'avgholdtime', 'averageholdtime', 'avghold', 'holdtime'] },
      custDisc:   { kind: 'num',  keys: ['customerdisconnect', 'customerdisconnects', 'custdisconnect', 'customerhungup'] },
      agentDisc:  { kind: 'num',  keys: ['agentdisconnect', 'agentdisconnects', 'lrmdisconnect', 'agenthungup'] },
      ring:       { kind: 'sec',  keys: ['avgringtimes', 'avgringtime', 'ringtime', 'avgtimetoanswer', 'timetoanswer'] },
      queue:      { kind: 'sec',  keys: ['avgqueuetimes', 'avgqueuetime', 'queuetime', 'avgwaittime', 'waittime'] },
      did:        { kind: 'text', keys: ['did', 'didnumber', 'publishednumber'] },
      legs:       { kind: 'num',  keys: ['diallegs', 'legs', 'totallegs'] },
    };
    const inboundDiag = {};
    const inboundPerfAll = await passThrough('inbound_perf', {
      tabs: INBOUND_TABS,
      fields: INBOUND_FIELDS,
      diag: inboundDiag,
      emailCol: ['LRM email', 'LRM Email', 'Agent Id'],
      /* Kept for the raw header names the frontend still reads directly. The
         canonical _c block is authoritative; this is the compatibility layer. */
      numeric: ['Total Calls Received', 'Total Calls', 'Answered Calls', 'Not Answered Calls',
                'Rang & Missed', 'Not Routed - Owner Busy', 'Not Routed - Other',
                'Pickup % (when rang)', 'Answered % (overall)', 'Talk Time (s)',
                'Avg. Talk Time (s)', 'Avg. Wrapup Time (s)', 'Avg. Hold Time (s)',
                'Customer Disconnect'],
    });
    /* DATE-SCOPED like every other view (user, 17 Sep). Without this the tab read
       its whole history against whatever day was picked, which looked like
       inflation. rowDate() is the same parser the Ozontel rows use, so a Sheets
       date cell and a yyyy-MM-dd string both land. Undated rows are DROPPED — a
       row with no date cannot honour the picker — but now COUNTED, because
       dropping them silently is what made the totals unexplainable. */
    let inbUndated = 0;
    const inbDay = r => rowDate((r._c && r._c.date) || r['Date']);
    let inboundPerf = inboundPerfAll.filter(r => {
      const d = inbDay(r);
      if (!d) { inbUndated++; return false; }
      return d >= effFrom && d <= effTo;
    });
    inboundDiag.undated = inbUndated;
    inboundDiag.inWindowStrict = inboundPerf.length;
    /* MOST-RECENT-DAY FALLBACK (18 Sep 2026). The Ozonetel card is written on
       its own schedule, so a tab holding 2,202 rows can hold none for the day
       the picker happens to sit on — and the tab then reported "in the picked
       window: 0" over a full feed, which reads as a broken view rather than a
       feed that has not caught up. When the window is empty the LATEST day at
       or before the window end is served instead and the date is reported, so
       the substitution is stated on the card and never silent. */
    if (!inboundPerf.length && inboundPerfAll.length) {
      let best = '';
      for (const r of inboundPerfAll) { const d = inbDay(r); if (d && d <= effTo && d > best) best = d; }
      if (!best) for (const r of inboundPerfAll) { const d = inbDay(r); if (d && d > best) best = d; }
      if (best) {
        inboundPerf = inboundPerfAll.filter(r => inbDay(r) === best);
        inboundDiag.fallbackDate = best;
      }
    }
    inboundDiag.inWindow = inboundPerf.length;
    inboundDiag.window = effFrom + ' → ' + effTo;

    /* ── DID connectivity by lead type — two feeds, added 18 Sep 2026 ────────
       Both are written by Code.gs and NEITHER was being read. They are the live
       DID data; `did_rep` (the reputation-index card, DID_REP_QUESTION_ID) is
       still an EMPTY STRING in Code.gs, so the DID view's original feed never
       arrives and the tab renders its "no source" note against a sheet that has
       two populated DID tabs. That is what this fixes.

       They are different SHAPES and must not be merged:

       `did_overall` (card 3305) is PARAMETERLESS — it computes its own today /
       7d / 15d / overall windows inside the SQL via NOW(), has no Date column,
       and is full-replaced every 15 minutes. So it does NOT and CANNOT honour
       the dashboard's date picker, and the view must say so rather than imply
       the figures moved with the window. Five lead types × four windows.

       `did_day_on_day` (card 3304) is one row per Date × DID on a 5-minute
       trigger, history hard-pasted by its backfill. This one IS date-scoped
       here, like every other per-day feed.

       Every value in both is a connect PERCENTAGE. There are no denominators —
       no dials, no connects — which bounds what can honestly be built: a rate
       with no volume behind it cannot be ranked without gating, and 14 Sep in
       this feed is a Sunday-shaped day of 0.0s and 100.0s off tiny
       denominators. The view therefore leads with the ESTATE-WIDE movement and
       treats per-DID rows as a watch list, not a league table. */
    const DID_PCT = { kind: 'pct' };
    const didOverallDiag = {};
    const didOverall = await passThrough('did_overall', {
      tabs: ['did_overall', 'DID Overall', 'did overall'],
      diag: didOverallDiag,
      fields: {
        did:  { kind: 'text', keys: ['did', 'didnumber', 'publishednumber'] },
        /* Header keys drop the underscores, so fresh_lead_connect_pct_today
           collapses to freshleadconnectpcttoday. */
        freshToday:   { kind: 'pct', keys: ['freshleadconnectpcttoday'] },
        fresh7d:      { kind: 'pct', keys: ['freshleadconnectpct7d'] },
        fresh15d:     { kind: 'pct', keys: ['freshleadconnectpct15d'] },
        freshAll:     { kind: 'pct', keys: ['freshleadconnectpctoverall'] },
        retToday:     { kind: 'pct', keys: ['retargetingconnectpcttoday'] },
        ret7d:        { kind: 'pct', keys: ['retargetingconnectpct7d'] },
        ret15d:       { kind: 'pct', keys: ['retargetingconnectpct15d'] },
        retAll:       { kind: 'pct', keys: ['retargetingconnectpctoverall'] },
        confToday:    { kind: 'pct', keys: ['confirmationcallconnectpcttoday'] },
        conf7d:       { kind: 'pct', keys: ['confirmationcallconnectpct7d'] },
        conf15d:      { kind: 'pct', keys: ['confirmationcallconnectpct15d'] },
        confAll:      { kind: 'pct', keys: ['confirmationcallconnectpctoverall'] },
        lostToday:    { kind: 'pct', keys: ['lostleadsconnectpcttoday'] },
        lost7d:       { kind: 'pct', keys: ['lostleadsconnectpct7d'] },
        lost15d:      { kind: 'pct', keys: ['lostleadsconnectpct15d'] },
        lostAll:      { kind: 'pct', keys: ['lostleadsconnectpctoverall'] },
        totalToday:   { kind: 'pct', keys: ['totalconnectpcttoday'] },
        total7d:      { kind: 'pct', keys: ['totalconnectpct7d'] },
        total15d:     { kind: 'pct', keys: ['totalconnectpct15d'] },
        totalAll:     { kind: 'pct', keys: ['totalconnectpctoverall'] },
      },
    });

    const didDodDiag = {};
    const didDodAll = await passThrough('did_day_on_day', {
      tabs: ['did_day_on_day', 'DID Day on Day', 'did day on day', 'did_dod'],
      diag: didDodDiag,
      fields: {
        date:  { kind: 'text', keys: ['date'] },
        did:   { kind: 'text', keys: ['did'] },
        fresh: { kind: 'pct',  keys: ['freshleadconnectpct'] },
        ret:   { kind: 'pct',  keys: ['retargetingconnectpct'] },
        conf:  { kind: 'pct',  keys: ['confirmationcallconnectpct'] },
        lost:  { kind: 'pct',  keys: ['lostleadsconnectpct'] },
        total: { kind: 'pct',  keys: ['totalconnectpct'] },
      },
    });
    let dodUndated = 0;
    const didDod = didDodAll.filter(r => {
      const d = rowDate((r._c && r._c.date) || r['Date']);
      if (!d) { dodUndated++; return false; }
      return d >= effFrom && d <= effTo;
    });
    didDodDiag.undated = dodUndated;
    didDodDiag.inWindow = didDod.length;
    didDodDiag.window = effFrom + ' → ' + effTo;
    /* The trend card needs more than the picked window to show a curve, so the
       unscoped rows ride along too — explicitly named, never silently summed
       against a picked day. */
    const didDodAllDays = didDodAll;

    const useLive = !!String(process.env.CONN_SHEET_ID || '').trim();
    const [connDaily, connHourly, connAnomaly, didRows, inboundRows] = useLive
      ? [[], [], [], [], []]
      : await Promise.all([
      passThrough('conn_daily',   { emailCol: ['LRM Email', 'Agent Id'], numeric: CONN_NUM }),
      passThrough('conn_hourly',  { numeric: ['Calls', 'Callers', 'Calls per Caller', 'Share %',
                                   'Expected Share %', 'Expected Calls', 'Band Low', 'Band High',
                                   'Expected per Caller', 'Baseline Points', 'Shape Dev %',
                                   'Connect %', 'Real Conversations', 'Early Hangup %',
                                   'Agent Cut %', 'Median Patience s', 'Talk Min', 'Baseline Calls'] }),
      passThrough('conn_anomaly', { emailCol: ['LRM Email'], numeric: ['Today', 'Own Normal',
                                   'Own SD Used', 'Z', 'Move', 'Breaks', 'Calls That Day',
                                   'Baseline Days'] }),
      passThrough('did_rep',      { numeric: ['Calls', 'Active Days', 'Calls per Day',
                                   'Unique Numbers', 'Connects', 'Connect %', 'Expected Connects',
                                   'Expected %', 'Index', 'Shortfall', 'Real Conversations',
                                   'Inbound Calls', 'Inbound per 1000 Out'] }),
      passThrough('inbound_route',{ numeric: ['Calls', 'Answered', 'Missed', 'Answer %',
                                   'Platform Dropped', 'Platform Dropped %', 'Caller Hung Up',
                                   'Never Offered', 'Never Offered %', 'Ended <1s', 'Ended 1-4s',
                                   'Ended 5-19s', 'Ended 20s+', 'Ended <5s %', 'Talk Min',
                                   'Legs per Call', 'Worst Retry Storm', 'LRMs Reached',
                                   'Reached No Agent'] }),
    ]);

    /* ── 6f. The LIVE tabs (Live_Callers / Live_Hourly / Live_DIDs / Live_Floor)
       A separate Apps Script already refreshes these every 15 minutes, so they
       — not the Metabase cards above — are the working source. _connlive.js
       translates them into the same shapes; see that file for what the live
       feed can and cannot supply.

       Precedence: a legacy conn_* tab WINS where it exists, so wiring a card
       later needs no code change. `connSource` tells the frontend which it got,
       because the two differ in grain — the live feed is a weekly SNAPSHOT with
       no Date column, and the views must say so instead of letting the date
       filter look as though it applied. */
    const todayISO = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    let connFloor = [], connError = '', connDiag = {};
    try {
      const live = await readLiveConnectivity(readSheet, todayISO);
      connFloor = live.connFloor;
      connError = live.error || '';
      connDiag = live.diag || {};
      if (!connDaily.length && live.connDaily.length) {
        live.connDaily.forEach(r => {
          const em = norm(r['LRM Email']);
          if (!em || isExcluded(em)) return;
          connDaily.push({ ...r, _email: em });
        });
      }
      if (!connHourly.length) connHourly.push(...live.connHourly);
      if (!didRows.length)    didRows.push(...live.didRows);
    } catch (e) {
      console.warn('Live connectivity tabs unavailable: ' + e.message);
      connError = e.message;
    }
    const connSource = connDaily.length
      ? (connDaily[0]['Days'] !== undefined ? 'live' : 'cards') : 'none';

    // ── 7. Dropdown lists ─────────────────────────────────────────────────────
    const citySet = {}, tlNameSet = {}, lrmSet = {};
    agentRows.forEach(r => {
      if (r['City'])    citySet[r['City']] = true;
      if (r['TL Name']) tlNameSet[r['TL Name']] = true;
      const id = String(r['Agent Id'] || '').trim();
      if (id) lrmSet[id] = (r['LRM Name'] || nameFromEmail(id)) + '||' + (r['City'] || '');
    });
    const lrmList = Object.keys(lrmSet)
      .map(id => { const [name, city] = lrmSet[id].split('||'); return { id, name, city }; })
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      dateLabel, fromDate: effFrom, toDate: effTo,
      viewer: {
        email: viewerEmail,
        name: auth.user.name || nameFromEmail(viewerEmail),
        role,
        authConfigured: !!auth.configured,
        // what the frontend is allowed to show
        canSeeADOSView: role === 'ADOS' || role === 'VIEWER',
        canSeeZSMView: role === 'ADOS' || role === 'VIEWER',
        canSeeTLView:  role === 'ADOS' || role === 'ZSM' || role === 'VIEWER',
        scopeSize: scoped.length,
      },
      rosterRows: rosterAll.map(r => ({ ...r, _inScope: inScope(norm(r['Agent Id'])) })),
      totals, cityRows, adosRows, zsmRows, tlRows, hourlyRows, hourlyHasMS,
      speedRows, speedHas, speedBuckets: SPEED_BUCKETS, msScheduleRows,
      speedLeads:    wantLeads ? speedLeads    : [],
      coverageLeads: wantLeads ? coverageLeads : [],
      leadsOmitted:  !wantLeads,
      coverageRows, coverageTrend, coverageStatus, coverageHas,
      coverageMatureDays: COVERAGE_MATURE_DAYS, coverage: coverageMeta,
      depthRows, depthTrend, depthHas,
      connDaily, connHourly, connAnomaly, didRows, inboundRows, inboundPerf, inboundDiag,
      didOverall, didDod, didDodAllDays, didOverallDiag, didDodDiag, connFloor,
      connHas: {
        daily: connDaily.length > 0, hourly: connHourly.length > 0,
        anomaly: connAnomaly.length > 0, did: didRows.length > 0,
        inbound: inboundRows.length > 0, inboundPerf: inboundPerf.length > 0,
        didOverall: didOverall.length > 0, didDod: didDodAll.length > 0,
        floor: connFloor.length > 0,
        source: connSource, today: todayISO, error: connError, diag: connDiag,
      },
      msScore: { error: msScore.error || '', external: !!msScore.external, diag: msScore.diag || {},
                 scored: msScored, lrms: agentRows.length,
                 inSheet: Object.keys(msScore.byEmail || {}).length },
      agentCols, agentRows: agentRowsSlim,
      dupRowsDropped, stale: anyStale(),
      cityList: Object.keys(citySet).sort(),
      tlList:   Object.keys(tlNameSet).sort(),
      lrmList,
      activeLRMs: agentRows.length, cities: cityRows.length,
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function emptyPayload(from, to, viewerEmail) {
  return {
    dateLabel: from === to ? from : from + ' – ' + to,
    fromDate: from, toDate: to,
    viewer: { email: viewerEmail, name: '', role: 'VIEWER', authConfigured: false,
              canSeeADOSView: true, canSeeZSMView: true, canSeeTLView: true, scopeSize: 0 },
    totals: { totalCalls:0, uniqueDials:0, connected:0, realConnects:0, connectPct:0,
              realConnectPct:0, totalTTHr:0, target:0, msToday:0, msT0:0, msT1:0,
              meetingDone:0, msNoCall:0, dsToday:0, avgTalkMin:0 },
    cityRows: [], adosRows: [], zsmRows: [], tlRows: [], hourlyRows: [], hourlyHasMS: false,
    speedRows: [], speedLeads: [], speedHas: false, speedBuckets: [], msScheduleRows: [],
    coverageRows: [], coverageLeads: [], coverageTrend: [], coverageStatus: [],
    leadsOmitted: false,
    coverageHas: false, coverageMatureDays: 1,
    coverage: { error: '', external: false, diag: {} },
    depthRows: [], depthTrend: [], depthHas: false,
    connDaily: [], connHourly: [], connAnomaly: [], didRows: [], inboundRows: [],
    inboundPerf: [], inboundDiag: {},
    didOverall: [], didDod: [], didDodAllDays: [], didOverallDiag: {}, didDodDiag: {},
    connHas: { daily: false, hourly: false, anomaly: false, did: false, inbound: false,
               inboundPerf: false, didOverall: false, didDod: false },
    msScore: { error: '', external: false, diag: {}, scored: 0, lrms: 0, inSheet: 0 },
    agentCols: [], agentRows: [], rosterRows: [], cityList: [], tlList: [], lrmList: [],
    activeLRMs: 0, cities: 0,
  };
}
