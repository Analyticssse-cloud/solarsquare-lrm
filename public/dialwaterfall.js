/* ═════════════════════════════════════════════════════════════════
   Dial depth ladder. Row 0 = assigned leads never dialled; row k = leads
   dialled AT LEAST k times, with connectivity, MS, MD, %LD-MS, %LD-MD.
   Live rows are weighted groups from api/_leaddepth.js (LA x Data join);
   ldW / ldDepth / ldReached (leaddepth.js) read both those and mock rows.
   ═════════════════════════════════════════════════════════════════ */

var AW_MAX = 10; // attempts 1…9 shown individually, 10+ pooled
var AW_LEVELS = [
  { k: 'floor', lab: 'Floor' }, { k: 'ados', lab: 'ADOS' }, { k: 'zsm', lab: 'ZSM' }, { k: 'tl', lab: 'TL' },
  { k: 'lrm', lab: 'LRM' }, { k: 'cluster', lab: 'Cluster' }, { k: 'source', lab: 'Lead source' }
];
var awLevel = 'floor', awKey = '';
try { var _aw = JSON.parse(localStorage.getItem('lrmDialWaterfall') || 'null'); if (_aw) { awLevel = _aw.l || 'floor'; awKey = _aw.k || ''; } } catch (e) {}

function awHash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
function awEnsureAttempts(rows) {
  rows.forEach(function (r) {
    if (r.fca === undefined) {
      if (r.conn > 0) { var u = awHash(r.lead + 'c'); r.fca = Math.min(r.dials, 1 + Math.floor(r.dials * u * u)); r.derived = true; }
      else r.fca = 0;
    }
    if (r.msa === undefined) {
      if (r.ms > 0 && !r.fca) { r.msa = r.dials; r.noConnMs = true; }
      else if (r.ms > 0 && r.fca) { var v = awHash(r.lead + 'm'); r.msa = Math.min(r.dials, r.fca + Math.floor((r.dials - r.fca + 1) * v * v)); r.derived = true; }
      else r.msa = 0;
    }
  });
  return rows;
}
function awLab(k) { return k >= AW_MAX ? AW_MAX + '+' : String(k); }
function awLevelOf(r, l) { return l === 'floor' ? 'Floor' : (r[l] || '—'); }
function awNice(l, v) { return (l === 'cluster' || l === 'source' || l === 'floor') ? v : ldName(v); }

/* Scope shared with the lead-level sections below, so the whole tab reads
   one population. */
/* The tab obeys the MAIN filter bar (ADOS / ZSM / City / TL / LRM / search).
   Lead rows carry emails, the bar carries display names, so each lead is
   resolved through its LRM's roster row (Agent Id → ADOS/ZSM/TL Name, City);
   an LRM missing from the roster falls back to the names derived from the
   sheet's own emails. Lead source is the one filter the bar lacks, so it
   stays on the tab. */
var awSource = '';
try { awSource = localStorage.getItem('lrmDialSource') || ''; } catch (e) {}
var awRoster = null, awRosterSrc = null;
function awRosterMap() {
  var src = (window.D && (D.agentRows || D.rosterRows)) || null;
  if (awRoster && awRosterSrc === src) return awRoster;
  awRoster = {}; awRosterSrc = src;
  [].concat((window.D && D.rosterRows) || [], (window.D && D.agentRows) || []).forEach(function (a) {
    var e = String(a['Agent Id'] || '').trim().toLowerCase().replace('@homes.solarsquare.in', '@solarsquare.in');
    if (e && !awRoster[e]) awRoster[e] = { ados: String(a['ADOS Name'] || ''), zsm: String(a['ZSM Name'] || ''),
      tl: String(a['TL Name'] || ''), city: String(a['City'] || ''), name: String(a['LRM Name'] || ''), id: String(a['Agent Id'] || '') };
  });
  return awRoster;
}
function awInfo(r) {
  var e = String(r.lrm || '').toLowerCase();
  return awRosterMap()[e] || { ados: ldName(r.ados), zsm: ldName(r.zsm), tl: ldName(r.tl), city: r.cluster || '', name: ldName(r.lrm), id: r.lrm };
}
function awIn(list, v) {
  if (!list || !list.length) return true;
  v = String(v || '').toLowerCase();
  for (var i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === v) return true;
  return false;
}
window.ldFilter = function (r) {
  if (awSource && (r.source || '—') !== awSource) return false;
  if (typeof F === 'undefined') return true;
  var a = awInfo(r);
  if (!awIn(F.ados, a.ados) || !awIn(F.zsms, a.zsm) || !awIn(F.tls, a.tl)) return false;
  if (F.cities && F.cities.length && !awIn(F.cities, a.city) && !awIn(F.cities, r.cluster)) return false;
  if (F.agents && F.agents.length && !awIn(F.agents, a.id) && !awIn(F.agents, r.lrm)) return false;
  if (F.q) {
    var hay = (a.name + ' ' + r.lrm + ' ' + a.city + ' ' + a.tl + ' ' + r.lead).toLowerCase();
    var ok = String(F.q).toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) >= 0; });
    if (!ok) return false;
  }
  return true;
};

function awCompute(rows) {
  var N = rows.length, steps = [], cumC = 0, cumM = 0, totMs = 0;
  rows.forEach(function (r) { totMs += r.ms ? 1 : 0; });
  for (var k = 1; k <= AW_MAX; k++) {
    var last = k === AW_MAX;
    var inPlay = 0, dialsHere = 0, newC = 0, newM = 0;
    rows.forEach(function (r) {
      if (r.dials >= k) {
        dialsHere += last ? r.dials - (AW_MAX - 1) : 1;
        if (!r.fca || r.fca >= k) inPlay++;
      }
      if (last ? r.fca >= k : r.fca === k) newC++;
      if (r.ms && (last ? r.msa >= k : r.msa === k)) newM++;
    });
    var from = N ? cumC / N : 0; cumC += newC; cumM += newM;
    steps.push({ k: k, inPlay: inPlay, dials: dialsHere, newC: newC, newM: newM,
      from: from, to: N ? cumC / N : 0, cumM: cumM, cumMPct: totMs ? cumM / totMs : 0,
      perC: newC ? dialsHere / newC : Infinity, perM: newM ? dialsHere / newM : Infinity,
      hit: inPlay ? newC / inPlay : 0 });
  }
  return { N: N, steps: steps, totMs: totMs, reached: cumC };
}

/* Untouched leads (0 dials) are not in the call-depth sheet — it only lists
   leads that were dialled. The live feed needs the ASSIGNED lead list per LRM
   for the day; preview synthesises ~8% untouched per LRM from the real chains. */
function awEnsureUntouched(all) {
  if (!window.MOCK || all.__untouched) return all;
  var chains = {}, cnt = {};
  all.forEach(function (r) { chains[r.lrm] = chains[r.lrm] || r; cnt[r.lrm] = (cnt[r.lrm] || 0) + 1; });
  var n = 0;
  Object.keys(chains).forEach(function (lrm) {
    var c = chains[lrm], k = Math.round(cnt[lrm] * (0.03 + awHash(lrm) * 0.12));
    for (var i = 0; i < k; i++) all.push({ lead: 'UNTOUCHED' + (++n), lrm: c.lrm, cluster: c.cluster, dials: 0, conn: 0, ms: 0, md: 0,
      date: c.date, link: '', stage: 'Assigned', status: 'Open', source: c.source, tl: c.tl, zsm: c.zsm, ados: c.ados, mock: true, fca: 0, msa: 0 });
  });
  all.__untouched = true;
  return all;
}

var AW_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function renderDialWaterfall(panel) {
  var all = awEnsureUntouched(ldRows());
  panel.innerHTML = '';
  var wrap = document.createElement('div'); wrap.className = 'dp-wrap'; panel.appendChild(wrap);
  if (!all.length) { wrap.innerHTML = '<div class="dp-empty"><b>No call-depth feed yet.</b></div>'; return; }

  var srcCount = {};
  var allN = 0;
  all.forEach(function (r) { var v = r.source || '—'; srcCount[v] = (srcCount[v] || 0) + ldW(r); allN += ldW(r); });
  var srcList = Object.keys(srcCount).sort(function (a, b) { return srcCount[b] - srcCount[a]; });
  if (awSource && !srcCount[awSource]) awSource = '';
  var rows = all.filter(window.ldFilter);
  var scopeTxt = (typeof filtersActive === 'function' && filtersActive() && typeof F !== 'undefined')
    ? [F.ados.length ? 'ADOS: ' + F.ados.join(', ') : '', F.zsms.length ? 'ZSM: ' + F.zsms.join(', ') : '', F.cities.length ? 'City: ' + F.cities.join(', ') : '',
       F.tls.length ? 'TL: ' + F.tls.join(', ') : '', F.agents.length ? F.agents.length + ' LRM' + (F.agents.length > 1 ? 's' : '') : '', F.q ? '“' + F.q + '”' : '']
      .filter(Boolean).join(' · ') : 'Whole floor';
  var N = rows.reduce(function (t, r) { return t + ldW(r); }, 0);
  var mock = rows.some(function (r) { return r.mock; });
  if (typeof activeTab !== 'undefined' && activeTab === 'depth' && typeof setCount === 'function') setCount(ldFmt(N) + ' leads');
  var pct = function (a, b) { return b ? (Math.round(1000 * a / b) / 10) + '%' : '–'; };

  var h = '<div class="aw">';
  h += '<div class="ld-head"><div><div class="dp-title">Lead coverage by dial depth · ' + ldEsc((window.D && D.fromDate) ? (D.fromDate === D.toDate ? D.fromDate : D.fromDate + ' → ' + D.toDate) : (all[0].date || '')) + '</div>' +
    '<div class="ld-sub">Every assigned lead, starting with the ones <b>nobody has dialled</b>. Each next row is the leads dialled <b>at least</b> that many times, ' +
    'with the connectivity and meetings those leads produced.</div></div>' +
    (mock ? '<span class="ld-mock">Preview · sample data; live reads the LA + Data tabs</span>' : '') + '</div>';

  h += '<div class="aw-scope"><div class="aw-scope-l"><span>Showing</span><b>' + ldEsc(scopeTxt) + '</b>' +
    '<em>ADOS, ZSM, City, TL and LRM come from the filter bar above</em></div>' +
    '<label class="aw-src"><span>Lead source</span><select class="aw-sel" data-awsrc><option value="">All sources (' + ldFmt(allN) + ')</option>';
  srcList.forEach(function (v) { h += '<option value="' + ldEsc(v) + '"' + (v === awSource ? ' selected' : '') + '>' + ldEsc(v) + ' (' + ldFmt(srcCount[v]) + ')</option>'; });
  h += '</select></label></div>';

  h += '<div class="ld-card"><div class="ld-card-hd"><b>Leads by dial depth</b><span>' + ldFmt(N) + ' assigned leads · bar = share of assigned leads</span></div>' +
    '<div class="ld-bands"><div class="ld-band aw-hd"><div>Dial depth</div><div>Share of assigned</div><div>Connectivity</div><div>MS</div><div>MD</div><div>%LD-MS</div><div>%LD-MD</div></div>';
  AW_STEPS.forEach(function (k) {
    var leads = 0, exact = 0, dials = 0, reached = 0, ms = 0, md = 0;
    rows.forEach(function (r) {
      var d = ldDepth(r), w = ldW(r);
      if (k > 0 && d === k) exact += w;
      if (k === 0 ? d !== 0 : d < k) return;
      leads += w; dials += r.dials; ms += r.ms; md += r.md; if (ldReached(r)) reached += w;
    });
    var lab = k === 0 ? 'Not dialled' : 'Dialled ' + k + '+ time' + (k > 1 ? 's' : '');
    var sub = ldFmt(leads) + ' leads' + (k > 0 && k < 10 ? ' · ' + ldFmt(exact) + ' stopped at ' + k : '') + (k > 0 && ms ? ' · ' + Math.round(dials / ms) + ' dials / MS' : '');
    if (k === 0) sub = leads ? '<span class="ld-pill bad">' + ldFmt(leads) + ' untouched — dial today</span>' : '<span class="ld-pill ok">No lead left untouched</span>';
    h += '<div class="ld-band' + (k === 0 ? ' aw-zero' : '') + '"><div class="ld-band-l"><b>' + lab + '</b><span>' + sub + '</span></div>' +
      '<div class="aw-share"><div class="ld-band-bar"><i class="' + (k === 0 ? 'z' : '') + '" style="width:' + (N ? Math.max(0.5, 100 * leads / N) : 0) + '%"></i></div><span>' + pct(leads, N) + '</span></div>' +
      '<div class="ld-band-m"><b>' + (k === 0 ? '–' : pct(reached, leads)) + '</b><span>' + (k === 0 ? '' : ldFmt(reached) + ' leads') + '</span></div>' +
      '<div class="ld-band-m"><b>' + (k === 0 ? '–' : ldFmt(ms)) + '</b></div>' +
      '<div class="ld-band-m"><b>' + (k === 0 ? '–' : ldFmt(md)) + '</b></div>' +
      '<div class="ld-band-m"><b>' + (k === 0 ? '–' : pct(ms, leads)) + '</b></div>' +
      '<div class="ld-band-m"><b>' + (k === 0 ? '–' : pct(md, leads)) + '</b></div></div>';
  });
  h += '</div><div class="ef-foot">Leads = assigned in the selected date range (LA tab); dials, connects, MS and MD = everything logged on them since assignment (Data tab). ' +
    'Rows are cumulative: <b>Dialled 3+ times</b> includes every lead dialled 3, 4, 5 … times. <b>Connectivity</b> = leads with at least one connected call ÷ leads in the row. ' +
    '<b>%LD-MS</b> / <b>%LD-MD</b> = meetings scheduled / done ÷ leads in the row.</div></div>';
  h += '</div>';
  wrap.innerHTML = h;

  var sel = wrap.querySelector('[data-awsrc]');
  if (sel) sel.addEventListener('change', function () { awSource = sel.value; try { localStorage.setItem('lrmDialSource', awSource); } catch (e) {} renderDepth(); });
}

(function () {
  var css = '.aw{display:flex;flex-direction:column;gap:16px}' +
    '.aw-scope{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;background:#fff;border:1px solid #e3e8f3;border-radius:8px;padding:10px 14px}' +
    '.aw-sel{font:inherit;font-size:12.5px;font-weight:600;color:#18233f;border:1px solid #cfd7ea;border-radius:6px;padding:6px 8px;min-width:220px;background:#fff}' +
    '.aw-sel:focus{outline:2px solid #2348a8;outline-offset:1px}' +
    '.aw-scope-l{display:flex;flex-direction:column;gap:2px;flex:1 1 320px;min-width:0}.aw-scope-l span{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#6a7494}.aw-scope-l b{font-size:13px;color:#18233f}.aw-scope-l em{font-style:normal;font-size:11px;color:#6a7494}' +
    '.aw-src{display:flex;flex-direction:column;gap:3px}.aw-src span{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#6a7494}' +
    '.aw-n{flex:1 0 100%;font-size:11.5px;color:#6a7494;padding-top:8px;border-top:1px solid #eef1f7}' +
    '.aw-ros{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}@media (max-width:1100px){.aw-ros{grid-template-columns:repeat(3,minmax(0,1fr))}}@media (max-width:640px){.aw-ros{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '.aw-ro{background:#fff;border:1px solid #e3e8f3;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:3px}' +
    '.aw-ro b{font-size:21px;font-weight:800;color:#18233f;letter-spacing:-.4px;font-variant-numeric:tabular-nums}' +
    '.aw-ro.warn b{color:#a86a00}.aw-ro-l{font-size:12px;font-weight:700;color:#18233f}.aw-ro-s{font-size:11px;color:#6a7494;line-height:1.4}' +
    '.aw-chart{display:grid;grid-template-columns:38px 1fr;gap:6px}' +
    '.aw-yaxis{position:relative;height:240px;margin-top:0}' +
    '.aw-yaxis span{position:absolute;right:4px;transform:translateY(50%);font-size:10px;color:#a3aac0;font-variant-numeric:tabular-nums}' +
    '.aw-cols{display:grid;grid-template-columns:repeat(' + AW_MAX + ',minmax(0,1fr));gap:8px}' +
    '.aw-col{display:flex;flex-direction:column;gap:6px;min-width:0}' +
    '.aw-plot{position:relative;height:240px;border-bottom:1px solid #cfd7ea;background:linear-gradient(#f1f3f8 1px,transparent 1px) 0 0/100% 25%}' +
    '.aw-bar{position:absolute;left:12%;right:12%;background:#3e7fc4;border-radius:3px}' +
    '.aw-bar.late{background:#e0a33a}' +
    '.aw-guide{position:absolute;left:-4px;right:-4px;border-top:1px dashed #b7c3dc}' +
    '.aw-plot em{position:absolute;left:0;right:0;text-align:center;font-style:normal;font-size:11px;font-weight:800;color:#18233f;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.aw-x{text-align:center;display:flex;flex-direction:column;gap:1px}' +
    '.aw-x b{font-size:12.5px;color:#18233f}.aw-x span{font-size:10.5px;color:#6a7494;font-variant-numeric:tabular-nums}' +
    '.aw-x .aw-ms{color:#1f7a45;font-weight:700}' +
    '.aw-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:11px;color:#6a7494}' +
    '.aw-legend s{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}.aw-legend s.a{background:#3e7fc4}.aw-legend s.b{background:#e0a33a}' +
    'tr.aw-late td{background:#fffaf0}' +
    '.aw-hd{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#6a7494;padding:0 0 6px !important}.aw-hd>div:nth-child(n+3){text-align:right}' +
    '.aw-share{display:flex;align-items:center;gap:8px}.aw-share .ld-band-bar{flex:1}.aw-share span{font-size:11.5px;font-weight:700;color:#18233f;font-variant-numeric:tabular-nums;min-width:44px;text-align:right}' +
    '@media (max-width:1100px){.aw .ld-band{grid-template-columns:minmax(140px,1.5fr) minmax(90px,1fr) repeat(5,minmax(52px,.7fr));gap:10px}.aw .aw-share .ld-band-bar{display:block}}' +
    '@media (max-width:640px){.aw .ld-band{grid-template-columns:minmax(110px,1.4fr) repeat(5,minmax(44px,.7fr))}.aw .aw-share{display:none}}' +
    '.aw-zero{background:#fdf3f2;margin:0 -16px;padding-left:16px;padding-right:16px}.ld-band-bar i.z{background:#c0453a}' +
    '.ef-foot{font-size:11px;color:#6a7494;margin-top:10px;line-height:1.5;max-width:900px}' +
    '@media (max-width:760px){.aw-cols{gap:3px}.aw-plot em{font-size:9px}.aw-x span{font-size:9px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // Depth index retired (user, 24 Sep). Tab = dial waterfall + lead-level sections.
  window.renderDepth = function () {
    var panel = document.getElementById('depthPanel');
    if (!panel) return;
    renderDialWaterfall(panel);
    if (typeof renderLeadDepth === 'function') renderLeadDepth(panel);
  };
})();
