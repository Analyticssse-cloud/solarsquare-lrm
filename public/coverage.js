/* ═══════════════════════════════════════════════════════════════════════════
   Coverage — of the leads an LRM was given, how many did we ever get on the
   phone. The third metric, and the only one that can see a lead NOBODY dialled.

     Connect %            per DIAL   — of the calls made, how many answered.
     First Response Time  per ASSIGNED lead — how fast the first dial went out.
     Coverage (this)      per CREATED lead — did we ever reach this person.

   Why it looks like this:
     * EVERY ROW IS A COHORT, dated by lead CREATION, and a cohort keeps
       changing after its day ends — a lead created Monday can be connected
       Thursday. So a day younger than D+COVERAGE_MATURE is marked STILL
       MATURING and left out of the headline rather than scored. Measured
       1-18 Sep: 56% of eventual connects land same-day, 77% by D+1, 90% by
       D+3. A same-day figure is not a low score, it is an unfinished one.
     * COVERED means at least one CONNECTED call, ever (user, 19 Sep). The
       feed also carries D+0/D+1/D+3 so a tighter rule needs no re-backfill.
     * "Really covered" (>= 15s of talk) sits beside it because the dialler
       marks IVR-busy and ring-through as answered. Chennai reads 87.7%
       covered and 64.8% really covered — a raw rate flatters the floor.
     * NOT COVERED SPLITS IN TWO, and the halves have different owners:
       never dialled -> queue/allocation; dialled-no-answer -> connectivity.
       The table shows both, never a single "missed" number.
     * Unassigned leads are NOT in this feed (user, 20 Sep) — an allocation
       problem with a different owner. Stated in the footnote so the 83% is
       never mistaken for coverage of everything that came in.

   Reads only what the backend returns:
     D.coverageRows   [{agent,name,city,cluster,leadCity,tl,tlName,zsm,zsmName,
                        ados,adosName,assigned,dialled,connected,real,never,
                        noAns,d0,d1,d3,dials,geoPin,_inScope}]
     D.coverageTrend  [{date,assigned,connected,real,never,age,maturing}]
     D.coverageStatus [{status,assigned,connected,real,never}]
     D.coverageLeads  [{date,agent,lead,city,cluster,stage,status,source,
                        createdAt,assignedAt,dials,firstDial,lastDial,age,flag}]
     D.coverageHas    false when the `coverage` tab does not exist yet
     D.coverage       {error,external,diag}
   Depends on globals from index.html: D, F, esc, fmt, agentName, setCount,
   activeTab, switchTab.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Row grain of the main table. The feed's grain is LRM x cluster, so every one
   of these is a real rollup of the same cells — no grain is derived from
   another. Same list as First Response Time, minus Status, which is a lead
   property rather than a person and gets its own panel. */
var COV_GRAINS = [
  { k: 'cluster', lab: 'Cluster', head: 'Cluster', of: function (r) { return r.cluster || 'Unmapped'; } },
  { k: 'city',    lab: 'City',    head: 'City',    of: function (r) { return r.leadCity || 'Unmapped'; } },
  { k: 'ados',    lab: 'ADOS',    head: 'ADOS',    of: function (r) { return r.adosName || '—'; } },
  { k: 'zsm',     lab: 'ZSM',     head: 'ZSM',     of: function (r) { return r.zsmName || '—'; } },
  { k: 'tl',      lab: 'TL',      head: 'Team Lead', of: function (r) { return r.tlName || '—'; } },
  { k: 'lrm',     lab: 'LRM',     head: 'LRM',     of: function (r) { return r.agent; } }
];
var covGrain = 'cluster';
try { var _cg = localStorage.getItem('lrmCovGrain'); if (COV_GRAINS.some(function (g) { return g.k === _cg; })) covGrain = _cg; } catch (e) {}
/* Which definition the headline uses. 'ever' is the user's rule; 'real' is the
   same population counted with >= 15s of talk. Both come from the same row, so
   the switch is a column choice, never a re-query. */
var covBasis = 'ever';
try { var _cb = localStorage.getItem('lrmCovBasis'); if (_cb === 'ever' || _cb === 'real') covBasis = _cb; } catch (e) {}
var covSort = { col: 'assigned', dir: -1 };
var covOpen = null;

(function injectCoverageCss() {
  var css = '' +
  /* THE TAB is the scroll region and the table is not a nested scroller — a
     scroller inside a squeezed flex box is the bug that hid the bottom rows of
     First Response Time before 19 Sep. Same shape here, deliberately. */
  '.cv-wrap{padding:2px 0 18px;flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column}' +
  '.cv-wrap>*{flex:0 0 auto}' +
  '.cv-wrap>.tbl-wrap{overflow-x:auto;overflow-y:hidden}' +
  '.cv-head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin:2px 0 14px}' +
  '.cv-title{font-size:15px;font-weight:800;color:var(--ink,#18233f);letter-spacing:-.2px}' +
  '.cv-sub{font-size:11.5px;color:var(--muted,#6a7494);max-width:660px;line-height:1.5;margin-top:3px}' +
  '.cv-basis{display:flex;align-items:center;gap:6px;margin-left:auto}' +
  '.cv-basis-lbl{font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
  '.cv-chip{border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--ink,#18233f);font:700 11.5px/1 inherit;padding:6px 11px;border-radius:20px;cursor:pointer;white-space:nowrap}' +
  '.cv-chip:hover{border-color:#9fb0d8}' +
  '.cv-chip.on{background:#18233f;border-color:#18233f;color:#fff}' +
  '.cv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:1px;background:var(--border,#e3e8f3);border:1px solid var(--border,#e3e8f3);margin-bottom:16px}' +
  '.cv-kpi{background:#fff;padding:11px 13px}' +
  '.cv-kpi:last-child{grid-column:auto/-1}' +
  '.cv-kpi-v{font-size:22px;font-weight:800;letter-spacing:-.7px;color:var(--ink,#18233f);line-height:1.1}' +
  '.cv-kpi-l{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#6a7494);margin-top:3px}' +
  '.cv-kpi-n{font-size:10.5px;color:var(--muted,#6a7494);margin-top:2px}' +
  '.cv-kpi.bad .cv-kpi-v{color:#b0382c}' +
  /* Trend. Bars, not a line: each day is a discrete cohort and a line implies a
     continuous quantity between them. Maturing days are hatched, never hidden —
     hiding today's bar is how a floor stops noticing it stopped dialling. */
  '.cv-trend{border:1px solid var(--border,#e3e8f3);padding:14px 16px 10px;margin-bottom:18px;background:#fff}' +
  '.cv-trend-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap}' +
  '.cv-trend-hd b{font-size:12px;letter-spacing:-.1px}' +
  '.cv-trend-hd span{font-size:11px;color:var(--muted,#6a7494)}' +
  '.cv-bars{display:flex;gap:4px;align-items:flex-end;height:132px}' +
  '.cv-bar{flex:1 1 0;display:flex;flex-direction:column;justify-content:flex-end;height:100%;min-width:0;position:relative}' +
  '.cv-bar i{display:block;background:#6ea866;border-radius:2px 2px 0 0;min-height:2px}' +
  '.cv-bar.low i{background:#e8a05c}.cv-bar.bad i{background:#b0382c}' +
  '.cv-bar.raw i{background:#cfd8ea}' +
  '.cv-bar em{font-style:normal;font-size:9px;font-weight:800;text-align:center;color:var(--ink,#18233f);margin-bottom:3px;white-space:nowrap}' +
  '.cv-bar.imm i{background:repeating-linear-gradient(45deg,#c3ccdd,#c3ccdd 3px,#eef1f8 3px,#eef1f8 6px)}' +
  '.cv-bar.imm em{color:var(--muted,#6a7494)}' +
  '.cv-xlab{display:flex;gap:4px;margin-top:7px;border-top:1px solid var(--border,#e3e8f3);padding-top:6px}' +
  '.cv-xlab span{flex:1 1 0;min-width:0;font-size:9px;color:var(--muted,#6a7494);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.cv-grain{display:flex;align-items:center;gap:6px;margin:0 0 10px;flex-wrap:wrap}' +
  '.cv-tbl-note{font-size:11px;color:var(--muted,#6a7494);margin:0 0 7px;max-width:900px;line-height:1.5}' +
  '.cv-grid th,.cv-grid td{white-space:nowrap}' +
  '.cv-grid .cv-hgrp th{font-size:9px;letter-spacing:.6px;color:var(--muted,#6a7494);border-bottom:0;padding-bottom:2px}' +
  '.cv-grid th.cv-sep,.cv-grid td.cv-sep{border-left:1px solid var(--border,#e3e8f3)}' +
  '.cv-grid td.cv-warn{color:#b0382c;font-weight:700}' +
  '.cv-grid tr.cv-tot td{font-weight:800;background:#f4f6fb;border-bottom:1px solid #cfd7ea}' +
  /* The secondary count inside a figure cell (LRM count, never-dialled %). It has
     its OWN class: the equivalent in speed.js is scoped to table.sl-grid, so
     borrowing that class rendered these as full-size italic ink butted against
     the primary number. The two files load independently — never share a class
     across them. */
  '.cv-grid em.cv-n{font-style:normal;font-size:9.5px;color:var(--muted,#6a7494);margin-left:4px}' +
  '.cv-meter{position:relative;height:7px;background:#eef1f8;border-radius:4px;overflow:hidden;min-width:56px}' +
  '.cv-meter i{position:absolute;left:0;top:0;bottom:0;background:#6ea866;border-radius:4px}' +
  '.cv-meter.warn i{background:#e8a05c}.cv-meter.bad i{background:#b0382c}' +
  'tr.cv-row{cursor:pointer;-webkit-user-select:none;user-select:none}tr.cv-row:hover{background:rgba(24,35,63,.035)}' +
  'tr.cv-row.open{background:rgba(24,35,63,.055)}' +
  /* Row drill as a POP-UP, same as First Response Time. Keyframed rather than
     transitioned so it fires on the element's first paint, with no double rAF. */
  '.cv-modal-bk{position:fixed;inset:0;background:rgba(15,22,45,.46);z-index:300;display:none;align-items:center;justify-content:center;padding:22px}' +
  '.cv-modal-bk.open{display:flex;animation:cvFade .16s ease both}' +
  '.cv-modal{background:#fff;border-radius:10px;width:min(1080px,96vw);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 26px 70px rgba(15,22,45,.34);animation:cvPop .2s cubic-bezier(.2,.8,.3,1) both}' +
  '@keyframes cvFade{from{opacity:0}to{opacity:1}}' +
  '@keyframes cvPop{from{opacity:0;transform:translateY(10px) scale(.965)}to{opacity:1;transform:none}}' +
  '.cv-modal-bk.closing{animation:cvFade .13s ease reverse both}' +
  '.cv-modal-bk.closing .cv-modal{animation:cvPop .13s ease reverse both}' +
  '.cv-modal-hd{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border,#e3e8f3)}' +
  '.cv-modal-hd h3{margin:0;font-size:14.5px;font-weight:800;color:var(--ink,#18233f);letter-spacing:-.2px}' +
  '.cv-modal-hd span{font-size:11px;color:var(--muted,#6a7494)}' +
  '.cv-modal-x{margin-left:auto;border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--muted,#6a7494);font:700 13px/1 inherit;width:26px;height:26px;border-radius:6px;cursor:pointer}' +
  '.cv-modal-x:hover{color:var(--ink,#18233f);border-color:#9fb0d8}' +
  '.cv-modal-bd{overflow:auto;min-height:0}' +
  '.cv-modal-bd .cv-drill-in{padding:12px 16px 16px}' +
  '@media (prefers-reduced-motion:reduce){.cv-modal-bk.open,.cv-modal,.cv-modal-bk.closing,.cv-modal-bk.closing .cv-modal{animation:none}}' +
  'td.cv-drill{padding:0!important;background:#fbfcfe}' +
  '.cv-drill-in{padding:10px 14px 14px;overflow-x:auto}' +
  '.cv-drill-in h4{margin:0 0 7px;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
  '.cv-mini{width:100%;border-collapse:collapse;font-size:11.5px}' +
  '.cv-mini th{text-align:left;font-size:9.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#6a7494);padding:4px 8px;border-bottom:1px solid var(--border,#e3e8f3);white-space:nowrap}' +
  '.cv-mini th.num,.cv-mini td.num{text-align:right}' +
  '.cv-mini td{padding:4px 8px;border-bottom:1px solid #eef1f8;white-space:nowrap}' +
  '.cv-flag{font-size:9.5px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;padding:2px 6px;border-radius:3px}' +
  '.cv-flag.never{background:#f6e2df;color:#8f2c22}' +
  '.cv-flag.noans{background:#faeed9;color:#8a5a17}' +
  '.cv-flag.hard{background:#efe3f2;color:#6b3577}' +
  '.cv-empty{border:1px dashed var(--border,#e3e8f3);padding:26px;text-align:center;color:var(--muted,#6a7494);font-size:12px;line-height:1.6}' +
  '.cv-foot{margin-top:12px;padding-top:10px;border-top:1px solid var(--border,#e3e8f3)}' +
  '.cv-foot-b{font-size:10.5px;color:var(--muted,#6a7494);line-height:1.6;max-width:940px}' +
  '.cv-foot-b b{color:var(--ink,#18233f)}' +
  '.cv-subnote{font-size:10.5px;color:var(--muted,#6a7494);margin-top:6px}';
  var el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
})();

/* Same scope rules as every other tab. Written out rather than shared with
   speed.js because the two files are loaded independently and a shared helper
   would make load order matter. */
function filterCoverage() {
  return (D.coverageRows || []).filter(function (r) {
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

function covStats(rows) {
  var t = { assigned: 0, dialled: 0, connected: 0, real: 0, never: 0, noAns: 0,
            d0: 0, d1: 0, d3: 0, dials: 0, geoPin: 0 };
  (rows || []).forEach(function (r) {
    Object.keys(t).forEach(function (k) { t[k] += r[k] || 0; });
  });
  t.covPct = t.assigned ? Math.round(1000 * t.connected / t.assigned) / 10 : 0;
  t.realPct = t.assigned ? Math.round(1000 * t.real / t.assigned) / 10 : 0;
  t.headline = covBasis === 'real' ? t.realPct : t.covPct;
  t.uncovered = t.assigned - t.connected;
  t.dialsPer = t.assigned ? Math.round(10 * t.dials / t.assigned) / 10 : 0;
  return t;
}

function covBand(p) { return p >= 85 ? '' : p >= 75 ? 'warn' : 'bad'; }
function covTint(p) {
  if (p >= 90) return 'rgba(110,168,102,.14)';
  if (p >= 80) return 'rgba(110,168,102,.07)';
  if (p >= 70) return 'rgba(232,160,92,.12)';
  return 'rgba(176,56,44,.10)';
}

function covGrainDef(k) {
  k = k || covGrain;
  for (var i = 0; i < COV_GRAINS.length; i++) if (COV_GRAINS[i].k === k) return COV_GRAINS[i];
  return COV_GRAINS[0];
}

/* Group the LRM x cluster cells into whatever grain is selected. Counts sum, so
   every rate is recomputed from the summed counts — never averaged from the
   cells, which would weight a 12-lead LRM like a 300-lead one. */
function covGroup(rows, grain) {
  var G = covGrainDef(grain), by = {};
  (rows || []).forEach(function (r) {
    var k = G.of(r) || '—';
    var a = by[k] || (by[k] = { key: k, assigned: 0, dialled: 0, connected: 0, real: 0,
                                never: 0, noAns: 0, d0: 0, d1: 0, d3: 0, dials: 0, lrms: {} });
    ['assigned', 'dialled', 'connected', 'real', 'never', 'noAns', 'd0', 'd1', 'd3', 'dials']
      .forEach(function (f) { a[f] += r[f] || 0; });
    a.lrms[r.agent] = true;
  });
  return Object.keys(by).map(function (k) {
    var a = by[k];
    a.n = Object.keys(a.lrms).length;
    a.covPct = a.assigned ? Math.round(1000 * a.connected / a.assigned) / 10 : 0;
    a.realPct = a.assigned ? Math.round(1000 * a.real / a.assigned) / 10 : 0;
    a.headline = covBasis === 'real' ? a.realPct : a.covPct;
    a.neverPct = a.assigned ? Math.round(1000 * a.never / a.assigned) / 10 : 0;
    a.gap = Math.round((a.covPct - a.realPct) * 10) / 10;
    a.dialsPer = a.assigned ? Math.round(10 * a.dials / a.assigned) / 10 : 0;
    return a;
  });
}

function renderCoverage() {
  var panel = document.getElementById('coveragePanel');
  if (!panel) return;

  if (!D.coverageHas) {
    var err = (D.coverage && D.coverage.error) || '';
    panel.innerHTML = '<div class="cv-empty"><b>No coverage feed yet.</b><br>' +
      (err ? esc(err) : 'Set the two Metabase card ids in <code>Coverage.gs</code>, then run ' +
        '<code>covRunBackfill()</code>. The tabs are written into this same sheet.') +
      '</div>';
    if (activeTab === 'coverage') setCount('');
    return;
  }

  var rows = filterCoverage();
  var t = covStats(rows);
  if (activeTab === 'coverage') setCount(fmt(t.assigned) + ' leads');

  var G = covGrainDef();
  var groups = covGroup(rows, covGrain);
  var basisLab = covBasis === 'real' ? 'really covered' : 'covered';

  var html = '<div class="cv-wrap">';

  html += '<div class="cv-head"><div><div class="cv-title">Coverage</div>' +
    '<div class="cv-sub">Of the leads an LRM was given, how many we ever got on the phone. ' +
    'Each row is a <b>cohort</b> dated by when the lead was created, so a day keeps improving ' +
    'after it ends — days too young to judge are marked below.</div></div>' +
    '<div class="cv-basis"><span class="cv-basis-lbl">Counts as covered</span>' +
    '<button class="cv-chip' + (covBasis === 'ever' ? ' on' : '') + '" data-basis="ever" ' +
      'title="Any connected call, ever.">Connected</button>' +
    '<button class="cv-chip' + (covBasis === 'real' ? ' on' : '') + '" data-basis="real" ' +
      'title="Connected with at least 15 seconds of talk. The dialler marks IVR-busy and ring-through as answered, so the raw rate overstates real conversations.">15s+ talk</button>' +
    '</div></div>';

  // ── KPIs ───────────────────────────────────────────────────────────────────
  var kpi = function (cls, v, lab, note) {
    return '<div class="cv-kpi' + (cls ? ' ' + cls : '') + '"><div class="cv-kpi-v">' + v + '</div>' +
      '<div class="cv-kpi-l">' + lab + '</div>' +
      (note ? '<div class="cv-kpi-n">' + note + '</div>' : '') + '</div>';
  };
  html += '<div class="cv-kpis">' +
    kpi('', fmt(t.assigned), 'Leads assigned', 'all of them reached an LRM') +
    kpi(t.headline < 80 ? 'bad' : '', t.headline + '%', basisLab,
        covBasis === 'real' ? fmt(t.real) + ' with 15s+ talk'
                            : fmt(t.connected) + ' reached · ' + t.realPct + '% with 15s+ talk') +
    kpi(t.never > 0 ? 'bad' : '', fmt(t.never), 'Never dialled', 'nobody tried — queue, not calling') +
    kpi('', fmt(t.noAns), 'Dialled, no answer', 'tried and missed — connectivity') +
    kpi('', t.dialsPer, 'Dials per lead', fmt(t.dials) + ' dials in total') +
    '</div>';

  // ── Trend ──────────────────────────────────────────────────────────────────
  // Floor-wide, so it is NOT filtered by scope: it answers "is the floor keeping
  // up", which a scoped subset cannot. Said plainly in the header.
  var tr = (D.coverageTrend || []);
  if (tr.length > 1) {
    var maxA = 0;
    tr.forEach(function (d) { if (d.assigned > maxA) maxA = d.assigned; });
    var mature = tr.filter(function (d) { return !d.maturing; });
    html += '<div class="cv-trend"><div class="cv-trend-hd"><b>Coverage by cohort day</b>' +
      '<span>floor-wide, not filtered · bar height is the day\'s lead volume · ' +
      'hatched = still maturing, too young to judge</span></div><div class="cv-bars">';
    tr.forEach(function (d) {
      var pct = d.assigned ? Math.round(1000 * (covBasis === 'real' ? d.real : d.connected) / d.assigned) / 10 : 0;
      var h = maxA ? Math.max(2, Math.round(100 * d.assigned / maxA)) : 2;
      var cls = d.maturing ? 'imm' : (pct >= 85 ? '' : pct >= 75 ? 'low' : 'bad');
      html += '<div class="cv-bar ' + cls + '" title="' + esc(d.date) + ' · ' + fmt(d.assigned) +
        ' leads · ' + pct + '% ' + basisLab + (d.maturing ? ' · still maturing' : '') + '">' +
        '<em>' + (d.maturing ? '·' : pct) + '</em><i style="height:' + h + '%"></i></div>';
    });
    html += '</div><div class="cv-xlab">';
    tr.forEach(function (d) { html += '<span>' + esc(d.date.slice(8)) + '</span>'; });
    html += '</div>';
    if (mature.length >= 2) {
      var first = mature[0], last = mature[mature.length - 1];
      var p1 = first.assigned ? 100 * first.connected / first.assigned : 0;
      var p2 = last.assigned ? 100 * last.connected / last.assigned : 0;
      var delta = Math.round((p2 - p1) * 10) / 10;
      html += '<div class="cv-subnote">Across the mature days, coverage moved <b>' +
        (delta >= 0 ? '+' : '') + delta + ' pts</b> (' + esc(first.date) + ' → ' + esc(last.date) +
        '). Days after that are still filling in.</div>';
    }
    html += '</div>';
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  html += '<div class="cv-grain">';
  COV_GRAINS.forEach(function (g) {
    html += '<button class="cv-chip' + (g.k === covGrain ? ' on' : '') + '" data-cg="' + g.k + '">' + g.lab + '</button>';
  });
  html += '</div>';

  html += '<div class="cv-tbl-note">Rates are recomputed from the summed counts at every level, ' +
    'so a small LRM never weighs the same as a large one. <b>Never dialled</b> and <b>no answer</b> ' +
    'are the two halves of what is not covered — they have different owners.</div>';

  var dir = covSort.dir, sc = covSort.col;
  groups.sort(function (a, b) {
    var x = a[sc], y = b[sc];
    if (typeof x === 'string') return dir * (x < y ? -1 : x > y ? 1 : 0);
    return dir * ((x || 0) - (y || 0));
  });

  var th = function (k, lab, extra) {
    return '<th class="num' + (extra || '') + '" data-cs="' + k + '">' + lab + '</th>';
  };
  html += '<div class="tbl-wrap"><table class="cv-grid"><thead>' +
    '<tr class="cv-hgrp"><th></th><th class="num" colspan="2">Leads</th>' +
    '<th class="num cv-sep" colspan="2">Covered</th>' +
    '<th class="num cv-sep" colspan="2">Not covered</th>' +
    '<th class="num cv-sep" colspan="2">Effort</th></tr><tr>' +
    '<th data-cs="key">' + G.head + '</th>' +
    th('assigned', 'Assigned') +
    th('dialled', 'Dialled') +
    th('headline', basisLab === 'covered' ? 'Covered' : 'Really cov.', ' cv-sep') +
    th('gap', 'Raw → 15s+ gap') +
    th('never', 'Never dialled', ' cv-sep') +
    th('noAns', 'No answer') +
    th('dialsPer', 'Dials / lead', ' cv-sep') +
    th('d0', 'Same day') +
    '</tr></thead><tbody>';

  groups.forEach(function (g) {
    var open = covOpen === g.key;
    var pct = g.headline;
    html += '<tr class="cv-row' + (open ? ' open' : '') + '" data-ck="' + esc(g.key) + '">' +
      '<td>' + esc(g.key) + (covGrain !== 'lrm' ? ' <em class="cv-n">' + g.n + '</em>' : '') + '</td>' +
      '<td class="num">' + fmt(g.assigned) + '</td>' +
      '<td class="num">' + fmt(g.dialled) + '</td>' +
      '<td class="num cv-sep" style="background:' + covTint(pct) + '">' + pct + '%</td>' +
      '<td class="num' + (g.gap >= 15 ? ' cv-warn' : '') + '">' + (g.gap > 0 ? '−' + g.gap : '0') + ' pts</td>' +
      '<td class="num cv-sep' + (g.neverPct >= 8 ? ' cv-warn' : '') + '">' + fmt(g.never) +
        ' <em class="cv-n">' + g.neverPct + '%</em></td>' +
      '<td class="num">' + fmt(g.noAns) + '</td>' +
      '<td class="num cv-sep">' + g.dialsPer + '</td>' +
      '<td class="num">' + (g.connected ? Math.round(100 * g.d0 / g.connected) + '%' : '—') + '</td>' +
      '</tr>';
  });

  html += '<tr class="cv-tot"><td>All</td><td class="num">' + fmt(t.assigned) + '</td>' +
    '<td class="num">' + fmt(t.dialled) + '</td>' +
    '<td class="num cv-sep">' + t.headline + '%</td>' +
    '<td class="num">−' + Math.round((t.covPct - t.realPct) * 10) / 10 + ' pts</td>' +
    '<td class="num cv-sep">' + fmt(t.never) + '</td><td class="num">' + fmt(t.noAns) + '</td>' +
    '<td class="num cv-sep">' + t.dialsPer + '</td>' +
    '<td class="num">' + (t.connected ? Math.round(100 * t.d0 / t.connected) + '%' : '—') + '</td></tr>';
  html += '</tbody></table></div>';

  // ── Status panel ───────────────────────────────────────────────────────────
  // Not a grain chip: status is a property of the LEAD, not of a person, so it
  // cannot be filtered by scope and must not sit in the same switch.
  var st = (D.coverageStatus || []).filter(function (s) { return s.assigned >= 50; });
  if (st.length) {
    html += '<div class="cv-tbl-note" style="margin-top:18px"><b>By lead status</b> — floor-wide, ' +
      'not filtered. A status with low coverage and high volume is where leads are going quiet.</div>' +
      '<div class="tbl-wrap"><table class="cv-grid"><thead><tr><th>Status</th>' +
      '<th class="num">Leads</th><th class="num">Covered</th><th class="num">15s+ talk</th>' +
      '<th class="num">Never dialled</th></tr></thead><tbody>';
    st.forEach(function (s) {
      var p = s.assigned ? Math.round(1000 * s.connected / s.assigned) / 10 : 0;
      var rp = s.assigned ? Math.round(1000 * s.real / s.assigned) / 10 : 0;
      html += '<tr><td>' + esc(s.status) + '</td><td class="num">' + fmt(s.assigned) + '</td>' +
        '<td class="num" style="background:' + covTint(p) + '">' + p + '%</td>' +
        '<td class="num">' + rp + '%</td><td class="num">' + fmt(s.never) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  // ── Footnote ───────────────────────────────────────────────────────────────
  html += '<div class="cv-foot"><div class="cv-foot-b">' +
    '<b>Covered</b> means at least one connected call to that lead, at any time after it was ' +
    'created. <b>15s+ talk</b> is the same count with a real conversation behind it — the dialler ' +
    'reports IVR-busy and ring-through as answered, so the two differ by a lot in some clusters. ' +
    '<b>Leads with no LRM are not in this tab at all</b>: they are an allocation question with a ' +
    'different owner, and including them made the floor look far worse than its own work. ' +
    'Inbound calls are not counted yet, so a customer who rang us and spoke reads as uncovered — ' +
    'this understates coverage slightly. A cohort younger than ' + (D.coverageMatureDays || 1) +
    ' day is shown but never scored.' +
    ((D.coverage && D.coverage.error) ? ' <b>Feed warning:</b> ' + esc(D.coverage.error) : '') +
    '</div></div>';

  html += '</div>';
  panel.innerHTML = html;

  // ── Wiring ─────────────────────────────────────────────────────────────────
  panel.querySelectorAll('.cv-chip[data-basis]').forEach(function (b) {
    b.addEventListener('click', function () {
      covBasis = b.getAttribute('data-basis');
      try { localStorage.setItem('lrmCovBasis', covBasis); } catch (e) {}
      renderCoverage();
    });
  });
  panel.querySelectorAll('.cv-chip[data-cg]').forEach(function (b) {
    b.addEventListener('click', function () {
      covGrain = b.getAttribute('data-cg');
      covOpen = null;
      try { localStorage.setItem('lrmCovGrain', covGrain); } catch (e) {}
      renderCoverage();
    });
  });
  panel.querySelectorAll('.cv-grid th[data-cs]').forEach(function (h) {
    h.style.cursor = 'pointer';
    h.addEventListener('click', function () {
      var k = h.getAttribute('data-cs');
      covSort.dir = (covSort.col === k) ? covSort.dir * -1 : -1;
      covSort.col = k;
      renderCoverage();
    });
  });
  panel.querySelectorAll('tr.cv-row').forEach(function (tr2) {
    tr2.addEventListener('click', function () {
      var k = tr2.getAttribute('data-ck');
      if (covOpen === k) { covCloseModal(); return; }
      panel.querySelectorAll('tr.cv-row.open').forEach(function (o) { o.classList.remove('open'); });
      tr2.classList.add('open');
      covOpen = k;
      covOpenModal(k, groups, rows);
    });
  });
}

/* The drill lives in a pop-up rather than an expanded row: the worklist is a
   long list read top-down, and pushing the table apart to show it loses the
   row you clicked. Same shell and the same motion as First Response Time —
   its own classes, because the two files load independently. */
function covModalEl() {
  var bk = document.getElementById('cvModalBk');
  if (bk) return bk;
  bk = document.createElement('div');
  bk.id = 'cvModalBk';
  bk.className = 'cv-modal-bk';
  bk.innerHTML = '<div class="cv-modal" role="dialog" aria-modal="true">' +
    '<div class="cv-modal-hd"><h3 id="cvModalT"></h3><span id="cvModalS"></span>' +
    '<button class="cv-modal-x" id="cvModalX" title="Close (Esc)">\u2715</button></div>' +
    '<div class="cv-modal-bd" id="cvModalBd"></div></div>';
  document.body.appendChild(bk);
  bk.addEventListener('click', function (e) { if (e.target === bk) covCloseModal(); });
  bk.querySelector('#cvModalX').addEventListener('click', covCloseModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && bk.classList.contains('open')) covCloseModal();
  });
  return bk;
}

function covOpenModal(key, groups, rows) {
  var g = null;
  for (var i = 0; i < groups.length; i++) if (String(groups[i].key) === key) { g = groups[i]; break; }
  if (!g) return;
  var bk = covModalEl();
  bk.querySelector('#cvModalT').textContent = g.key;
  bk.querySelector('#cvModalS').textContent = fmt(g.assigned) + ' leads \u00b7 ' + g.headline +
    '% ' + (covBasis === 'real' ? 'really covered' : 'covered') + ' \u00b7 ' +
    fmt(g.never) + ' never dialled';
  bk.querySelector('#cvModalBd').innerHTML = covDrill(g, rows);
  bk.classList.remove('closing');
  bk.classList.add('open');
}

function covCloseModal() {
  covOpen = null;
  var p = document.getElementById('coveragePanel');
  if (p) p.querySelectorAll('tr.cv-row.open').forEach(function (o) { o.classList.remove('open'); });
  var bk = document.getElementById('cvModalBk');
  if (!bk || !bk.classList.contains('open')) return;
  bk.classList.add('closing');
  setTimeout(function () { bk.classList.remove('open', 'closing'); }, 140);
}

/* The drill is the WORKLIST — the uncovered leads themselves, in queue order:
   never dialled first, then oldest. That order is the point of the panel, so it
   is never re-sorted by a column click. */
function covDrill(g, rows) {
  var G = covGrainDef();
  // Which LRMs sit behind this group row — the worklist has no ADOS/ZSM columns,
  // so the group is resolved to a set of emails and the leads matched on that.
  var emails = {};
  (rows || []).forEach(function (r) { if ((G.of(r) || '—') === g.key) emails[r.agent] = true; });
  var leads = (D.coverageLeads || []).filter(function (l) { return emails[l.agent]; });

  var html = '<div class="cv-drill-in">';
  if (!leads.length) {
    /* NOT an error, and it says so. The worklist is pulled over a SHORTER window
       than the daily feed (7 days, ~2,300 rows against a 4,000 cap), so a wide
       date range legitimately has covered rows with no worklist behind them. */
    html += '<h4>Uncovered leads</h4><div class="cv-subnote">None in the worklist for this group. ' +
      'The worklist covers the last few days only \u2014 the table above can span a longer range, ' +
      'so an older cohort has no rows here even though its leads are counted.</div>';
    return html + '</div>';
  }
  var shown = leads.slice(0, 200);
  html += '<h4>Uncovered leads — ' + fmt(leads.length) + ' in ' + esc(g.key) +
    (leads.length > shown.length ? ' · showing the first ' + shown.length : '') + '</h4>';
  html += '<table class="cv-mini"><thead><tr><th>Lead</th><th>LRM</th><th>Created</th>' +
    '<th class="num">Age</th><th class="num">Dials</th><th>Last dial</th><th>Stage</th>' +
    '<th>Source</th><th>Why</th></tr></thead><tbody>';
  shown.forEach(function (l) {
    var cls = l.dials === 0 ? 'never' : (l.dials >= 5 ? 'hard' : 'noans');
    html += '<tr><td>' + esc(l.lead) + '</td>' +
      '<td>' + esc(agentName ? agentName(l.agent) : l.agent) + '</td>' +
      '<td>' + esc(l.createdAt) + '</td>' +
      '<td class="num">' + (l.age === null ? '—' : l.age + 'd') + '</td>' +
      '<td class="num">' + fmt(l.dials) + '</td>' +
      '<td>' + esc(l.lastDial || '—') + '</td>' +
      '<td>' + esc(l.stage || '—') + '</td>' +
      '<td>' + esc(l.source || '—') + '</td>' +
      '<td><span class="cv-flag ' + cls + '">' + esc(l.flag || '—') + '</span></td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}
