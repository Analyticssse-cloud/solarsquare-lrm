/* ═══════════════════════════════════════════════════════════════════════════
   DID Manager — which DIDs to replace today, and with what.
   Rule (set in DidManager.gs, echoed in each did_health_14d row's "Rule"):
     last 14 days  ≥1,000 calls  AND  ≥500 fresh dials  AND  fresh connect % < 40
     fresh = lead assigned today (T+0); connect = answered ÷ dials.
   Ozonetel has no API for this, so the tool PLANS and ops EXECUTES: the swap
   list below is done by hand in the Ozonetel admin panel, then marked Done in
   the "DID Swap List" sheet tab. A retired DID is retired permanently.
   Reads D.didHealth, D.didSwaps, D.didPool (api/dashboard.js), D.didMgrDiag.
   Depends on globals: D, esc, fmt, activeTab.
   ═══════════════════════════════════════════════════════════════════════════ */
var dmShow = 'attention';
try { var _ds = localStorage.getItem('lrmDmShow'); if (_ds === 'all' || _ds === 'attention') dmShow = _ds; } catch (e) {}

(function injectDmCss() {
  var css = '' +
  '.dm-wrap{padding:2px 0 18px;flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px}' +
  '.dm-wrap>*{flex:0 0 auto}.dm-wrap .tbl-wrap{overflow-x:auto;overflow-y:hidden}' +
  '.dm-head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap}' +
  '.dm-title{font-size:15px;font-weight:800;color:var(--ink,#18233f);letter-spacing:-.2px}' +
  '.dm-sub{font-size:11.5px;color:var(--muted,#6a7494);max-width:720px;line-height:1.5;margin-top:3px}' +
  '.dm-rule{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}' +
  '.dm-rule span{border:1px solid var(--border,#e3e8f3);background:#fff;font:700 11px/1 inherit;padding:6px 10px;border-radius:20px;color:var(--ink,#18233f);white-space:nowrap}' +
  '.dm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--border,#e3e8f3);border:1px solid var(--border,#e3e8f3)}' +
  '.dm-kpi{background:#fff;padding:11px 13px}' +
  '.dm-kpi-v{font-size:24px;font-weight:800;letter-spacing:-.7px;color:var(--ink,#18233f);line-height:1.1}' +
  '.dm-kpi-l{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#6a7494);margin-top:3px}' +
  '.dm-kpi-n{font-size:10.5px;color:var(--muted,#6a7494);margin-top:2px}' +
  '.dm-kpi.bad .dm-kpi-v{color:#b3261e}.dm-kpi.warn .dm-kpi-v{color:#9a6200}' +
  '.dm-card{border:1px solid var(--border,#e3e8f3);background:#fff}' +
  '.dm-card-hd{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 13px;border-bottom:1px solid var(--border,#e3e8f3)}' +
  '.dm-card-hd b{font-size:12.5px;color:var(--ink,#18233f)}.dm-card-hd span{font-size:11px;color:var(--muted,#6a7494)}' +
  '.dm-card-hd .dm-act{margin-left:auto;display:flex;gap:6px}' +
  '.dm-btn{border:1px solid #18233f;background:#18233f;color:#fff;font:700 11px/1 inherit;padding:7px 11px;border-radius:4px;cursor:pointer}' +
  '.dm-btn:hover{background:#2b3a63}.dm-btn.ghost{background:#fff;color:#18233f}.dm-btn.ghost:hover{background:#f3f5fa}' +
  '.dm-chip{border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--ink,#18233f);font:700 11px/1 inherit;padding:6px 10px;border-radius:20px;cursor:pointer}' +
  '.dm-chip.on{background:#18233f;border-color:#18233f;color:#fff}' +
  'table.dm-tbl{border-collapse:collapse;width:max-content;min-width:100%;font-size:12px}' +
  'table.dm-tbl th{font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#18233f;background:#f5f7fb;padding:7px 10px;text-align:left;border-bottom:1px solid #e3e8f3;white-space:nowrap}' +
  'table.dm-tbl td{padding:7px 10px;border-bottom:1px solid #eef1f7;white-space:nowrap}' +
  'table.dm-tbl .num{text-align:right;font-variant-numeric:tabular-nums}' +
  'table.dm-tbl td.did{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}' +
  'td.dm-arrow{color:var(--muted,#6a7494);padding:7px 2px}' +
  '.dm-v{display:inline-block;font:800 10px/1 inherit;letter-spacing:.3px;text-transform:uppercase;padding:4px 7px;border-radius:3px;border:1px solid}' +
  '.dm-v.replace{color:#b3261e;border-color:#f0b8b3;background:#fdf1f0}' +
  '.dm-v.live{color:#fff;border-color:#b3261e;background:#b3261e}' +
  '.dm-v.keep{color:#2d6a3e;border-color:#bfe0c8;background:#f1f9f3}' +
  '.dm-v.thin{color:#6a7494;border-color:#e3e8f3;background:#f7f8fb}' +
  '.dm-v.pend{color:#18233f;border-color:#c9d3ea;background:#eef2fa}' +
  '.dm-v.nospare{color:#9a6200;border-color:#f0c674;background:#fff7e6}' +
  'td.dm-low{color:#b3261e;font-weight:800}' +
  '.dm-bar{position:relative;width:90px;height:6px;background:#eef1f7;border-radius:2px;display:inline-block;vertical-align:middle;margin-left:8px}' +
  '.dm-bar i{position:absolute;left:0;top:0;bottom:0;background:#7f9bd1;border-radius:2px}.dm-bar i.low{background:#d9776f}' +
  '.dm-bar b{position:absolute;top:-3px;bottom:-3px;width:2px;background:#18233f}' +
  '.dm-note{border:1px solid #f0c674;background:#fff7e6;color:#7a5200;padding:10px 13px;font-size:11.5px;line-height:1.55}' +
  '.dm-note.bad{border-color:#f0b8b3;background:#fdf1f0;color:#8a1f18}' +
  '.dm-note code{background:rgba(0,0,0,.05);padding:0 4px;border-radius:3px}' +
  '.dm-empty{padding:16px 13px;font-size:12px;color:var(--muted,#6a7494)}' +
  '.dm-foot{font-size:10.5px;color:var(--muted,#6a7494);line-height:1.55;max-width:800px}';
  var s = document.createElement('style'); s.id = 'dm-css'; s.textContent = css; document.head.appendChild(s);
})();

function dmN(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : null; }
function dmKey(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function dmF(v) { return v == null ? '—' : (typeof fmt === 'function' ? fmt(v) : String(v)); }
function dmPct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }
function dmDays(iso) {
  var d = new Date(String(iso || '').slice(0, 10) + 'T00:00:00'); if (isNaN(d)) return null;
  var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t - d) / 864e5);
}
function dmRule(rows) {
  var txt = (rows[0] && rows[0]['Rule']) || '';
  var m = txt.match(/(\d+)\s*calls.*?(\d+)\s*fresh.*?<\s*([\d.]+)/i);
  return m ? { calls: +m[1], fresh: +m[2], pct: +m[3], txt: txt } : { calls: 1000, fresh: 500, pct: 40, txt: '' };
}
function dmVerdictCls(v) {
  v = String(v || '');
  if (/still/i.test(v)) return 'live';
  if (/^replace/i.test(v)) return 'replace';
  if (/^keep/i.test(v)) return 'keep';
  return 'thin';
}

function renderDidManager() {
  var panel = document.getElementById('didmgrPanel');
  if (!panel || !window.D) return;
  var H = D.didHealth || [], S = D.didSwaps || [], P = D.didPool || [], dg = D.didMgrDiag || {};
  var R = dmRule(H);

  var pending = S.filter(function (s) { return s['Status'] === 'Pending'; });
  var noSpare = S.filter(function (s) { return s['Status'] === 'No spare'; });
  var open = pending.concat(noSpare).sort(function (a, b) { return String(a['Flagged On']).localeCompare(String(b['Flagged On'])); });
  var cnt = { Spare: 0, Reserved: 0, Active: 0, Retired: 0 };
  P.forEach(function (p) { if (cnt[p['Status']] != null) cnt[p['Status']]++; });
  var done7 = S.filter(function (s) { var d = dmDays(s['Done At']); return s['Status'] === 'Done' && d != null && d <= 7; }).length;
  var flagged7 = S.filter(function (s) { var d = dmDays(s['Flagged On']); return d != null && d <= 7; }).length;
  var stillLive = H.filter(function (r) { return /still/i.test(r['Verdict'] || ''); });
  var retiredRows = H.filter(function (r) { return /^retired/i.test(r['Verdict'] || ''); });
  var eligible = H.filter(function (r) { return (dmN(r['Calls 14d']) || 0) >= R.calls && (dmN(r['Fresh Dials 14d']) || 0) >= R.fresh; });
  var replaceNow = H.filter(function (r) { return /^replace/i.test(r['Verdict'] || ''); });
  var win = H[0] ? (H[0]['Window Start'] + ' → ' + H[0]['Window End']) : '';
  var perDay = flagged7 / 7, cover = perDay > 0 ? Math.floor(cnt.Spare / perDay) : null;

  var h = '<div class="dm-wrap">';
  h += '<div class="dm-head"><div><div class="dm-title">DID Manager</div>' +
    '<div class="dm-sub">Every morning at 06:00 the tool checks each DID over the last 14 days and lists the ones to replace, each paired with a spare from the pool. ' +
    '<b>Swaps are made by hand in the Ozonetel admin panel</b>, then marked <b>Done</b> in the <code>DID Swap List</code> sheet tab. A retired DID never comes back.' +
    (win ? ' Window: <b>' + esc(win) + '</b>.' : '') + '</div></div>' +
    '<div class="dm-rule"><span>≥ ' + dmF(R.calls) + ' calls</span><span>≥ ' + dmF(R.fresh) + ' fresh dials</span><span>Fresh connect &lt; ' + R.pct + '%</span></div></div>';

  // Wiring notes — name the step that is missing, never draw zeros.
  var miss = [];
  if (!H.length) miss.push('<b>No DID health data.</b> Save <code>sql/did-manager-fresh-14d-v1.sql</code> as a Metabase card, put its id in <code>DidManager.gs → DIDM_QUESTION_ID</code>, and run <code>runDidManager()</code>.' + ((dg.health || {}).error ? ' (' + esc(dg.health.error) + ')' : ''));
  if (!P.length) miss.push('<b>The spare pool is empty.</b> Run <code>setupDidManagerTabs()</code>, then paste spare DIDs into the <code>DID Pool</code> tab with Status = <code>Spare</code>.');
  if (miss.length) h += '<div class="dm-note">' + miss.join('<br>') + '</div>';
  if (stillLive.length) h += '<div class="dm-note bad"><b>' + stillLive.length + ' retired DID' + (stillLive.length === 1 ? ' is' : 's are') + ' still dialling:</b> ' +
    stillLive.map(function (r) { return '<code>' + esc(r['DID']) + '</code>'; }).join(' ') + '. The swap was marked Done but not made in Ozonetel.</div>';
  if (noSpare.length) h += '<div class="dm-note"><b>' + noSpare.length + ' DID' + (noSpare.length === 1 ? '' : 's') + ' flagged with no spare to replace ' + (noSpare.length === 1 ? 'it' : 'them') + '.</b> Add spares to the <code>DID Pool</code> tab; the next run assigns them oldest-flag first.</div>';
  if (eligible.length >= 5 && replaceNow.length / eligible.length > 0.5) h += '<div class="dm-note"><b>The rule is flagging ' + replaceNow.length + ' of ' + eligible.length + ' DIDs that have enough volume to judge.</b> ' +
    'Floor-wide Manual connectivity has sat around 31% with no day above ~35%, and new numbers start near 41% then fall with use. So a 40% bar retires most numbers once they pass 1,000 calls, and the pool will need about <b>' + Math.max(1, Math.round(perDay || replaceNow.length / 14)) + ' new DIDs a day</b> to keep up.</div>';

  h += '<div class="dm-kpis">' +
    '<div class="dm-kpi' + (open.length ? ' bad' : '') + '"><div class="dm-kpi-v">' + open.length + '</div><div class="dm-kpi-l">To swap in Ozonetel</div><div class="dm-kpi-n">' + pending.length + ' with a spare · ' + noSpare.length + ' without</div></div>' +
    '<div class="dm-kpi' + (cover != null && cover < 7 ? ' warn' : '') + '"><div class="dm-kpi-v">' + cnt.Spare + '</div><div class="dm-kpi-l">Spares left</div><div class="dm-kpi-n">' + (cover != null ? '≈ ' + cover + ' day' + (cover === 1 ? '' : 's') + ' at this week’s pace' : 'no flags this week') + '</div></div>' +
    '<div class="dm-kpi"><div class="dm-kpi-v">' + H.filter(function (r) { return !/^retired/i.test(r['Verdict'] || ''); }).length + '</div><div class="dm-kpi-l">DIDs dialling</div><div class="dm-kpi-n">' + eligible.length + ' have enough volume to judge</div></div>' +
    '<div class="dm-kpi"><div class="dm-kpi-v">' + done7 + '</div><div class="dm-kpi-l">Swapped · last 7 days</div><div class="dm-kpi-n">' + flagged7 + ' flagged in the same 7 days</div></div>' +
    '<div class="dm-kpi"><div class="dm-kpi-v">' + cnt.Retired + '</div><div class="dm-kpi-l">Retired for good</div><div class="dm-kpi-n">' + cnt.Active + ' active · ' + cnt.Reserved + ' reserved</div></div>' +
    '</div>';

  // 1 — Swap list
  h += '<div class="dm-card"><div class="dm-card-hd"><b>Swap list</b><span>do these in the Ozonetel admin panel, then set Status = Done in the sheet</span>' +
    (open.length ? '<div class="dm-act"><button class="dm-btn" data-dmcopy="1">Copy swap list</button></div>' : '') + '</div>';
  if (!open.length) h += '<div class="dm-empty">' + (H.length ? 'Nothing to swap. Every DID that crossed the volume bars is at or above ' + R.pct + '% on fresh leads.' : 'Waiting for the first run.') + '</div>';
  else {
    h += '<div class="tbl-wrap"><table class="dm-tbl"><thead><tr><th>Retire</th><th></th><th>Replace with</th><th class="num">Calls 14d</th><th class="num">Fresh dials</th><th class="num">Fresh connect %</th><th>Flagged</th><th class="num">Waiting</th><th>Status</th></tr></thead><tbody>';
    open.forEach(function (s) {
      var w = dmDays(s['Flagged On']), pc = dmN(s['Fresh Connect %']);
      h += '<tr><td class="did">' + esc(dmKey(s['Retire DID'])) + '</td><td class="dm-arrow">→</td><td class="did">' + (dmKey(s['Replace With']) ? esc(dmKey(s['Replace With'])) : '<span class="dm-v nospare">no spare</span>') + '</td>' +
        '<td class="num">' + dmF(dmN(s['Calls 14d'])) + '</td><td class="num">' + dmF(dmN(s['Fresh Dials 14d'])) + '</td><td class="num dm-low">' + dmPct(pc) + '</td>' +
        '<td>' + esc(s['Flagged On'] || '') + '</td><td class="num">' + (w == null ? '—' : w === 0 ? 'today' : w + ' d') + '</td>' +
        '<td><span class="dm-v ' + (s['Status'] === 'Pending' ? 'pend' : 'nospare') + '">' + esc(s['Status']) + '</span></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  // 2 — Every DID
  var rows = H.slice();
  if (dmShow === 'attention') rows = rows.filter(function (r) { var v = r['Verdict'] || ''; return /replace|still/i.test(v) || ((dmN(r['Calls 14d']) || 0) >= R.calls * 0.8 && (dmN(r['Fresh Connect %']) || 100) < R.pct + 5); });
  rows.sort(function (a, b) { return (dmN(a['Fresh Connect %']) == null ? 999 : dmN(a['Fresh Connect %'])) - (dmN(b['Fresh Connect %']) == null ? 999 : dmN(b['Fresh Connect %'])); });
  var axis = Math.max(60, R.pct + 20);
  h += '<div class="dm-card"><div class="dm-card-hd"><b>Every DID · last 14 days</b><span>worst fresh-lead connect % first</span><div class="dm-act">' +
    '<button class="dm-chip' + (dmShow === 'attention' ? ' on' : '') + '" data-dmshow="attention">Needs attention</button>' +
    '<button class="dm-chip' + (dmShow === 'all' ? ' on' : '') + '" data-dmshow="all">All ' + H.length + '</button></div></div>';
  if (!rows.length) h += '<div class="dm-empty">' + (H.length ? 'No DID is at or near the line.' : 'Waiting for the first run.') + '</div>';
  else {
    h += '<div class="tbl-wrap"><table class="dm-tbl"><thead><tr><th>DID</th><th>Block</th><th class="num">Calls 14d</th><th class="num">Calls / day</th><th class="num">Fresh dials</th><th>Fresh connect %</th><th class="num">Connect % (all)</th><th>Last seen</th><th>Verdict</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var pc = dmN(r['Fresh Connect %']), low = pc != null && pc < R.pct;
      h += '<tr><td class="did">' + esc(r['DID']) + '</td><td>' + esc(r['Block'] || '') + '</td>' +
        '<td class="num">' + dmF(dmN(r['Calls 14d'])) + '</td><td class="num">' + dmF(dmN(r['Calls per Day'])) + '</td><td class="num">' + dmF(dmN(r['Fresh Dials 14d'])) + '</td>' +
        '<td class="num' + (low ? ' dm-low' : '') + '">' + dmPct(pc) + '<span class="dm-bar"><i class="' + (low ? 'low' : '') + '" style="width:' + Math.min(100, (pc || 0) / axis * 100) + '%"></i><b style="left:' + (R.pct / axis * 100) + '%"></b></span></td>' +
        '<td class="num">' + dmPct(dmN(r['Connect % (all)'])) + '</td><td>' + esc(r['Last Seen'] || '') + '</td>' +
        '<td><span class="dm-v ' + dmVerdictCls(r['Verdict']) + '">' + esc(r['Verdict'] || '—') + '</span></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  // 3 — Spare pool
  var spares = P.filter(function (p) { return p['Status'] === 'Spare'; });
  h += '<div class="dm-card"><div class="dm-card-hd"><b>Spare pool</b><span>' + cnt.Spare + ' spare · ' + cnt.Reserved + ' reserved for a pending swap · next to be used listed first</span></div>';
  if (!spares.length) h += '<div class="dm-empty">No spares. Add DIDs to the <code>DID Pool</code> tab with Status = Spare.</div>';
  else {
    h += '<div class="tbl-wrap"><table class="dm-tbl"><thead><tr><th>DID</th><th>Added on</th><th>Notes</th></tr></thead><tbody>';
    spares.sort(function (a, b) { return String(a['Added On']).localeCompare(String(b['Added On'])); }).forEach(function (p) {
      h += '<tr><td class="did">' + esc(dmKey(p['DID'])) + '</td><td>' + esc(p['Added On'] || '') + '</td><td>' + esc(p['Notes'] || '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  h += '<div class="dm-foot"><b>Fresh</b> = a dial on the day the lead was assigned to an LRM (first or latest assignment). <b>Connect</b> = answered ÷ dials, Manual calls only. ' +
    'The window is the 14 complete days ending yesterday, so a DID needs two weeks of heavy use before it can be judged. A DID that is flagged stays on the list until it is marked Done or Cancelled in the sheet. ' +
    'The thresholds are set in <code>DidManager.gs</code> or in Script Properties (<code>DIDM_MIN_CALLS</code>, <code>DIDM_MIN_FRESH</code>, <code>DIDM_MAX_FRESH_PCT</code>).</div>';
  h += '</div>';
  panel.innerHTML = h;

  panel.querySelectorAll('[data-dmshow]').forEach(function (b) {
    b.addEventListener('click', function () { dmShow = b.getAttribute('data-dmshow'); try { localStorage.setItem('lrmDmShow', dmShow); } catch (e) {} renderDidManager(); });
  });
  var cp = panel.querySelector('[data-dmcopy]');
  if (cp) cp.addEventListener('click', function () {
    var txt = 'Retire DID\tReplace with\n' + open.map(function (s) { return dmKey(s['Retire DID']) + '\t' + (dmKey(s['Replace With']) || 'NO SPARE'); }).join('\n');
    var done = function () { cp.textContent = 'Copied ' + open.length; setTimeout(function () { cp.textContent = 'Copy swap list'; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { window.prompt('Copy:', txt); });
    else window.prompt('Copy:', txt);
  });
}
window.renderDidManager = renderDidManager;
