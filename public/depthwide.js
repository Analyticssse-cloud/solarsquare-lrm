/* ═════════════════════════════════════════════════════════════════
   Dial depth — ONE consolidated view, laid out like the "Calling depth"
   sheet (1 Oct 2026). One row per City (or ADOS / ZSM / TL / LRM / Source):
     Dialing depth (overall)                  dials ÷ dialled leads
     Calling depth (best connectivity hour)   Best hour · Best hour connect % ·
                                              Calling depth (best hr) · Connect %
                                              (all hrs) · % of dials in best hr
     Stage-wise calling depth                 dials ÷ dialled leads per stage
     Leads dialled · Total dials
   Click any row / stage cell → pop-up of the lead ids behind it (same shell as
   Coverage and First Response Time). Lead list arrives on the lazy ?leads=1
   fetch (D.depthLeads); preview uses the mock per-lead rows.
   Load AFTER citydepth.js — it takes over window.renderDepth.
   ═════════════════════════════════════════════════════════════════ */
var DW_GRAINS = [
  { k: 'cluster', lab: 'City' }, { k: 'ados', lab: 'ADOS' }, { k: 'zsm', lab: 'ZSM' }, { k: 'tl', lab: 'TL' },
  { k: 'lrm', lab: 'LRM' }, { k: 'source', lab: 'Lead source' }
];
var DW_STAGE_COLS = 9, DW_THIN = 5;
var dwGrain = 'cluster', dwMode = 'table', dwSort = { col: 'dialled', dir: -1 }, dwList = 'all', dwCtx = null;
try { dwGrain = localStorage.getItem('lrmDepthWideGrain') || 'cluster'; } catch (e) {}
if (!DW_GRAINS.some(function (g) { return g.k === dwGrain; })) dwGrain = 'cluster';

function dwKeyOf(r, g) { return String(r[g] || '').trim() || '—'; }
function dwLabel(g, k) { return (g === 'cluster' || g === 'source') ? k : ldName(k); }
function dwStage(s) { s = String(s || '').trim(); return s || 'No stage'; }
function dwPct(a, b) { return b ? Math.round(1000 * a / b) / 10 : null; }
function dwP(v) { return v == null ? '–' : v.toFixed(1) + '%'; }
function dwF2(n, d) { return d ? (n / d).toFixed(2) : ''; }
/* Meetings = LEADS with a meeting scheduled (msl), not a sum of the daily MS count,
   which counts one lead once per day it carried a meeting. */
function dwMsLeads(r) { return r.n ? (r.msl != null ? r.msl : r.ms) : (r.ms > 0 ? 1 : 0); }
function dwReach(r) { return r.n ? !!r.rch : ((r.rc != null ? r.rc : r.conn) > 0); }
function dwHr(h) { var p = function (x) { return (x < 10 ? '0' : '') + x + ':00'; }; return p(h) + '-' + p(h + 1); }

/* LRM → TL/ZSM/ADOS from the aggregate rows, so the lead list can ship LRM only. */
function dwChain() {
  var m = {};
  ldRows().forEach(function (r) { if (r.lrm && !m[r.lrm]) m[r.lrm] = { tl: r.tl, zsm: r.zsm, ados: r.ados }; });
  return m;
}
/* Per-lead rows, normalised to the same shape the filters read. null = still loading. */
function dwLeadRows() {
  if (window.MOCK && !(window.D && D.leadDepthAgg)) return ldRows().filter(function (r) { return r.dials > 0; });
  if (!window.D || D.leadsOmitted) return null;
  if (D.__dwLeads && D.__dwLeadsSrc === D.depthLeads) return D.__dwLeads;
  var ch = dwChain();
  D.__dwLeadsSrc = D.depthLeads;
  D.__dwLeads = (D.depthLeads || []).map(function (x) {
    var c = ch[x.lrm] || {};
    return { lead: x.l, lrm: x.lrm, tl: c.tl, zsm: c.zsm, ados: c.ados, cluster: x.c, source: x.s || '—', stage: x.st, status: x.ss,
      dials: x.d, conn: x.cn, rc: x.rc, ms: x.ms, md: x.md, assigned: x.a, link: 'https://lighthouse.solarsquare.in/#/menu/lead/details/' + encodeURIComponent(x.l) };
  });
  return D.__dwLeads;
}

function dwRender(panel) {
  var flt = window.ldFilter || function () { return true; };
  var all = (typeof awEnsureUntouched === 'function') ? awEnsureUntouched(ldRows()) : ldRows();
  panel.innerHTML = '';
  var wrap = document.createElement('div'); wrap.className = 'dp-wrap dw'; panel.appendChild(wrap);
  if (!all.length) { wrap.innerHTML = ldDiagHtml(); return; }

  var srcCount = {}, allN = 0;
  all.forEach(function (r) { var v = r.source || '—'; srcCount[v] = (srcCount[v] || 0) + ldW(r); allN += ldW(r); });
  if (awSource && !srcCount[awSource]) awSource = '';
  var srcList = Object.keys(srcCount).sort(function (a, b) { return srcCount[b] - srcCount[a]; });

  var g = dwGrain, rows = all.filter(flt), G = {}, lrmKey = {};
  var mk = function (k) { return { key: k, leads: 0, dialled: 0, dials: 0, reached: 0, ms: 0, overZero: 0, st: {}, h: {}, hc: 0, hn: 0, hu: 0 }; };
  var T = mk('All shown');
  rows.forEach(function (r) {
    var k = dwKeyOf(r, g), w = ldW(r), d = ldDepth(r);
    [G[k] || (G[k] = mk(k)), T].forEach(function (a) {
      a.leads += w; a.dials += r.dials; a.ms += dwMsLeads(r);
      if (d > 0) a.dialled += w;
      if (dwReach(r)) a.reached += w;
      if (d >= 6 && !dwReach(r)) a.overZero += w;
    });
    if (r.lrm && !lrmKey[r.lrm]) lrmKey[r.lrm] = k;
  });
  if (!T.leads) { wrap.innerHTML = ldDiagHtml(); return; }

  // Hourly → best connectivity hour. Source has no hourly split.
  var hasHourly = false, hasUniq = false;
  if (g !== 'source') ((window.D && D.hourlyRows) || []).forEach(function (r) {
    var e = String(r.agent || '').trim().toLowerCase().replace('@homes.solarsquare.in', '@solarsquare.in');
    var k = lrmKey[e]; if (!k) return;
    var hr = +r.hour, c = +r.calls || 0, n = +r.connected || 0, u = +r.uniq || 0; if (!c || !isFinite(hr)) return;
    hasHourly = true; if (u) hasUniq = true;
    [G[k], T].forEach(function (a) { var x = a.h[hr] || (a.h[hr] = { c: 0, n: 0, u: 0 }); x.c += c; x.n += n; x.u += u; a.hc += c; a.hn += n; a.hu += u; });
  });
  // Stage-wise.
  var stTot = {};
  (typeof cdStageRows === 'function' ? cdStageRows() : []).filter(flt).forEach(function (r) {
    var a = G[dwKeyOf(r, g)]; if (!a) return;
    var dl = r.n ? (r.dl || 0) : (r.dials > 0 ? 1 : 0); if (!dl) return;
    var s = dwStage(r.stage);
    stTot[s] = (stTot[s] || 0) + dl;
    [a, T].forEach(function (x) { var v = x.st[s] || (x.st[s] = { dl: 0, dials: 0 }); v.dl += dl; v.dials += r.dials; });
  });
  var named = Object.keys(stTot).filter(function (s) { return s !== 'No stage'; }).sort(function (a, b) { return stTot[b] - stTot[a]; });
  var cols = named.slice(0, DW_STAGE_COLS), otherSet = {};
  named.slice(DW_STAGE_COLS).forEach(function (s) { otherSet[s] = 1; });
  var hasOther = named.length > DW_STAGE_COLS, hasNone = !!stTot['No stage'];

  var fin = function (a) {
    var b = null, min = Math.max(30, 0.03 * a.hc);
    Object.keys(a.h).forEach(function (k) { var v = a.h[k]; if (v.c < min) return; var r = v.n / v.c; if (!b || r > b.r) b = { hr: +k, r: r, c: v.c, u: v.u }; });
    a.best = b; a.depth = a.dialled ? a.dials / a.dialled : 0;
    a.bestConn = b ? 100 * b.r : null; a.allConn = a.hc ? 100 * a.hn / a.hc : null;
    a.bestDepth = b && b.u ? b.c / b.u : null; a.bestShare = b ? 100 * b.c / a.hc : null;
    var o = { dl: 0, dials: 0 };
    Object.keys(otherSet).forEach(function (s) { var v = a.st[s]; if (v) { o.dl += v.dl; o.dials += v.dials; } });
    a.st.__other = o;
    return a;
  };
  var groups = Object.keys(G).map(function (k) { var a = fin(G[k]); a.label = dwLabel(g, k); return a; });
  fin(T);
  var sv = function (a) {
    var c = dwSort.col; if (c === 'label') return a.label;
    if (c.indexOf('st:') === 0) { var v = a.st[c.slice(3)]; return v && v.dl ? v.dials / v.dl : -1; }
    return a[c] == null ? -1 : a[c];
  };
  groups.sort(function (a, b) { var x = sv(a), y = sv(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dwSort.dir; });

  var mock = rows.some(function (r) { return r.mock; });
  var range = (window.D && D.fromDate) ? (D.fromDate === D.toDate ? D.fromDate : D.fromDate + ' → ' + D.toDate) : '';
  if (typeof activeTab !== 'undefined' && activeTab === 'depth' && typeof setCount === 'function') setCount(ldFmt(T.leads) + ' leads');
  var over = (typeof ldOverRows === 'function' ? ldOverRows() : []).filter(flt);
  var glab = (DW_GRAINS.filter(function (x) { return x.k === g; })[0] || {}).lab;

  var h = '<div class="dw-head"><div><div class="dp-title">Calling depth · leads assigned ' + ldEsc(range) + '</div>' +
    '<div class="ld-sub">Leads are picked by <b>assigned date</b>; every dial on them since assignment counts. Depth = dials ÷ leads dialled. <b>Click any row or stage cell</b> to see the lead ids behind it.</div></div>' +
    (mock ? '<span class="ld-mock">Preview · sample data</span>' : '') + '</div>';

  var dg = (window.D && D.leadDepthDiag) || {}, realBasis = dg.reachBasis === 'real';
  var cov = [];
  if (dg.dataMax) cov.push('Data tab covers calls ' + ldEsc(dg.dataMin) + ' → ' + ldEsc(dg.dataMax));
  if (dg.afterDataEnd) cov.push(ldFmt(dg.afterDataEnd) + ' leads assigned after ' + ldEsc(dg.dataMax) + ' left out (no call data yet, not untouched)');
  if (dg.dataDupRows) cov.push(ldFmt(dg.dataDupRows) + ' duplicate lead × day rows in Data collapsed');
  if (cov.length) h += '<div class="ld-sub dw-cov">' + cov.join(' · ') + '</div>';
  var stat = function (v, l, c) { return '<div class="ld-stat' + (c ? ' ' + c : '') + '"><b>' + v + '</b><span>' + l + '</span></div>'; };
  h += '<div class="ld-stats">' + stat(ldFmt(T.leads), 'leads assigned') +
    stat(dwP(dwPct(T.leads - T.dialled, T.leads)), 'untouched', (T.leads - T.dialled) / T.leads >= 0.2 ? 'bad' : '') +
    stat(ldFmt(T.dialled), 'leads dialled') + stat(T.depth.toFixed(2), 'dialing depth (overall)') +
    stat(dwP(dwPct(T.reached, T.dialled)), realBasis ? 'dialled leads reached (real conversation)' : 'dialled leads connected (any connect)') + stat(ldFmt(T.ms), 'leads with a meeting scheduled') +
    stat(ldFmt(T.overZero), realBasis ? 'dead over-dials (6+, never reached)' : 'dead over-dials (6+, never connected)', T.overZero ? 'bad' : '') + '</div>';

  h += '<div class="ld-card dw-card"><div class="dw-bar"><div class="ld-seg">';
  DW_GRAINS.forEach(function (x) { h += '<button class="' + (x.k === g ? 'on' : '') + '" data-dg="' + x.k + '">' + x.lab + '</button>'; });
  h += '</div><select class="aw-sel" data-awsrc><option value="">All sources (' + ldFmt(allN) + ')</option>';
  srcList.forEach(function (v) { h += '<option value="' + ldEsc(v) + '"' + (v === awSource ? ' selected' : '') + '>' + ldEsc(v) + ' (' + ldFmt(srcCount[v]) + ')</option>'; });
  h += '</select><div class="ld-seg dw-mode"><button class="' + (dwMode === 'table' ? 'on' : '') + '" data-dm="table">Depth table</button>' +
    '<button class="' + (dwMode === 'leads' ? 'on' : '') + '" data-dm="leads">Over-dialled leads <em>' + ldFmt(over.length) + '</em></button></div></div>';

  if (dwMode === 'table') {
    var stCols = cols.slice(); if (hasOther) stCols.push('__other'); if (hasNone) stCols.push('No stage');
    var sl = function (s) { return s === '__other' ? 'Other' : s === 'No stage' ? 'No stage (not in LA)' : s; };
    var th = function (k, lab, cls) { return '<th class="' + (cls || '') + (k === 'label' ? '' : ' num') + '" data-ds="' + ldEsc(k) + '">' + ldEsc(lab) + (dwSort.col === k ? (dwSort.dir < 0 ? ' ▾' : ' ▴') : '') + '</th>'; };
    h += '<div class="tbl-wrap"><table class="dw-tbl"><thead><tr class="grp"><th colspan="2"></th>' +
      '<th colspan="5" class="sep dw-g1">Calling depth (Best connectivity hour)</th>' +
      (stCols.length ? '<th colspan="' + stCols.length + '" class="sep dw-g2">Stage wise calling depth</th>' : '') + '<th colspan="2" class="sep"></th></tr><tr>' +
      th('label', glab) + th('depth', 'Dialing depth (Overall)') +
      th('best', 'Best hour', 'sep dw-g1') + th('bestConn', 'Best hour connect %', 'dw-g1') + th('bestDepth', 'Calling depth (best hr)', 'dw-g1') +
      th('allConn', 'Connect % (all hrs)', 'dw-g1') + th('bestShare', '% of dials in best hr', 'dw-g1');
    stCols.forEach(function (s, i) { h += th('st:' + s, sl(s), (i === 0 ? 'sep ' : '') + 'dw-g2 dw-stc'); });
    h += th('dialled', 'Leads dialled', 'sep') + th('dials', 'Total dials') + '</tr></thead><tbody>';
    var row = function (a, tot) {
      var key = tot ? '' : a.key;
      var r = '<tr class="dw-row' + (tot ? ' dw-tot' : '') + '" data-pk="' + ldEsc(key) + '" data-ps=""><td><b>' + ldEsc(tot ? 'All shown' : a.label) + '</b></td>' +
        '<td class="num"><b>' + (a.dialled ? a.depth.toFixed(2) : '–') + '</b></td>';
      if (a.best) r += '<td class="num sep">' + dwHr(a.best.hr) + '</td><td class="num">' + dwP(a.bestConn) + '</td>' +
        '<td class="num" title="' + (hasUniq ? '' : 'Needs a Unique Leads Dialed column in the hourly tab') + '">' + (a.bestDepth ? a.bestDepth.toFixed(2) : '–') + '</td>';
      else r += '<td class="num sep t-mute" colspan="3">' + (g === 'source' ? 'n/a for lead source' : hasHourly ? 'too few calls' : 'no hourly data') + '</td>';
      r += '<td class="num">' + dwP(a.allConn) + '</td><td class="num">' + dwP(a.bestShare) + '</td>';
      stCols.forEach(function (s, i) {
        var v = a.st[s];
        r += '<td class="num dw-cell' + (i === 0 ? ' sep' : '') + (v && v.dl && v.dl < DW_THIN ? ' dw-thin' : '') + '" data-ps="' + ldEsc(s) + '"' +
          (v && v.dl ? ' title="' + ldFmt(v.dl) + ' leads dialled · ' + ldFmt(v.dials) + ' dials' + (v.dl < DW_THIN ? ' · thin sample' : '') + '"' : '') + '>' + (v && v.dl ? dwF2(v.dials, v.dl) : '') + '</td>';
      });
      r += '<td class="num sep">' + ldFmt(a.dialled) + '</td><td class="num">' + ldFmt(a.dials) + '</td></tr>';
      return r;
    };
    h += row(T, true);
    groups.forEach(function (a) { h += row(a, false); });
    h += '</tbody></table></div>';
    dwCtx = { g: g, otherSet: otherSet, glab: glab };
  } else h += dwLeads(over);
  h += '</div><div class="ef-foot"><b>Dialing depth</b> = dials ÷ leads dialled at least once, for leads assigned in the date range (LA tab), counting every dial since the lead\'s <b>first</b> assignment, so calls under a previous owner still count (Data tab, one row per lead × day — duplicates collapsed). <b>Meetings</b> = leads with at least one meeting scheduled, not a sum of daily counts. ' +
    '<b>Best hour</b> = the hour with the highest connected ÷ dials for that row\'s LRMs (hourly tab, dated by <b>call</b> date; hours under 30 dials or 3% of the day ignored). ' +
    '<b>Calling depth (best hr)</b> = dials ÷ unique leads dialled in that hour' + (hasUniq ? '' : ' — <b>blank until the hourly tab carries a "Unique Leads Dialed" column</b>') + '. ' +
    '<b>Stage-wise</b> = dials ÷ dialled leads by the lead\'s <b>current</b> stage; the ' + DW_STAGE_COLS + ' largest stages get a column, the rest pool into Other. Grey = fewer than ' + DW_THIN + ' leads.</div>';
  wrap.innerHTML = h;

  var rerender = function () { var y = wrap.scrollTop; window.renderDepth(); var w2 = document.querySelector('#depthPanel .dw'); if (w2) w2.scrollTop = y; };
  wrap.querySelectorAll('[data-dg]').forEach(function (b) { b.addEventListener('click', function () { dwGrain = b.getAttribute('data-dg'); try { localStorage.setItem('lrmDepthWideGrain', dwGrain); } catch (e) {} rerender(); }); });
  wrap.querySelectorAll('[data-dm]').forEach(function (b) { b.addEventListener('click', function () { dwMode = b.getAttribute('data-dm'); rerender(); }); });
  wrap.querySelectorAll('[data-dl]').forEach(function (b) { b.addEventListener('click', function () { dwList = b.getAttribute('data-dl'); rerender(); }); });
  wrap.querySelectorAll('th[data-ds]').forEach(function (th) {
    th.addEventListener('click', function () { var k = th.getAttribute('data-ds'); dwSort.dir = dwSort.col === k ? -dwSort.dir : (k === 'label' ? 1 : -1); dwSort.col = k; rerender(); });
  });
  wrap.querySelectorAll('tr.dw-row').forEach(function (tr) {
    tr.addEventListener('click', function (ev) {
      var td = ev.target.closest('td'), s = td && td.hasAttribute('data-ps') ? td.getAttribute('data-ps') : '';
      dwOpen(tr.getAttribute('data-pk'), s);
    });
  });
  var sel = wrap.querySelector('[data-awsrc]');
  if (sel) sel.addEventListener('change', function () { awSource = sel.value; try { localStorage.setItem('lrmDialSource', awSource); } catch (e) {} rerender(); });
}

/* ── Lead pop-up (same shell + motion as Coverage / First Response Time) ── */
var dwPopState = null;
function dwOpen(key, stage) {
  dwPopState = { key: key, stage: stage, q: '' };
  var bk = document.getElementById('dwModal');
  if (!bk) {
    bk = document.createElement('div'); bk.id = 'dwModal'; bk.className = 'cv-modal-bk';
    bk.innerHTML = '<div class="cv-modal" role="dialog" aria-modal="true"><div class="cv-modal-hd"><h3></h3><span></span>' +
      '<input class="dw-q" type="search" placeholder="Search lead id, LRM, stage…"><button class="cv-modal-x" aria-label="Close">✕</button></div><div class="cv-modal-bd"></div></div>';
    document.body.appendChild(bk);
    var close = function () { bk.classList.add('closing'); setTimeout(function () { bk.classList.remove('open', 'closing'); }, 130); };
    bk.addEventListener('click', function (e) { if (e.target === bk) close(); });
    bk.querySelector('.cv-modal-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && bk.classList.contains('open')) close(); });
    bk.querySelector('.dw-q').addEventListener('input', function () { dwPopState.q = this.value; dwFill(); });
  }
  bk.querySelector('.dw-q').value = '';
  bk.classList.remove('closing'); bk.classList.add('open');
  dwFill();
}
function dwFill() {
  var bk = document.getElementById('dwModal'); if (!bk || !dwPopState || !dwCtx) return;
  var st = dwPopState, g = dwCtx.g, flt = window.ldFilter || function () { return true; };
  var title = (st.key ? dwLabel(g, st.key) : 'All shown') + (st.stage ? ' · ' + (st.stage === '__other' ? 'Other stages' : st.stage) : '');
  bk.querySelector('h3').textContent = title;
  var bd = bk.querySelector('.cv-modal-bd'), src = dwLeadRows();
  if (src === null) {
    bk.querySelector('.cv-modal-hd span').textContent = '';
    bd.innerHTML = '<div class="cv-empty">Loading lead list…</div>';
    if (typeof ensureLeads === 'function') ensureLeads('depth');
    setTimeout(function () { if (bk.classList.contains('open')) dwFill(); }, 1200);
    return;
  }
  var list = src.filter(function (r) {
    if (!flt(r)) return false;
    if (st.key && dwKeyOf(r, g) !== st.key) return false;
    if (st.stage) { var s = dwStage(r.stage); if (st.stage === '__other' ? !dwCtx.otherSet[s] : s !== st.stage) return false; }
    return true;
  });
  var n = list.length, dials = list.reduce(function (t, r) { return t + r.dials; }, 0);
  if (st.q) { var q = st.q.toLowerCase(); list = list.filter(function (r) { return (r.lead + ' ' + r.lrm + ' ' + (r.stage || '') + ' ' + (r.status || '') + ' ' + (r.cluster || '')).toLowerCase().indexOf(q) >= 0; }); }
  list.sort(function (a, b) { return b.dials - a.dials || a.conn - b.conn; });
  bk.querySelector('.cv-modal-hd span').textContent = ldFmt(n) + ' leads · ' + ldFmt(dials) + ' dials · ' + dwF2(dials, n) + ' depth';
  var CAP = 1000, h = '<div class="cv-drill-in"><table class="cv-mini"><thead><tr><th>Lead id</th><th>LRM</th><th>TL</th><th>City</th><th>Source</th><th>Stage</th><th>Status</th>' +
    '<th class="num">Dials</th><th class="num">Connects</th><th class="num">MS</th><th class="num">MD</th><th>Assigned</th></tr></thead><tbody>';
  list.slice(0, CAP).forEach(function (r) {
    h += '<tr><td>' + (r.link ? '<a href="' + ldEsc(r.link) + '" target="_blank" rel="noopener">' + ldEsc(r.lead) + '</a>' : ldEsc(r.lead)) + '</td>' +
      '<td>' + ldEsc(ldName(r.lrm)) + '</td><td>' + ldEsc(ldName(r.tl)) + '</td><td>' + ldEsc(r.cluster || '—') + '</td><td>' + ldEsc(r.source || '—') + '</td>' +
      '<td>' + ldEsc(dwStage(r.stage)) + '</td><td>' + ldEsc(r.status || '—') + '</td><td class="num"><b>' + r.dials + '</b></td>' +
      '<td class="num' + (r.conn ? '' : ' t-bad') + '">' + r.conn + '</td><td class="num">' + (r.ms || '–') + '</td><td class="num">' + (r.md || '–') + '</td><td>' + ldEsc(r.assigned || r.date || '') + '</td></tr>';
  });
  if (!list.length) h += '<tr><td colspan="12" class="ld-none">No leads match.</td></tr>';
  h += '</tbody></table>' + (list.length > CAP ? '<div class="cv-subnote">Showing the deepest ' + CAP + ' of ' + ldFmt(list.length) + ' — search to narrow.</div>' : '') + '</div>';
  bd.innerHTML = h;
}

function dwLeads(over) {
  var cnt = {}; over.forEach(function (r) { var k = ldAction(r).k; cnt[k] = (cnt[k] || 0) + 1; });
  if (!/^(all|park|confirm|closed|coach)$/.test(dwList)) dwList = 'all';
  var list = over.filter(function (r) { return dwList === 'all' || ldAction(r).k === dwList; }).sort(function (a, b) { return b.dials - a.dials || a.conn - b.conn; });
  var modes = [['all', 'All', over.length], ['park', 'Park 48 h', cnt.park || 0], ['confirm', 'Confirm by message', cnt.confirm || 0], ['closed', 'Closed, still dialled', cnt.closed || 0], ['coach', 'Connected, no MS', cnt.coach || 0]];
  var h = '<div class="ld-seg dw-sub">';
  modes.forEach(function (m) { h += '<button class="' + (dwList === m[0] ? 'on' : '') + '" data-dl="' + m[0] + '">' + m[1] + ' <em>' + ldFmt(m[2]) + '</em></button>'; });
  h += '</div><div class="tbl-wrap"><table class="dw-tbl"><thead><tr><th>Lead</th><th>LRM · TL</th><th>City</th><th class="num sep">Dials</th><th class="num">Connects</th><th class="num">MS</th><th class="sep">Stage · Status</th><th class="sep">Next step</th></tr></thead><tbody>';
  list.slice(0, 500).forEach(function (r) {
    var a = ldAction(r), lead = r.link ? '<a href="' + ldEsc(r.link) + '" target="_blank" rel="noopener">' + ldEsc(r.lead) + '</a>' : ldEsc(r.lead);
    h += '<tr><td><b>' + lead + '</b><div class="ld-mini">' + ldEsc(r.source || '—') + '</div></td><td>' + ldEsc(ldName(r.lrm)) + '<div class="ld-mini">TL ' + ldEsc(ldName(r.tl)) + '</div></td>' +
      '<td>' + ldEsc(r.cluster || '—') + '</td><td class="num sep"><b>' + r.dials + '</b></td><td class="num' + (r.conn ? '' : ' t-bad') + '">' + r.conn + '</td><td class="num">' + (r.ms || '–') + '</td>' +
      '<td class="sep">' + ldEsc(r.stage || 'No stage') + '<div class="ld-mini">' + ldEsc(r.status || '—') + '</div></td><td class="sep"><span class="ld-pill ' + a.c + '">' + ldEsc(a.t) + '</span></td></tr>';
  });
  if (!list.length) h += '<tr><td colspan="8" class="ld-none">No leads in this list.</td></tr>';
  return h + '</tbody></table></div>' + (list.length > 500 ? '<div class="ef-foot">Showing the deepest 500 of ' + ldFmt(list.length) + '.</div>' : '');
}

(function () {
  var css = '.dw{display:flex;flex-direction:column;gap:12px}' +
    '.dw-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}' +
    '.dw-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin-bottom:12px}.dw-bar .ld-seg{margin-left:0}.dw-bar .dw-mode{margin-left:auto}' +
    '.dw-sub{margin:0 0 10px}' +
    '.dw-tbl{font-size:12px}.dw-tbl th[data-ds]{cursor:pointer;user-select:none}' +
    '.dw-tbl td{white-space:nowrap}.dw-tbl th.dw-stc{white-space:normal;min-width:78px;max-width:110px;line-height:1.25}' +
    '.dw-tbl tr.grp th{text-align:center}' +
    '.dw-tbl th.dw-g1{background:#eaf4ec}.dw-tbl tr.grp th.dw-g2{box-shadow:inset 0 -2px 0 #3e7fc4}' +
    'tr.dw-row{cursor:pointer}tr.dw-row:hover td{background:#f4f7fd}td.dw-cell:hover{box-shadow:inset 0 0 0 1px #3e7fc4}' +
    'td.dw-thin{color:#a3aac0}' +
    'tr.dw-tot td{background:#f4f6fb;font-weight:700;border-bottom:1px solid #cfd7ea}' +
    '.dw .ld-stats{flex-wrap:nowrap;overflow-x:auto}.dw .ld-stat{flex:1 0 120px}' +
    '.dw-q{font:inherit;font-size:12px;border:1px solid #d6dbe8;border-radius:6px;padding:5px 8px;min-width:220px;margin-left:auto}' +
    '.dw-q+.cv-modal-x{margin-left:6px}#dwModal .cv-mini a{color:#2348a8;text-decoration:none;font-weight:700}#dwModal .cv-mini a:hover{text-decoration:underline}';
  var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  window.renderDepth = function () {
    var panel = document.getElementById('depthPanel');
    if (panel) dwRender(panel);
  };
})();
