/* ═════════════════════════════════════════════════════════════════
   _leaddepth.js — Dial depth tab, from "Call Depth Analysis 2.0"
   (env LEADDEPTH_SHEET_ID). Reads TWO tabs and joins them on lead_id:

   LA   (env LEADDEPTH_LA_TAB, default "LA") — the COHORT: every assigned lead.
        lead_id | Call_log LRM Email | Cluster | marketing_lead_source |
        lead_assigned_at | Light House Link | stage | status | TL | ZSM | Ados
        ("Call Depth Analysis 3.0", 7 Oct 2026: LA dropped TL | ZSM | Ados. They are
        now OPTIONAL here and filled per LRM from the mapping tab below.)
   LRM Mapping (env LEADDEPTH_MAP_TAB, default "LRM Mapping") — OPTIONAL, ~280 rows:
        Email IDs | TL | Cluster | DZMS/ZSM | ADOS | Role. TL column = the TL's email
        for LRM rows, the literal "TL" on a TL's own row (→ that TL is their own TL),
        and "DZSM"/"Program Manager" on rows that are not floor staff (skipped).
        Precedence per lead: LA's own column, then this mapping.
   Data (env LEADDEPTH_DATA_TAB, default "Data") — calls, one row per lead x day.
        lead_id | … | count of call dial | count of connected |
        meeting schedule count | meeting done count | Call / Schedule Date | …

   Cohort = LA leads whose lead_assigned_at falls in the dashboard's date
   range. Each lead's dials / connects / MS / MD = SUM over its Data rows on
   or after the assigned date. A cohort lead with no Data row = 0 dials =
   UNTOUCHED — that is why LA is needed at all: Data only lists dialled leads.
   Owner + hierarchy come from LA (the assignee), not the caller.

   ~300k rows per tab, so the payload is AGGREGATED, never per lead:
     agg  [{lrm,tl,zsm,ados,cluster,source,d,rch,n,dials,conn,ms,md}]
          one row per (LRM, source, depth d capped at 11 = ">10", reached 0/1)
     over [{lead,…,dials,conn,ms,md,stage,status,link}] leads with 6+ dials, capped
   Both carry `lrm`, so dashboard.js scopePayload() scopes them per viewer.
   Only the needed columns are fetched (batchGet by column), cached 10 min.
   ═════════════════════════════════════════════════════════════════ */
import { sheetsApi } from './_connlive.js';
import { headerDate } from './_msscore.js';

const sq = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const normE = (v) => String(v || '').trim().toLowerCase().replace('@homes.solarsquare.in', '@solarsquare.in');
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
const iso = (v) => headerDate(typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v) || String(v || '').slice(0, 10);
/* Slash/dash dates are ambiguous (01/09/2026 = 1 Sep or 9 Jan). headerDate assumes US
   MM/DD, which silently misdates a DD/MM column — calls then land before assignment
   and get dropped, inflating Untouched. Decide the order PER COLUMN from the values
   that can only be read one way (a part > 12), then parse every cell with it. */
const SL = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/;
function slashOrder(col) {
  let dmy = 0, mdy = 0;
  for (const v of col || []) { const m = typeof v === 'string' && v.trim().match(SL); if (!m) continue; if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++; }
  return dmy > mdy ? 'dmy' : 'mdy';
}
const p2 = (n) => (n < 10 ? '0' : '') + n;
const isoOrd = (v, ord) => {
  const m = typeof v === 'string' && v.trim().match(SL);
  if (m) return ord === 'dmy' ? m[3] + '-' + p2(+m[2]) + '-' + p2(+m[1]) : m[3] + '-' + p2(+m[1]) + '-' + p2(+m[2]);
  return iso(v);
};
const colA1 = (i) => { let s = '', n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const LA_COLS = { lead: ['leadid'], lrm: ['calllogl rmemail', 'calllogrmemail', 'lrmemail'], cluster: ['cluster'],
  source: ['marketingleadsource', 'leadsource'], assigned: ['leadassignedat', 'assignedat'], stage: ['stage'], status: ['status'],
  tl: ['tl'], zsm: ['zsm'], ados: ['ados'] };
const DATA_COLS = { lead: ['leadid'], dials: ['countofcalldial'], conn: ['countofconnected'], ms: ['meetingschedulecount'],
  md: ['meetingdonecount'], date: ['callscheduledate'],
  // OPTIONAL: real conversations (e.g. 15s+ talk). When present, "reached" uses it
  // instead of count of connected, which also counts rings/IVR pickups.
  real: ['countofreallyconnected', 'countofrealconnected', 'countofrealconnects', 'realconnects', 'countofconversations', 'countofconversation'] };
const OPTIONAL = { real: 1, tl: 1, zsm: 1, ados: 1 };

const MAP_COLS = { email: ['emailids', 'emailid', 'email'], tl: ['tl'], zsm: ['dzmszsm', 'zsm', 'dzsm'], ados: ['ados'] };
const isMail = (v) => /@/.test(String(v || ''));
/* LRM -> {tl,zsm,ados}. Never throws: a missing tab just means no fill. */
async function readMap(api, id) {
  const tab = String(process.env.LEADDEPTH_MAP_TAB || 'LRM Mapping').trim();
  const map = new Map();
  try {
    const res = await api.spreadsheets.values.get({ spreadsheetId: id, range: q(tab) });
    const rows = res.data.values || [];
    const { m } = mapCols(rows[0] || [], MAP_COLS);
    if (m.email < 0) return { map, tab, error: 'no "Email IDs" header' };
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], e = normE(r[m.email]);
      if (!isMail(e)) continue;
      const t = String(r[m.tl] == null ? '' : r[m.tl]).trim();
      const tl = isMail(t) ? normE(t) : /^tl$/i.test(t) ? e : '';
      if (!tl) continue;
      map.set(e, { tl, zsm: isMail(r[m.zsm]) ? normE(r[m.zsm]) : '', ados: isMail(r[m.ados]) ? normE(r[m.ados]) : '' });
    }
    return { map, tab };
  } catch (err) { return { map, tab, error: String(err.message || err) }; }
}

function mapCols(hdr, spec) {
  const h = hdr.map(sq), m = {}, miss = [];
  Object.keys(spec).forEach((k) => {
    let i = -1;
    for (const c of spec[k].map(sq)) { i = h.indexOf(c); if (i >= 0) break; }
    if (i < 0) for (const c of spec[k].map(sq)) { i = h.findIndex((x) => x.indexOf(c) === 0); if (i >= 0) break; }
    m[k] = i; if (i < 0) miss.push(k);
  });
  return { m, miss };
}
const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";

async function readTab(api, id, tab, spec) {
  const head = await api.spreadsheets.values.get({ spreadsheetId: id, range: q(tab) + '!1:1' });
  const hdr = (head.data.values || [])[0] || [];
  const { m, miss } = mapCols(hdr, spec);
  if (m.lead < 0) throw new Error('Tab "' + tab + '": no lead_id header');
  const keys = Object.keys(m).filter((k) => m[k] >= 0);
  const r = await api.spreadsheets.values.batchGet({ spreadsheetId: id, majorDimension: 'COLUMNS',
    ranges: keys.map((k) => q(tab) + '!' + colA1(m[k]) + '2:' + colA1(m[k])) });
  const cols = {};
  (r.data.valueRanges || []).forEach((vr, i) => { cols[keys[i]] = (vr.values || [])[0] || []; });
  return { cols, len: Math.max(0, ...Object.values(cols).map((c) => c.length)), miss: miss.filter((k) => !OPTIONAL[k]), has: m };
}

const CACHE_MS = 600000;
let cache = null, inflight = null;

async function load(id) {
  if (cache && cache.id === id && Date.now() - cache.at < CACHE_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const api = await sheetsApi();
    const laTab = String(process.env.LEADDEPTH_LA_TAB || 'LA').trim();
    const dataTab = String(process.env.LEADDEPTH_DATA_TAB || 'Data').trim();
    const [la, data, hm] = await Promise.all([readTab(api, id, laTab, LA_COLS), readTab(api, id, dataTab, DATA_COLS), readMap(api, id)]);
    let hierFromMap = 0, hierMissing = 0;
    // Calls per lead, kept per date so the "on/after assigned" rule applies at request time.
    // Data is one row per lead x day by design. A repeated lead x day is a COPY (re-pasted
    // export / overlapping backfill) — keep one, taking the larger value per field,
    // or its dials and meetings are counted twice.
    const calls = new Map();
    const dc = data.cols, hasReal = data.has.real >= 0;
    const dOrd = slashOrder(dc.date), laOrd = slashOrder(la.cols.assigned);
    let dupData = 0, dMin = '', dMax = '';
    for (let i = 0; i < data.len; i++) {
      const lead = String((dc.lead || [])[i] || '').trim();
      if (!lead) continue;
      const dt = isoOrd((dc.date || [])[i], dOrd);
      const rec = [dt, num((dc.dials || [])[i]), num((dc.conn || [])[i]), num((dc.ms || [])[i]), num((dc.md || [])[i]), hasReal ? num((dc.real || [])[i]) : 0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) { if (!dMin || dt < dMin) dMin = dt; if (!dMax || dt > dMax) dMax = dt; }
      let byDay = calls.get(lead); if (!byDay) calls.set(lead, byDay = new Map());
      const prev = byDay.get(dt);
      if (prev) { dupData++; for (let k = 1; k < rec.length; k++) if (rec[k] > prev[k]) prev[k] = rec[k]; }
      else byDay.set(dt, rec);
    }
    const lc = la.cols, leads = [], seen = new Map();
    let aMin = '', aMax = '', aBlank = 0, dupRows = 0;
    for (let i = 0; i < la.len; i++) {
      const lead = String((lc.lead || [])[i] || '').trim();
      if (!lead) continue;
      // LA can list one lead more than once (re-assignment). Keep ONE row per lead —
      // the latest assignment owns it (owner, hierarchy, cohort date) — but dials count
      // from the FIRST assignment, so calls made under the previous owner are not
      // thrown away and the lead does not read as untouched.
      const ai = isoOrd((lc.assigned || [])[i], laOrd);
      let first = ai;
      if (seen.has(lead)) {
        dupRows++;
        const j = seen.get(lead), P = leads[j];
        if (ai && (!P.first || ai < P.first)) P.first = ai;
        if (!(ai > P.assigned)) continue;
        first = P.first;
        leads.splice(j, 1, null);
      }
      seen.set(lead, leads.length);
      const lrm = normE((lc.lrm || [])[i]), H = hm.map.get(lrm) || {};
      let tl = normE((lc.tl || [])[i]), zsm = normE((lc.zsm || [])[i]), ados = normE((lc.ados || [])[i]);
      if (!tl && H.tl) { tl = H.tl; hierFromMap++; }
      if (!zsm) zsm = H.zsm || ''; if (!ados) ados = H.ados || '';
      if (!tl) hierMissing++;
      leads.push({ lead, lrm, cluster: String((lc.cluster || [])[i] || '').trim(),
        source: String((lc.source || [])[i] || '').trim() || '—', assigned: ai, first,
        stage: String((lc.stage || [])[i] || '').trim(), status: String((lc.status || [])[i] || '').trim(),
        tl, zsm, ados });
      const ad = leads[leads.length - 1].assigned; void ai;
      if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { if (!aMin || ad < aMin) aMin = ad; if (!aMax || ad > aMax) aMax = ad; } else aBlank++;
    }
    cache = { id, at: Date.now(), leads: leads.filter(Boolean), dupRows, calls, dupData, dMin, dMax, dOrd, laOrd, hasReal, laTab, dataTab, missLA: la.miss, missData: data.miss, dataRows: data.len, aMin, aMax, aBlank, aSample: String((lc.assigned || [])[0] || ''),
      mapTab: hm.tab, mapRows: hm.map.size, mapError: hm.error || '', hierFromMap, hierMissing };
    return cache;
  })();
  try { return await inflight; } finally { inflight = null; }
}

const OVER = 6, OVER_CAP = 2500;

export async function readLeadDepth(from, to, opts) {
  const wantLeads = !!(opts && opts.leads);
  const id = String(process.env.LEADDEPTH_SHEET_ID || '').trim();
  if (!id) return { agg: [], over: [], stage: [], diag: { configured: false } };
  let c;
  try { c = await load(id); }
  catch (e) { console.error('leaddepth read', e); return { agg: [], over: [], stage: [], diag: { configured: true, error: String(e.message || e) } }; }

  const agg = new Map(), over = [], stg = new Map(), list = [];
  let cohort = 0, untouched = 0, noDate = 0, preDials = 0, preLeads = 0, afterData = 0, beforeData = 0, reassignedDials = 0;
  const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  for (const L of c.leads) {
    // A lead with no parseable assigned date used to slip through BOTH bounds and sit
    // in every range as untouched. Out of the cohort now; counted in diag.noDate.
    if ((from || to) && !okDate(L.assigned)) { noDate++; continue; }
    if (from && L.assigned < from) continue;
    if (to && L.assigned > to) continue;
    // Assigned after the Data tab's last call date: it CANNOT have dials yet, so it
    // is not untouched — it is outside the data. Kept out of the cohort, counted in diag.
    if (c.dMax && L.assigned > c.dMax) { afterData++; continue; }
    // Assigned BEFORE the Data tab's first call date: its early dials are not in the
    // sheet, so it would read as untouched/shallow. Out of the cohort, counted in diag.
    if (c.dMin && L.assigned < c.dMin) { beforeData++; continue; }
    cohort++;
    const since = L.first || L.assigned;
    let dials = 0, conn = 0, ms = 0, md = 0, real = 0, pre = 0;
    for (const r of (c.calls.get(L.lead) || new Map()).values()) {
      if (r[0] && r[0] < since) { pre += r[1]; continue; }
      dials += r[1]; conn += r[2]; ms += r[3]; md += r[4]; real += r[5];
      if (r[0] && r[0] < L.assigned) reassignedDials += r[1];
    }
    if (pre) { preDials += pre; if (!dials) preLeads++; }
    if (!dials) untouched++;
    const d = Math.min(11, dials), rch = (c.hasReal ? real : conn) > 0 ? 1 : 0;
    const key = L.lrm + '|' + L.source + '|' + d + '|' + rch;
    let g = agg.get(key);
    if (!g) agg.set(key, g = { lrm: L.lrm, tl: L.tl, zsm: L.zsm, ados: L.ados, cluster: L.cluster, source: L.source, d, rch, n: 0, dials: 0, conn: 0, ms: 0, md: 0, msl: 0 });
    g.n++; g.dials += dials; g.conn += conn; g.ms += ms; g.md += md; if (ms > 0) g.msl++;
    // Stage-wise depth (City view): no depth/reach split, so it stays small.
    const sk = L.lrm + '|' + L.source + '|' + L.cluster + '|' + L.stage;
    let s = stg.get(sk);
    if (!s) stg.set(sk, s = { lrm: L.lrm, tl: L.tl, zsm: L.zsm, ados: L.ados, cluster: L.cluster, source: L.source, stage: L.stage || '—', n: 0, dl: 0, dials: 0 });
    s.n++; if (dials) s.dl++; s.dials += dials;
    // Per-lead list for the Dial depth pop-up — only on the lazy ?leads=1 fetch.
    // Short keys + LRM only (TL/ZSM/ADOS are re-derived client-side from agg).
    if (wantLeads && dials) list.push({ l: L.lead, lrm: L.lrm, c: L.cluster, s: L.source, st: L.stage, ss: L.status, d: dials, cn: conn, rc: c.hasReal ? real : conn, ms, md, a: L.assigned });
    if (dials >= OVER) over.push({ lead: L.lead, lrm: L.lrm, tl: L.tl, zsm: L.zsm, ados: L.ados, cluster: L.cluster, source: L.source,
      dials, conn, ms, md, stage: L.stage, status: L.status, assigned: L.assigned,
      link: 'https://lighthouse.solarsquare.in/#/menu/lead/details/' + encodeURIComponent(L.lead) });
  }
  over.sort((a, b) => b.dials - a.dials || a.conn - b.conn);
  /* Reconciliation: does the Data tab even hold the floor's calls, and do its lead ids
     match LA's? Dials by CALL date in the range, split by whether the lead is in LA.
     A low dataDialsInRange vs the dialler total = the Data tab is incomplete; a high
     dialsOnLeadsNotInLA = an id-format mismatch (e.g. Mongo _id vs LMP code). */
  if (!c.laSet) c.laSet = new Set(c.leads.map((L) => L.lead));
  let dialsInRange = 0, dialsNotInLA = 0, leadsNotInLA = 0, msInRange = 0;
  const notInLASample = [];
  for (const [lead, byDay] of c.calls) {
    let dl = 0;
    for (const r of byDay.values()) { if ((from && r[0] < from) || (to && r[0] > to)) continue; dl += r[1]; msInRange += r[3]; }
    if (!dl) continue;
    dialsInRange += dl;
    if (!c.laSet.has(lead)) { dialsNotInLA += dl; leadsNotInLA++; if (notInLASample.length < 5) notInLASample.push(lead); }
  }
  let cohortDials = 0; for (const g of agg.values()) cohortDials += g.dials;
  const recon = { dataDialsInRange: dialsInRange, dataMsInRange: msInRange, cohortDials, dialsOnLeadsNotInLA: dialsNotInLA, leadsNotInLA,
    notInLASample, laIdSample: c.leads.slice(0, 3).map((L) => L.lead) };
  return { agg: [...agg.values()], over: over.slice(0, OVER_CAP), stage: [...stg.values()], leads: list,
    diag: { configured: true, ...recon, laTab: c.laTab, dataTab: c.dataTab, laRows: c.leads.length, dataRows: c.dataRows,
      cohort, untouched, overTotal: over.length, noDate, afterDataEnd: afterData, beforeDataStart: beforeData, dataMin: c.dMin, dataMax: c.dMax,
      dataDupRows: c.dupData, dataDateOrder: c.dOrd, laDateOrder: c.laOrd, reachBasis: c.hasReal ? 'real' : 'connected', dialsUnderPrevOwner: reassignedDials, laDupRows: c.dupRows, preAssignDials: preDials, untouchedOnlyPreAssign: preLeads, missingLA: c.missLA, missingData: c.missData, from, to, cachedAt: new Date(c.at).toISOString(),
      assignedMin: c.aMin, assignedMax: c.aMax, assignedUnparsed: c.aBlank, assignedSample: c.aSample,
      mapTab: c.mapTab, mapPeople: c.mapRows, mapError: c.mapError, leadsHierFromMap: c.hierFromMap, leadsNoHierarchy: c.hierMissing } };
}
