/* ═══════════════════════════════════════════════════════════════════════════
   Distribution — hourly achievement heatmaps.  Replaces the Floor Board tab.

   ONE grid, one shared colour scale (red = behind the hour's bar, green = at or
   above it):
     1. Group grid     ADOS/ZSM/TL/City x hour + projected close, FLOOR row on top
     2. Drill          LRM x hour      — opens under a clicked group row

   The separate "Floor pulse" heatmap (metric x hour) was removed 3 Sep 2026 — two
   stacked heatmaps of the same cells read as clutter, and its top row WAS the
   grid's FLOOR row for the other two metrics. Its two real jobs survive as the
   metric pills: each pill carries that metric's floor-wide % on pace right now,
   so the leak is still visible at a glance, and clicking one switches the grid.

   Reads only what the backend already returns:
     D.hourlyRows   [{agent, hour, calls, connected, talkHr, ms}]  ('hourly' tab)
     D.hourlyHasMS  false when the sheet has no 'MS Scheduled' column yet
     filterAgents() the filter bar + viewer scope, same as every other view
   so there is no new API surface and the filter bar applies unchanged.

   Depends on globals from index.html: D, filterAgents, istNow, esc, fmt,
   activeTab.  No chart engine: every shape on this tab is a CSS bar.
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
var DIST_PAGE = '#ffffff', DIST_INK = '#18233f', DIST_MUTED = '#6a7494', DIST_RULE = '#e3e8f3';

/* The per-LRM DAY target the MTD table accrues. Mirrors FLOOR_TARGET in index.html;
   read from it when that file is loaded so the two can never drift. */
var FLOOR_TARGET_DAY = (typeof FLOOR_TARGET !== 'undefined') ? FLOOR_TARGET : { dials:150, talkMin:120, ms:10 };
var distMetric = 'dials', distGroup = 'tl', distMode = 'pct', distOpen = null;


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
/* ── Removed 4 Sep 2026: the ECharts heatmap layer (distChart, distBase, distYAxis,
   distFutureSeries, distVmap, distDrawPills, distDrawGrid, distDrawDrill) and the
   echarts CDN tag in index.html. distRender() draws hero → MTD (and drew FRT until
   4 Sep) since the heatmap was replaced by the MTD table, so the engine was a blocking
   third-party script for a chart nobody draws. §5: CSS bars unless the shape needs
   an engine, and these tabs must open instantly. Series helpers (distSeries,
   distGroups, distShare) are kept — the MTD table and the pace bar read them. */
/* ── MTD totals table (replaces the hourly heatmap grid, 4 Sep 2026) ──────
   Dials, talk time and meetings scheduled for the DATE RANGE IN VIEW — set the
   date filter to 1st→today and it is month to date. The heatmap it replaced
   showed the share of LRMs on cumulative pace hour by hour: the right instrument
   at 14:00 on one day, the wrong one for a month, where the question is simply
   how much work each group has put in against its accrued target.
   Fully filterable: rows come from filterAgents(), so the filter bar, the viewer
   scope and the group chips all apply, and every row opens to its LRMs.

   Targets accrue by DAY, not by the clock: per-LRM day target x LRMs x days in
   range. Days come from the row's own _dayCount (the backend counts the days an
   LRM actually appears in), so an LRM who joined mid-month is not scored against
   the whole month. */
var MTD_COLS = [
  { k:'dials', lab:'Dials',      per:FLOOR_TARGET_DAY.dials,   get:function(r){ return Number(r['Call Count'])||0; },
    show:function(v){ return fmt(Math.round(v)); }, unit:'' },
  { k:'talk',  lab:'Talk time',  per:FLOOR_TARGET_DAY.talkMin, get:function(r){ return (Number(r['Total Talk Time'])||0)*60; },
    show:function(v){ return fmt(Math.round(v/60*10)/10)+' hr'; }, unit:' min' },
  { k:'ms',    lab:'MS',         per:FLOOR_TARGET_DAY.ms,      get:function(r){ return Number(r['MS Today'])||0; },
    show:function(v){ return fmt(Math.round(v)); }, unit:'' }
];
function mtdStats(rows) {
  var s = { n:rows.length, days:0, vals:{}, tgt:{} };
  MTD_COLS.forEach(function (c) { s.vals[c.k] = 0; s.tgt[c.k] = 0; });
  rows.forEach(function (r) {
    var days = Number(r._dayCount) || 1;
    s.days = Math.max(s.days, days);
    MTD_COLS.forEach(function (c) { s.vals[c.k] += c.get(r); s.tgt[c.k] += c.per * days; });
  });
  return s;
}
function mtdRowsBy(level) {
  var col = DIST_LEVELS[level].col, g = {}, order = [];
  filterAgents().forEach(function (r) {
    var k = String(r[col] || '').trim() || '— Unmapped —';
    if (!g[k]) { g[k] = []; order.push(k); }
    g[k].push(r);
  });
  return order.map(function (k) { return { key:k, rows:g[k], s:mtdStats(g[k]) }; });
}
function mtdCells(s) {
  return MTD_COLS.map(function (c) {
    var v = s.vals[c.k], t = s.tgt[c.k], pct = t ? Math.round(v / t * 100) : 0;
    return '<td class="num sep">' + c.show(v) + '</td>'
      + '<td class="num">' + (s.n ? c.show(v / s.n) : '—') + '</td>'
      + '<td class="num"><span class="mtd-pct ' + (pct >= 100 ? 'ok' : pct >= 70 ? 'mid' : 'no') + '">' + pct + '%</span></td>';
  }).join('');
}
function distDrawMtd() {
  var host = document.getElementById('distMtd'); if (!host) return;
  var all = filterAgents(), tot = mtdStats(all);
  var groups = mtdRowsBy(distGroup).sort(function (a, b) { return b.s.vals.dials - a.s.vals.dials; });
  var head = '<tr class="mtd-hgrp"><th></th><th></th>'
    + MTD_COLS.map(function (c) { return '<th class="num sep" colspan="3">' + c.lab + '</th>'; }).join('') + '</tr>'
    + '<tr><th>' + DIST_LEVELS[distGroup].label + '</th><th class="num">LRMs</th>'
    + MTD_COLS.map(function () { return '<th class="num sep">Total</th><th class="num">/ LRM</th><th class="num">vs target</th>'; }).join('')
    + '</tr>';
  var body = '<tr class="mtd-tot"><td>FLOOR</td><td class="num">' + fmt(tot.n) + '</td>' + mtdCells(tot) + '</tr>';
  groups.forEach(function (b) {
    var open = distOpen === b.key;
    body += '<tr class="mtd-row' + (open ? ' open' : '') + '" data-k="' + esc(b.key) + '"><td>' + esc(b.key) + '</td>'
      + '<td class="num">' + fmt(b.s.n) + '</td>' + mtdCells(b.s) + '</tr>';
    if (open) {
      b.rows.slice().sort(function (x, y) { return (Number(y['Call Count'])||0) - (Number(x['Call Count'])||0); })
        .forEach(function (r) {
          var s1 = mtdStats([r]);
          body += '<tr class="mtd-sub"><td>' + esc(r['LRM Name'] || agentName(r['Agent Id'])) + '</td>'
            + '<td class="num">' + s1.days + 'd</td>' + mtdCells(s1) + '</tr>';
        });
    }
  });
  if (!groups.length) body = '<tr><td colspan="11" class="fb-sub" style="text-align:center;padding:18px">No LRMs in this range.</td></tr>';
  host.innerHTML = '<div class="tbl-wrap"><table class="dist mtd">' + head + body + '</table></div>';
  host.querySelectorAll('tr.mtd-row').forEach(function (tr) {
    tr.addEventListener('click', function () {
      var k = tr.getAttribute('data-k');
      distOpen = (distOpen === k) ? null : k;
      distDrawMtd();
    });
  });
  var sub = document.getElementById('distMtdSub');
  if (sub) sub.textContent = fmt(tot.n) + ' LRMs in view · ' + (D.dateLabel || '') +
    ' · target accrues per day worked (' + FLOOR_TARGET_DAY.dials + ' dials / ' +
    FLOOR_TARGET_DAY.talkMin + ' talk-min / ' + FLOOR_TARGET_DAY.ms + ' MS per LRM per day)' +
    (tot.days ? ' · up to ' + tot.days + ' day' + (tot.days === 1 ? '' : 's') + ' per LRM' : '');
}

/* ── Panel shell ────────────────────────────────────────────────────────── */
function renderHourlyBoard() {
  var el = document.getElementById('distPanel');
  if (!el || !D) return;
  // No ECharts and no hourly feed needed any more — the MTD table and the hero
  // both read the daily agent rows.
  if (!document.getElementById('distMtd')) {
    el.innerHTML =
      '<div class="fb-wrap">'
    +   '<div id="distHero"></div>'
    +   '<div class="fb-stamp"><span class="fb-live" id="distStamp"></span>'
    +     '<span id="distStampSub"></span></div>'
    +   '<div class="fb-box fb-grow"><div class="hl-hd"><h4>Dials, talk time and meetings &mdash; total for the range</h4>'
    +     '<div class="hl-chips" id="distChipGroup">'
    +       '<button data-g="ados">ADOS</button><button data-g="zsm">ZSM</button>'
    +       '<button data-g="tl" class="on">TL</button><button data-g="city">City</button></div>'
    +     '</div>'
    +     '<div class="fb-sub" id="distMtdSub"></div>'
    +     '<div id="distMtd"></div>'
    +     '<div class="fb-hrnote">Set the date filter to the 1st &rarr; today for month to date. '
    +     '<b>vs target</b> is against the target accrued over the days each LRM actually worked, so a '
    +     'mid-month joiner is not scored against the whole month. Click a row to open its LRMs.</div>'
    +   '</div>'
    /* The "MS booked ≠ MS Today" note went with the hourly columns it described
       (4 Sep): this tab no longer draws an hourly feed, so the sentence pointed at
       columns that are not on the screen. */
    + '</div>';
    document.getElementById('distChipGroup').addEventListener('click', function (e) {
      if (e.target.tagName !== 'BUTTON') return;
      distGroup = e.target.getAttribute('data-g'); distOpen = null;
      Array.prototype.forEach.call(this.children, function (b) { b.classList.remove('on'); });
      e.target.classList.add('on'); distRender();
    });
  }
  var stamp = document.getElementById('distStamp');
  if (stamp) {
    var el2 = distElapsed();
    stamp.textContent = el2 >= DIST_HOURS.length ? 'FULL DAY'
      : 'AS OF ' + ('0' + (DIST_TARGET.shiftStart + el2)).slice(-2) + ':00 · ' + el2 + ' OF ' + DIST_HOURS.length + ' HRS';
  }
  var ss = document.getElementById('distStampSub');
  if (ss) ss.innerHTML = esc(D.dateLabel || '') + ' · totals for the range in view';
  distRender();
}
/* The first-response histogram was removed from the product (user, 4 Sep): it is not
   drawn on this tab OR on the First Response Time tab, which is the table. Its
   renderer (speedHistCard) was deleted from speed.js in the same change rather than
   left unreachable — the FRT shape can come back as one call in renderSpeed(). */
/* The hero + strip are owned by index.html (they read the daily agent rows, not the
   hourly feed) — drawn here, never re-implemented. */
function distDrawHero() {
  var host = document.getElementById('distHero');
  if (!host) return;
  host.innerHTML = (typeof floorHeroHTML === 'function') ? floorHeroHTML(filterAgents()) : '';
}
function distRender() { distDrawHero(); distDrawMtd(); }

