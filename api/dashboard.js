// api/dashboard.js
// GET /api/dashboard?from=yyyy-MM-dd&to=yyyy-MM-dd
//
// Ozontel is the single source of truth (date in col A, yyyy-MM-dd string).
// LRM_TL_MAP provides agent -> Cluster (City) + Reporting Team Lead.
// We ignore LRM-Dashboard / Manager Dashboard (those use TODAY() and are
// single-date derived views).

import { readSheet } from './_sheets.js';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let { from, to } = req.query;
    from = from || '';
    to   = to   || '';
    if (from && to && from > to) { const t = from; from = to; to = t; }

    // 1. Read Ozontel
    const oRaw = await readSheet('Ozontel');
    if (!oRaw.length) return res.status(200).json(emptyPayload(from, to));

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

    // 2. Read LRM_TL_MAP for City (Cluster) + TL
    const mapRaw = await readSheet('LRM_TL_MAP');
    const mHdr   = (mapRaw[0] || []).map(h => String(h).trim());
    const idx = (name) => mHdr.indexOf(name);
    const iEmail   = idx('Email IDs');
    const iCluster = idx('Cluster');
    const iTLName  = idx('Reporting Team Lead');
    const iTLEmail = idx('LRM TL Email ID');
    const iDZSM    = idx('LRM DZSM Email ID');

    const cityMap = {}, tlMap = {};
    for (let i = 1; i < mapRaw.length; i++) {
      const r = mapRaw[i];
      if (!r) continue;
      const email = String(r[iEmail] || '').trim().toLowerCase();
      if (!email || !email.includes('@')) continue;
      const city   = iCluster >= 0 ? String(r[iCluster] || '').trim() : '';
      const tlName = iTLName  >= 0 ? String(r[iTLName]  || '').trim() : '';
      const tlMail = iTLEmail >= 0 ? String(r[iTLEmail] || '').trim() : '';
      const dzsm   = iDZSM    >= 0 ? String(r[iDZSM]    || '').trim() : '';
      if (city) cityMap[email] = city;
      tlMap[email] = { tlName, tlMail, dzsm };
    }

    // 3. Aggregate Ozontel per agent across the range
    const NUMERIC = [
      'Total Calls','Unique Leads Dialed','Connected Calls',
      'Total Talk Time','Avg. Talk Time','Avg. Handling Time','Ex.Call Count',
      'MS Today','MS T+0','MS T+1','MS T+2','MS >T+2',
      'DS Today','DS T+1','DS T+2','Delta','Score',
    ];

    const bucket = {};
    oData.forEach(row => {
      const d = rowDate(row[0]);
      if (!d || d < effFrom || d > effTo) return;
      const obj = {};
      oHdr.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      let agt = String(obj['Agent Id'] || '').trim();
      if (!agt || !agt.includes('@') || agt.includes('->')) return;
      const key = agt.toLowerCase();
      if (!bucket[key]) {
        bucket[key] = { ...obj, 'Agent Id': agt };
        NUMERIC.forEach(k => { bucket[key][k] = Number(obj[k]) || 0; });
        bucket[key]._dayCount = 1;
      } else {
        NUMERIC.forEach(k => { bucket[key][k] = (bucket[key][k] || 0) + (Number(obj[k]) || 0); });
        bucket[key]._dayCount++;
      }
    });

    const agentRows = Object.keys(bucket).map(k => bucket[k]);

    agentRows.forEach(r => {
      const calls = Number(r['Total Calls']) || 0;
      const conn  = Number(r['Connected Calls']) || 0;
      r['Connect %'] = calls > 0 ? Math.round((conn / calls) * 10000) / 100 : 0;
      if (r._dayCount > 1) {
        r['Avg. Talk Time']     = Math.round((r['Avg. Talk Time']     || 0) / r._dayCount * 10) / 10;
        r['Avg. Handling Time'] = Math.round((r['Avg. Handling Time'] || 0) / r._dayCount * 10) / 10;
      }
      const key    = String(r['Agent Id'] || '').trim().toLowerCase();
      r['City']    = cityMap[key] || '';
      const meta   = tlMap[key]   || {};
      r['TL']      = meta.tlMail || '';
      r['TL Name'] = meta.tlName || (meta.tlMail ? nameFromEmail(meta.tlMail) : '');
      r['DZSM']    = meta.dzsm   || '';
      const msTotal = ['MS Today','MS T+0','MS T+1','MS T+2','MS >T+2']
        .reduce((s, k) => s + (Number(r[k]) || 0), 0);
      r._flagLowVol = calls > 0 && calls < 30;
      r._flagIdle   = calls === 0;
      r._flagNoMeet = msTotal === 0;
    });

    // 4. City summary
    const cityAgg = {};
    agentRows.forEach(r => {
      const city = r['City'] || '(Unassigned)';
      if (!cityAgg[city]) {
        cityAgg[city] = { city, totalCalls:0, uniqueDials:0, connected:0,
          totalTT:0, activeLRM:0, msToday:0, msT0:0, msT1:0, msT2:0,
          dsToday:0, dsT1:0, dsT2:0, delta:0 };
      }
      const c = cityAgg[city];
      c.totalCalls  += Number(r['Total Calls']         || 0);
      c.uniqueDials += Number(r['Unique Leads Dialed']  || 0);
      c.connected   += Number(r['Connected Calls']      || 0);
      c.totalTT     += Number(r['Total Talk Time']      || 0);
      c.activeLRM   += 1;
      c.msToday     += Number(r['MS Today'] || 0);
      c.msT0        += Number(r['MS T+0']   || 0);
      c.msT1        += Number(r['MS T+1']   || 0);
      c.msT2        += Number(r['MS T+2']   || 0);
      c.dsToday     += Number(r['DS Today'] || 0);
      c.dsT1        += Number(r['DS T+1']   || 0);
      c.dsT2        += Number(r['DS T+2']   || 0);
      c.delta       += Number(r['Delta']    || 0);
    });

    const cityRows = Object.keys(cityAgg).map(k => {
      const c = cityAgg[k];
      return {
        city:c.city, totalCalls:c.totalCalls, uniqueDials:c.uniqueDials, connected:c.connected,
        connectPct: c.totalCalls > 0 ? Math.round((c.connected/c.totalCalls)*10000)/100 : 0,
        totalTTHr:  c.totalTT > 0 ? Math.round(c.totalTT/60*10)/10 : 0,
        activeLRM:  c.activeLRM,
        callsPerLRM: c.activeLRM > 0 ? Math.round(c.totalCalls/c.activeLRM) : 0,
        msToday:c.msToday, msT0:c.msT0, msT1:c.msT1, msT2:c.msT2,
        dsToday:c.dsToday, dsT1:c.dsT1, dsT2:c.dsT2, delta:c.delta,
      };
    }).sort((a, b) => b.totalCalls - a.totalCalls);

    // 5. Totals
    const totals = agentRows.reduce((acc, r) => {
      acc.totalCalls  += Number(r['Total Calls']        || 0);
      acc.uniqueDials += Number(r['Unique Leads Dialed'] || 0);
      acc.connected   += Number(r['Connected Calls']     || 0);
      acc.totalTTMin  += Number(r['Total Talk Time']     || 0);
      acc.msToday     += Number(r['MS Today'] || 0);
      acc.msT0        += Number(r['MS T+0']   || 0);
      acc.msT1        += Number(r['MS T+1']   || 0);
      acc.dsToday     += Number(r['DS Today'] || 0);
      return acc;
    }, { totalCalls:0, uniqueDials:0, connected:0, totalTTMin:0, msToday:0, msT0:0, msT1:0, dsToday:0 });
    totals.connectPct = totals.totalCalls > 0 ? Math.round((totals.connected/totals.totalCalls)*10000)/100 : 0;
    totals.totalTTHr  = Math.round(totals.totalTTMin/60*10)/10;

    // 6. Slim agent rows
    const agentCols = [
      'Agent Id','City','TL Name','Total Calls','Unique Leads Dialed','Connected Calls',
      'Connect %','Total Talk Time','Avg. Talk Time','Avg. Handling Time',
      'MS Today','MS T+0','MS T+1','MS T+2','DS Today','DS T+1','DS T+2',
      'Delta','Score','Final Rank',
    ];
    const metaKeys = ['TL','_flagLowVol','_flagIdle','_flagNoMeet'];
    const agentRowsSlim = agentRows.map(r => {
      const obj = {};
      agentCols.forEach(k => { obj[k] = r[k] !== undefined ? r[k] : ''; });
      metaKeys.forEach(k => { obj[k] = r[k]; });
      return obj;
    }).sort((a, b) => (Number(a['Final Rank']) || 9999) - (Number(b['Final Rank']) || 9999));

    // 7. Label
    let dateLabel = effFrom === effTo ? fmtLabel(effFrom)
                                      : fmtLabel(effFrom) + ' – ' + fmtLabel(effTo);
    if (fellBack) dateLabel += ' (latest available)';

    // 8. Dropdown lists
    const citySet = {}, tlSet = {};
    agentRows.forEach(r => {
      if (r['City'])    citySet[r['City']] = true;
      if (r['TL Name']) tlSet[r['TL Name']] = true;
    });

    return res.status(200).json({
      dateLabel, fromDate: effFrom, toDate: effTo,
      totals, cityRows, agentCols, agentRows: agentRowsSlim,
      cityList: Object.keys(citySet).sort(),
      tlList:   Object.keys(tlSet).sort(),
      activeLRMs: agentRows.length, cities: cityRows.length,
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function emptyPayload(from, to) {
  return {
    dateLabel: from === to ? from : from + ' – ' + to,
    fromDate: from, toDate: to,
    totals: { totalCalls:0, uniqueDials:0, connected:0, connectPct:0, totalTTHr:0, msToday:0, msT0:0, msT1:0, dsToday:0 },
    cityRows: [], agentCols: [], agentRows: [], cityList: [], tlList: [], activeLRMs: 0, cities: 0,
  };
}
