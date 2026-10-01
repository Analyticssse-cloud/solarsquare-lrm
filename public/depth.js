/* ═══════════════════════════════════════════════════════════════════════════
   Calling depth — the depth-adjusted connect index.

   THE PROBLEM THIS TAB EXISTS FOR
   A raw Connect % punishes whoever is working the hard end of the list. First
   attempts answer at ~34%, 6th-10th at ~20%, so two callers doing identical
   work score twenty points apart purely on the age of the numbers they were
   handed. Measured 1-10 Sep: headline connectivity FELL 4.0pp while
   within-bucket execution IMPROVED 3.8pp — a mix effect of -7.9pp. Every
   connectivity number on this dashboard is that broken metric unless it is
   read next to the index.

     Index      = actual connects ÷ expected connects × 100, where expected is
                  Σ p(answer | attempt band). 100 is estate par.
     Shortfall  = actual − expected, in CONVERSATIONS. It adds across a team,
                  so it is the figure a TL can act on.

   FOUR RULES BUILT INTO THIS FILE
     1. NEVER AVERAGE THE INDEX. Only connects and expected are summed; every
        index on screen is recomputed from the summed counts. Averaging the
        per-day index weights a 40-call day like a 400-call one — the exact
        error the metric was built to remove.
     2. THE INDEX IS ESTATE-RELATIVE. If the whole floor degrades together it
        still reads ~100. So Connect % is always shown beside it, never
        instead of it, and never alone.
     3. ATTEMPT DEPTH IS BOUNDED AT 90 DAYS in the source card, and that is
        measured, not theoretical: 15.7% of numbers — 19.9% of dial volume —
        are first seen at the lookback edge, so they read shallower than they
        are. Expected is OVERSTATED, shortfall is PESSIMISTIC, ranking is
        safe. Said plainly in the footnote rather than buried.
     4. A THINLY BASELINED DAY IS MARKED. The card computes band rates from
        its own window, so a day pulled inside a bisected chunk was judged
        against a shorter baseline. Those days are hatched, like an immature
        cohort in Coverage.

   Reads only what the backend returns:
     D.depthRows   [{agent,name,city,cluster,tl,tlName,zsm,zsmName,ados,adosName,
                     days,calls,uniq,fresh,connects,expected,real,
                     a13,a410,a11,avgDepth,baseMin,_inScope}]
     D.depthTrend  [{date,calls,connects,expected,fresh,real,uniq,lrms,
                     avgDepth,baseMin}]
     D.depthHas    false when the `depth` tab does not exist yet
   Depends on globals from index.html: D, F, esc, fmt, agentName, setCount,
   activeTab.
   ═══════════════════════════════════════════════════════════════════════════ */

var DP_GRAINS = [
  { k: 'cluster', lab: 'Cluster', head: 'Cluster', of: function (r) { return r.cluster || 'Unmapped'; } },
  { k: 'city',    lab: 'City',    head: 'City',    of: function (r) { return r.city || 'Unmapped'; } },
  { k: 'ados',    lab: 'ADOS',    head: 'ADOS',    of: function (r) { return r.adosName || '—'; } },
  { k: 'zsm',     lab: 'ZSM',     head: 'ZSM',     of: function (r) { return r.zsmName || '—'; } },
  { k: 'tl',      lab: 'TL',      head: 'Team Lead', of: function (r) { return r.tlName || '—'; } },
  { k: 'lrm',     lab: 'LRM',     head: 'LRM',     of: function (r) { return r.name || r.agent; } }
];
var dpGrain = 'tl';
try { var _dg = localStorage.getItem('lrmDepthGrain'); if (DP_GRAINS.some(function (g) { return g.k === _dg; })) dpGrain = _dg; } catch (e) {}
/* Which column the table leads on. 'index' ranks execution, 'shortfall' ranks
   by how many conversations are actually missing — the same data read as a
   league table or as a worklist. Default is the worklist. */
var dpSort = { col: 'shortfall', dir: 1 };

(function injectDepthCss() {
  var css = '' +
  '.dp-wrap{padding:2px 0 18px;flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column}' +
  '.dp-wrap>*{flex:0 0 auto}' +
  '.dp-wrap>.tbl-wrap{overflow-x:auto;overflow-y:hidden}' +
  '.dp-head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin:2px 0 14px}' +
  '.dp-title{font-size:15px;font-weight:800;color:var(--ink,#18233f);letter-spacing:-.2px}' +
  '.dp-sub{font-size:11.5px;color:var(--muted,#6a7494);max-width:680px;line-height:1.5;margin-top:3px}' +
  '.dp-chip{border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--ink,#18233f);font:700 11.5px/1 inherit;padding:6px 11px;border-radius:20px;cursor:pointer;white-space:nowrap}' +
  '.dp-chip:hover{border-color:#9fb0d8}.dp-chip.on{background:#18233f;border-color:#18233f;color:#fff}' +
  '.dp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:1px;background:var(--border,#e3e8f3);border:1px solid var(--border,#e3e8f3);margin-bottom:16px}' +
  '.dp-kpi{background:#fff;padding:11px 13px}' +
  '.dp-kpi:last-child{grid-column:auto/-1}' +
  '.dp-kpi-v{font-size:22px;font-weight:800;letter-spacing:-.7px;color:var(--ink,#18233f);line-height:1.1}' +
  '.dp-kpi-l{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#6a7494);margin-top:3px}' +
  '.dp-kpi-n{font-size:10.5px;color:var(--muted,#6a7494);margin-top:2px}' +
  '.dp-kpi.bad .dp-kpi-v{color:#b0382c}.dp-kpi.good .dp-kpi-v{color:#4b7f44}' +
  /* Trend. Bar HEIGHT is the day's dial volume and the FIGURE is the index —
     the index alone would let a 40-call Sunday shout as loudly as a full
     Tuesday. The par line at 100 is drawn, not implied. */
  '.dp-trend{border:1px solid var(--border,#e3e8f3);padding:14px 16px 10px;margin-bottom:18px;background:#fff}' +
  '.dp-trend-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap}' +
  '.dp-trend-hd b{font-size:12px;letter-spacing:-.1px}' +
  '.dp-trend-hd span{font-size:11px;color:var(--muted,#6a7494)}' +
  '.dp-bars{display:flex;gap:4px;align-items:flex-end;height:132px}' +
  '.dp-bar{flex:1 1 0;display:flex;flex-direction:column;justify-content:flex-end;height:100%;min-width:0}' +
  '.dp-bar i{display:block;background:#6ea866;border-radius:2px 2px 0 0;min-height:2px}' +
  '.dp-bar.low i{background:#e8a05c}.dp-bar.bad i{background:#b0382c}.dp-bar.par i{background:#8fa8cf}' +
  '.dp-bar em{font-style:normal;font-size:9px;font-weight:800;text-align:center;color:var(--ink,#18233f);margin-bottom:3px;white-space:nowrap}' +
  '.dp-bar.thin i{background:repeating-linear-gradient(45deg,#c3ccdd,#c3ccdd 3px,#eef1f8 3px,#eef1f8 6px)}' +
  '.dp-bar.thin em{color:var(--muted,#6a7494)}' +
  '.dp-xlab{display:flex;gap:4px;margin-top:7px;border-top:1px solid var(--border,#e3e8f3);padding-top:6px}' +
  '.dp-xlab span{flex:1 1 0;min-width:0;font-size:9px;color:var(--muted,#6a7494);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.dp-subnote{font-size:11px;color:var(--muted,#6a7494);margin-top:9px;line-height:1.55}' +
  /* The mix bar. This is the picture the whole tab argues from: when the pale
     "fresh" band shrinks, Connect % falls with no change in execution. */
  '.dp-mix{display:flex;height:26px;border:1px solid var(--border,#e3e8f3);overflow:hidden;margin:2px 0 8px}' +
  '.dp-mix i{display:block;height:100%;font-style:normal;font-size:9.5px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap}' +
  '.dp-mix i.b1{background:#8fa8cf}.dp-mix i.b2{background:#5d7bab}.dp-mix i.b3{background:#33496f}' +
  '.dp-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:10.5px;color:var(--muted,#6a7494)}' +
  '.dp-legend b{color:var(--ink,#18233f);font-weight:700}' +
  '.dp-legend s{text-decoration:none;display:inline-block;width:9px;height:9px;margin-right:5px;vertical-align:-1px}' +
  '.dp-grain{display:flex;align-items:center;gap:6px;margin:0 0 10px;flex-wrap:wrap}' +
  '.dp-tbl-note{font-size:11px;color:var(--muted,#6a7494);margin:0 0 7px;max-width:900px;line-height:1.5}' +
  '.dp-grid th,.dp-grid td{white-space:nowrap}' +
  '.dp-grid th.dp-sep,.dp-grid td.dp-sep{border-left:1px solid var(--border,#e3e8f3)}' +
  '.dp-grid em.dp-n{font-style:normal;font-size:9.5px;color:var(--muted,#6a7494);margin-left:4px}' +
  '.dp-grid td.dp-short{font-weight:700}.dp-grid td.dp-short.neg{color:#b0382c}.dp-grid td.dp-short.pos{color:#4b7f44}' +
  '.dp-grid tr.dp-tot td{font-weight:800;background:#f4f6fb;border-bottom:1px solid #cfd7ea}' +
  '.dp-foot{margin-top:18px;border-top:1px solid var(--border,#e3e8f3);padding-top:11px}' +
  '.dp-foot-b{font-size:11px;color:var(--muted,#6a7494);line-height:1.6;max-width:940px}' +
  '.dp-empty{padding:38px 22px;font-size:12.5px;color:var(--muted,#6a7494);line-height:1.7}' +
  '.dp-empty b{color:var(--ink,#18233f)}';
  var s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();

/* Same scope rules as every other tab, written out rather than shared: the
   files load independently and a shared helper would make load order matter. */
function filterDepth() {
  return (D.depthRows || []).filter(function (r) {
    if (F.ados.length && F.ados.indexOf(String(r.adosName || '')) < 0) return false;
    if (F.zsms.length && F.zsms.indexOf(String(r.zsmName || '')) < 0) return false;
    if (F.cities.length && F.cities.indexOf(String(r.city || '')) < 0) return false;
    if (F.tls.length && F.tls.indexOf(String(r.tlName || '')) < 0) return false;
    if (F.agents.length && F.agents.indexOf(String(r.agent || '')) < 0) return false;
    if (F.q) {
      var words = (r.agent + ' ' + r.city + ' ' + r.cluster + ' ' + r.tlName + ' ' + (r.name || ''))
        .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      var qs = String(F.q).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      for (var qi = 0; qi < qs.length; qi++) {
        var hit = false;
        for (var wi = 0; wi < words.length; wi++) if (words[wi].indexOf(qs[qi]) === 0) { hit = true; break; }
        if (!hit) return false;
      }
    }
    return r._inScope !== false;
  });
}

/* Rule 1 lives here: `idx` is derived from summed connects and expected, never
   from an average of the rows' own indexes. Every caller of this function gets
   that for free, which is the point of there being exactly one. */
function dpDerive(a) {
  a.idx = a.expected ? Math.round(100 * a.connects / a.expected) : 0;
  a.shortfall = Math.round((a.connects - a.expected) * 10) / 10;
  a.connectPct = a.calls ? Math.round(1000 * a.connects / a.calls) / 10 : 0;
  a.freshPct = a.calls ? Math.round(1000 * a.fresh / a.calls) / 10 : 0;
  a.realPct = a.calls ? Math.round(1000 * a.real / a.calls) / 10 : 0;
  a.depth = a.calls ? Math.round(100 * a.depthWSum / a.calls) / 100 : 0;
  return a;
}

function dpStats(rows) {
  var t = { calls: 0, uniq: 0, fresh: 0, connects: 0, expected: 0, real: 0,
            a13: 0, a410: 0, a11: 0, depthWSum: 0, lrms: 0 };
  (rows || []).forEach(function (r) {
    ['calls', 'uniq', 'fresh', 'connects', 'expected', 'real', 'a13', 'a410', 'a11']
      .forEach(function (k) { t[k] += r[k] || 0; });
    t.depthWSum += (r.avgDepth || 0) * (r.calls || 0);
    t.lrms += 1;
  });
  return dpDerive(t);
}

function dpGrainDef(k) {
  k = k || dpGrain;
  for (var i = 0; i < DP_GRAINS.length; i++) if (DP_GRAINS[i].k === k) return DP_GRAINS[i];
  return DP_GRAINS[0];
}

function dpGroup(rows, grain) {
  var G = dpGrainDef(grain), by = {};
  (rows || []).forEach(function (r) {
    var k = G.of(r) || '—';
    var a = by[k] || (by[k] = { key: k, calls: 0, uniq: 0, fresh: 0, connects: 0,
                                expected: 0, real: 0, a13: 0, a410: 0, a11: 0,
                                depthWSum: 0, lrms: {} });
    ['calls', 'uniq', 'fresh', 'connects', 'expected', 'real', 'a13', 'a410', 'a11']
      .forEach(function (f) { a[f] += r[f] || 0; });
    a.depthWSum += (r.avgDepth || 0) * (r.calls || 0);
    a.lrms[r.agent] = true;
  });
  return Object.keys(by).map(function (k) {
    var a = by[k];
    a.n = Object.keys(a.lrms).length;
    return dpDerive(a);
  });
}

/* Bands are deliberately WIDE around par. An index of 97 is not a finding —
   it is the same work with a different lead mix — and colouring it amber
   teaches people to ignore the colour. */
function dpBand(i) { return i >= 108 ? 'good' : i >= 92 ? '' : i >= 80 ? 'warn' : 'bad'; }
function dpTint(i) {
  if (i >= 108) return 'rgba(110,168,102,.14)';
  if (i >= 92)  return 'transparent';
  if (i >= 80)  return 'rgba(232,160,92,.12)';
  return 'rgba(176,56,44,.10)';
}

function renderDepth() {
  var panel = document.getElementById('depthPanel');
  if (!panel) return;

  if (!D.depthHas) {
    panel.innerHTML = '<div class="dp-empty"><b>No calling-depth feed yet.</b><br>' +
      'Save <code>sql/connectivity-lrm-daily-v2.sql</code> as a Metabase question, put its id in ' +
      '<code>DEP_QID</code> in <code>Depth.gs</code>, then run <code>depRunBackfill()</code>. ' +
      'The <code>depth</code> tab is written into this same sheet.</div>';
    if (activeTab === 'depth') setCount('');
    return;
  }

  var rows = filterDepth();
  var t = dpStats(rows);
  if (activeTab === 'depth') setCount(fmt(t.calls) + ' calls');

  var G = dpGrainDef();
  var groups = dpGroup(rows, dpGrain);

  var html = '<div class="dp-wrap">';

  html += '<div class="dp-head"><div><div class="dp-title">Calling depth</div>' +
    '<div class="dp-sub">Connect rate with the <b>attempt mix taken out</b>. Every dial is scored ' +
    'against how often that attempt number answers across the floor, so working a pile of ' +
    'eleventh attempts is no longer punished. <b>100 is par</b>; <b>shortfall</b> is the same ' +
    'thing in missing conversations, and it adds up across a team.</div></div></div>';

  // ── KPIs ───────────────────────────────────────────────────────────────────
  var kpi = function (cls, v, lab, note) {
    return '<div class="dp-kpi' + (cls ? ' ' + cls : '') + '"><div class="dp-kpi-v">' + v + '</div>' +
      '<div class="dp-kpi-l">' + lab + '</div>' +
      (note ? '<div class="dp-kpi-n">' + note + '</div>' : '') + '</div>';
  };
  html += '<div class="dp-kpis">' +
    kpi(dpBand(t.idx), t.idx || '—', 'Depth index',
        '100 = estate par · ' + fmt(Math.round(t.expected)) + ' expected') +
    kpi(t.shortfall < 0 ? 'bad' : 'good',
        (t.shortfall > 0 ? '+' : '') + fmt(t.shortfall), 'Shortfall',
        'conversations against expectation') +
    kpi('', t.connectPct + '%', 'Connect %',
        fmt(t.connects) + ' of ' + fmt(t.calls) + ' dials') +
    kpi('', t.freshPct + '%', 'Fresh share',
        fmt(t.fresh) + ' first attempts') +
    kpi('', t.depth || '—', 'Avg attempt depth',
        'mean attempt number per dial') +
    kpi('', fmt(t.lrms), 'LRMs dialling', fmt(t.uniq) + ' unique numbers') +
    '</div>';

  // ── Trend ──────────────────────────────────────────────────────────────────
  // Floor-wide and NOT scope-filtered, same as Coverage: it answers "is the
  // floor holding par", which a scoped subset cannot.
  var tr = (D.depthTrend || []);
  if (tr.length > 1) {
    var maxC = 0, baseMode = 0, counts = {};
    tr.forEach(function (d) {
      if (d.calls > maxC) maxC = d.calls;
      if (d.baseMin) counts[d.baseMin] = (counts[d.baseMin] || 0) + 1;
    });
    /* "Thin" is relative to the baseline every OTHER day got, not to a magic
       number: whatever span most days were pulled with is normal here. */
    Object.keys(counts).forEach(function (k) { if (counts[k] > (counts[baseMode] || 0)) baseMode = Number(k); });

    html += '<div class="dp-trend"><div class="dp-trend-hd"><b>Depth index by day</b>' +
      '<span>floor-wide, not filtered · bar height is the day\'s dial volume · ' +
      'figure is the index · hatched = judged against a shorter baseline</span></div><div class="dp-bars">';
    tr.forEach(function (d) {
      var idx = d.expected ? Math.round(100 * d.connects / d.expected) : 0;
      var h = maxC ? Math.max(2, Math.round(100 * d.calls / maxC)) : 2;
      var thin = baseMode && d.baseMin && d.baseMin < baseMode;
      var cls = thin ? 'thin' : (idx >= 108 ? '' : idx >= 92 ? 'par' : idx >= 80 ? 'low' : 'bad');
      var cp = d.calls ? Math.round(1000 * d.connects / d.calls) / 10 : 0;
      html += '<div class="dp-bar ' + cls + '" title="' + esc(d.date) + ' · ' + fmt(d.calls) +
        ' dials · index ' + idx + ' · ' + cp + '% connected · ' + d.lrms + ' LRMs' +
        (thin ? ' · baselined over ' + d.baseMin + ' days' : '') + '">' +
        '<em>' + (idx || '·') + '</em><i style="height:' + h + '%"></i></div>';
    });
    html += '</div><div class="dp-xlab">';
    tr.forEach(function (d) { html += '<span>' + esc(d.date.slice(8)) + '</span>'; });
    html += '</div>';

    /* The mix effect, stated rather than left to be inferred. This comparison
       is the reason the tab exists, so it is written out in words on the
       first and last day of whatever range is loaded. */
    var f = tr[0], l = tr[tr.length - 1];
    var fi = f.expected ? 100 * f.connects / f.expected : 0;
    var li = l.expected ? 100 * l.connects / l.expected : 0;
    var fc = f.calls ? 100 * f.connects / f.calls : 0;
    var lc = l.calls ? 100 * l.connects / l.calls : 0;
    var ff = f.calls ? 100 * f.fresh / f.calls : 0;
    var lf = l.calls ? 100 * l.fresh / l.calls : 0;
    var dIdx = Math.round((li - fi) * 10) / 10;
    var dCon = Math.round((lc - fc) * 10) / 10;
    var sign = function (x) { return (x > 0 ? '+' : '') + x; };
    html += '<div class="dp-subnote">From <b>' + esc(f.date) + '</b> to <b>' + esc(l.date) +
      '</b>, raw connect rate moved <b>' + sign(dCon) + 'pp</b> while the depth index moved <b>' +
      sign(dIdx) + '</b>' +
      ((dCon < 0 && dIdx >= 0) || (dCon > 0 && dIdx <= 0)
        ? ' — they point in <b>opposite directions</b>, which is a mix effect, not a change in execution.'
        : '.') +
      ' Fresh share went ' + Math.round(ff * 10) / 10 + '% → ' + Math.round(lf * 10) / 10 +
      '%; that is what moves the two apart.</div>';
    html += '</div>';
  }

  // ── Attempt mix ────────────────────────────────────────────────────────────
  if (t.calls) {
    var p13 = Math.round(1000 * t.a13 / t.calls) / 10;
    var p410 = Math.round(1000 * t.a410 / t.calls) / 10;
    var p11 = Math.round(1000 * t.a11 / t.calls) / 10;
    html += '<div class="dp-trend"><div class="dp-trend-hd"><b>Where the dials are going</b>' +
      '<span>share of dials by attempt number · in scope</span></div>' +
      '<div class="dp-mix">' +
      (p13 ? '<i class="b1" style="width:' + p13 + '%">' + (p13 >= 8 ? p13 + '%' : '') + '</i>' : '') +
      (p410 ? '<i class="b2" style="width:' + p410 + '%">' + (p410 >= 8 ? p410 + '%' : '') + '</i>' : '') +
      (p11 ? '<i class="b3" style="width:' + p11 + '%">' + (p11 >= 8 ? p11 + '%' : '') + '</i>' : '') +
      '</div><div class="dp-legend">' +
      '<span><s style="background:#8fa8cf"></s><b>1st–3rd</b> ' + fmt(t.a13) + ' dials</span>' +
      '<span><s style="background:#5d7bab"></s><b>4th–10th</b> ' + fmt(t.a410) + ' dials</span>' +
      '<span><s style="background:#33496f"></s><b>11th+</b> ' + fmt(t.a11) + ' dials</span>' +
      '</div><div class="dp-subnote">A shrinking pale band is a <b>supply</b> problem, not a calling ' +
      'one: the same callers answer fewer phones because the numbers are older. Over 1–10 Sep the ' +
      'fresh share fell 71.5% → 19.2% while volume rose 54%.</div></div>';
  }

  // ── Grain table ────────────────────────────────────────────────────────────
  html += '<div class="dp-grain"><span class="dp-sub" style="margin:0 4px 0 0">Group by</span>';
  DP_GRAINS.forEach(function (g) {
    html += '<button class="dp-chip' + (g.k === dpGrain ? ' on' : '') + '" data-dg="' + g.k + '">' +
      esc(g.lab) + '</button>';
  });
  html += '</div>';
  html += '<div class="dp-tbl-note">Sorted by <b>shortfall</b> — the rows missing the most ' +
    'conversations lead, which is the order a TL works the floor in. Click <b>Index</b> to read it ' +
    'as a league table instead. Every index here is recomputed from that group\'s own totals; ' +
    'none is an average of the rows beneath it.</div>';

  groups.sort(function (a, b) {
    var k = dpSort.col;
    var x = a[k], y = b[k];
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x).localeCompare(String(y)) * (dpSort.dir < 0 ? -1 : 1);
    }
    return ((x || 0) - (y || 0)) * (dpSort.dir < 0 ? -1 : 1);
  });

  var th = function (k, lab, extra) {
    return '<th class="' + (extra || '') + (k === 'key' ? '' : ' num') + '" data-ds="' + k + '">' +
      esc(lab) + (dpSort.col === k ? (dpSort.dir < 0 ? ' ▾' : ' ▴') : '') + '</th>';
  };
  html += '<div class="tbl-wrap"><table class="dp-grid"><thead><tr>' +
    th('key', G.head) + th('n', 'LRMs') +
    th('calls', 'Dials', 'dp-sep') + th('connects', 'Connects') + th('connectPct', 'Connect %') +
    th('idx', 'Index', 'dp-sep') + th('shortfall', 'Shortfall') +
    th('freshPct', 'Fresh %', 'dp-sep') + th('depth', 'Avg depth') + th('realPct', '15s+ talk') +
    '</tr></thead><tbody>';

  groups.forEach(function (g) {
    html += '<tr><td>' + esc(g.key) + '</td><td class="num">' + fmt(g.n) + '</td>' +
      '<td class="num dp-sep">' + fmt(g.calls) + '</td>' +
      '<td class="num">' + fmt(g.connects) + '</td>' +
      '<td class="num">' + g.connectPct + '%</td>' +
      '<td class="num dp-sep" style="background:' + dpTint(g.idx) + ';font-weight:700">' + (g.idx || '—') + '</td>' +
      '<td class="num dp-short ' + (g.shortfall < 0 ? 'neg' : 'pos') + '">' +
        (g.shortfall > 0 ? '+' : '') + fmt(g.shortfall) + '</td>' +
      '<td class="num dp-sep">' + g.freshPct + '%</td>' +
      '<td class="num">' + (g.depth || '—') + '</td>' +
      '<td class="num">' + g.realPct + '%</td></tr>';
  });
  html += '<tr class="dp-tot"><td>All in scope</td><td class="num">' + fmt(t.lrms) + '</td>' +
    '<td class="num dp-sep">' + fmt(t.calls) + '</td><td class="num">' + fmt(t.connects) + '</td>' +
    '<td class="num">' + t.connectPct + '%</td>' +
    '<td class="num dp-sep">' + (t.idx || '—') + '</td>' +
    '<td class="num dp-short ' + (t.shortfall < 0 ? 'neg' : 'pos') + '">' +
      (t.shortfall > 0 ? '+' : '') + fmt(t.shortfall) + '</td>' +
    '<td class="num dp-sep">' + t.freshPct + '%</td><td class="num">' + (t.depth || '—') + '</td>' +
    '<td class="num">' + t.realPct + '%</td></tr>';
  html += '</tbody></table></div>';

  // ── Footnote ───────────────────────────────────────────────────────────────
  html += '<div class="dp-foot"><div class="dp-foot-b">' +
    '<b>The index is estate-relative.</b> It compares each caller against what the floor achieves ' +
    'on the same attempt numbers, so if connectivity degrades everywhere at once it still reads ' +
    '~100. That is why Connect % sits beside it and never on its own. ' +
    '<b>Attempt depth is bounded at 90 days</b>, and that bound is measured: 15.7% of numbers — ' +
    'carrying 19.9% of dial volume — are first seen at the edge of the lookback, so they read as ' +
    'shallower attempts than they really are. Expected connects are therefore slightly overstated ' +
    'and <b>shortfall reads pessimistic</b>; ranking is unaffected, because every caller is scored ' +
    'on the same band rates. Removing the bound needs the persisted first-touch model ' +
    '(<code>sql/connectivity-first-touch-v2-persisted.sql</code>). ' +
    '<b>Manual dials only</b> — inbound is demand arriving, not a dial, and folding it in would ' +
    'flatter the denominator.' +
    '</div></div>';

  html += '</div>';
  panel.innerHTML = html;

  // ── Wiring ─────────────────────────────────────────────────────────────────
  panel.querySelectorAll('.dp-chip[data-dg]').forEach(function (b) {
    b.addEventListener('click', function () {
      dpGrain = b.getAttribute('data-dg');
      try { localStorage.setItem('lrmDepthGrain', dpGrain); } catch (e) {}
      renderDepth();
    });
  });
  panel.querySelectorAll('.dp-grid th[data-ds]').forEach(function (h) {
    h.style.cursor = 'pointer';
    h.addEventListener('click', function () {
      var k = h.getAttribute('data-ds');
      /* Shortfall ascends by default (most-missing first); everything else
         descends. Getting this backwards puts the best performer at the top of
         a worklist, which is how a panel stops being read. */
      dpSort.dir = (dpSort.col === k) ? dpSort.dir * -1 : (k === 'shortfall' || k === 'key' ? 1 : -1);
      dpSort.col = k;
      renderDepth();
    });
  });
}
