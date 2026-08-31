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

const norm = (v) => String(v || '').trim().toLowerCase().replace('@homes.solarsquare.in', '@solarsquare.in');
const num  = (v) => Number(v) || 0;

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
];
const AVG_COLS = ['Avg. Talk Time', 'Avg. Handling Time'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  // Never serve a cached snapshot — the point of this endpoint is live sheet data.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await requireUser(req);
  if (!auth.ok) return deny(res, auth);
  const viewerEmail = norm(auth.user.email);

  try {
    let { from, to } = req.query;
    from = from || '';
    to   = to   || '';
    if (from && to && from > to) { const t = from; from = to; to = t; }

    // ── 1. Ozontel ────────────────────────────────────────────────────────────
    const oRaw = await readSheet('Ozontel');
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
    const mapRaw = await readSheet('LRM_TL_MAP');
    const mHdr   = (mapRaw[0] || []).map(h => String(h).trim());
    const iEmail   = findCol(mHdr, ['Email IDs', 'Email ID', 'LRM Email', 'Agent Id']);
    const iCluster = findCol(mHdr, ['Cluster', 'City']);
    const iTLName  = findCol(mHdr, ['Reporting Team Lead', 'TL Name']);
    const iTLEmail = findCol(mHdr, ['LRM TL Email ID', 'TL Email']);
    const iZSM     = findCol(mHdr, ['LRM DZSM Email ID', 'DZSM Email', 'ZSM Email', 'DZSM', 'ZSM']);
    const iADOS    = findCol(mHdr, ['ADOS Email ID', 'LRM ADOS Email ID', 'ADOS Email', 'ADOS']);

    const cityMap = {}, tlMap = {};
    const adosSet = new Set(), zsmSet = new Set(), tlSet = new Set(), lrmSet2 = new Set();

    for (let i = 1; i < mapRaw.length; i++) {
      const r = mapRaw[i];
      if (!r) continue;
      const email = norm(r[iEmail]);
      if (!email || !email.includes('@')) continue;
      const city   = iCluster >= 0 ? String(r[iCluster] || '').trim() : '';
      const tlName = iTLName  >= 0 ? String(r[iTLName]  || '').trim() : '';
      const tlMail = iTLEmail >= 0 ? norm(r[iTLEmail]) : '';
      const zsm    = iZSM     >= 0 ? norm(r[iZSM])     : '';
      const ados   = iADOS    >= 0 ? norm(r[iADOS])    : '';
      if (city) cityMap[email] = city;
      tlMap[email] = { tlName, tlMail, zsm, ados };
      lrmSet2.add(email);
      if (tlMail) tlSet.add(tlMail);
      if (zsm)    zsmSet.add(zsm);
      if (ados)   adosSet.add(ados);
    }

    // Role is derived from where the viewer sits in the hierarchy. Checked most
    // senior first so someone listed twice resolves to their highest role.
    let role = 'VIEWER';
    if (!auth.configured)            role = 'VIEWER';
    else if (adosSet.has(viewerEmail)) role = 'ADOS';
    else if (zsmSet.has(viewerEmail))  role = 'ZSM';
    else if (tlSet.has(viewerEmail))   role = 'TL';
    else if (lrmSet2.has(viewerEmail)) role = 'LRM';

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
    const bucket = {};
    oData.forEach(row => {
      const d = rowDate(row[0]);
      if (!d || d < effFrom || d > effTo) return;
      const obj = {};
      oHdr.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });

      let agt = String(obj['Agent Id'] || '').trim();
      if (!agt || !agt.includes('@') || agt.includes('->')) return;
      const key = norm(agt);

      // Accept the pre-v11 header too, so an un-backfilled sheet still renders.
      const callCount = num(pick(obj, ['Call Count', 'Total Calls']));

      if (!bucket[key]) {
        bucket[key] = { ...obj, 'Agent Id': agt };
        SUM_COLS.forEach(k => { bucket[key][k] = num(obj[k]); });
        bucket[key]['Call Count'] = callCount;
        AVG_COLS.forEach(k => { bucket[key]['_sum_' + k] = num(obj[k]); });
        bucket[key]._dayCount = 1;
      } else {
        SUM_COLS.forEach(k => { bucket[key][k] = num(bucket[key][k]) + num(obj[k]); });
        bucket[key]['Call Count'] = num(bucket[key]['Call Count']) + callCount;
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
      'MS Today', 'MS T+0', 'MS T+1', 'MS T+2', 'Meeting Done',
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
    try {
      const hRaw = await readSheet('hourly');
      if (hRaw.length > 1) {
        const hHdr    = hRaw[0].map(h => String(h).trim());
        const hiDate  = findCol(hHdr, ['Date']);
        const hiHour  = findCol(hHdr, ['Hour']);
        const hiAgent = findCol(hHdr, ['Agent Id', 'LRM Email']);
        const hiCalls = findCol(hHdr, ['Call Count', 'Total Calls']);
        const hiConn  = findCol(hHdr, ['Connected Calls']);
        const hiTT    = findCol(hHdr, ['Total Talk Time']);
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
          const a = acc[hr] || (acc[hr] = { hour: hr, calls: 0, connected: 0, talkHr: 0 });
          a.calls     += num(r[hiCalls]);
          a.connected += num(r[hiConn]);
          a.talkHr    += num(r[hiTT]);
        }
        hourlyRows = Object.keys(acc).map(k => {
          const a = acc[k];
          return { hour: a.hour, calls: a.calls, connected: a.connected, talkHr: Math.round(a.talkHr * 100) / 100 };
        }).sort((x, y) => x.hour - y.hour);
      }
    } catch (e) {
      console.warn('No hourly tab: ' + e.message);
    }

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
      totals, cityRows, adosRows, zsmRows, tlRows, hourlyRows,
      agentCols, agentRows: agentRowsSlim,
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
    cityRows: [], adosRows: [], zsmRows: [], tlRows: [], hourlyRows: [],
    agentCols: [], agentRows: [], cityList: [], tlList: [], lrmList: [],
    activeLRMs: 0, cities: 0,
  };
}
