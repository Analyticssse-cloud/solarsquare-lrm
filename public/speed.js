/* ═══════════════════════════════════════════════════════════════════════════
   First Response Time — how long an LRM takes to make the FIRST call after a
   lead is assigned to them. (Named "Speed to Lead" until 3 Sep 2026; the rename
   is labels only, every identifier and sheet tab below still says speed.)

   Why it looks like this:
     * The SLA is NOT decided yet (user, 3 Sep). So the view is a DISTRIBUTION
       first: the histogram is the primary object and the SLA is a switch over
       the bucket edges the feed already carries (5 / 15 / 30 / 60 min). Every
       "% on time" number on the tab recomputes from the chosen edge — nothing
       is baked into the data.
     * A lead counts against the day it was ASSIGNED, and a lead never called
       counts as a BREACH (user's decision). It is in every denominator.
     * The clock is BUSINESS-HOURS adjusted in SQL: a lead landing at or after
       19:00 starts its clock at 10:30 the next day, and one landing before
       10:30 starts at 10:30 the same day. So TAT is measured from `Clock Start`,
       not from the assignment instant — the drill shows both.
     * `Assign Lag` (lead created -> assigned) is SYSTEM allocation latency, not
       the LRM's. Reported beside TAT, never folded into it.
     * Medians are not summable, so across a multi-day range the table shows a
       median BAND read off the histogram, not a fake averaged median. On a
       single day it shows the exact median the SQL computed.

   Reads only what the backend returns:
     D.speedRows    [{agent,name,city,tl,tlName,zsm,zsmName,ados,adosName,
                      assigned,called,never,buckets[7],avgTat,avgLag,medianDay,_inScope}]
     D.speedLeads   [{date,agent,lead,city,cluster,stage,status,createdAt,
                      assignedAt,clockStart,firstCallAt,lag,tat,flag}]
                    — the actionable tail only
     D.speedHas     false when the 'speed' sheet tab does not exist yet
   Depends on globals from index.html: D, F, esc, fmt, agentName, setCount,
   activeTab, switchTab.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Bucket edges MUST match sql/speed-to-lead-daily.sql column order. v6 edges
   (user, 3 Sep): five EXCLUSIVE buckets that sum to leads WORKED. */
var SPEED_EDGES = [5, 10, 30, 60, Infinity];
var SPEED_LABELS = ['0–5 min', '5–10 min', '10–30 min', '30–60 min', '> 60 min'];
var SPEED_BANDS = SPEED_LABELS;
/* Short forms for the wide cluster table's two column blocks. */
var SPEED_SHORT = ['<5 min', '<10 min', '<30 min', '<60 min', '>60 min'];
/* Only edges the feed can answer exactly. Anything else would need lead-level rows. */
var SPEED_SLA_CHOICES = [5, 10, 30, 60];
/* Row grain of the main table. The feed's grain is LRM x cluster, so every one of
   these is a real rollup of the same cells — no grain is derived from another. */
var SPEED_GRAINS = [
  { k: 'cluster', lab: 'Cluster', head: 'Cluster', of: function (r) { return r.cluster || 'Unmapped'; } },
  { k: 'city',    lab: 'City',    head: 'City',    of: function (r) { return r.leadCity || 'Unmapped'; } },
  { k: 'ados',    lab: 'ADOS',    head: 'ADOS',    of: function (r) { return r.adosName || '—'; } },
  { k: 'zsm',     lab: 'ZSM',     head: 'ZSM',     of: function (r) { return r.zsmName || '—'; } },
  { k: 'tl',      lab: 'TL',      head: 'Team Lead', of: function (r) { return r.tlName || '—'; } },
  { k: 'lrm',     lab: 'LRM',     head: 'LRM',     of: function (r) { return r.agent; } }
];
var speedGrain = 'cluster';
try { var _g = localStorage.getItem('lrmSpeedGrain'); if (SPEED_GRAINS.some(function (g) { return g.k === _g; })) speedGrain = _g; } catch (e) {}
var speedSLA = 30;
try { var _s = parseInt(localStorage.getItem('lrmSpeedSLA'), 10); if (SPEED_SLA_CHOICES.indexOf(_s) >= 0) speedSLA = _s; } catch (e) {}
var speedSort = { col: 'assigned', dir: -1 };   // biggest population first
var speedOpen = null;

(function injectSpeedCss() {
  var css = '' +
  /* The panel is a flex column (.panel) and .tbl-wrap is already flex:1 with a
     sticky head — .sl-wrap being a plain block was the only thing stopping the table
     from taking the rest of the screen. */
  /* overflow:auto on the wrap is what makes the min-height guard degrade to a
     SCROLL instead of a clip — same contract as .fb-wrap on the Floor Board. Without
     it, a short window puts the table's last row past the body edge unreachably. */
  '.sl-wrap{padding:2px 0 0;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:auto}' +
  '.sl-wrap>.tbl-wrap{flex:1 1 auto;min-height:220px;margin-bottom:2px}' +
  /* Short windows: the fixed chrome above the table is 277px, most of it the six KPI
     cells and the standing-caveat paragraph. Condense both so the table keeps the room. */
  '@media (max-height:820px){' +
    '.sl-sub{display:none}' +
    '.sl-kpi{padding:7px 11px}' +
    '.sl-kpi-v{font-size:17px}' +
    '.sl-kpi-n{display:none}' +
    '.sl-kpis{margin-bottom:8px}' +
    '.sl-head{margin:0 0 8px}' +
    '.sl-tbl-note{display:none}' +
  '}' +
  '.sl-wrap>.sl-head,.sl-wrap>.sl-kpis,.sl-wrap>.sl-grain,.sl-wrap>.sl-tbl-note{flex:0 0 auto}' +
  '.sl-head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin:2px 0 11px}' +
  '.sl-title{font-size:15px;font-weight:800;color:var(--ink,#18233f);letter-spacing:-.2px}' +
  '.sl-sub{font-size:11.5px;color:var(--muted,#6a7494);max-width:640px;line-height:1.5;margin-top:3px}' +
  '.sl-sla{display:flex;align-items:center;gap:6px;margin-left:auto}' +
  '.sl-sla-lbl{font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
  '.sl-chip{border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--ink,#18233f);font:700 11.5px/1 inherit;padding:6px 11px;border-radius:20px;cursor:pointer;white-space:nowrap}' +
  '.sl-chip:hover{border-color:#9fb0d8}' +
  '.sl-chip.on{background:#18233f;border-color:#18233f;color:#fff}' +
  '.sl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:1px;background:var(--border,#e3e8f3);border:1px solid var(--border,#e3e8f3);margin-bottom:11px}' +
  '.sl-kpi:last-child{grid-column:auto/-1}' +
  '.sl-kpi{background:#fff;padding:11px 13px}' +
  '.sl-kpi-v{font-size:22px;font-weight:800;letter-spacing:-.7px;color:var(--ink,#18233f);line-height:1.1}' +
  '.sl-kpi-l{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#6a7494);margin-top:3px}' +
  '.sl-kpi-n{font-size:10.5px;color:var(--muted,#6a7494);margin-top:2px}' +
  '.sl-kpi.bad .sl-kpi-v{color:#b0382c}' +
  /* .sl-hist / .sl-bar / .sl-xlab rules went with speedHistCard() (4 Sep 2026): a
     stylesheet for markup nothing emits is the same unreachable layer. */
  '.sl-tbl-note{font-size:11px;color:var(--muted,#6a7494);margin:0 0 7px;max-width:900px;line-height:1.5}' +
  '.sl-grain{display:flex;align-items:center;gap:6px;margin:0 0 8px;flex-wrap:wrap}' +
  '.sl-chip[disabled]{opacity:.4;cursor:not-allowed;border-style:dashed}' +
  '.sl-geo{font-size:11px;color:var(--muted,#6a7494);margin:0 0 8px;line-height:1.5}' +
  '.sl-grid th,.sl-grid td{white-space:nowrap}' +
  '.sl-grid .sl-hgrp th{font-size:9px;letter-spacing:.6px;color:var(--muted,#6a7494);border-bottom:0;padding-bottom:2px}' +
  '.sl-grid th.sl-sep,.sl-grid td.sl-sep{border-left:1px solid var(--border,#e3e8f3)}' +
  '.sl-grid td.sl-warn{color:#b0382c;font-weight:700}' +
  '.sl-grid tr.sl-tot td{font-weight:800;background:#f4f6fb;border-bottom:1px solid #cfd7ea}' +
  '.sl-grid em.sl-n{font-style:normal;font-size:9.5px;color:var(--muted,#6a7494);margin-left:4px}' +
  '.sl-mini-grid td,.sl-mini-grid th{white-space:nowrap}' +
  '.sl-subnote{font-size:10.5px;color:var(--muted,#6a7494);margin-top:6px}' +
  '.sl-meter{position:relative;height:7px;background:#eef1f8;border-radius:4px;overflow:hidden;min-width:56px}' +
  '.sl-meter i{position:absolute;left:0;top:0;bottom:0;background:#6ea866;border-radius:4px}' +
  '.sl-meter.warn i{background:#e8a05c}.sl-meter.bad i{background:#b0382c}' +
  'tr.sl-row{cursor:pointer}tr.sl-row:hover{background:rgba(24,35,63,.035)}' +
  'tr.sl-row.open{background:rgba(24,35,63,.055)}' +
  'td.sl-drill{padding:0!important;background:#fbfcfe}' +
  '.sl-drill-in{padding:10px 14px 14px;overflow-x:auto}' +
  '.sl-drill-in h4{margin:0 0 7px;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
  '.sl-mini{width:100%;border-collapse:collapse;font-size:11.5px}' +
  '.sl-mini th{text-align:left;font-size:9.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#6a7494);padding:4px 8px;border-bottom:1px solid var(--border,#e3e8f3);white-space:nowrap}' +
  '.sl-mini th.num,.sl-mini td.num{text-align:right}' +
  '.sl-mini td{padding:4px 8px;border-bottom:1px solid #eef1f8;white-space:nowrap}' +
  '.sl-flag{font-size:9.5px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;padding:2px 6px;border-radius:3px}' +
  '.sl-flag.never{background:#f6e2df;color:#8f2c22}' +
  '.sl-flag.slow{background:#faeed9;color:#8a5a17}' +
  '.sl-empty{border:1px dashed var(--border,#e3e8f3);padding:26px;text-align:center;color:var(--muted,#6a7494);font-size:12px;line-height:1.6}';
  var el = document.createElement('style');
  el.id = 'speedCss';
  el.textContent = css;
  document.head.appendChild(el);
})();

function speedSlaIndex() {
  for (var i = 0; i < SPEED_EDGES.length; i++) if (SPEED_EDGES[i] === speedSLA) return i;
  return 2;
}
function filterSpeed() {
  return (D.speedRows || []).filter(function (r) {
    if (F.ados.length && F.ados.indexOf(String(r.adosName || '')) < 0) return false;
    if (F.zsms.length && F.zsms.indexOf(String(r.zsmName || '')) < 0) return false;
    if (F.cities.length && F.cities.indexOf(String(r.city || '')) < 0) return false;
    if (F.tls.length && F.tls.indexOf(String(r.tlName || '')) < 0) return false;
    if (F.agents.length && F.agents.indexOf(String(r.agent || '')) < 0) return false;
    if (F.q) {
      var hay = (r.agent + ' ' + r.city + ' ' + r.tlName).toLowerCase();
      if (hay.indexOf(F.q) < 0) return false;
    }
    return r._inScope !== false;
  });
}
/* On-time = called within the SLA edge. Never-called is a breach, so the
   denominator is leads ASSIGNED, never leads called. */
function speedStats(rows) {
  var k = speedSlaIndex(), n = SPEED_LABELS.length;
  var t = { assigned: 0, called: 0, never: 0, onTime: 0, buckets: [], tatSum: 0, lagSum: 0 };
  for (var i = 0; i < n; i++) t.buckets.push(0);
  rows.forEach(function (r) {
    t.assigned += r.assigned || 0;
    t.called += r.called || 0;
    t.never += r.never || 0;
    t.tatSum += (r.avgTat || 0) * (r.called || 0);
    t.lagSum += (r.avgLag || 0) * (r.assigned || 0);
    (r.buckets || []).forEach(function (v, i) { t.buckets[i] += v || 0; });
  });
  for (var j = 0; j <= k; j++) t.onTime += t.buckets[j];
  t.onTimePct = t.assigned > 0 ? Math.round((t.onTime / t.assigned) * 1000) / 10 : 0;
  t.neverPct = t.assigned > 0 ? Math.round((t.never / t.assigned) * 1000) / 10 : 0;
  t.workedPct = t.assigned > 0 ? Math.round((t.called / t.assigned) * 100) : 0;
  t.avgTat = t.called > 0 ? Math.round((t.tatSum / t.called) * 10) / 10 : 0;
  t.avgLag = t.assigned > 0 ? Math.round((t.lagSum / t.assigned) * 10) / 10 : 0;
  t.band = speedBand(t.buckets, t.never);
  return t;
}
/* Median band off the histogram: walk the buckets to the 50th percentile of
   leads ASSIGNED. Lands on "not called" when more than half were never called
   — which is the honest answer, not a number. */
function speedBand(buckets, never) {
  var total = never || 0;
  buckets.forEach(function (v) { total += v || 0; });
  if (!total) return '—';
  var half = total / 2, run = 0;
  for (var i = 0; i < buckets.length; i++) {
    run += buckets[i] || 0;
    if (run >= half) return SPEED_BANDS[i];
  }
  return 'not called';
}
function speedMeterCls(pct) { return pct >= 70 ? '' : pct >= 40 ? 'warn' : 'bad'; }
/* Distinct LRMs in a set of rows. The feed's grain is LRM x CLUSTER, so a row is
   a CELL, not a person — anyone working two clusters appears twice. Every
   "N LRMs" label must go through this. */
function speedLrmCount(rows) {
  var seen = {}, n = 0;
  (rows || []).forEach(function (r) { var a = r.agent; if (a && !seen[a]) { seen[a] = 1; n++; } });
  return n;
}
/* Does the feed actually carry the lead's own geo? dashboard.js writes 'Unmapped'
   when the speed sheet has no Cluster / City column, so a table grouped on it is one
   row called Unmapped — a statement about the feed dressed as a rollup. The LRM's
   roster city is NOT a substitute: this grain is the lead's geo by design. */
function speedGeoHas(rows, field) {
  return (rows || []).some(function (r) {
    var v = String(r[field] || '').trim();
    return v && v !== 'Unmapped';
  });
}
function speedGrainDef(k) {
  for (var i = 0; i < SPEED_GRAINS.length; i++) if (SPEED_GRAINS[i].k === (k || speedGrain)) return SPEED_GRAINS[i];
  return SPEED_GRAINS[0];
}
/* Roll the LRM x cluster cells up to the chosen grain. One pass, order-stable. */
function speedGroupBy(rows, grainKey) {
  var g = speedGrainDef(grainKey), out = [], idx = {};
  rows.forEach(function (r) {
    var k = String(g.of(r) || '—');
    var b = idx[k];
    if (!b) { b = idx[k] = { key: k, rows: [] }; out.push(b); }
    b.rows.push(r);
  });
  out.forEach(function (b) { b.s = speedStats(b.rows); });
  return out;
}
/* Green tint for a share, matching the reference sheet: strong green at 90%+,
   pale through the middle, red under 50%. Returns a background colour. */
function speedTint(pct) {
  if (pct >= 85) return '#bfe3c6';
  if (pct >= 75) return '#d6ecd9';
  if (pct >= 65) return '#eaf4ea';
  if (pct >= 50) return '#fdf3e3';
  if (pct >= 30) return '#f9ded8';
  return '#f2c4bb';
}

function renderSpeed() {
  var panel = document.getElementById('speedPanel');
  if (!panel || !D) return;
  if (!D.speedHas) {
    panel.innerHTML = '<div class="sl-empty"><b>No first-response-time source yet.</b><br>' +
      'This view reads a <code>speed</code> tab (one row per LRM per lead-assignment day) ' +
      'and an optional <code>speed_leads</code> drill tab. Paste <code>sql/speed-to-lead-daily.sql</code> ' +
      'and <code>sql/speed-to-lead-leads.sql</code> into two Metabase cards, set ' +
      '<code>SPEED_QUESTION_ID</code> / <code>SPEED_LEADS_QUESTION_ID</code> in Code.gs, ' +
      'then run <code>setupSpeedTabs()</code>.</div>';
    if (activeTab === 'speed') setCount('');
    return;
  }
  var rows = filterSpeed();
  var t = speedStats(rows);
  if (activeTab === 'speed') setCount(fmt(t.assigned) + ' leads assigned');

  var k = speedSlaIndex();
  var html = '<div class="sl-wrap">';

  html += '<div class="sl-head"><div><div class="sl-title">First response time — first call after assignment</div>' +
    '<div class="sl-sub">A lead counts against the day it was assigned. Leads never called are counted as breaches, ' +
    'so the denominator is leads <b>assigned</b>. The clock runs on floor hours: a lead landing at or after ' +
    '19:00 starts at <b>10:30 the next day</b>, one landing before 10:30 starts at 10:30 the same day. ' +
    'First calls before the assignment instant are ignored (they belong to the previous owner).</div></div>' +
    '<div class="sl-sla"><span class="sl-sla-lbl">SLA</span>' +
    SPEED_SLA_CHOICES.map(function (m) {
      return '<button class="sl-chip' + (m === speedSLA ? ' on' : '') + '" data-sla="' + m + '">' + m + ' min</button>';
    }).join('') + '</div></div>';

  html += '<div class="sl-kpis">' +
    kpiCell(fmt(t.assigned), 'Leads assigned', speedLrmCount(rows) + ' LRMs in view') +
    kpiCell(t.onTimePct + '%', 'First call within ' + speedSLA + ' min', fmt(t.onTime) + ' of ' + fmt(t.assigned), t.onTimePct < 40) +
    kpiCell(t.band, 'Median time to first call', t.called ? 'avg ' + fmt(Math.round(t.avgTat)) + ' min (called only)' : '') +
    kpiCell(fmt(t.never), 'Never called', t.neverPct + '% of assigned', t.never > 0) +
    kpiCell(fmt(t.called - t.onTime), 'Called, but late', 'after ' + speedSLA + ' min') +
    kpiCell(t.avgLag ? fmt(Math.round(t.avgLag)) + ' min' : '—', 'Created → assigned', 'system allocation lag, not in TAT') +
    '</div>';

  // ── the main table: one row per chosen grain, counts then shares ──────────
  // Column blocks mirror the sheet the floor already reads: population, then the
  // five exclusive buckets as COUNTS (they sum to Worked), then the same five as a
  // % of Worked. Only "Touched %" is tinted — tinting all eleven made it unreadable.
  var geoOk = { cluster: speedGeoHas(rows, 'cluster'), city: speedGeoHas(rows, 'leadCity') };
  var geoOff = !geoOk.cluster || !geoOk.city;
  if (geoOk[speedGrain] === false) speedGrain = 'tl';
  var G = speedGrainDef();
  html += '<div class="sl-grain"><span class="sl-sla-lbl">Rows</span>' +
    SPEED_GRAINS.map(function (g) {
      var off = geoOk[g.k] === false;
      return '<button class="sl-chip' + (g.k === speedGrain ? ' on' : '') + '" data-grain="' + g.k + '"' +
        (off ? ' disabled title="The speed sheet carries no ' + g.lab + ' for the lead"' : '') + '>' + g.lab + '</button>';
    }).join('') + '</div>';
  if (geoOff) {
    var missing = [!geoOk.cluster ? 'Cluster' : null, !geoOk.city ? 'City' : null].filter(Boolean).join(' and ');
    html += '<div class="sl-geo"><b>' + missing + ' rows are off:</b> this feed carries no lead ' +
      esc(missing.toLowerCase()) + ', so grouping on it produces one row called Unmapped rather than a rollup. ' +
      'Add the column to the <code>speed</code> tab (SQL already selects it) and the grain switches back on. ' +
      'The LRM\'s roster city is not used as a stand-in — this grain is the lead\'s own geo.</div>';
  }

  var groups = speedGroupBy(rows).filter(function (b) { return b.s.assigned > 0; });
  groups.sort(function (a, b) {
    if (speedSort.col === 'key') return String(a.key).localeCompare(String(b.key)) * speedSort.dir;
    return ((Number(a.s[speedSort.col]) || 0) - (Number(b.s[speedSort.col]) || 0)) * speedSort.dir;
  });

  html += '<div class="sl-tbl-note">Counts are exclusive and sum to <b>Worked</b>; the right block is the same ' +
    'five buckets as a share of Worked. <b>Worked</b> = at least one dial after assignment, so ' +
    'Assigned − Worked is the never-called tail. Click a row to open ' +
    (speedGrain === 'lrm' ? 'its slow and never-called leads.' : 'its LRMs.') + '</div>';

  html += '<div class="tbl-wrap"><table class="sl-grid"><thead>' +
    '<tr class="sl-hgrp"><th></th><th class="num" colspan="3">Leads</th>' +
      '<th class="num sl-sep" colspan="5">Time to first call — leads</th>' +
      '<th class="num sl-sep" colspan="5">Share of worked</th></tr>' +
    '<tr><th data-sc="key">' + esc(G.head) + '</th>' +
    '<th class="num" data-sc="assigned">Assigned</th>' +
    '<th class="num" data-sc="called">Worked</th>' +
    '<th class="num" data-sc="workedPct">Touched %</th>' +
    SPEED_SHORT.map(function (l, i) { return '<th class="num' + (i === 0 ? ' sl-sep' : '') + '">' + l + '</th>'; }).join('') +
    SPEED_SHORT.map(function (l, i) { return '<th class="num' + (i === 0 ? ' sl-sep' : '') + '">' + l + '</th>'; }).join('') +
    '</tr></thead><tbody>';

  function speedCells(s, isTot) {
    var wp = s.workedPct;
    var out = '<td class="num">' + fmt(s.assigned) + '</td><td class="num">' + fmt(s.called) + '</td>' +
      '<td class="num"' + (isTot ? '' : ' style="background:' + speedTint(wp) + '"') + '>' + wp + '%</td>';
    s.buckets.forEach(function (v, i) {
      out += '<td class="num' + (i === 0 ? ' sl-sep' : '') + '">' + (v ? fmt(v) : '') + '</td>';
    });
    s.buckets.forEach(function (v, i) {
      var p = s.called > 0 ? Math.round(v / s.called * 100) : 0;
      out += '<td class="num' + (i === 0 ? ' sl-sep' : '') + (i === SPEED_SHORT.length - 1 && p >= 40 ? ' sl-warn' : '') +
        '">' + (s.called ? p + '%' : '') + '</td>';
    });
    return out;
  }

  html += '<tr class="sl-tot"><td>ALL (' + groups.length + ' ' + G.lab.toLowerCase() + (groups.length === 1 ? '' : 's') + ')</td>' +
    speedCells(t, true) + '</tr>';

  groups.forEach(function (b) {
    var id = speedGrain + '::' + b.key, open = speedOpen === id;
    var label = speedGrain === 'lrm' ? (b.rows[0].name || agentName(b.key)) : b.key;
    html += '<tr class="sl-row' + (open ? ' open' : '') + '" data-open="' + esc(id) + '">' +
      '<td>' + esc(label) + (speedGrain === 'lrm' ? '' : ' <em class="sl-n">' + speedLrmCount(b.rows) + '</em>') + '</td>' +
      speedCells(b.s) + '</tr>';
    if (open) html += '<tr><td class="sl-drill" colspan="14">' +
      (speedGrain === 'lrm' ? speedDrill(b.key) : speedSubRows(b)) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  if (!groups.length) html += '<div class="sl-empty">No leads were assigned to anyone in this filter and date range.</div>';
  html += '</div>';
  panel.innerHTML = html;

  panel.querySelectorAll('.sl-chip').forEach(function (b) {
    b.addEventListener('click', function () {
      speedSLA = parseInt(b.getAttribute('data-sla'), 10) || 30;
      try { localStorage.setItem('lrmSpeedSLA', String(speedSLA)); } catch (e) {}
      renderSpeed();
    });
  });
  panel.querySelectorAll('.sl-grain .sl-chip').forEach(function (b) {
    b.addEventListener('click', function () {
      speedGrain = b.getAttribute('data-grain') || 'cluster';
      speedOpen = null;
      try { localStorage.setItem('lrmSpeedGrain', speedGrain); } catch (e) {}
      renderSpeed();
    });
  });
  panel.querySelectorAll('th[data-sc]').forEach(function (th) {
    th.style.cursor = 'pointer';
    th.addEventListener('click', function () {
      var c = th.getAttribute('data-sc');
      if (speedSort.col === c) speedSort.dir *= -1; else { speedSort.col = c; speedSort.dir = (c === 'key' || c === 'workedPct') ? 1 : -1; }
      renderSpeed();
    });
  });
  panel.querySelectorAll('tr.sl-row').forEach(function (tr) {
    tr.addEventListener('click', function () {
      var a = tr.getAttribute('data-open');
      speedOpen = (speedOpen === a) ? null : a;
      renderSpeed();
    });
  });
}

function kpiCell(v, l, note, bad) {
  return '<div class="sl-kpi' + (bad ? ' bad' : '') + '"><div class="sl-kpi-v">' + esc(String(v)) + '</div>' +
    '<div class="sl-kpi-l">' + esc(l) + '</div>' + (note ? '<div class="sl-kpi-n">' + esc(note) + '</div>' : '') + '</div>';
}

/* speedHistCard() was deleted 4 Sep 2026. The user removed the histogram from the
   Floor Board, and this tab has been the table since the shape moved off it, so the
   renderer had no caller anywhere in the app. Bucket maths still lives in
   speedStats() — restoring the shape is one card, not a re-derivation. */

/* The LRMs behind a group row — same eleven columns, weakest touch-rate first, so
   the row that dragged the cluster down is the first thing you read. */
function speedSubRows(b) {
  var per = speedGroupBy(b.rows, 'lrm').filter(function (x) { return x.s.assigned > 0; });
  per.sort(function (x, y) { return x.s.workedPct - y.s.workedPct; });
  var out = '<div class="sl-drill-in"><h4>' + esc(b.key) + ' — ' + per.length + ' LRM' + (per.length === 1 ? '' : 's') +
    ', weakest touch rate first</h4><table class="sl-mini sl-mini-grid"><thead><tr><th>LRM</th>' +
    '<th class="num">Assigned</th><th class="num">Worked</th><th class="num">Touched %</th>' +
    SPEED_SHORT.map(function (l) { return '<th class="num">' + l + '</th>'; }).join('') + '</tr></thead><tbody>';
  per.forEach(function (x) {
    out += '<tr><td>' + esc(x.rows[0].name || agentName(x.key)) + '</td>' +
      '<td class="num">' + fmt(x.s.assigned) + '</td><td class="num">' + fmt(x.s.called) + '</td>' +
      '<td class="num" style="background:' + speedTint(x.s.workedPct) + '">' + x.s.workedPct + '%</td>' +
      x.s.buckets.map(function (v) { return '<td class="num">' + (v ? fmt(v) : '') + '</td>'; }).join('') + '</tr>';
  });
  return out + '</tbody></table><div class="sl-subnote">Switch <b>Rows</b> to <b>LRM</b> to open the ' +
    'slow and never-called leads under a person.</div></div>';
}

/* 'YYYY-MM-DD HH:MM' -> '03 Sep 14:22'. The feed formats these in SQL so JS never
   re-parses them as dates; this only shortens the string. */
function slWhen(s) {
  s = String(s || '');
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
  if (!m) return s || '—';
  var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m[2], 10) - 1] || m[2];
  return m[3] + ' ' + mon + ' ' + m[4];
}

function speedDrill(agent) {
  var rows = (D.speedLeads || []).filter(function (r) { return r.agent === agent; });
  if (!rows.length) {
    return '<div class="sl-drill-in"><h4>Leads behind this row</h4>' +
      '<div style="font-size:11.5px;color:#6a7494">Nothing in the drill feed for this LRM — either every lead was ' +
      'called inside an hour, or the <code>speed_leads</code> tab has not been filled yet.</div></div>';
  }
  var shown = rows.slice(0, 40);
  var out = '<div class="sl-drill-in"><h4>Leads behind this row — ' + rows.length +
    ' never-called or slower than 60 min' + (rows.length > shown.length ? ' (first 40)' : '') + '</h4>' +
    '<table class="sl-mini"><thead><tr><th>Lead</th><th>City / cluster</th><th>Stage</th>' +
    '<th>Lead created</th><th>Assigned</th><th>Clock start</th><th>First call</th>' +
    '<th class="num">Assign lag</th><th class="num">TAT</th><th></th></tr></thead><tbody>';
  shown.forEach(function (r) {
    var never = r.tat === null || r.tat === undefined;
    var geo = r.cluster || r.city || '';
    var shifted = r.clockStart && r.assignedAt && r.clockStart !== r.assignedAt;
    out += '<tr><td><b>' + esc(r.lead) + '</b></td><td>' + esc(geo) + '</td><td>' + esc(r.stage) + '</td>' +
      '<td>' + esc(slWhen(r.createdAt)) + '</td>' +
      '<td>' + esc(slWhen(r.assignedAt)) + '</td>' +
      '<td' + (shifted ? ' style="color:#8a5a17" title="Off-hours arrival — clock moved to floor open"' : '') + '>' +
        esc(slWhen(r.clockStart || r.assignedAt)) + '</td>' +
      '<td>' + esc(r.firstCallAt ? slWhen(r.firstCallAt) : '—') + '</td>' +
      '<td class="num">' + (r.lag === null || r.lag === undefined ? '—' : fmt(Math.round(r.lag)) + ' min') + '</td>' +
      '<td class="num">' + (never ? '—' : fmt(Math.round(r.tat)) + ' min') + '</td>' +
      '<td><span class="sl-flag ' + (never ? 'never' : 'slow') + '">' + (never ? 'Never called' : 'Slow') + '</span></td></tr>';
  });
  return out + '</tbody></table></div>';
}
