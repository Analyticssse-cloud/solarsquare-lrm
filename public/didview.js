/* ════════════════════════════════════════════════════════════════════════════
   didview.js — the DID estate tab. RESTRUCTURED 18 Oct 2026 (was: three KPI
   strips, eight stacked cards, three feed banners and a long caveat card on
   one scroll). Now: ONE headline strip, ONE feed line, and a view switch that
   draws a single section at a time —
     Overview      lead type × (range | vs all days | today | 15d | today vs 15d)
                   + the day-by-day curve
     By city       did_city_daily — city table, click → DIDs in that city
     Numbers       watch list (worst movers vs their own baseline) + full tables
     Reputation    did_rep cards, only when DID_REP_QUESTION_ID is set
   Caveats collapse into one "How to read this tab" disclosure at the foot.

   Feed rules that have NOT changed (do not "fix" them):
   - did_overall (card 3305) has no Date column → its Today/7d/15d/Overall
     windows IGNORE the picker. did_day_on_day (3304) follows it.
   - Both carry rates only, no dials → every estate figure is an UNWEIGHTED
     mean across DIDs; per-DID rows are ranked by MOVEMENT, never by level.
   - did_city_daily carries counts → city rates ARE volume-weighted; cells
     under DV_CITY_MIN calls are greyed and not ranked.
   ════════════════════════════════════════════════════════════════════════════ */

/* Lead types, in the order the estate should read them: the two that carry the
   argument first. `pre` is the canonical-field prefix from api/dashboard.js. */
var DID_TYPES = [
  { pre: 'fresh', dod: 'fresh', label: 'Fresh leads',       note: 'first contact' },
  { pre: 'ret',   dod: 'ret',   label: 'Retargeting',       note: 'previously worked' },
  { pre: 'conf',  dod: 'conf',  label: 'Confirmation calls', note: 'meeting already booked' },
  { pre: 'lost',  dod: 'lost',  label: 'Lost leads',        note: 'revival attempts' },
  { pre: 'total', dod: 'total', label: 'All calls',         note: 'every lead type' }
];
var DID_WINDOWS = [
  { suf: 'Today', label: 'Today' },
  { suf: '7d',    label: '7 days' },
  { suf: '15d',   label: '15 days' },
  { suf: 'All',   label: 'Overall' }
];
var didWindow = (function(){ try { return localStorage.getItem('lrmDidWindow') || 'Today'; } catch(e){ return 'Today'; } })();

function dvRows() { return (D && D.didOverall) || []; }
function dvVal(r, key) {
  var c = r._c || {}, v = c[key];
  return (v === undefined || v === null || v === '') ? null : Number(v);
}
/* Unweighted mean over the DIDs that HAVE the figure. Returns null when none
   do, so a missing window renders as an em dash instead of 0.0%. */
function dvMean(rows, key) {
  var s = 0, n = 0;
  rows.forEach(function(r){ var v = dvVal(r, key); if (v !== null && isFinite(v)) { s += v; n++; } });
  return n ? s / n : null;
}
function dvPct(v, dp) {
  return (v === null || v === undefined || isNaN(v))
    ? '<span style="color:#c0c4d6">&mdash;</span>'
    : Number(v).toFixed(dp === undefined ? 1 : dp) + '%';
}
function dvSigned(v) {
  if (v === null || v === undefined || isNaN(v)) return '<span style="color:#c0c4d6">&mdash;</span>';
  var s = (v > 0 ? '+' : '') + v.toFixed(1) + 'pp';
  return '<span class="' + (v <= -3 ? 'bad' : v >= 3 ? 'ok' : '') + '">' + s + '</span>';
}

/* ── RANGE-SCOPED ESTATE, from did_day_on_day ──────────────────────────────
   WHY THIS EXISTS (19 Sep 2026): the tab used to lead with `did_overall`,
   whose four windows are computed inside the card via NOW(). Nothing on the
   tab moved when the date picker moved — reported as "the numbers are not
   changing when applying date filter". It was not a bug in the picker: that
   feed has no Date column and CANNOT be scoped. The date-aware feed was
   already arriving (`D.didDod`, one row per Date × DID, filtered to the
   window server-side) and was only being used for the all-days trend.
   So the picked window now leads, and did_overall is demoted to a labelled
   reference band below it. Same caveat as everywhere on this tab: these are
   rates with no denominators, so every figure is an UNWEIGHTED MEAN over the
   Date × DID rows present — a DID that took twelve dials counts as much as
   one that took nine hundred. */
function dvWinRows() { return (D && D.didDod) || []; }
function dvAllDayRows() { return (D && (D.didDodAllDays || D.didDod)) || []; }
function dvShape(rows) {
  var days = {}, dids = {};
  rows.forEach(function(r){
    var c = r._c || {}, d = String(c.date || r['Date'] || '').trim().slice(0, 10);
    if (d) days[d] = 1;
    if (c.did) dids[String(c.did)] = 1;
  });
  var dl = Object.keys(days).sort();
  return { days: dl.length, first: dl[0] || '', last: dl[dl.length - 1] || '', dids: Object.keys(dids).length };
}
function dvWinLabel() {
  var s = dvShape(dvWinRows());
  if (!s.days) return ((D && D.didDodDiag && D.didDodDiag.window) || 'selected range');
  return s.first === s.last ? s.first : s.first + ' \u2192 ' + s.last;
}


var DV_VIEWS = [['overview', 'Overview'], ['city', 'By city'], ['numbers', 'Numbers'], ['rep', 'Reputation']];
var dvView = (function(){ try { return localStorage.getItem('lrmDidView') || 'overview'; } catch(e){ return 'overview'; } })();
var DV_FLAG_PP = -3;   // a DID this far below its own baseline is on the watch list

/* Per-DID means inside the picked range and over every day the tab holds. */
function dvRangeByDid() {
  var bag = function(rows){
    var out = {};
    rows.forEach(function(r){
      var c = r._c || {}, k = String(c.did || '').trim();
      if (!k) return;
      var b = out[k] || (out[k] = { n: 0, s: {} });
      b.n++;
      DID_TYPES.forEach(function(t){
        var v = dvVal(r, t.dod);
        if (v === null || !isFinite(v)) return;
        var e = b.s[t.dod] || (b.s[t.dod] = { s: 0, n: 0 });
        e.s += v; e.n++;
      });
    });
    return out;
  };
  var win = bag(dvWinRows()), all = bag(dvAllDayRows());
  var m = function(b, k, key){ var e = b[k] && b[k].s[key]; return (e && e.n) ? e.s / e.n : null; };
  return Object.keys(win).map(function(k){
    var o = { did: k, days: win[k].n, t: {} };
    DID_TYPES.forEach(function(t){ o.t[t.dod] = m(win, k, t.dod); });
    o.w = o.t.total; o.a = m(all, k, 'total');
    o.mv = (o.w === null || o.a === null) ? null : o.w - o.a;
    return o;
  });
}

function dvRangeTable(list) {
  if (!list.length) return '';
  var s = list.slice().sort(function(x, y){
    if (x.mv === null) return 1; if (y.mv === null) return -1; return x.mv - y.mv;
  });
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th style="text-align:left">DID</th><th class="sep">Days</th>'
    + DID_TYPES.map(function(t, i){ return '<th' + (i === 0 ? ' class="sep"' : '') + '>' + esc(t.label) + '</th>'; }).join('')
    + '<th class="sep">All calls, every day</th><th>Range vs all days</th></tr></thead><tbody>'
    + s.map(function(o){
        return '<tr><td class="nm" style="text-align:left">' + esc(o.did) + '</td><td num="1" class="sep">' + o.days + '</td>'
          + DID_TYPES.map(function(t, i){ return '<td num="1"' + (i === 0 ? ' class="sep"' : '') + '>' + dvPct(o.t[t.dod]) + '</td>'; }).join('')
          + '<td num="1" class="sep">' + dvPct(o.a) + '</td><td num="1">' + dvSigned(o.mv) + '</td></tr>';
      }).join('')
    + '</tbody></table></div>';
}

/* ONE lead-type table. The first two figure columns follow the picker
   (did_day_on_day); the last three are did_overall's fixed windows. A band row
   names the two groups so the picker boundary is visible in the header itself. */
function dvLeadMatrix(hasDod, hasOverall) {
  var win = dvWinRows(), all = dvAllDayRows(), ov = dvRows();
  var tot = 'background:var(--blue-soft,#eef1f7);font-weight:600';
  var body = DID_TYPES.map(function(t){
    var isT = t.pre === 'total', st = isT ? ' style="' + tot + '"' : '';
    var cells = '';
    if (hasDod) {
      var w = dvMean(win, t.dod), a = dvMean(all, t.dod);
      cells += '<td num="1" class="sep"' + st + '>' + dvPct(w) + '</td>'
             + '<td num="1"' + st + '>' + dvSigned(w === null || a === null ? null : w - a) + '</td>';
    }
    if (hasOverall) {
      var td = dvMean(ov, t.pre + 'Today'), b = dvMean(ov, t.pre + '15d');
      cells += '<td num="1" class="sep"' + st + '>' + dvPct(td) + '</td>'
             + '<td num="1"' + st + '>' + dvPct(b) + '</td>'
             + '<td num="1"' + st + '>' + dvSigned(td === null || b === null ? null : td - b) + '</td>';
    }
    return '<tr><td style="text-align:left' + (isT ? ';' + tot : '') + '">' + esc(t.label)
      + ' <span class="fb-sub" style="font-weight:400">' + esc(t.note) + '</span></td>' + cells + '</tr>';
  }).join('');
  return '<div class="tbl-wrap"><table class="dist"><thead>'
    + '<tr class="grp"><th></th>'
    + (hasDod ? '<th colspan="2" class="sep">Selected range</th>' : '')
    + (hasOverall ? '<th colspan="3" class="sep">Fixed windows &middot; ignores picker</th>' : '')
    + '</tr><tr><th style="text-align:left">Lead type</th>'
    + (hasDod ? '<th class="sep">Connect %</th><th>vs all days</th>' : '')
    + (hasOverall ? '<th class="sep">Today</th><th>15 days</th><th>Today vs 15d</th>' : '')
    + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

/* Day-by-day curve across every day the tab holds (a trend clipped to one
   picked day is not a trend). Lines, not bars — the three lead types share
   one picture and the gap between fresh and retargeting is the finding. */
function dvTrendChart() {
  var src = dvAllDayRows();
  if (!src.length) return '';
  var byDay = {};
  src.forEach(function(r){
    var c = r._c || {}, d = String(c.date || r['Date'] || '').trim().slice(0, 10);
    if (!d) return;
    var g = byDay[d] || (byDay[d] = { total: [], fresh: [], ret: [], n: 0 });
    g.n++;
    ['total', 'fresh', 'ret'].forEach(function(k){
      var v = c[k];
      if (v !== undefined && v !== null && v !== '' && isFinite(Number(v))) g[k].push(Number(v));
    });
  });
  var days = Object.keys(byDay).sort();
  if (days.length < 2) return '';
  var mean = function(a){ return a.length ? Math.round(a.reduce(function(s, x){ return s + x; }, 0) / a.length * 10) / 10 : null; };
  var ser = function(k){ return days.map(function(d){ return mean(byDay[d][k]); }); };
  var ws = dvShape(dvWinRows());
  var S = [
    { name: 'Fresh', k: 'fresh', ink: '#2f8f5b', w: 2 },
    { name: 'All calls', k: 'total', ink: '#2c4a8a', w: 2.6 },
    { name: 'Retargeting', k: 'ret', ink: '#c0563b', w: 2, dash: '5 4' }
  ];
  S.forEach(function(sr){ sr.v = days.map(function(d){ return mean(byDay[d][sr.k]); }); });
  var all = [];
  S.forEach(function(sr){ sr.v.forEach(function(v){ if (v !== null) all.push(v); }); });
  if (!all.length) return '';
  /* Axis zoomed to the data band (stated on the axis itself) — a 0-based axis
     flattens a 22-48% spread into three parallel lines. */
  var lo = Math.floor(Math.min.apply(null, all) / 5) * 5, hi = Math.ceil(Math.max.apply(null, all) / 5) * 5;
  if (hi - lo < 10) hi = lo + 10;
  var W = 760, H = 220, L = 40, R = 116, T = 12, B = 26, n = days.length;
  var X = function(i){ return L + (W - L - R) * (n > 1 ? i / (n - 1) : 0); };
  var Y = function(v){ return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
  var g = '', step = (hi - lo) <= 20 ? 5 : 10;
  for (var t = lo; t <= hi + 0.01; t += step) {
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="#e4e7f0"/>'
       + '<text x="' + (L - 6) + '" y="' + (Y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="#8a93a8">' + t + '%</text>';
  }
  var every = Math.max(1, Math.ceil(n / 12));
  days.forEach(function(d, i){
    if (i % every && i !== n - 1) return;
    var p = d.split('-');
    g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9.5" fill="#8a93a8">'
       + esc(p.length === 3 ? p[2] + '/' + p[1] : d) + '</text>';
  });
  var ends = [];
  S.forEach(function(sr){
    var d = '', pen = false, lastI = -1;
    sr.v.forEach(function(v, i){
      if (v === null) { pen = false; return; }
      d += (pen ? ' L' : ' M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; lastI = i;
    });
    g += '<path d="' + d + '" fill="none" stroke="' + sr.ink + '" stroke-width="' + sr.w + '" stroke-linejoin="round" stroke-linecap="round"'
       + (sr.dash ? ' stroke-dasharray="' + sr.dash + '"' : '') + '/>';
    if (lastI >= 0) {
      var lv = sr.v[lastI];
      g += '<circle cx="' + X(lastI).toFixed(1) + '" cy="' + Y(lv).toFixed(1) + '" r="3" fill="' + sr.ink + '"/>';
      ends.push({ x: X(lastI) + 8, y: Y(lv) + 3.5, t: lv.toFixed(1) + '% ' + sr.name, ink: sr.ink });
    }
  });
  /* End labels pushed apart so two series ending close together never overlap. */
  ends.sort(function(p, q){ return p.y - q.y; });
  for (var e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 13) ends[e].y = ends[e - 1].y + 13;
  ends.forEach(function(p){
    g += '<text x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" font-size="10.5" font-weight="700" fill="' + p.ink + '">' + esc(p.t) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block" font-family="Segoe UI, system-ui, sans-serif" role="img" aria-label="Connect % per day by lead type">' + g + '</svg>'
    + '<div class="fb-sub" style="padding-top:6px">' + days.length + ' days in the tab'
    + (ws.days ? ' &middot; picked range ' + esc(dvWinLabel()) : '') + '. Axis starts at ' + lo + '%, not zero. Weekend days sit on tiny volumes &mdash; '
    + 'a spike there is an artefact, not a collapse.</div>';
}

/* ── City (did_city_daily — counts, so weighted) ─────────────────────────── */
var DV_CITY_MIN = 30;
var dvCity = (function(){ try { return localStorage.getItem('lrmDidCity') || ''; } catch(e){ return ''; } })();
function dvRate(n, d) { return d > 0 ? 100 * n / d : null; }
function dvGap(v) {
  if (v === null || v === undefined || isNaN(v)) return '<span style="color:#c0c4d6">&mdash;</span>';
  var s = (v > 0 ? '+' : '') + v.toFixed(1) + 'pp';
  return '<span class="' + (v <= -3 ? 'bad' : v >= 3 ? 'ok' : '') + '">' + s + '</span>';
}
function dvCityAgg() {
  var dc = D && D.didCity;
  if (!dc || !dc.clusters || !dc.clusters.length) return null;
  var C = dc.clusters;
  var tot = C.reduce(function (a, c) { a.calls += c.calls; a.connects += c.connects; a.fresh += c.fresh; a.freshConn += c.freshConn; a.pin += c.pin; return a; },
    { calls: 0, connects: 0, fresh: 0, freshConn: 0, pin: 0 });
  var placed = C.filter(function (c) { return c.cluster !== 'Unmapped' && c.cluster !== 'No lead'; });
  var ranked = placed.filter(function (c) { return c.calls >= 200; })
    .map(function (c) { return { k: c.cluster, r: dvRate(c.connects, c.calls) }; })
    .sort(function (a, b) { return b.r - a.r; });
  return { dc: dc, C: C, cells: dc.cells || [], tot: tot, placed: placed,
           floor: dvRate(tot.connects, tot.calls), floorFresh: dvRate(tot.freshConn, tot.fresh),
           top: ranked[0] || null, low: ranked.length > 1 ? ranked[ranked.length - 1] : null };
}
function dvCityView() {
  var A = dvCityAgg(), g = (D && D.didCityDiag) || {};
  if (!A) {
    return ccCard({ title: 'DID performance by lead city', note: 'not wired yet',
      sub: g.tab ? 'Read ' + (g.rows || 0) + ' rows from <code>' + esc(g.tab) + '</code>, none inside the picked range.'
         : 'Save <code>sql/did-city-daily-v1.sql</code> as a Metabase card, set <code>DID_CITY_QUESTION_ID</code> in Code.gs '
         + 'and run the backfill. Blocked until the metabase-pii grant on <code>lead</code> is restored.', body: '' });
  }
  var C = A.C, tot = A.tot, floor = A.floor;
  if (!dvCity || !C.some(function (c) { return c.cluster === dvCity; })) dvCity = (A.placed[0] || C[0]).cluster;
  var on = 'background:var(--blue-soft,#eef1f7)';
  var cityTbl = '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th style="text-align:left">Lead city</th><th class="sep">Calls</th><th>Share</th>'
    + '<th class="sep">Connect %</th><th>vs floor</th><th class="sep">Fresh connect %</th></tr></thead><tbody>'
    + C.map(function (c) {
        var r = dvRate(c.connects, c.calls), sel = c.cluster === dvCity, bg = sel ? ' style="' + on + '"' : '';
        return '<tr data-dvcity="' + esc(c.cluster) + '" style="cursor:pointer">'
          + '<td class="nm" style="text-align:left' + (sel ? ';' + on + ';font-weight:600' : '') + '">' + esc(c.cluster) + '</td>'
          + '<td num="1" class="sep"' + bg + '>' + fmt(c.calls) + '</td>'
          + '<td num="1"' + bg + '>' + dvPct(dvRate(c.calls, tot.calls)) + '</td>'
          + '<td num="1" class="sep"' + bg + '>' + dvPct(r) + '</td>'
          + '<td num="1"' + bg + '>' + dvGap(r === null || floor === null ? null : r - floor) + '</td>'
          + '<td num="1" class="sep"' + bg + '>' + dvPct(dvRate(c.freshConn, c.fresh)) + '</td></tr>';
      }).join('')
    + '<tr><td class="nm" style="text-align:left;' + on + ';font-weight:600">All cities</td>'
    + '<td num="1" class="sep" style="' + on + ';font-weight:600">' + fmt(tot.calls) + '</td>'
    + '<td num="1" style="' + on + ';font-weight:600">100.0%</td>'
    + '<td num="1" class="sep" style="' + on + ';font-weight:600">' + dvPct(floor) + '</td>'
    + '<td num="1" style="' + on + '"></td>'
    + '<td num="1" class="sep" style="' + on + ';font-weight:600">' + dvPct(A.floorFresh) + '</td></tr>'
    + '</tbody></table></div>';

  var byDid = {};
  A.cells.forEach(function (x) { var b = byDid[x.did] || (byDid[x.did] = { calls: 0, connects: 0 }); b.calls += x.calls; b.connects += x.connects; });
  var city = C.filter(function (c) { return c.cluster === dvCity; })[0];
  var cityRate = city ? dvRate(city.connects, city.calls) : null;
  var inCity = A.cells.filter(function (x) { return x.cluster === dvCity; }).map(function (x) {
    var all = byDid[x.did] || { calls: 0, connects: 0 };
    var r = dvRate(x.connects, x.calls), rest = dvRate(all.connects - x.connects, all.calls - x.calls);
    return { did: x.did, calls: x.calls, r: r, fr: dvRate(x.freshConn, x.fresh),
             vsCity: (r === null || cityRate === null) ? null : r - cityRate,
             vsElse: (r === null || rest === null) ? null : r - rest, gated: x.calls < DV_CITY_MIN };
  }).sort(function (a, b) {
    if (a.gated !== b.gated) return a.gated ? 1 : -1;
    if (a.gated) return b.calls - a.calls;
    return (a.vsElse === null ? 999 : a.vsElse) - (b.vsElse === null ? 999 : b.vsElse);
  });
  var flagged = inCity.filter(function (x) { return !x.gated && x.vsElse !== null && x.vsElse <= -5; }).length;
  var didTbl = '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th style="text-align:left">DID</th><th class="sep">Calls here</th><th>Connect %</th>'
    + '<th class="sep">vs this city</th><th>vs same DID elsewhere</th><th class="sep">Fresh connect %</th></tr></thead><tbody>'
    + inCity.map(function (x) {
        return '<tr' + (x.gated ? ' style="color:var(--muted)"' : '') + '><td class="nm" style="text-align:left">' + esc(x.did) + '</td>'
          + '<td num="1" class="sep">' + fmt(x.calls) + '</td><td num="1">' + dvPct(x.r) + '</td>'
          + '<td num="1" class="sep">' + (x.gated ? '&mdash;' : dvGap(x.vsCity)) + '</td>'
          + '<td num="1">' + (x.gated ? '&mdash;' : dvGap(x.vsElse)) + '</td>'
          + '<td num="1" class="sep">' + dvPct(x.fr) + '</td></tr>';
      }).join('')
    + '</tbody></table></div>';

  return '<div class="dv-split">'
    + ccCard({ title: 'By lead city',
        note: A.top && A.low ? (A.top.r - A.low.r).toFixed(1) + 'pp spread' : '',
        sub: 'Customer&rsquo;s city, weighted by calls. Click a row to see its DIDs.',
        body: cityTbl })
    + ccCard({ title: 'DIDs in ' + esc(dvCity),
        note: flagged ? '<b class="bad">' + flagged + ' weak here</b>' : inCity.length + ' DIDs',
        sub: '<b>vs same DID elsewhere</b> &le; &minus;5pp = a regional block or spam label, not a bad number. Under '
           + DV_CITY_MIN + ' calls greyed.',
        body: didTbl })
    + '</div>';
}

/* ── Every number, every window ────────────────────────────────────────────
   The audit table. Sorted by the window in view so the switch above it does
   something useful, and the lead-type columns sit in one group per type. */
var dvSort = { col: 'totalToday', dir: 1 };
function dvTable(rows) {
  var W = didWindow;
  var cols = DID_TYPES.map(function(t){ return { key: t.pre + W, label: t.label }; });
  var sorted = rows.slice().sort(function(x, y){
    var a = dvVal(x, dvSort.col), b = dvVal(y, dvSort.col);
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * dvSort.dir;
  });
  var th = function(key, label, cls) {
    var on = dvSort.col === key;
    return '<th class="' + (cls || '') + (on ? ' sorted' : '') + '" data-dvsort="' + key + '">'
         + esc(label) + (on ? (dvSort.dir > 0 ? ' \u25b2' : ' \u25bc') : '') + '</th>';
  };
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th style="text-align:left">DID</th>'
    + cols.map(function(c, i){ return th(c.key, c.label, i === 0 ? 'sep' : ''); }).join('')
    + th('total15d', '15d all calls', 'sep') + th('totalAll', 'Overall', '')
    + '</tr></thead><tbody>'
    + sorted.map(function(r){
        var c = r._c || {};
        return '<tr><td class="nm" style="text-align:left">' + esc(c.did || '') + '</td>'
          + cols.map(function(col, i){
              var v = dvVal(r, col.key);
              var cls = (i === 0 ? 'sep' : '') + (v === null ? '' : (v >= 40 ? ' ok' : v < 20 ? ' bad' : ''));
              return '<td num="1" class="' + cls.trim() + '">' + dvPct(v) + '</td>';
            }).join('')
          + '<td num="1" class="sep">' + dvPct(dvVal(r, 'total15d')) + '</td>'
          + '<td num="1">' + dvPct(dvVal(r, 'totalAll')) + '</td></tr>';
      }).join('')
    + '</tbody></table></div>';
}

/* ── Numbers: one watch list, two full tables behind buttons ─────────────── */
function dvNumbersView(list, hasOverall) {
  var items, basis;
  if (list.length) {
    basis = 'selected range vs every day in tab';
    items = list.filter(function(o){ return o.mv !== null; })
      .map(function(o){ return { label: o.did, value: o.mv, sub: o.w.toFixed(1) + '% vs ' + o.a.toFixed(1) + '% · ' + o.days + 'd' }; });
  } else {
    basis = 'today vs 15-day line';
    items = dvRows().map(function(r){
      var t = dvVal(r, 'totalToday'), b = dvVal(r, 'total15d');
      return (t === null || b === null) ? null : { label: String((r._c && r._c.did) || ''), value: t - b, sub: t.toFixed(1) + '% vs ' + b.toFixed(1) + '%' };
    }).filter(Boolean);
  }
  items.sort(function(a, b){ return a.value - b.value; });
  var worst = items.filter(function(i){ return i.value <= DV_FLAG_PP; });
  var shown = (worst.length ? worst : items).slice(0, 15);
  window.__dvRangeTable = dvRangeTable(list);
  window.__dvTable = hasOverall ? dvTable(dvRows()) : '';
  var btns = (window.__dvRangeTable ? ccTableBtn('Range table', '__dvRangeTable', 'Every DID · selected range') : '')
           + (window.__dvTable ? ccTableBtn('Fixed-window table', '__dvTable', 'Every DID · all lead types') : '');
  return ccCard({
    title: worst.length ? worst.length + ' below baseline' : 'Weakest movers',
    sub: 'Movement ' + esc(basis) + ', not level &mdash; without dial counts a raw rate ranks noise. Flag = ' + DV_FLAG_PP
       + 'pp or worse.' + (worst.length ? '' : ' None flagged; showing the ' + shown.length + ' weakest.'),
    body: '<div class="dv-btns">' + btns + '</div>' + (shown.length ? ccRankedBars(shown, { suffix: 'pp', signed: true, labelW: 132, aria: 'DID movement against own baseline',
            fmt: function(v){ return (v > 0 ? '+' : '') + (Math.round(v * 10) / 10) + 'pp'; } })
          : '<div class="fb-sub" style="padding:12px 0">No DID has a reading in both windows.</div>')
  });
}

function dvHowTo() {
  return '<details class="dv-howto"><summary>How to read this tab</summary><ul>'
    + '<li><b>Lead type drives connectivity more than the number.</b> Fresh runs ~2&times; retargeting on the same DIDs &mdash; compare DIDs only within a lead type.</li>'
    + '<li><b>Range figures and the curve are unweighted means across DIDs</b> (the feeds carry rates, not dials). The city view is the only weighted one.</li>'
    + '<li><b>Fixed windows ignore the date picker</b> &mdash; Today means today.</li>'
    + '<li><b>New numbers read high for a few weeks.</b> Run <code>sql/did-decay-v1.sql</code> before buying more; set <code>DID_REP_QUESTION_ID</code> for the depth-adjusted index.</li>'
    + '<li><b>Compliance outranks all of it:</b> promotional calls must come from the 140 series (TCCCPR, Feb 2025).</li>'
    + '</ul></details>';
}

function renderDID() {
  var panel = document.getElementById('didPanel');
  if (!panel || !D) return;
  var rows = dvRows();
  var hasOverall = !!(D.connHas && D.connHas.didOverall && rows.length);
  var hasDod = !!(D.connHas && D.connHas.didDod);
  var hasRep = !!(D.connHas && D.connHas.did && D.didRows && D.didRows.length);
  var A = dvCityAgg(), hasCity = !!A;

  if (activeTab === 'did') setCount(hasOverall ? rows.length + ' DIDs' : (hasDod ? 'day-on-day only' : (hasCity ? 'by city only' : 'no DID feed')));

  if (!hasOverall && !hasDod && !hasRep && !hasCity) {
    var g0 = (D && D.didOverallDiag) || {};
    panel.innerHTML = connStack(chNoSource('DID estate', 'No DID feed for this view yet. ' + (g0.tab ? 'Read ' + (g0.rows || 0) + ' rows from ' + g0.tab + '.'
        : 'Run setupDidOverallTab() and setupDidDodTab() in Apps Script, then installDidDodTrigger().')));
    return;
  }

  var win = dvWinRows(), ws = dvShape(win), as = dvShape(dvAllDayRows());
  var list = hasDod && win.length ? dvRangeByDid() : [];
  var useRange = list.length > 0;
  var src = useRange ? win : rows;
  var kT = useRange ? 'total' : 'totalToday', kF = useRange ? 'fresh' : 'freshToday', kR = useRange ? 'ret' : 'retToday';
  var tot = dvMean(src, kT), base = useRange ? dvMean(dvAllDayRows(), 'total') : dvMean(rows, 'total15d');
  var fr = dvMean(src, kF), rt = dvMean(src, kR);
  var flagged = useRange ? list.filter(function(o){ return o.mv !== null && o.mv <= DV_FLAG_PP; }).length
    : rows.filter(function(r){ var t = dvVal(r, 'totalToday'), b = dvVal(r, 'total15d'); return t !== null && b !== null && t - b <= DV_FLAG_PP; }).length;
  var scope = useRange ? dvWinLabel() : 'today';

  var cells = [
    ['Numbers in use', fmt(useRange ? ws.dids : rows.length), scope],
    ['Connect %', dvPct(tot, 1), (tot === null || base === null) ? '' : ((tot - base > 0 ? '+' : '') + (tot - base).toFixed(1) + 'pp vs ' + (useRange ? as.days + '-day line' : '15d'))],
    ['Fresh vs retargeting', (fr === null || rt === null) ? '&mdash;' : dvPct(fr, 0) + ' <u>/</u> ' + dvPct(rt, 0), (fr === null || rt === null) ? '' : (fr - rt).toFixed(1) + 'pp gap'],
    ['Below own baseline', fmt(flagged), DV_FLAG_PP + 'pp or worse']
  ];
  if (hasCity) cells.push(['Weakest city', A.low ? esc(A.low.k) : '&mdash;', A.low ? A.low.r.toFixed(1) + '% vs floor ' + A.floor.toFixed(1) + '%' : '200+ calls needed']);

  var views = DV_VIEWS.filter(function(v){ return v[0] !== 'rep' || hasRep; })
    .filter(function(v){ return v[0] !== 'city' || hasCity || D.didCityDiag; })
    .map(function(v){ return v[0] === 'numbers' && flagged ? [v[0], v[1] + ' (' + flagged + ')'] : v; });
  if (!views.some(function(v){ return v[0] === dvView; })) dvView = 'overview';

  var feeds = [
    hasDod ? 'Range: did_day_on_day' + (as.days ? ' (' + as.days + ' days held)' : '') : null,
    hasOverall ? 'Fixed windows: did_overall, ignores picker' : null,
    hasCity ? 'City: did_city_daily' : null
  ].filter(Boolean).join(' &middot; ');

  var html = connStripCells(cells)
    + '<div class="dv-bar">' + ccSeg('data-dvview', views, dvView) + '<span class="dv-feeds">' + feeds + '</span></div>';

  if (dvView === 'overview') {
    if (hasDod && !win.length) {
      html += ccCard({ title: 'No DID rows in the selected range', note: esc((D.didDodDiag && D.didDodDiag.window) || ''),
        sub: 'The day-on-day tab holds ' + as.days + ' days (' + esc(as.first) + ' to ' + esc(as.last) + '). Widen the range; the fixed windows below still show.', body: '' });
    }
    if (useRange || hasOverall) {
      html += ccCard({ title: 'By lead type',
        note: (useRange ? ws.dids : rows.length) + ' DIDs',
        sub: 'Read across a row for movement, down a column for the lead-type gap.',
        body: dvLeadMatrix(useRange, hasOverall) });
    }
    var trend = dvTrendChart();
    if (trend) html += ccCard({ title: 'Day by day', body: trend });
  } else if (dvView === 'city') {
    html += dvCityView();
  } else if (dvView === 'numbers') {
    html += dvNumbersView(list, hasOverall);
  } else if (dvView === 'rep') {
    html += didRepCards();
  }

  html += dvHowTo();
  panel.innerHTML = connStack(html);
  if (typeof ccWireTables === 'function') ccWireTables(panel, 'Every DID', window.__dvTable || '');
  if (dvView === 'rep' && typeof didRepWire === 'function') didRepWire(panel);

  panel.querySelectorAll('button[data-dvview]').forEach(function (b) {
    b.addEventListener('click', function () {
      dvView = b.getAttribute('data-dvview');
      try { localStorage.setItem('lrmDidView', dvView); } catch (e) {}
      renderDID();
    });
  });
  panel.querySelectorAll('[data-dvcity]').forEach(function (el) {
    el.addEventListener('click', function () {
      dvCity = el.getAttribute('data-dvcity');
      try { localStorage.setItem('lrmDidCity', dvCity); } catch (e) {}
      renderDID();
    });
  });
}

Object.assign(window, { renderDID: renderDID });
