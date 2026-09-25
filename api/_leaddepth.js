/* ═════════════════════════════════════════════════════════════════
   _leaddepth.js — Dial depth tab, from "Call Depth Analysis 2.0"
   (env LEADDEPTH_SHEET_ID). Reads TWO tabs and joins them on lead_id:

   LA   (env LEADDEPTH_LA_TAB, default "LA") — the COHORT: every assigned lead.
        lead_id | Call_log LRM Email | Cluster | marketing_lead_source |
        lead_assigned_at | Light House Link | stage | status | TL | ZSM | Ados
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
const colA1 = (i) => { let s = '', n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const LA_COLS = { lead: ['leadid'], lrm: ['calllogl rmemail', 'calllogrmemail', 'lrmemail'], cluster: ['cluster'],
  source: ['marketingleadsource', 'leadsource'], assigned: ['leadassignedat', 'assignedat'], stage: ['stage'], status: ['status'],
  tl: ['tl'], zsm: ['zsm'], ados: ['ados'] };
const DATA_COLS = { lead: ['leadid'], dials: ['countofcalldial'], conn: ['countofconnected'], ms: ['meetingschedulecount'],
  md: ['meetingdonecount'], date: ['callscheduledate'] };

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
  return { cols, len: Math.max(0, ...Object.values(cols).map((c) => c.length)), miss };
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
    const [la, data] = await Promise.all([readTab(api, id, laTab, LA_COLS), readTab(api, id, dataTab, DATA_COLS)]);
    // Calls per lead, kept per date so the "on/after assigned" rule applies at request time.
    const calls = new Map();
    const dc = data.cols;
    for (let i = 0; i < data.len; i++) {
      const lead = String((dc.lead || [])[i] || '').trim();
      if (!lead) continue;
      const rec = [iso((dc.date || [])[i]), num((dc.dials || [])[i]), num((dc.conn || [])[i]), num((dc.ms || [])[i]), num((dc.md || [])[i])];
      const a = calls.get(lead); if (a) a.push(rec); else calls.set(lead, [rec]);
    }
    const lc = la.cols, leads = [];
    for (let i = 0; i < la.len; i++) {
      const lead = String((lc.lead || [])[i] || '').trim();
      if (!lead) continue;
      leads.push({ lead, lrm: normE((lc.lrm || [])[i]), cluster: String((lc.cluster || [])[i] || '').trim(),
        source: String((lc.source || [])[i] || '').trim() || '—', assigned: iso((lc.assigned || [])[i]),
        stage: String((lc.stage || [])[i] || '').trim(), status: String((lc.status || [])[i] || '').trim(),
        tl: normE((lc.tl || [])[i]), zsm: normE((lc.zsm || [])[i]), ados: normE((lc.ados || [])[i]) });
    }
    cache = { id, at: Date.now(), leads, calls, laTab, dataTab, missLA: la.miss, missData: data.miss, dataRows: data.len };
    return cache;
  })();
  try { return await inflight; } finally { inflight = null; }
}

const OVER = 6, OVER_CAP = 2500;

export async function readLeadDepth(from, to) {
  const id = String(process.env.LEADDEPTH_SHEET_ID || '').trim();
  if (!id) return { agg: [], over: [], diag: { configured: false } };
  let c;
  try { c = await load(id); }
  catch (e) { console.error('leaddepth read', e); return { agg: [], over: [], diag: { configured: true, error: String(e.message || e) } }; }

  const agg = new Map(), over = [];
  let cohort = 0, untouched = 0;
  for (const L of c.leads) {
    if (from && L.assigned && L.assigned < from) continue;
    if (to && L.assigned && L.assigned > to) continue;
    cohort++;
    let dials = 0, conn = 0, ms = 0, md = 0;
    for (const r of c.calls.get(L.lead) || []) {
      if (L.assigned && r[0] && r[0] < L.assigned) continue;
      dials += r[1]; conn += r[2]; ms += r[3]; md += r[4];
    }
    if (!dials) untouched++;
    const d = Math.min(11, dials), rch = conn > 0 ? 1 : 0;
    const key = L.lrm + '|' + L.source + '|' + d + '|' + rch;
    let g = agg.get(key);
    if (!g) agg.set(key, g = { lrm: L.lrm, tl: L.tl, zsm: L.zsm, ados: L.ados, cluster: L.cluster, source: L.source, d, rch, n: 0, dials: 0, conn: 0, ms: 0, md: 0 });
    g.n++; g.dials += dials; g.conn += conn; g.ms += ms; g.md += md;
    if (dials >= OVER) over.push({ lead: L.lead, lrm: L.lrm, tl: L.tl, zsm: L.zsm, ados: L.ados, cluster: L.cluster, source: L.source,
      dials, conn, ms, md, stage: L.stage, status: L.status, assigned: L.assigned,
      link: 'https://lighthouse.solarsquare.in/#/menu/lead/details/' + encodeURIComponent(L.lead) });
  }
  over.sort((a, b) => b.dials - a.dials || a.conn - b.conn);
  return { agg: [...agg.values()], over: over.slice(0, OVER_CAP),
    diag: { configured: true, laTab: c.laTab, dataTab: c.dataTab, laRows: c.leads.length, dataRows: c.dataRows,
      cohort, untouched, overTotal: over.length, missingLA: c.missLA, missingData: c.missData, from, to, cachedAt: new Date(c.at).toISOString() } };
}
