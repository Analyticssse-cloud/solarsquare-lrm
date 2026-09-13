/* ════════════════════════════════════════════════════════════════════════════
   _connlive.js — adapter for the LIVE connectivity tabs.

   WHY THIS FILE EXISTS
   --------------------
   The connectivity views were built against five Metabase-backed tabs
   (conn_daily / conn_hourly / conn_anomaly / did_rep / inbound_route). They are
   not needed: a separate Apps Script already refreshes the same metrics into
   this spreadsheet every 15 minutes, under different tab and column names:

     Live_Callers  one row per LRM, THIS WEEK   (not per day)
     Live_Hourly   one row per hour of TODAY, with two baselines per hour
     Live_DIDs     one row per number, THIS WEEK
     Live_Floor    one row per comparison PERIOD (today / last week / averages)

   So this translates those four into the shapes the frontend already reads,
   rather than rewriting the views. The legacy conn_* tabs still win when they
   exist, so nothing breaks if they are ever wired.

   THREE THINGS THE LIVE FEED CANNOT DO, AND THIS FILE MUST NOT PRETEND IT CAN
   ---------------------------------------------------------------------------
   1. It is a SNAPSHOT, not a history — "Calls this week", no Date column. The
      Connectivity and Behaviour tabs therefore show the current week whatever
      the date filter says, and the frontend states that on the card. Do not
      invent a Date and let the range filter slice it.
   2. There is no attempt-depth mix and no fresh-number count, so the depth
      cards stay hidden. The INDEX survives, because "Against expected" /
      "Reputation index" already carry the depth adjustment from upstream.
   3. There is no own-baseline anomaly feed and no inbound routing feed. What
      the live feed has instead is WEEK-OVER-WEEK deltas, which are a different
      (coarser) test and are labelled as such — never as a z-score break.

   Counts are reconstructed from percentages where the feed only gives a rate
   (connects = calls x connectivity %). That is a rounding-level approximation,
   not a different definition, and it keeps one code path in the views.
   ════════════════════════════════════════════════════════════════════════════ */

const sq   = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const numv = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v == null ? '' : v).replace(/[, %]/g, ''));
  return isFinite(n) ? n : 0;
};
const truthy = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
};
// Tolerant header index: first header matching any candidate once case, spaces
// and punctuation are squashed. The live tabs are hand-titled ("Inbound per
// 1,000 out"), so exact-string matching would break on a comma.
function idx(hdr, names) {
  const want = names.map(sq);
  for (let i = 0; i < hdr.length; i++) if (want.indexOf(sq(hdr[i])) >= 0) return i;
  return -1;
}
const rd = (r, i) => (i < 0 ? '' : r[i]);

/* ── Live_Callers -> connDaily rows ─────────────────────────────────────────
   One emitted row per LRM (the feed is already weekly), carrying `Days` so the
   frontend's per-day figures stay per-day. Duplicate rows for the same person
   DO occur in the feed (the @homes alias arrives twice, with the second copy's
   "vs last week" columns equal to the metric itself, i.e. no baseline) — they
   are collapsed here, because the view SUMS rows per email and would otherwise
   double that caller's dials. */
function adaptCallers(raw) {
  if (!raw || raw.length < 2) return [];
  const h = raw[0].map((x) => String(x).trim());
  const I = {
    name:   idx(h, ['Caller', 'LRM Name', 'Name']),
    email:  idx(h, ['Email', 'LRM Email', 'Agent Id']),
    calls:  idx(h, ['Calls this week', 'Calls']),
    perDay: idx(h, ['Calls per day']),
    conn:   idx(h, ['Connectivity %', 'Connect %']),
    connW:  idx(h, ['Connectivity vs last week']),
    convPd: idx(h, ['Conversations per day']),
    early:  idx(h, ['Early hang-up %', 'Early hangup %']),
    earlyW: idx(h, ['Early hang-up vs last week', 'Early hangup vs last week']),
    wait:   idx(h, ['Seconds waited', 'Median Patience s']),
    short:  idx(h, ['Pick-ups killed under 15s %', 'Short connect %']),
    redial: idx(h, ['Redial under a minute %', 'Rapid redial %']),
    cap:    idx(h, ['Calls beyond the daily cap', 'Calls Beyond Cap']),
    vsExp:  idx(h, ['Against expected', 'Shortfall']),
  };
  if (I.email < 0 || I.calls < 0) return [];
  const seen = {}, out = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const email = String(rd(r, I.email) || '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;

    const calls   = numv(rd(r, I.calls));
    const perDay  = numv(rd(r, I.perDay));
    const days    = perDay > 0 ? Math.max(1, Math.round(calls / perDay)) : 1;
    const connPct = numv(rd(r, I.conn));
    const connects = Math.round(calls * connPct / 100);
    const vsExp   = I.vsExp < 0 ? null : numv(rd(r, I.vsExp));
    const earlyPct = numv(rd(r, I.early));
    const shortPct = numv(rd(r, I.short));

    out.push({
      'LRM Email': email,
      'LRM Name': String(rd(r, I.name) || '').trim(),
      'Days': days,
      'Calls': calls,
      'Connects': connects,
      'Connect %': connPct,
      // Expected connects is recovered from the shortfall the feed already
      // publishes, so the index here is upstream's depth-adjusted one and not a
      // second, differently-defined number.
      'Expected Connects': vsExp === null ? 0 : Math.max(0, connects - vsExp),
      'Real Conversations': Math.round(numv(rd(r, I.convPd)) * days),
      'Early Hangups': Math.round(calls * earlyPct / 100),
      'Early Hangup %': earlyPct,
      'Median Patience s': numv(rd(r, I.wait)),
      'Short Connects': Math.round(connects * shortPct / 100),
      'Short Connect %': shortPct,
      'Rapid Redials': Math.round(calls * numv(rd(r, I.redial)) / 100),
      'Calls Beyond Cap': numv(rd(r, I.cap)),
      // Week-over-week movement. NOT an own-baseline z-score: it compares one
      // week to the next for the same person, so a quiet week moves it too.
      'Conn vs Last Week': I.connW < 0 ? null : numv(rd(r, I.connW)),
      'Early vs Last Week': I.earlyW < 0 ? null : numv(rd(r, I.earlyW)),
    });
  }
  return out;
}

/* ── Live_Hourly -> connHourly rows ─────────────────────────────────────────
   The hour SHAPE test, implemented on this feed's own columns. The baseline is
   a SHARE of the day, never an absolute count: the floor has roughly tripled
   since mid-August (this feed shows 15,624 calls today against a 4-week
   same-weekday average of 7,012 by 15:00), so an absolute comparison declares
   almost every hour a spike.

   Shares are renormalised across the hours that have actually happened, so a
   part-day compares like with like, and a baseline hour under 50 calls is
   dropped rather than allowed to swing on nothing. */
function adaptHourly(raw, todayISO) {
  if (!raw || raw.length < 2) return [];
  const h = raw[0].map((x) => String(x).trim());
  const I = {
    hour:   idx(h, ['Hour']),
    status: idx(h, ['Status']),
    calls:  idx(h, ['Calls today', 'Calls']),
    lastWk: idx(h, ['Calls same day last week']),
    normal: idx(h, ['Calls on a normal day']),
    conn:   idx(h, ['Connectivity today %', 'Connect %']),
    connLw: idx(h, ['Connectivity last week %']),
    conn7:  idx(h, ['Connectivity 7-day avg %']),
    early:  idx(h, ['Early hang-up today %', 'Early hangup %']),
    earlyLw:idx(h, ['Early hang-up last week %']),
    wait:   idx(h, ['Seconds waited today']),
  };
  if (I.hour < 0) return [];
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const hourTxt = String(rd(r, I.hour) || '').trim();
    if (!hourTxt) continue;
    const hr = parseInt(hourTxt, 10);
    if (isNaN(hr)) continue;
    rows.push({
      hr,
      hourTxt,
      status: String(rd(r, I.status) || '').trim().toLowerCase(),
      calls:  numv(rd(r, I.calls)),
      normal: numv(rd(r, I.normal)),
      lastWk: numv(rd(r, I.lastWk)),
      conn:   numv(rd(r, I.conn)),
      connLw: numv(rd(r, I.connLw)),
      conn7:  numv(rd(r, I.conn7)),
      early:  numv(rd(r, I.early)),
      earlyLw:numv(rd(r, I.earlyLw)),
      wait:   numv(rd(r, I.wait)),
    });
  }
  const done = rows.filter((x) => x.status !== 'not yet');
  const sumToday  = done.reduce((a, x) => a + x.calls, 0);
  const sumNormal = done.reduce((a, x) => a + x.normal, 0);

  return rows.map((x) => {
    const share    = sumToday  ? x.calls  / sumToday  * 100 : 0;
    const expShare = sumNormal ? x.normal / sumNormal * 100 : 0;
    // A baseline hour under 50 calls is not a baseline. Baseline Points is the
    // gate the frontend reads (>= 3 to draw); it is set from that rule, not
    // from a count of days, because this feed does not publish one.
    const usable = x.status !== 'not yet' && x.normal >= 50 && expShare > 0;
    const dev = usable ? (share / expShare - 1) * 100 : 0;
    return {
      'Date': todayISO,
      'Hour': hourTxt,
      'Status': x.status === 'not yet' ? 'not yet' : x.status,
      'Calls': x.calls,
      'Share %': share,
      'Expected Share %': expShare,
      'Expected Calls': x.normal,
      'Baseline Calls': x.lastWk,
      'Baseline Points': usable ? 4 : 0,
      'Shape Dev %': Math.round(dev * 10) / 10,
      'Shape': !usable ? '' : (dev >= 50 ? 'spike' : (dev <= -50 ? 'collapse' : 'normal')),
      'Connect %': x.conn,
      'Connect % Last Week': x.connLw,
      'Connect % 7d': x.conn7,
      'Early Hangup %': x.early,
      'Early Hangup % Last Week': x.earlyLw,
      'Median Patience s': x.wait,
      // Deliberately absent: this feed carries no per-hour conversation count,
      // and deriving one from connects would be a number with no source.
      'Owner': !usable ? '' : (dev >= 50 || dev <= -50 ? 'Systems / roster — NOT LRM behaviour' : ''),
    };
  });
}

/* ── Live_DIDs -> did_rep rows ──────────────────────────────────────────────
   Block is the NINE-digit prefix (918041763xxx). Eleven digits splits the
   estate into ~40 pseudo-blocks of ten numbers and the block comparison
   becomes unreadable.

   Cohort is NOT derived. The feed carries no in-service date, and the whole
   point of the cohort split (fresh ~41% vs aged-and-hammered ~26%) is that it
   turns on age, so guessing it from volume would manufacture the finding. The
   cohort card hides itself when the column is absent. */
function adaptDIDs(raw) {
  if (!raw || raw.length < 2) return [];
  const h = raw[0].map((x) => String(x).trim());
  const I = {
    did:    idx(h, ['Number', 'DID']),
    calls:  idx(h, ['Calls this week', 'Calls']),
    perDay: idx(h, ['Calls per day']),
    conn:   idx(h, ['Connectivity %', 'Connect %']),
    real:   idx(h, ['Real conversations %']),
    index:  idx(h, ['Reputation index', 'Index']),
    idxW:   idx(h, ['Index vs last week']),
    hang:   idx(h, ['Caller hang-up %']),
    inb:    idx(h, ['Inbound per 1,000 out', 'Inbound per 1000 Out']),
    ok:     idx(h, ['Reading reliable']),
  };
  if (I.did < 0) return [];
  const out = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const did = String(rd(r, I.did) || '').trim();
    if (!did) continue;
    const calls   = numv(rd(r, I.calls));
    const perDay  = numv(rd(r, I.perDay));
    const connPct = numv(rd(r, I.conn));
    const connects = Math.round(calls * connPct / 100);
    const index   = numv(rd(r, I.index));
    const expected = index > 0 ? connects / (index / 100) : 0;
    const reliable = I.ok < 0 ? calls >= 500 : truthy(rd(r, I.ok));
    const per1k   = numv(rd(r, I.inb));
    out.push({
      'DID': did,
      'Block': did.slice(0, 9),
      'Calls': calls,
      'Calls per Day': perDay,
      'Active Days': perDay > 0 ? Math.max(1, Math.round(calls / perDay)) : 0,
      'Connects': connects,
      'Connect %': connPct,
      'Real Conv %': numv(rd(r, I.real)),
      'Expected Connects': Math.round(expected),
      'Index': index,
      'Shortfall': expected ? Math.round(connects - expected) : 0,
      'Index vs Last Week': I.idxW < 0 ? null : numv(rd(r, I.idxW)),
      'Caller Hangup %': numv(rd(r, I.hang)),
      'Inbound per 1000 Out': per1k,
      'Inbound Calls': Math.round(calls * per1k / 1000),
      // "Reading reliable" is the feed's own volume gate; it is what makes a
      // verdict admissible, so an unreliable row gets no verdict at all rather
      // than a grey one that still reads as advice.
      'Confidence': reliable ? '' : 'too few calls',
      'Verdict': !reliable ? '' : (index < 90 ? 'retire' : (index >= 110 ? 'strong' : '')),
    });
  }
  return out;
}

/* ── Live_Floor -> the period comparison ───────────────────────────────────
   Passed through almost verbatim; only the numbers are coerced. The row order
   in the sheet is alphabetical by period, which reads as noise, so the known
   periods are ordered today -> last week -> averages -> change and anything
   unrecognised is kept at the end rather than dropped. */
const FLOOR_ORDER = ['today so far', 'same day last week', 'last 7 days, daily average',
                     'same weekday, 4-week average', 'change vs same day last week'];
function adaptFloor(raw) {
  if (!raw || raw.length < 2) return [];
  const h = raw[0].map((x) => String(x).trim());
  const iP = idx(h, ['Period']);
  if (iP < 0) return [];
  const numCols = h.map((name, j) => (j === iP ? false : true));
  const out = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const period = String(rd(r, iP) || '').trim();
    if (!period) continue;
    const o = { Period: period };
    h.forEach((name, j) => {
      if (!name || j === iP) return;
      o[name] = numCols[j] ? numv(r[j]) : String(r[j] || '').trim();
    });
    out.push(o);
  }
  return out.sort((a, b) => {
    const ia = FLOOR_ORDER.indexOf(a.Period.toLowerCase());
    const ib = FLOOR_ORDER.indexOf(b.Period.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/* Read the four live tabs and translate. `readTab` is the dashboard's own
   reader (same spreadsheet as everything else) and is used when the live tabs
   sit in the dashboard's sheet.

   THE LIVE TABS ARE IN A DIFFERENT SPREADSHEET (13 Sep 2026), so the normal
   case is the other branch: set `CONN_SHEET_ID` to that file's id and this
   reads it directly with the same service account. Two requirements, both
   outside the code:
     1. share that spreadsheet with GOOGLE_SA_EMAIL (Viewer is enough — this
        path only ever reads);
     2. set CONN_SHEET_ID in the Vercel environment and redeploy.

   QUOTA IS THE REAL CONSTRAINT HERE, NOT AUTH (learned the hard way 13 Sep:
   "Read requests per minute per user" exceeded, and the views went blank
   because a throttled read is indistinguishable from a missing tab). The
   Sheets API allows 60 reads per minute per service account, and ONE dashboard
   request already reads Ozontel, the roster, hourly, speed, speed_leads and MS
   inventory. So this file must be cheap:
     · ONE batchGet for all four tabs, not four gets (falls back to per-tab
       reads only if the batch is rejected, e.g. a renamed tab);
     · a module-level cache shared by every request the same warm instance
       serves — the source only refreshes every 15 minutes, so a 120s TTL costs
       nothing in freshness and removes almost all of the load;
     · failures are cached too, briefly, so a throttled minute cannot turn into
       a retry storm that keeps the quota pinned;
     · the error TEXT is returned, so the views can say "quota" instead of
       rendering an empty panel that looks like a missing feed. */
const LIVE_TABS = ['Live_Callers', 'Live_Hourly', 'Live_DIDs', 'Live_Floor'];
/* Tab titles are DISCOVERED, not assumed. The four names above came from the
   refresh-status block's JSON keys, which turned out not to be the sheet's
   actual titles — and a batchGet on a wrong range throws "Unable to parse
   range", which the first version swallowed into an empty feed with no message.
   So: list the real titles once (one cheap metadata read), match each role by
   squashed name, and if a role cannot be matched SAY WHICH TITLES EXIST. */
const TAB_MATCH = [
  ['callers', ['livecallers', 'callers', 'caller', 'livecaller', 'livelrms', 'lrms', 'livelrm', 'agents']],
  ['hourly',  ['livehourly', 'hourly', 'livehours', 'hours', 'livehour']],
  ['dids',    ['livedids', 'dids', 'did', 'livenumbers', 'numbers', 'livedid']],
  ['floor',   ['livefloor', 'floor', 'livesummary', 'summary', 'livetoday']],
];
function matchTitles(titles) {
  const bySquash = {};
  titles.forEach((t) => { bySquash[sq(t)] = t; });
  const out = {};
  TAB_MATCH.forEach(([role, cands]) => {
    for (const c of cands) if (bySquash[c]) { out[role] = bySquash[c]; return; }
    // Nothing exact: accept a title that CONTAINS the primary candidate, so
    // "Live_Callers (v2)" or "Live Callers " still resolve.
    const prim = cands[0];
    const hit = titles.find((t) => sq(t).indexOf(prim) >= 0 || prim.indexOf(sq(t)) >= 0);
    if (hit) out[role] = hit;
  });
  return out;
}
const CACHE_OK_MS  = 120000;
const CACHE_ERR_MS = 20000;
let cache = null;   // { key, at, ttl, value }

/* ── Service-account credentials ─────────────────────────────────────────────
   This file needs its own client (it reads a DIFFERENT spreadsheet from the
   dashboard's `readSheet`), so it has to resolve the credentials itself — and
   that is where it broke on 13 Sep with `1E08010C:DECODER routines::
   unsupported`, which is OpenSSL saying "this is not a private key". It means
   the variable was empty or the wrong shape, NOT that auth was refused.

   So nothing is assumed about the variable names or the encoding: several
   conventional names are tried, a whole service-account JSON blob is accepted,
   wrapping quotes are stripped, literal \n sequences become real newlines, and
   a base64-wrapped key is decoded. The name that was used is reported in the
   error text, because "which variable is the key actually in" is the entire
   question when this fails. */
const KEY_VARS = ['GOOGLE_SA_KEY', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SA_PRIVATE_KEY',
                  'GOOGLE_SERVICE_ACCOUNT_KEY', 'GCP_PRIVATE_KEY', 'SA_KEY'];
const EMAIL_VARS = ['GOOGLE_SA_EMAIL', 'GOOGLE_CLIENT_EMAIL',
                    'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GCP_CLIENT_EMAIL', 'SA_EMAIL'];
const JSON_VARS = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_CREDENTIALS',
                   'GOOGLE_APPLICATION_CREDENTIALS_JSON', 'GCP_SA_JSON'];

function cleanKey(raw) {
  let k = String(raw || '').trim();
  if (!k) return '';
  // Vercel's UI keeps pasted quotes; a quoted value arrives WITH them.
  if ((k[0] === '"' && k[k.length - 1] === '"') || (k[0] === "'" && k[k.length - 1] === "'")) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\r/g, '').replace(/\\n/g, '\n');
  if (k.indexOf('PRIVATE KEY') < 0 && /^[A-Za-z0-9+/=\s]+$/.test(k) && k.length > 200) {
    try { k = Buffer.from(k, 'base64').toString('utf8'); } catch (e) {}
  }
  return k.trim();
}
function credentials() {
  for (const v of JSON_VARS) {
    const raw = process.env[v];
    if (!raw) continue;
    try {
      const j = JSON.parse(raw.trim());
      if (j.client_email && j.private_key) {
        return { email: j.client_email, key: cleanKey(j.private_key), from: v };
      }
    } catch (e) {}
  }
  let email = '', efrom = '';
  for (const v of EMAIL_VARS) {
    if (process.env[v]) { email = String(process.env[v]).trim().replace(/^['"]|['"]$/g, ''); efrom = v; break; }
  }
  for (const v of KEY_VARS) {
    const k = cleanKey(process.env[v]);
    if (k.indexOf('PRIVATE KEY') >= 0) return { email, key: k, from: v + (efrom ? ' + ' + efrom : '') };
  }
  // Nothing parsed: report what exists so the fix is one look.
  const present = KEY_VARS.concat(EMAIL_VARS, JSON_VARS).filter((v) => !!process.env[v]);
  return { email, key: '', from: '', present };
}

async function sheetsApi() {
  const c = credentials();
  if (!c.key || !c.email) {
    const e = new Error('CREDS: no usable service-account key. Variables present: '
      + ((c.present && c.present.length) ? c.present.join(', ') : '(none of the expected names)')
      + '. Expected a PEM private key in one of ' + KEY_VARS.join(' / ')
      + ', or a full JSON credential in ' + JSON_VARS[0] + '.');
    throw e;
  }
  const { google } = await import('googleapis');
  const auth = new google.auth.JWT(c.email, null, c.key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  return google.sheets({ version: 'v4', auth });
}

/* Metadata + one batched values read = two API calls for the whole feed. */
async function readExternal(sheetId) {
  const api = await sheetsApi();
  const meta = await api.spreadsheets.get({
    spreadsheetId: sheetId, fields: 'sheets.properties.title',
  });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  const picked = matchTitles(titles);
  const roles = Object.keys(picked);
  if (!roles.length) {
    return { tabs: null, titles, picked,
      error: 'Live sheet is readable, but none of its tabs match the expected names. Tabs found: '
           + (titles.join(', ') || '(none)') + '.' };
  }
  // A title with a space or a quote must be quoted as an A1 range.
  const rangeOf = (t) => "'" + String(t).replace(/'/g, "''") + "'";
  const res = await api.spreadsheets.values.batchGet({
    spreadsheetId: sheetId, ranges: roles.map((r) => rangeOf(picked[r])),
  });
  const vrs = res.data.valueRanges || [];
  const tabs = {};
  roles.forEach((r, i) => { tabs[r] = (vrs[i] && vrs[i].values) || []; });
  return { tabs, titles, picked, error: '' };
}

export async function readLiveConnectivity(readTab, todayISO) {
  const ext = String(process.env.CONN_SHEET_ID || '').trim();
  const key = ext || 'self';
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < cache.ttl) return cache.value;

  let tabs = null, error = '', diag = {};
  if (ext) {
    try {
      const r = await readExternal(ext);
      tabs = r.tabs; error = r.error;
      diag = { titles: r.titles, picked: r.picked };
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/^CREDS:/.test(msg)) {
        error = msg.replace(/^CREDS:\s*/, '');
      } else if (/DECODER|unsupported|PEM|private key/i.test(msg)) {
        error = 'The service-account private key in this deployment could not be parsed (OpenSSL: '
              + 'unsupported). Re-paste GOOGLE_SA_KEY including the BEGIN/END lines, with \\n escapes '
              + 'or real newlines, no surrounding quotes — then redeploy.';
      } else if (/quota|rate|429/i.test(msg)) {
        error = 'Google Sheets read quota exceeded — the feed will reappear within a minute.';
      } else if (/permission|403/i.test(msg)) {
        error = 'The live sheet is not readable by the service account — share it with GOOGLE_SA_EMAIL as Viewer.';
      } else if (/not found|404|Requested entity/i.test(msg)) {
        error = 'No spreadsheet with the id in CONN_SHEET_ID — check the id.';
      } else {
        error = 'Live sheet read failed: ' + msg;
      }
      console.warn('Live connectivity read failed: ' + msg);
    }
  } else {
    // No env var: fall back to the dashboard's own spreadsheet, and say so if
    // the tabs are not there either — "not configured" and "configured but
    // empty" must not look the same.
    tabs = {};
    const roles = ['callers', 'hourly', 'dids', 'floor'];
    for (let i = 0; i < LIVE_TABS.length; i++) {
      try { tabs[roles[i]] = await readTab(LIVE_TABS[i]); } catch (e) { tabs[roles[i]] = []; }
    }
    if (!roles.some((r) => (tabs[r] || []).length > 1)) {
      tabs = null;
      error = 'CONN_SHEET_ID is not set in this deployment, and the dashboard sheet has no Live_* tabs.';
    }
  }

  let value;
  if (tabs) {
    value = {
      connDaily:  adaptCallers(tabs.callers),
      connHourly: adaptHourly(tabs.hourly, todayISO),
      didRows:    adaptDIDs(tabs.dids),
      connFloor:  adaptFloor(tabs.floor),
      external:   !!ext, error: '', diag: diag,
    };
    /* Tabs read but nothing survived translation = a COLUMN mismatch, not a
       missing feed. Name the tab and its headers rather than going quiet. */
    if (!value.connDaily.length && (tabs.callers || []).length > 1) {
      value.error = 'Read "' + (diag.picked && diag.picked.callers ? diag.picked.callers : 'Live_Callers')
        + '" (' + ((tabs.callers || []).length - 1) + ' rows) but could not find an Email / Calls column. '
        + 'Headers seen: ' + (tabs.callers[0] || []).join(' | ') + '.';
    }
  } else {
    value = { connDaily: [], connHourly: [], didRows: [], connFloor: [],
              external: !!ext, error: error, diag: diag };
  }

  cache = { key, at: now, ttl: tabs && !value.error ? CACHE_OK_MS : CACHE_ERR_MS, value };
  return value;
}
