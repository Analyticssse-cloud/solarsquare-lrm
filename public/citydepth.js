/* ═════════════════════════════════════════════════════════════════
   City / cluster calling depth — Dial depth tab, under the ladder.
   One row per cluster:
     Dialling depth (overall)   dials ÷ dialled leads (LA × Data cohort)
     Best connectivity hour     from D.hourlyRows: the cluster's hour with the
                                highest connect %, its rate vs the day, and the
                                share of the cluster's dials placed in it
     Stage-wise calling depth   dials ÷ dialled leads per CURRENT lead stage
                                (D.leadDepthStage live; per-lead mock rows in preview)
   Obeys the main filter bar via window.ldFilter (dialwaterfall.js).
   ═════════════════════════════════════════════════════════════════ */
var CD_MIN_HOUR_CALLS = 30, CD_STAGES = 4;

function cdStageRows() {
  if (window.MOCK && !(window.D && D.leadDepthAgg)) return ldRows();
  return (window.D && D.leadDepthStage) || [];
}
function cdKey(s) { return String(s || '').trim() || '—'; }
function cdHourLab(h) { h = +h; var p = function (x) { return (x < 10 ? '0' : '') + x + ':00'; }; return p(h) + '–' + p(h + 1); }
function cdShortStage(s) { return String(s || '—').replace(/Meeting Confirmed - Customer Home/i, 'Meeting Confirmed').replace(/^Lead - /i, ''); }

function renderCityDepth(panel) {
  var flt = window.ldFilter || function () { return true; };
  var host = document.createElement('div'); host.className = 'dp-wrap cd';
  panel.appendChild(host);
  var pct = function (a, b) { return b ? (Math.round(1000 * a / b) / 10) + '%' : '–'; };
  var dpl = function (d, n) { return n ? (Math.round(10 * d / n) / 10).toFixed(1) : '–'; };

  // 1. Overall depth per cluster (same cohort as the ladder above).
  var C = {}, all = { leads: 0, dialled: 0, dials: 0 };
  var get = function (k) { return C[k] || (C[k] = { k: k, leads: 0, dialled: 0, dials: 0, st: {}, h: {}, hCalls: 0, hConn: 0 }); };
  ldRows().filter(flt).forEach(function (r) {
    var c = get(cdKey(r.cluster)), w = ldW(r), dd = ldDepth(r) > 0 ? w : 0;
    c.leads += w; c.dialled += dd; c.dials += r.dials;
    all.leads += w; all.dialled += dd; all.dials += r.dials;
  });
  if (!all.leads) return;

  // 2. Stage-wise.
  var stAll = {};
  cdStageRows().filter(flt).forEach(function (r) {
    var c = C[cdKey(r.cluster)]; if (!c) return;
    var s = cdKey(r.stage), dl = r.n ? (r.dl || 0) : (r.dials > 0 ? 1 : 0);
    if (!dl) return;
    var a = c.st[s] || (c.st[s] = { s: s, dl: 0, dials: 0 }); a.dl += dl; a.dials += r.dials;
    var b = stAll[s] || (stAll[s] = { s: s, dl: 0, dials: 0 }); b.dl += dl; b.dials += r.dials;
  });

  // 3. Best connectivity hour — hourly rows mapped to a cluster through the roster.
  var hAll = {}, hasHourly = false;
  ((window.D && D.hourlyRows) || []).forEach(function (r) {
    var e = String(r.agent || '').trim().toLowerCase();
    if (!e) return;
    var info = awInfo({ lrm: e });
    if (!flt({ lrm: e, source: awSource || '—', cluster: info.city, lead: '' })) return;
    var c = null, city = String(info.city || '').toLowerCase();
    Object.keys(C).forEach(function (k) { if (k.toLowerCase() === city) c = C[k]; });
    var hr = +r.hour, calls = +r.calls || 0, conn = +r.connected || 0;
    if (!calls || !isFinite(hr)) return;
    hasHourly = true;
    var x = hAll[hr] || (hAll[hr] = { calls: 0, conn: 0 }); x.calls += calls; x.conn += conn;
    if (!c) return;
    var y = c.h[hr] || (c.h[hr] = { calls: 0, conn: 0 }); y.calls += calls; y.conn += conn;
    c.hCalls += calls; c.hConn += conn;
  });
  var best = function (h, tot) {
    var b = null, min = Math.max(CD_MIN_HOUR_CALLS, 0.03 * tot);
    Object.keys(h).forEach(function (k) {
      var v = h[k]; if (v.calls < min) return;
      var r = v.conn / v.calls; if (!b || r > b.r) b = { hr: +k, r: r, calls: v.calls };
    });
    return b;
  };

  var hourCell = function (h, calls, conn) {
    var b = best(h, calls);
    if (!b) return '<td class="cd-na">' + (hasHourly ? 'Too few calls' : 'No hourly data') + '</td>';
    return '<td class="cd-hr"><b>' + cdHourLab(b.hr) + '</b><span><em>' + pct(b.r * 1000, 1000) + '</em> connect vs ' + pct(conn, calls) + ' day</span>' +
      '<span>' + pct(b.calls, calls) + ' of dials placed here</span></td>';
  };
  var stageCell = function (st) {
    var list = Object.keys(st).map(function (k) { return st[k]; }).sort(function (a, b) { return b.dl - a.dl; });
    if (!list.length) return '<td class="cd-na">–</td>';
    var top = list.slice(0, CD_STAGES), rest = list.slice(CD_STAGES);
    var max = Math.max.apply(null, top.map(function (a) { return a.dials / a.dl; }));
    var h = '<td class="cd-st"><div class="cd-stl">';
    top.forEach(function (a) {
      var v = a.dials / a.dl;
      h += '<div class="cd-sr" title="' + ldEsc(a.s) + ' · ' + ldFmt(a.dl) + ' dialled leads · ' + ldFmt(a.dials) + ' dials">' +
        '<span class="cd-sn">' + ldEsc(cdShortStage(a.s)) + '</span><i style="width:' + Math.max(4, 100 * v / max) + '%"></i><b>' + v.toFixed(1) + '</b></div>';
    });
    if (rest.length) h += '<div class="cd-more" title="' + ldEsc(rest.map(function (a) { return cdShortStage(a.s) + ' ' + (a.dials / a.dl).toFixed(1); }).join(' · ')) + '">+' + rest.length + ' more stage' + (rest.length > 1 ? 's' : '') + '</div>';
    return h + '</div></td>';
  };

  var cities = Object.keys(C).map(function (k) { return C[k]; }).sort(function (a, b) { return b.leads - a.leads; });
  var h = '<div class="ld-card"><div class="ld-card-hd"><b>Calling depth by city / cluster</b><span>' + cities.length + ' clusters · depth = dials per dialled lead</span></div>' +
    '<div class="tbl-wrap"><table class="cd-tbl"><thead><tr><th>City / cluster</th><th class="num">Dialling depth (overall)</th>' +
    '<th>Calling depth · best connectivity hour</th><th>Stage-wise calling depth <small>dials / dialled lead</small></th></tr></thead><tbody>';
  cities.forEach(function (c) {
    h += '<tr><td class="cd-city"><b>' + ldEsc(c.k) + '</b><span>' + ldFmt(c.leads) + ' leads · ' + pct(c.leads - c.dialled, c.leads) + ' untouched</span></td>' +
      '<td class="num cd-dep"><b>' + dpl(c.dials, c.dialled) + '</b><span>' + ldFmt(c.dials) + ' dials · ' + ldFmt(c.dialled) + ' leads</span></td>' +
      hourCell(c.h, c.hCalls, c.hConn) + stageCell(c.st) + '</tr>';
  });
  var aCalls = 0, aConn = 0; Object.keys(hAll).forEach(function (k) { aCalls += hAll[k].calls; aConn += hAll[k].conn; });
  h += '<tr class="cd-tot"><td class="cd-city"><b>All shown</b><span>' + ldFmt(all.leads) + ' leads · ' + pct(all.leads - all.dialled, all.leads) + ' untouched</span></td>' +
    '<td class="num cd-dep"><b>' + dpl(all.dials, all.dialled) + '</b><span>' + ldFmt(all.dials) + ' dials · ' + ldFmt(all.dialled) + ' leads</span></td>' +
    hourCell(hAll, aCalls, aConn) + stageCell(stAll) + '</tr>';
  h += '</tbody></table></div><div class="ef-foot"><b>Dialling depth</b> = dials ÷ leads dialled at least once, for leads assigned in the date range (untouched leads are shown separately, not averaged in as zero). ' +
    '<b>Best connectivity hour</b> = the hour with the highest connected ÷ dials for that cluster\'s LRMs over the date range (hours under ' + CD_MIN_HOUR_CALLS + ' dials or 3% of the day are ignored); it reads the hourly tab, so it is dated by <b>call date</b> and ignores the lead-source picker. ' +
    '<b>Stage-wise</b> = dials ÷ dialled leads grouped by the lead\'s <b>current</b> stage (LA tab), largest stages first; hover a row for counts.</div></div>';
  host.innerHTML = h;
}

(function () {
  var css = '.cd{margin-top:16px}' +
    '.cd-tbl td{vertical-align:top}' +
    '.cd-tbl th small{font-weight:600;text-transform:none;letter-spacing:0;color:#6a7494;margin-left:4px}' +
    '.cd-city b,.cd-dep b,.cd-hr b{display:block;font-size:13px;color:#18233f}' +
    '.cd-dep b{font-size:16px;font-variant-numeric:tabular-nums}' +
    '.cd-city span,.cd-dep span,.cd-hr span{display:block;font-size:11px;color:#6a7494;white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.cd-hr em{font-style:normal;font-weight:700;color:#1f7a45}' +
    '.cd-na{font-size:11.5px;color:#a3aac0}' +
    '.cd-st{min-width:280px}.cd-stl{display:flex;flex-direction:column;gap:3px}' +
    '.cd-sr{display:grid;grid-template-columns:minmax(110px,150px) minmax(40px,1fr) 30px;align-items:center;gap:8px;font-size:11.5px}' +
    '.cd-sn{color:#18233f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.cd-sr i{display:block;height:6px;border-radius:3px;background:#3e7fc4;justify-self:start}' +
    '.cd-sr b{text-align:right;font-variant-numeric:tabular-nums;color:#18233f}' +
    '.cd-more{font-size:10.5px;color:#6a7494;cursor:help}' +
    'tr.cd-tot td{background:#f4f6fb;border-top:1px solid #cfd7ea}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();
