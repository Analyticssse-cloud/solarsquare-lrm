// api/dashboard.js
// GET /api/dashboard?from=yyyy-MM-dd&to=yyyy-MM-dd
//
// Reads Ozontel + LRM-Dashboard tabs from the Google Sheet,
// aggregates, and returns the same JSON shape the frontend expects.

const { readSheet } = require('./_sheets');

// ── Helpers ──────────────────────────────────────────────────────────────────

function toIST(date) {
  // Returns yyyy-MM-dd string in IST for a JS Date
  const ist = new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function todayIST() {
  return toIST(new Date());
}

function fmtLabel(ymd) {
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function rowDate(cell) {
  if (!cell) return '';
  if (cell instanceof Date) return toIST(cell);
  return String(cell).trim().slice(0, 10);
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS – allow the Vercel frontend origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const today    = todayIST();
    let { from, to } = req.query;
    from = from || today;
    to   = to   || today;
    if (from > to) { const t = from; from = to; to = t; }

    // ── 1. Read Ozontel tab ────────────────────────────────────────────────
    const oRaw  = await readSheet('Ozontel');
    if (!oRaw.length) return res.status(200).json(emptyPayload(from, to, today));

    const oHdr  = oRaw[0].map(h => String(h).trim());
    const oData = oRaw.slice(1);

    // Dates present in the sheet
    const availDates = {};
    oData.forEach(row => { const d = rowDate(row[0]); if (d) availDates[d] = true; });

    const hasInRange = oData.some(row => {
      const d = rowDate(row[0]);
      return d >= from && d <= to;
    });

    let effFrom = from, effTo = to, fellBack = false;
    if (!hasInRange) {
      const latest = Object.keys(availDates).sort().pop() || today;
      effFrom = effTo = latest;
      fellBack = true;
    }

    // ── 2. Aggregate Ozontel rows per agent ───────────────────────────────
    const NUMERIC = [
      'Total Calls', 'Unique Leads Dialed', 'Connected Calls',
      'Total Talk Time', 'Avg. Talk Time', 'Avg. Handling Time', 'Ex.Call Count',
      'MS Today', 'MS T+0', 'MS T+1', 'MS T+2', 'MS >T+2',
      'DS Today', 'DS T+1', 'DS T+2',
      'Delta', 'Score',
    ];

    const bucket = {};   // agentEmail → merged obj
    oData.forEach(row => {
      const d = rowDate(row[0]);
      if (!d || d < effFrom || d > effTo) return;

      const obj = {};
      oHdr.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });

      const agt = String(obj['Agent Id'] || '').trim();
      if (!agt || !agt.includes('@')) return;

      if (!bucket[agt]) {
        bucket[agt] = { ...obj };
        NUMERIC.forEach(k => { bucket[agt][k] = Number(obj[k]) || 0; });
        bucket[agt]._dayCount = 1;
      } else {
        NUMERIC.forEach(k => { bucket[agt][k] = (bucket[agt][k] || 0) + (Number(obj[k]) || 0); });
        bucket[agt]._dayCount++;
      }
    });

    // Recalculate derived fields
    const agentRows = Object.keys(bucket).map(k => bucket[k]);
    agentRows.forEach(r => {
      const calls = Number(r['Total Calls']) || 0;
      const conn  = Number(r['Connected Calls']) || 0;
      r['Connect %'] = calls > 0 ? Math.round((conn / calls) * 10000) / 100 : 0;
      if (r._dayCount > 1) {
        r['Avg. Talk Time']     = Math.round((r['Avg. Talk Time']     || 0) / r._dayCount * 10) / 10;
        r['Avg. Handling Time'] = Math.round((r['Avg. Handling Time'] || 0) / r._dayCount * 10) / 10;
      }
    });

    // ── 3. Read LRM-Dashboard tab for City / TL mapping ───────────────────
    const lRaw = await readSheet('LRM-Dashboard');
    // Row 0 = date header, Row 1 = totals, Row 2 = column headers, Row 3+ = data
    const lHdr = (lRaw[2] || []).map(h => String(h).trim());
    const lCI  = {};
    lHdr.forEach((h, i) => { lCI[h] = i; });

    const cityMap = {}, tlMap = {};
    for (let i = 3; i < lRaw.length; i++) {
      const r    = lRaw[i];
      const city = String(r[lCI['City']]     || '').trim();
      const agt  = String(r[lCI['Agent Id']] || '').trim();
      const tl   = String(r[lCI['TL']]       || '').trim();
      const zsm  = String(r[lCI['ZSM']]      || '').trim();
      const ados = String(r[lCI['ADOS']]     || '').trim();
      if (!agt || !agt.includes('@')) continue;
      if (city) cityMap[agt] = city;
      tlMap[agt] = { tl, zsm, ados };
    }

    // ── 4. Enrich with City / TL / flags ──────────────────────────────────
    function nameFromEmail(email) {
      const local = String(email || '').split('@')[0];
      return local.split('.').map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join(' ').trim();
    }

    agentRows.forEach(r => {
      const agt    = String(r['Agent Id'] || '').trim();
      r['City']    = cityMap[agt] || '';
      const meta   = tlMap[agt]   || {};
      r['TL']      = meta.tl   || '';
      r['ZSM']     = meta.zsm  || '';
      r['ADOS']    = meta.ados || '';
      r['TL Name'] = meta.tl ? nameFromEmail(meta.tl) : '';

      const calls   = Number(r['Total Calls'] || 0);
      const msTotal = ['MS Today','MS T+0','MS T+1','MS T+2','MS >T+2']
        .reduce((s, k) => s + (Number(r[k]) || 0), 0);
      r._flagLowVol = calls > 0 && calls < 30;
      r._flagIdle   = calls === 0;
      r._flagNoMeet = msTotal === 0;
      r._calls      = calls;
      r._connected  = Number(r['Connected Calls'] || 0);
    });

    // ── 5. City summary ────────────────────────────────────────────────────
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
        city:        c.city,
        totalCalls:  c.totalCalls,
        uniqueDials: c.uniqueDials,
        connected:   c.connected,
        connectPct:  c.totalCalls > 0 ? Math.round((c.connected / c.totalCalls) * 10000) / 100 : 0,
        totalTTHr:   c.totalTT > 0 ? Math.round(c.totalTT / 60 * 10) / 10 : 0,
        activeLRM:   c.activeLRM,
        callsPerLRM: c.activeLRM > 0 ? Math.round(c.totalCalls / c.activeLRM) : 0,
        msToday:     c.msToday,
        msT0:        c.msT0,
        msT1:        c.msT1,
        msT2:        c.msT2,
        dsToday:     c.dsToday,
        dsT1:        c.dsT1,
        dsT2:        c.dsT2,
        delta:       c.delta,
      };
    }).sort((a, b) => b.totalCalls - a.totalCalls);

    // ── 6. Global totals ───────────────────────────────────────────────────
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

    totals.connectPct = totals.totalCalls > 0
      ? Math.round((totals.connected / totals.totalCalls) * 10000) / 100 : 0;
    totals.totalTTHr  = Math.round(totals.totalTTMin / 60 * 10) / 10;

    // ── 7. Slim agent rows ─────────────────────────────────────────────────
    const agentCols = [
      'Agent Id','City','TL Name','Total Calls','Unique Leads Dialed','Connected Calls',
      'Connect %','Total Talk Time','Avg. Talk Time','Avg. Handling Time',
      'MS Today','MS T+0','MS T+1','MS T+2',
      'DS Today','DS T+1','DS T+2',
      'Delta','Score','Final Rank',
    ];
    const metaKeys = ['TL','_flagLowVol','_flagIdle','_flagNoMeet','_calls','_connected'];

    const agentRowsSlim = agentRows
      .map(r => {
        const obj = {};
        agentCols.forEach(k => { obj[k] = r[k] !== undefined ? r[k] : ''; });
        metaKeys.forEach(k => { obj[k] = r[k]; });
        return obj;
      })
      .sort((a, b) => (Number(a['Final Rank']) || 9999) - (Number(b['Final Rank']) || 9999));

    // ── 8. Date label ──────────────────────────────────────────────────────
    let dateLabel = effFrom === effTo
      ? fmtLabel(effFrom) + (effFrom !== today ? ' (latest)' : '')
      : fmtLabel(effFrom) + ' – ' + fmtLabel(effTo);
    if (fellBack) dateLabel += ' ⚠ (no data in range)';

    // ── 9. Filter dropdown lists ───────────────────────────────────────────
    const citySet = {}, tlSet = {};
    agentRows.forEach(r => {
      if (r['City'])    citySet[r['City']] = true;
      if (r['TL Name']) tlSet[r['TL Name']] = true;
    });

    return res.status(200).json({
      dateLabel,
      fromDate:  effFrom,
      toDate:    effTo,
      totals,
      cityRows,
      agentCols,
      agentRows: agentRowsSlim,
      cityList:  Object.keys(citySet).sort(),
      tlList:    Object.keys(tlSet).sort(),
      activeLRMs: agentRows.length,
      cities:     cityRows.length,
    });

  } catch (err) {
    console.error('Dashboard API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function emptyPayload(from, to, today) {
  return {
    dateLabel: from === to ? from : from + ' – ' + to,
    fromDate: from, toDate: to,
    totals: { totalCalls:0, uniqueDials:0, connected:0, connectPct:0, totalTTHr:0, msToday:0, msT0:0, msT1:0, dsToday:0 },
    cityRows: [], agentCols: [], agentRows: [],
    cityList: [], tlList: [], activeLRMs: 0, cities: 0,
  };
}
