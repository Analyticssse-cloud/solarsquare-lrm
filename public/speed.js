/* ═══════════════════════════════════════════════════════════════════════════
   Speed to Lead — how long an LRM takes to make the FIRST call after a lead is
   assigned to them.

   Why it looks like this:
     * The SLA is NOT decided yet (user, 3 Sep). So the view is a DISTRIBUTION
       first: the histogram is the primary object and the SLA is a switch over
       the bucket edges the feed already carries (5 / 15 / 30 / 60 min). Every
       "% on time" number on the tab recomputes from the chosen edge — nothing
       is baked into the data.
     * A lead counts against the day it was ASSIGNED, and a lead never called
       counts as a BREACH (user's decision). It is in every denominator.
     * Medians are not summable, so across a multi-day range the table shows a
       median BAND read off the histogram, not a fake averaged median. On a
       single day it shows the exact median the SQL computed.

   Reads only what the backend returns:
     D.speedRows    [{agent,name,city,tl,tlName,zsm,zsmName,ados,adosName,
                      assigned,called,never,buckets[7],avgTat,medianDay,_inScope}]
     D.speedLeads   [{date,agent,lead,cluster,stage,status,assignedAt,
                      firstCallAt,tat,flag}]   — the actionable tail only
     D.speedHas     false when the 'speed' sheet tab does not exist yet
   Depends on globals from index.html: D, F, esc, fmt, agentName, setCount,
   activeTab, switchTab.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Bucket edges MUST match sql/speed-to-lead-daily.sql column order. */
var SPEED_EDGES = [5, 15, 30, 60, 240, 1440, Infinity];
var SPEED_LABELS = ['0–5 min', '5–15 min', '15–30 min', '30–60 min', '1–4 hr', '4–24 hr', '> 1 day'];
var SPEED_BANDS = ['0–5 min', '5–15 min', '15–30 min', '30–60 min', '1–4 hr', '4–24 hr', '> 1 day'];
/* Only edges the feed can answer exactly. Anything else would need lead-level rows. */
var SPEED_SLA_CHOICES = [5, 15, 30, 60];
var speedSLA = 30;
try { var _s = parseInt(localStorage.getItem('lrmSpeedSLA'), 10); if (SPEED_SLA_CHOICES.indexOf(_s) >= 0) speedSLA = _s; } catch (e) {}
var speedSort = { col: 'onTimePct', dir: 1 };   // worst first
var speedOpen = null;

(function injectSpeedCss() {
  var css = '' +
  '.sl-wrap{padding:2px 0 18px}' +
  '.sl-head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin:2px 0 14px}' +
  '.sl-title{font-size:15px;font-weight:800;color:var(--ink,#18233f);letter-spacing:-.2px}' +
  '.sl-sub{font-size:11.5px;color:var(--muted,#6a7494);max-width:640px;line-height:1.5;margin-top:3px}' +
  '.sl-sla{display:flex;align-items:center;gap:6px;margin-left:auto}' +
  '.sl-sla-lbl{font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
  '.sl-chip{border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--ink,#18233f);font:700 11.5px/1 inherit;padding:6px 11px;border-radius:20px;cursor:pointer;white-space:nowrap}' +
  '.sl-chip:hover{border-color:#9fb0d8}' +
  '.sl-chip.on{background:#18233f;border-color:#18233f;color:#fff}' +
  '.sl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--border,#e3e8f3);border:1px solid var(--border,#e3e8f3);margin-bottom:16px}' +
  '.sl-kpi{background:#fff;padding:11px 13px}' +
  '.sl-kpi-v{font-size:22px;font-weight:800;letter-spacing:-.7px;color:var(--ink,#18233f);line-height:1.1}' +
  '.sl-kpi-l{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#6a7494);margin-top:3px}' +
  '.sl-kpi-n{font-size:10.5px;color:var(--muted,#6a7494);margin-top:2px}' +
  '.sl-kpi.bad .sl-kpi-v{color:#b0382c}' +
  '.sl-hist{border:1px solid var(--border,#e3e8f3);padding:14px 16px 10px;margin-bottom:18px;background:#fff}' +
  '.sl-hist-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap}' +
  '.sl-hist-hd b{font-size:12px;letter-spacing:-.1px}' +
  '.sl-hist-hd span{font-size:11px;color:var(--muted,#6a7494)}' +
  '.sl-bars{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;align-items:end;height:150px}' +
  '.sl-bar{display:flex;flex-direction:column;justify-content:flex-end;height:100%;position:relative}' +
  '.sl-bar i{display:block;background:#6ea866;min-height:2px;border-radius:2px 2px 0 0}' +
  '.sl-bar.late i{background:#d2664f}' +
  '.sl-bar.none i{background:#8b8f9c}' +
  '.sl-bar em{font-style:normal;font-size:11px;font-weight:800;text-align:center;color:var(--ink,#18233f);margin-bottom:4px}' +
  '.sl-xlab{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;margin-top:7px;border-top:1px solid var(--border,#e3e8f3);padding-top:6px}' +
  '.sl-xlab span{font-size:9.5px;color:var(--muted,#6a7494);text-align:center;line-height:1.3}' +
  '.sl-xlab span b{display:block;font-size:10px;color:var(--ink,#18233f)}' +
  '.sl-tbl-note{font-size:11px;color:var(--muted,#6a7494);margin:0 0 7px}' +
  '.sl-meter{position:relative;height:7px;background:#eef1f8;border-radius:4px;overflow:hidden;min-width:56px}' +
  '.sl-meter i{position:absolute;left:0;top:0;bottom:0;background:#6ea866;border-radius:4px}' +
  '.sl-meter.warn i{background:#e8a05c}.sl-meter.bad i{background:#b0382c}' +
  'tr.sl-row{cursor:pointer}tr.sl-row:hover{background:rgba(24,35,63,.035)}' +
  'tr.sl-row.open{background:rgba(24,35,63,.055)}' +
  'td.sl-drill{padding:0!important;background:#fbfcfe}' +
  '.sl-drill-in{padding:10px 14px 14px}' +
  '.sl-drill-in h4{margin:0 0 7px;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
  '.sl-mini{width:100%;border-collapse:collapse;font-size:11.5px}' +
  '.sl-mini th{text-align:left;font-size:9.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#6a7494);padding:4px 8px;border-bottom:1px solid var(--border,#e3e8f3)}' +
  '.sl-mini td{padding:4px 8px;border-bottom:1px solid #eef1f8}' +
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
  var t = { assigned: 0, called: 0, never: 0, onTime: 0, buckets: [], tatSum: 0 };
  for (var i = 0; i < n; i++) t.buckets.push(0);
  rows.forEach(function (r) {
    t.assigned += r.assigned || 0;
    t.called += r.called || 0;
    t.never += r.never || 0;
    t.tatSum += (r.avgTat || 0) * (r.called || 0);
    (r.buckets || []).forEach(function (v, i) { t.buckets[i] += v || 0; });
  });
  for (var j = 0; j <= k; j++) t.onTime += t.buckets[j];
  t.onTimePct = t.assigned > 0 ? Math.round((t.onTime / t.assigned) * 1000) / 10 : 0;
  t.neverPct = t.assigned > 0 ? Math.round((t.never / t.assigned) * 1000) / 10 : 0;
  t.avgTat = t.called > 0 ? Math.round((t.tatSum / t.called) * 10) / 10 : 0;
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

function renderSpeed() {
  var panel = document.getElementById('speedPanel');
  if (!panel || !D) return;
  if (!D.speedHas) {
    panel.innerHTML = '<div class="sl-empty"><b>No speed-to-lead source yet.</b><br>' +
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

  html += '<div class="sl-head"><div><div class="sl-title">Speed to lead — first call after assignment</div>' +
    '<div class="sl-sub">A lead counts against the day it was assigned. Leads never called are counted as breaches, ' +
    'so the denominator is leads <b>assigned</b>. First calls before the assignment instant are ignored ' +
    '(they belong to the previous owner).</div></div>' +
    '<div class="sl-sla"><span class="sl-sla-lbl">SLA</span>' +
    SPEED_SLA_CHOICES.map(function (m) {
      return '<button class="sl-chip' + (m === speedSLA ? ' on' : '') + '" data-sla="' + m + '">' + m + ' min</button>';
    }).join('') + '</div></div>';

  html += '<div class="sl-kpis">' +
    kpiCell(fmt(t.assigned), 'Leads assigned', rows.length + ' LRMs in view') +
    kpiCell(t.onTimePct + '%', 'First call within ' + speedSLA + ' min', fmt(t.onTime) + ' of ' + fmt(t.assigned), t.onTimePct < 40) +
    kpiCell(t.band, 'Median time to first call', t.called ? 'avg ' + fmt(Math.round(t.avgTat)) + ' min (called only)' : '') +
    kpiCell(fmt(t.never), 'Never called', t.neverPct + '% of assigned', t.never > 0) +
    kpiCell(fmt(t.called - t.onTime), 'Called, but late', 'after ' + speedSLA + ' min') +
    '</div>';

  // histogram — the primary object while the SLA is still open
  var max = Math.max.apply(null, t.buckets.concat([t.never])) || 1;
  html += '<div class="sl-hist"><div class="sl-hist-hd"><b>Distribution of time to first call</b>' +
    '<span>green = inside the ' + speedSLA + '-min SLA · click an SLA above to move the line</span></div><div class="sl-bars">';
  t.buckets.forEach(function (v, i) {
    html += '<div class="sl-bar ' + (i <= k ? '' : 'late') + '"><em>' + fmt(v) + '</em>' +
      '<i style="height:' + Math.max(2, Math.round((v / max) * 118)) + 'px"></i></div>';
  });
  html += '<div class="sl-bar none"><em>' + fmt(t.never) + '</em><i style="height:' +
    Math.max(2, Math.round((t.never / max) * 118)) + 'px"></i></div>';
  html += '</div><div class="sl-xlab">' +
    SPEED_LABELS.map(function (l, i) {
      var pct = t.assigned > 0 ? Math.round((t.buckets[i] / t.assigned) * 1000) / 10 : 0;
      return '<span><b>' + l + '</b>' + pct + '%</span>';
    }).join('') +
    '<span><b>Never called</b>' + t.neverPct + '%</span></div></div>';

  // per-LRM table, worst first
  var body = rows.map(function (r) {
    var s = speedStats([r]);
    return { r: r, onTimePct: s.onTimePct, band: s.band, never: r.never || 0, assigned: r.assigned || 0, avgTat: r.avgTat || 0,
             med: (r.medianDay !== null && r.medianDay !== undefined) ? r.medianDay : null };
  }).filter(function (x) { return x.assigned > 0; });
  body.sort(function (a, b) {
    var av = a[speedSort.col], bv = b[speedSort.col];
    if (speedSort.col === 'name') return String(a.r.agent).localeCompare(String(b.r.agent)) * speedSort.dir;
    return ((Number(av) || 0) - (Number(bv) || 0)) * speedSort.dir;
  });

  html += '<div class="sl-tbl-note">Sorted worst-first on <b>% within ' + speedSLA + ' min</b>. ' +
    'Click a row for the leads behind it — never-called first, then slowest. ' +
    (D.speedLeads && D.speedLeads.length ? '' : 'No drill rows in this range.') + '</div>';
  html += '<div class="tbl-wrap"><table><thead><tr>' +
    '<th data-sc="name">LRM</th><th>City</th><th>Team Lead</th>' +
    '<th class="num" data-sc="assigned">Assigned</th>' +
    '<th class="num">Called</th>' +
    '<th class="num" data-sc="onTimePct">% within ' + speedSLA + ' min</th>' +
    '<th>Median</th>' +
    '<th class="num" data-sc="avgTat">Avg TAT (min)</th>' +
    '<th class="num" data-sc="never">Never called</th></tr></thead><tbody>';
  body.forEach(function (x) {
    var r = x.r, open = speedOpen === r.agent;
    html += '<tr class="sl-row' + (open ? ' open' : '') + '" data-agent="' + esc(r.agent) + '">' +
      '<td>' + esc(r.name || agentName(r.agent)) + '</td>' +
      '<td>' + esc(r.city || '') + '</td>' +
      '<td>' + esc(r.tlName || '') + '</td>' +
      '<td class="num">' + fmt(x.assigned) + '</td>' +
      '<td class="num">' + fmt(r.called || 0) + '</td>' +
      '<td class="num"><div style="display:flex;align-items:center;gap:7px;justify-content:flex-end">' +
        '<span>' + x.onTimePct + '%</span><div class="sl-meter ' + speedMeterCls(x.onTimePct) + '" style="width:62px">' +
        '<i style="width:' + Math.min(100, x.onTimePct) + '%"></i></div></div></td>' +
      '<td>' + esc(x.med !== null ? x.med + ' min' : x.band) + '</td>' +
      '<td class="num">' + (r.called ? fmt(Math.round(r.avgTat)) : '—') + '</td>' +
      '<td class="num">' + (x.never ? fmt(x.never) : '—') + '</td></tr>';
    if (open) html += '<tr><td class="sl-drill" colspan="9">' + speedDrill(r.agent) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  if (!body.length) html += '<div class="sl-empty">No leads were assigned to anyone in this filter and date range.</div>';
  html += '</div>';
  panel.innerHTML = html;

  panel.querySelectorAll('.sl-chip').forEach(function (b) {
    b.addEventListener('click', function () {
      speedSLA = parseInt(b.getAttribute('data-sla'), 10) || 30;
      try { localStorage.setItem('lrmSpeedSLA', String(speedSLA)); } catch (e) {}
      renderSpeed();
    });
  });
  panel.querySelectorAll('th[data-sc]').forEach(function (th) {
    th.style.cursor = 'pointer';
    th.addEventListener('click', function () {
      var c = th.getAttribute('data-sc');
      if (speedSort.col === c) speedSort.dir *= -1; else { speedSort.col = c; speedSort.dir = c === 'onTimePct' ? 1 : -1; }
      renderSpeed();
    });
  });
  panel.querySelectorAll('tr.sl-row').forEach(function (tr) {
    tr.addEventListener('click', function () {
      var a = tr.getAttribute('data-agent');
      speedOpen = (speedOpen === a) ? null : a;
      renderSpeed();
    });
  });
}

function kpiCell(v, l, note, bad) {
  return '<div class="sl-kpi' + (bad ? ' bad' : '') + '"><div class="sl-kpi-v">' + esc(String(v)) + '</div>' +
    '<div class="sl-kpi-l">' + esc(l) + '</div>' + (note ? '<div class="sl-kpi-n">' + esc(note) + '</div>' : '') + '</div>';
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
    '<table class="sl-mini"><thead><tr><th>Lead</th><th>Cluster</th><th>Stage</th><th>Assigned</th><th>First call</th><th>TAT</th><th></th></tr></thead><tbody>';
  shown.forEach(function (r) {
    var never = r.tat === null || r.tat === undefined;
    out += '<tr><td><b>' + esc(r.lead) + '</b></td><td>' + esc(r.cluster) + '</td><td>' + esc(r.stage) + '</td>' +
      '<td>' + esc(r.assignedAt) + '</td><td>' + esc(r.firstCallAt || '—') + '</td>' +
      '<td>' + (never ? '—' : fmt(Math.round(r.tat)) + ' min') + '</td>' +
      '<td><span class="sl-flag ' + (never ? 'never' : 'slow') + '">' + (never ? 'Never called' : 'Slow') + '</span></td></tr>';
  });
  return out + '</tbody></table></div>';
}
