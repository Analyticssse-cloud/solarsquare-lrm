/* ═══════════════════════════════════════════════════════════════════════════
   Distribution — hourly achievement heatmaps.  Replaces the Floor Board tab.

   Four views, one shared colour scale (red = behind the hour's bar, green = at
   or above it):
     1. Floor pulse    metric x hour   — 3 rows, "where is the floor leaking"
     2. Group grid     ADOS/ZSM/TL/City x hour + projected close
     3. Drill          LRM x hour      — opens under a clicked group row

   Reads only what the backend already returns:
     D.hourlyRows   [{agent, hour, calls, connected, talkHr, ms}]  ('hourly' tab)
     D.hourlyHasMS  false when the sheet has no 'MS Scheduled' column yet
     filterAgents() the filter bar + viewer scope, same as every other view
   so there is no new API surface and the filter bar applies unchanged.

   Depends on globals from index.html: D, filterAgents, istNow, esc, fmt,
   activeTab.  ECharts is loaded from the CDN in index.html.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The bar. 20 dials / 15 talk-min / 1.25 MS an hour over 8 PRODUCTIVE hours
   inside the 10:00-19:00 shift, so the day target lands exactly on 150/120/10.
   One edit point — DIST_HOURS is derived, never hardcoded elsewhere. */
var DIST_TARGET = { shiftStart: 10, shiftEnd: 19, productiveHours: 8,
                    dialsPerHour: 20, talkMinPerHour: 15, msPerHour: 1.25 };
var DIST_HOURS = (function () {
  var out = [];
  for (var h = DIST_TARGET.shiftStart; h < DIST_TARGET.shiftEnd; h++) out.push(h);
  return out;
})();
var DIST_METRICS = {
  dials: { label: 'Dials',      lab: 'Dials', noun: 'dials',    unit: '',
           per: DIST_TARGET.dialsPerHour,   cap: DIST_TARGET.dialsPerHour   * DIST_TARGET.productiveHours, field: 'calls' },
  talk:  { label: 'Talk time',  lab: 'Talk',  noun: 'talk-min', unit: ' min',
           per: DIST_TARGET.talkMinPerHour, cap: DIST_TARGET.talkMinPerHour * DIST_TARGET.productiveHours, field: 'talkMin' },
  ms:    { label: 'Meetings booked', lab: 'MS', noun: 'meetings', unit: '',
           per: DIST_TARGET.msPerHour,      cap: DIST_TARGET.msPerHour      * DIST_TARGET.productiveHours, field: 'ms' }
};
/* Red -> amber -> green. Same nine stops everywhere, so a colour means the same
   thing in all four charts. */
var DIST_RAMP = ['#b0382c','#d2664f','#e8a05c','#f2ce7e','#dfd98a','#a9c47e','#6ea866','#3f8a55','#1f6b45'];
var DIST_PAGE = '#ffffff', DIST_INK = '#18233f', DIST_MUTED = '#6a7494', DIST_RULE = '#e3e8f3';

var distMetric = 'dials', distGroup = 'tl', distMode = 'pct', distOpen = null;
var distCharts = {}, distObservers = {};

function distTgt(M, i) { return Math.min(M.cap, M.per * (i + 1)); }
function distFtgt(M, i) {
  var t = distTgt(M, i);
  return (t % 1 ? t.toFixed(2).replace(/0$/, '') : t) + M.unit;
}
/* Hours elapsed in the shift. On a past date every hour is elapsed — otherwise a
   board opened at 09:00, or any historical day, would read as all-future and
   render blank. Same guard the hourly league card uses. */
function distElapsed() {
  // Driven by the DATA, not the date inputs: the latest day present in the feed
  // decides. Anything older than today is a finished day, so every hour is
  // elapsed — otherwise a historical or multi-day view would mark most hours
  // "future" and grey out the board. Same failure the league card guards against.
  var today = (typeof todayIST === 'function') ? todayIST() : null;
  var maxDay = '';
  (D.hourlyRows || []).forEach(function (h) {
    var d = String(h.date || '').slice(0, 10);
    if (d > maxDay) maxDay = d;
  });
  if (today && maxDay && maxDay < today) return DIST_HOURS.length;
  var h = istNow().getUTCHours();
  return Math.max(0, Math.min(DIST_HOURS.length, h + 1 - DIST_TARGET.shiftStart));
}

/* Per-LRM cumulative totals by hour, scoped to the filter bar.
   Returns { byAgent: {email: [cum per hour]}, agents: [email], meta: {email: row} }
   for one metric. Cumulative, so an LRM who was behind at 11:00 and caught up by
   14:00 counts as on pace at 14:00 — the bar is a running total, not a per-hour quota. */
function distSeries(metricKey) {
  var M = DIST_METRICS[metricKey];
  var rows = filterAgents();
  var meta = {}, agents = [], byAgentHas = {};
  rows.forEach(function (r) {
    var e = String(r['Agent Id'] || '').trim().toLowerCase();
    if (!e) return;
    if (!meta[e]) { meta[e] = r; agents.push(e); byAgentHas[e] = 1; }
  });
  var hrs = D.hourlyRows || [];
  // Per agent, per DAY, per hour. Keeping the day separate matters: over a
  // multi-day range a single summed total would clear a one-day bar trivially
  // (5 days x 19 dials/hr sails past 20/hr and every cell reads 100%).
  // The board is a daily-pace instrument, so an LRM is scored on the MEAN of
  // the days present, against the unchanged 20/15/1.25-per-hour bar.
  var per = {};
  hrs.forEach(function (h) {
    var e = String(h.agent || h['Agent Id'] || '').trim().toLowerCase();
    if (!byAgentHas[e]) return;
    var hour = Number(h.hour !== undefined ? h.hour : h['Hour']);
    var idx = DIST_HOURS.indexOf(hour);
    if (idx < 0) return;                       // outside the shift — deliberately dropped here
    var day = String(h.date || '').slice(0, 10) || '_';
    var v = metricKey === 'dials' ? Number(h.calls || h['Call Count'] || 0)
          : metricKey === 'talk'  ? Number(h.talkHr || h['Total Talk Time'] || 0) * 60
          :                         Number(h.ms !== undefined ? h.ms : (h['MS Scheduled'] || 0));
    var byDay = per[e] || (per[e] = {});
    var arr = byDay[day] || (byDay[day] = DIST_HOURS.map(function () { return 0; }));
    arr[idx] += (Number(v) || 0);
  });
  var byAgent = {};
  agents.forEach(function (e) {
    var days = Object.keys(per[e] || {});
    var out = DIST_HOURS.map(function () { return 0; });
    if (!days.length) { byAgent[e] = out; return; }
    days.forEach(function (d) {
      var run = 0;
      per[e][d].forEach(function (v, i) { run += v; out[i] += run; });
    });
    byAgent[e] = out.map(function (v) { return v / days.length; });
  });
  return { byAgent: byAgent, agents: agents, meta: meta, M: M, days: (function () {
    var s = {};
    hrs.forEach(function (h) { var d = String(h.date || '').slice(0, 10); if (d) s[d] = 1; });
    return Object.keys(s).length || 1;
  })() };
}
/* Which org column groups the rows at each level. */
var DIST_LEVELS = {
  ados: { col: 'ADOS Name', label: 'ADOS',      child: 'ZSM' },
  zsm:  { col: 'ZSM Name',  label: 'ZSM',       child: 'TL'  },
  tl:   { col: 'TL Name',   label: 'Team Lead', child: 'LRM' },
  city: { col: 'City',      label: 'City',      child: 'LRM' }
};
function distGroups(S) {
  var col = DIST_LEVELS[distGroup].col, g = {};
  S.agents.forEach(function (e) {
    var k = String(S.meta[e][col] || '').trim() || '— Unmapped —';
    (g[k] = g[k] || []).push(e);
  });
  return Object.keys(g).sort(function (a, b) { return g[b].length - g[a].length; })
                       .map(function (k) { return { key: k, members: g[k] }; });
}
/* Share of a member list at or above the cumulative bar at hour i. */
function distShare(S, members, i) {
  var bar = distTgt(S.M, i), hit = 0;
  members.forEach(function (e) { if ((S.byAgent[e] || [])[i] >= bar) hit++; });
  return members.length ? hit / members.length : 0;
}
function distChart(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  if (!distCharts[id] || distCharts[id].getDom() !== el) {
    distCharts[id] = echarts.init(el, null, { renderer: 'canvas' });
    // echarts.init falls back to a 100px canvas whenever clientWidth is 0 at init
    // time - a deferred/background layout, a panel still display:none, or a
    // filter-bar reflow all hit that, and NOTHING re-measures afterwards: the
    // window 'resize' listener never fires because the container got its width
    // during initial layout, not from a window resize. So the squashed render
    // persists until the user drags the browser edge. An always-on floor board
    // opened in a background tab is exactly that case.
    // One observer per container fixes every path at the root (pulse, grid, drill,
    // and panel show/hide) instead of a resize() call remembered per draw site.
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        var c = distCharts[id];
        if (c && !c.isDisposed()) c.resize();
      });
      ro.observe(el);
      distObservers[id] = ro;
    }
  }
  return distCharts[id];
}
function distBase(cols) {
  return {
    animation: true, animationDuration: 420, animationEasing: 'cubicOut',
    animationDurationUpdate: 420, animationEasingUpdate: 'cubicOut',
    tooltip: { position: 'top', borderWidth: 0, backgroundColor: DIST_INK, padding: [7, 10],
               textStyle: { color: '#fff', fontSize: 12 }, extraCssText: 'border-radius:5px' },
    xAxis: { type: 'category', data: cols, splitArea: { show: true, areaStyle: { color: ['rgba(0,0,0,0)'] } },
             axisLine: { lineStyle: { color: DIST_RULE } }, axisTick: { show: false },
             axisLabel: { interval: 0, color: DIST_MUTED, fontSize: 10 } },
    series: [{ type: 'heatmap', itemStyle: { borderColor: DIST_PAGE, borderWidth: 2 },
               emphasis: { itemStyle: { borderColor: DIST_INK, borderWidth: 2 } } }]
  };
}
function distYAxis(labels, size) {
  return { type: 'category', data: labels, inverse: true,
           splitArea: { show: true, areaStyle: { color: ['rgba(0,0,0,0)'] } },
           axisLine: { show: false }, axisTick: { show: false },
           axisLabel: { color: DIST_INK, fontSize: size || 12 } };
}
/* Flat grey block for hours that have not happened yet — an absent cell would
   read as "zero", which is a different and wrong statement. */
function distFutureSeries(rowCount, elapsed, extraCol) {
  var d = [];
  for (var y = 0; y < rowCount; y++) {
    for (var x = elapsed; x < DIST_HOURS.length; x++) d.push([x, y, 0]);
    if (extraCol) d.push([DIST_HOURS.length, y, 0]);
  }
  return { type: 'heatmap', data: d, silent: true, label: { show: false },
           itemStyle: { color: '#eef1f6', borderColor: DIST_PAGE, borderWidth: 2 } };
}
function distVmap(o) {
  var v = { type: 'continuous', show: false, min: 0, max: 100, precision: 0, inRange: { color: DIST_RAMP } };
  for (var k in o) v[k] = o[k];
  return v;
}
var DIST_HL = DIST_HOURS.map(function (h) { return ('0' + h).slice(-2) + ':00'; });

/* ── 1. Floor pulse ─────────────────────────────────────────────────────── */
function distDrawPulse() {
  var c = distChart('distPulse'); if (!c) return;
  var keys = ['dials', 'talk', 'ms'], el = distElapsed(), data = [];
  var live = keys.filter(function (k) { return k !== 'ms' || D.hourlyHasMS !== false; });
  var n = 0, S0 = null;
  live.forEach(function (k, y) {
    var S = distSeries(k); n = S.agents.length; S0 = S;
    for (var x = 0; x < el; x++) data.push([x, y, Math.round(distShare(S, S.agents, x) * 100)]);
  });
  var o = distBase(DIST_HL);
  o.grid = { left: 74, right: 18, top: 6, bottom: 26, containLabel: false };
  o.yAxis = distYAxis(live.map(function (k) { return DIST_METRICS[k].lab; }));
  o.visualMap = distVmap({ seriesIndex: 0 });
  o.tooltip.formatter = function (p) {
    var M = DIST_METRICS[live[p.data[1]]];
    return '<b>' + p.data[2] + '% of ' + n + ' LRMs on pace</b><br>' + M.label +
           ' · by ' + DIST_HL[p.data[0]] + ' · bar ≥ ' + distFtgt(M, p.data[0]);
  };
  o.series[0].data = data;
  o.series[0].label = { show: true, color: DIST_INK, fontSize: 10, formatter: function (p) { return p.data[2] + '%'; } };
  o.series.push(distFutureSeries(live.length, el));
  c.setOption(o, { notMerge: true });
  c.resize();
  c.off('click'); c.on('click', function (p) { distMetric = live[p.data[1]]; distRender(); });
  var sub = document.getElementById('distPulseSub');
  if (sub) sub.textContent = '% of the ' + n + ' LRMs in view at or above that hour’s cumulative bar' +
    (S0 && S0.days > 1 ? ' · mean of ' + S0.days + ' days in range' : '') +
    (D.hourlyHasMS === false ? ' · MS row hidden: the sheet has no ‘MS Scheduled’ column yet' : '') +
    ' · click a row to drive the grid below';
}

/* ── 2. Group grid ──────────────────────────────────────────────────────── */
function distDrawGrid() {
  var c = distChart('distGrid'); if (!c) return;
  var S = distSeries(distMetric), M = S.M, groups = distGroups(S), el = distElapsed();
  var rows = [{ key: 'FLOOR', members: S.agents, floor: true }].concat(groups);
  var labels = rows.map(function (r) { return r.floor ? 'FLOOR (' + r.members.length + ')' : r.key + ' (' + r.members.length + ')'; });
  var data = [];
  rows.forEach(function (r, y) {
    for (var x = 0; x < el; x++) data.push([x, y, Math.round(distShare(S, r.members, x) * 100)]);
    // Projected close: run rate over elapsed hours carried across the productive
    // hours, then expressed as % of the day target. NOT a finished-day number.
    if (el > 0) {
      var hit = 0;
      r.members.forEach(function (e) {
        var run = (S.byAgent[e] || [])[el - 1] || 0;
        if (run / el * DIST_TARGET.productiveHours >= M.cap) hit++;
      });
      data.push([DIST_HOURS.length, y, r.members.length ? Math.round(hit / r.members.length * 100) : 0]);
    }
  });
  var o = distBase(DIST_HL.concat(['PROJ ' + DIST_TARGET.shiftEnd + ':00']));
  o.grid = { left: 150, right: 18, top: 6, bottom: 26, containLabel: false };
  o.yAxis = distYAxis(labels);
  o.visualMap = distVmap({ seriesIndex: 0 });
  o.tooltip.formatter = function (p) {
    var y = p.data[1], x = p.data[0], tot = rows[y].members.length, pc = p.data[2], cnt = Math.round(pc / 100 * tot);
    if (x === DIST_HOURS.length)
      return '<b>' + pc + '% projected to close at target</b><br>' + labels[y] +
             ' · ' + cnt + ' of ' + tot + ' LRMs · run rate × ' + DIST_TARGET.productiveHours + ' hrs';
    return '<b>' + cnt + ' of ' + tot + ' LRMs on pace (' + pc + '%)</b><br>' + labels[y] +
           ' · by ' + DIST_HL[x] + ' · bar ≥ ' + distFtgt(M, x);
  };
  o.series[0].data = data;
  o.series[0].label = { show: true, color: DIST_INK, fontSize: 10, formatter: function (p) {
    var tot = rows[p.data[1]].members.length, pc = p.data[2];
    return distMode === 'count' ? Math.round(pc / 100 * tot) : pc + '%';
  } };
  o.series.push(distFutureSeries(rows.length, el, el === 0));
  c.setOption(o, { notMerge: true });
  c.resize();
  c.off('click');
  c.on('click', function (p) {
    var r = rows[p.data[1]];
    distOpen = (r.floor || distOpen === r.key) ? null : r.key;
    distDrawDrill();
  });
  var t = document.getElementById('distGridTitle');
  if (t) t.textContent = M.label + ' — ' + (distMode === 'count' ? 'LRMs on cumulative pace' : 'share of LRMs on cumulative pace');
  if (typeof setCount === 'function' && activeTab === 'dist') setCount(S.agents.length + ' LRMs');
}

/* ── 3. LRM drill ───────────────────────────────────────────────────────── */
function distDrawDrill() {
  var wrap = document.getElementById('distDrillWrap'), bar = document.getElementById('distDrillBar');
  if (!wrap) return;
  if (!distOpen) { wrap.style.display = 'none'; if (bar) bar.style.display = 'none'; return; }
  wrap.style.display = ''; if (bar) bar.style.display = '';
  var c = distChart('distDrill'); if (!c) return;
  var S = distSeries(distMetric), M = S.M, el = distElapsed();
  var g = distGroups(S).filter(function (x) { return x.key === distOpen; })[0];
  if (!g) { distOpen = null; return distDrawDrill(); }
  // Worst first — the reason you opened the row.
  var members = g.members.slice().sort(function (a, b) {
    return ((S.byAgent[a] || [])[Math.max(0, el - 1)] || 0) - ((S.byAgent[b] || [])[Math.max(0, el - 1)] || 0);
  });
  var labels = members.map(function (e) { return String(S.meta[e]['LRM Name'] || e); });
  var data = [];
  members.forEach(function (e, y) {
    for (var x = 0; x < el; x++) {
      var v = (S.byAgent[e] || [])[x] || 0;
      data.push([x, y, Math.round(v * 100) / 100, Math.round(v / distTgt(M, x) * 100)]);
    }
    if (el > 0) {
      var run = (S.byAgent[e] || [])[el - 1] || 0, proj = run / el * DIST_TARGET.productiveHours;
      data.push([DIST_HOURS.length, y, Math.round(proj), Math.round(proj / M.cap * 100)]);
    }
  });
  var o = distBase(DIST_HL.concat(['PROJ ' + DIST_TARGET.shiftEnd + ':00']));
  o.grid = { left: 150, right: 18, top: 6, bottom: 26, containLabel: false };
  o.yAxis = distYAxis(labels, 11.5);
  // Anchored 40-120 so 100% of bar is the green pivot: an LRM at 80% of the bar
  // must not read the same green as one who cleared it.
  o.visualMap = distVmap({ min: 40, max: 120, dimension: 3, seriesIndex: 0 });
  o.tooltip.formatter = function (p) {
    var x = p.data[0];
    return '<b>' + p.data[2] + M.unit + '</b> · ' + p.data[3] + '% of bar<br>' + labels[p.data[1]] +
           ' · ' + (x === DIST_HOURS.length ? 'projected close vs ' + M.cap + M.unit
                                            : 'by ' + DIST_HL[x] + ' · bar ≥ ' + distFtgt(M, x));
  };
  o.series[0].data = data;
  o.series[0].label = { show: true, color: DIST_INK, fontSize: 10, formatter: function (p) { return p.data[2]; } };
  o.series.push(distFutureSeries(members.length, el, el === 0));
  c.setOption(o, { notMerge: true });
  wrap.style.height = Math.max(120, 34 + members.length * 24) + 'px';
  c.resize();
  var lbl = document.getElementById('distDrillLbl');
  if (lbl) lbl.innerHTML = '<b>' + esc(distOpen) + '</b> · ' + members.length + ' LRMs, weakest first · ' +
    'cell = ' + M.noun + ' cumulative, colour = % of that hour’s bar';
}

/* ── Panel shell ────────────────────────────────────────────────────────── */
function renderHourlyBoard() {
  var el = document.getElementById('distPanel');
  if (!el || !D) return;
  if (!window.echarts) {
    el.innerHTML = '<div class="fb-box"><div class="fb-sub">Chart library did not load — check the network tab.</div></div>';
    return;
  }
  var hrs = D.hourlyRows || [];
  var perAgent = hrs.length && hrs[0] && (hrs[0].agent !== undefined || hrs[0]['Agent Id'] !== undefined);
  if (!perAgent) {
    el.innerHTML = '<div class="fb-box"><h4>Hourly achievement</h4>'
      + '<div class="fb-sub">Needs the per-LRM <b>‘hourly’</b> sheet tab. Once Code.gs writes it '
      + '(<code>autoUpdateHourly</code> on the 15-min trigger), every chart here fills in automatically — '
      + 'no further deploy.</div></div>';
    return;
  }
  if (!document.getElementById('distGrid')) {
    var pace = distElapsed();
    el.innerHTML =
      '<div class="fb-wrap">'
    +   '<div class="fb-stamp"><span class="fb-live" id="distStamp"></span>'
    +     '<span>Shift ' + DIST_TARGET.shiftStart + ':00–' + DIST_TARGET.shiftEnd + ':00 · '
    +     'cumulative bar ' + DIST_TARGET.dialsPerHour + ' dials / ' + DIST_TARGET.talkMinPerHour
    +     ' talk-min / ' + DIST_TARGET.msPerHour + ' MS per hour over '
    +     DIST_TARGET.productiveHours + ' productive hours</span></div>'
    +   '<div class="fb-box"><div class="hl-hd"><h4>Floor pulse — metric × hour</h4></div>'
    +     '<div class="fb-sub" id="distPulseSub"></div><div class="dist-chart" id="distPulse"></div></div>'
    +   '<div class="fb-box"><div class="hl-hd"><h4 id="distGridTitle">Hourly achievement</h4>'
    +     '<span class="dist-lg"><em>behind</em><i></i><em>on pace</em></span>'
    +     '<div class="hl-chips" id="distChipGroup">'
    +       '<button data-g="ados">ADOS</button><button data-g="zsm">ZSM</button>'
    +       '<button data-g="tl" class="on">TL</button><button data-g="city">City</button></div>'
    +     '<div class="hl-chips" id="distChipMode">'
    +       '<button data-c="pct" class="on">% on pace</button><button data-c="count">LRMs on pace</button></div>'
    +     '</div>'
    +     '<div class="dist-chart" id="distGrid"></div>'
    +     '<div class="dist-drillbar" id="distDrillBar" style="display:none"><span id="distDrillLbl"></span>'
    +       '<span class="dist-x" id="distDrillX">close ✕</span></div>'
    +     '<div class="dist-chart" id="distDrillWrap" style="display:none"><div id="distDrill" style="width:100%;height:100%"></div></div>'
    +     '<div class="fb-hrnote">Grey = hour not yet elapsed. <b>PROJ</b> = run rate over elapsed hours '
    +     'carried across the ' + DIST_TARGET.productiveHours + ' productive hours. Click a row to open its LRMs.</div>'
    +   '</div>'
    +   '<div class="fb-hrnote"><b>MS booked ≠ MS Today.</b> The hourly feed counts meetings '
    +     'booked in that hour; MS Today counts meetings scheduled for that day — two different '
    +     'populations, so they will not reconcile. 18% of bookings fall outside the shift and are '
    +     'not shown here, so these columns sum to less than the day’s MS total.</div>'
    + '</div>';
    document.getElementById('distChipGroup').addEventListener('click', function (e) {
      if (e.target.tagName !== 'BUTTON') return;
      distGroup = e.target.getAttribute('data-g'); distOpen = null;
      Array.prototype.forEach.call(this.children, function (b) { b.classList.remove('on'); });
      e.target.classList.add('on'); distRender();
    });
    document.getElementById('distChipMode').addEventListener('click', function (e) {
      if (e.target.tagName !== 'BUTTON') return;
      distMode = e.target.getAttribute('data-c');
      Array.prototype.forEach.call(this.children, function (b) { b.classList.remove('on'); });
      e.target.classList.add('on'); distDrawGrid();
    });
    document.getElementById('distDrillX').addEventListener('click', function () { distOpen = null; distDrawDrill(); });
  }
  var stamp = document.getElementById('distStamp');
  if (stamp) {
    var el2 = distElapsed();
    stamp.textContent = el2 >= DIST_HOURS.length ? 'FULL DAY'
      : 'AS OF ' + ('0' + (DIST_TARGET.shiftStart + el2)).slice(-2) + ':00 · ' + el2 + ' OF ' + DIST_HOURS.length + ' HRS';
  }
  distRender();
}
function distRender() { distDrawPulse(); distDrawGrid(); distDrawDrill(); }
window.addEventListener('resize', function () {
  Object.keys(distCharts).forEach(function (k) { try { distCharts[k].resize(); } catch (e) {} });
});
