/* ═══════════════════════════════════════════════════════════════════════════
   MS Slots — meetings already confirmed for a day (tomorrow by default),
   split by the four field slots:
     Slot 1  09:30–12:00   Slot 2  12:00–15:00
     Slot 3  15:00–18:00   Slot 4  18:00–21:00
   plus "Outside slots" (before 09:30, 21:00+, or no time on the record).
   A boundary time belongs to the LATER slot (12:00 -> Slot 2).

   Reads D.msScheduleRows (sql/ms-inventory-lead-snapshot.sql v17, tab
   'MS Schedule Inventory'). It is a SNAPSHOT taken by autoUpdateMSSchedule()
   — 05:30 daily unless the hourly trigger is installed — so meetings booked
   after the last pull are not in it yet. The tab says when that is.
   Slot columns are null on a v16 tab: the tab shows a "not wired" note
   instead of drawing every meeting as unslotted.
   Depends on globals: D, F, esc, fmt, setCount, activeTab.
   ═══════════════════════════════════════════════════════════════════════════ */
var MSL_SLOTS = [
  { k: 'Slot 1', lab: 'Slot 1', time: '9:30 – 12:00', col: '#18233f' },
  { k: 'Slot 2', lab: 'Slot 2', time: '12:00 – 3:00 pm', col: '#3d5a99' },
  { k: 'Slot 3', lab: 'Slot 3', time: '3:00 – 6:00 pm', col: '#7f9bd1' },
  { k: 'Slot 4', lab: 'Slot 4', time: '6:00 – 9:00 pm', col: '#b9c8e8' }
];
var MSL_GRAINS = [
  { k: 'cluster', lab: 'Cluster', of: function (r, m) { return r['Cluster'] || 'Unmapped'; } },
  { k: 'city',    lab: 'City',    of: function (r, m) { return r['City'] || m['City'] || 'Unmapped'; } },
  { k: 'zsm',     lab: 'ZSM',     of: function (r, m) { return m['ZSM Name'] || '—'; } },
  { k: 'tl',      lab: 'TL',      of: function (r, m) { return m['TL Name'] || '—'; } },
  { k: 'lrm',     lab: 'LRM',     of: function (r, m) { return r['Assigned LRM'] || '— No LRM —'; } }
];
var mslGrain = 'cluster', mslDay = 1;
try {
  var _mg = localStorage.getItem('lrmMslGrain'); if (MSL_GRAINS.some(function (g) { return g.k === _mg; })) mslGrain = _mg;
  var _md = parseInt(localStorage.getItem('lrmMslDay'), 10); if (_md === 0 || _md === 1 || _md === 2) mslDay = _md;
} catch (e) {}

(function injectMslCss() {
  var css = '' +
  '.msl-wrap{padding:2px 0 18px;flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column}' +
  '.msl-wrap>*{flex:0 0 auto}.msl-wrap>.tbl-wrap{overflow-x:auto;overflow-y:hidden}' +
  '.msl-head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin:2px 0 14px}' +
  '.msl-title{font-size:15px;font-weight:800;color:var(--ink,#18233f);letter-spacing:-.2px}' +
  '.msl-sub{font-size:11.5px;color:var(--muted,#6a7494);max-width:660px;line-height:1.5;margin-top:3px}' +
  '.msl-ctl{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.msl-ctls{display:flex;gap:16px;margin-left:auto;flex-wrap:wrap}' +
  '.msl-lbl{font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
  '.msl-chip{border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--ink,#18233f);font:700 11.5px/1 inherit;padding:6px 11px;border-radius:20px;cursor:pointer;white-space:nowrap}' +
  '.msl-chip:hover{border-color:#9fb0d8}.msl-chip.on{background:#18233f;border-color:#18233f;color:#fff}' +
  '.msl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--border,#e3e8f3);border:1px solid var(--border,#e3e8f3);margin-bottom:16px}' +
  '.msl-kpi{background:#fff;padding:11px 13px;position:relative}' +
  '.msl-kpi-v{font-size:24px;font-weight:800;letter-spacing:-.7px;color:var(--ink,#18233f);line-height:1.1}' +
  '.msl-kpi-l{font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#6a7494);margin-top:3px;display:flex;align-items:center;gap:6px}' +
  '.msl-kpi-l i{width:9px;height:9px;border-radius:2px;display:inline-block}' +
  '.msl-kpi-n{font-size:10.5px;color:var(--muted,#6a7494);margin-top:2px}' +
  '.msl-kpi.pk .msl-kpi-v{color:#3d5a99}' +
  '.msl-mix{display:flex;height:10px;border-radius:2px;overflow:hidden;background:#eef1f7;min-width:120px}' +
  '.msl-mix i{display:block;height:100%}.msl-mix i.out{background:repeating-linear-gradient(45deg,#cfd8ea 0 3px,#eef1f7 3px 6px)}' +
  'td.msl-pk{font-weight:800;color:#3d5a99}' +
  'td .msl-sh{display:block;font-size:9.5px;font-weight:600;color:var(--muted,#6a7494)}' +
  'tr.msl-tot td{font-weight:800;background:#f5f7fb}' +
  '.msl-note{border:1px solid #f0c674;background:#fff7e6;color:#7a5200;padding:10px 13px;font-size:11.5px;line-height:1.5;margin-bottom:14px}' +
  '.msl-note code{background:rgba(0,0,0,.05);padding:0 4px;border-radius:3px}' +
  '.msl-foot{font-size:10.5px;color:var(--muted,#6a7494);margin-top:10px;line-height:1.5;max-width:760px}';
  var s = document.createElement('style'); s.id = 'msl-css'; s.textContent = css; document.head.appendChild(s);
})();

function mslISO(off) { var d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function mslDayLabel(iso) { var d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }

function mslRows() {
  var meta = {};
  (D.rosterRows || D.agentRows || []).forEach(function (m) { meta[String(m['Agent Id'] || '').toLowerCase()] = m; });
  var want = mslISO(mslDay);
  var people = F.ados.length || F.zsms.length || F.tls.length || F.agents.length;
  return (D.msScheduleRows || []).filter(function (r) {
    var sd = String(r['Schedule Date'] || '').slice(0, 10);
    if (sd ? sd !== want : r['Days Out'] !== mslDay) return false;
    var m = meta[String(r['Assigned LRM'] || '').toLowerCase()];
    if (!m) return !people && (!F.cities.length || F.cities.indexOf(String(r['City'] || '')) >= 0);
    if (m._inScope === false) return false;
    if (F.ados.length && F.ados.indexOf(String(m['ADOS Name'] || '')) < 0) return false;
    if (F.zsms.length && F.zsms.indexOf(String(m['ZSM Name'] || '')) < 0) return false;
    if (F.cities.length && F.cities.indexOf(String(m['City'] || r['City'] || '')) < 0) return false;
    if (F.tls.length && F.tls.indexOf(String(m['TL Name'] || '')) < 0) return false;
    if (F.agents.length && F.agents.indexOf(String(m['Agent Id'] || '')) < 0) return false;
    if (F.q) {
      var hay = (r['Assigned LRM'] + ' ' + r['Cluster'] + ' ' + r['City'] + ' ' + (m['LRM Name'] || '') + ' ' + (m['TL Name'] || '')).toLowerCase();
      var qs = String(F.q).toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < qs.length; i++) if (hay.indexOf(qs[i]) < 0) return false;
    }
    return true;
  }).map(function (r) { r._m = meta[String(r['Assigned LRM'] || '').toLowerCase()] || {}; return r; });
}

function mslAdd(acc, r) {
  acc.ms += Number(r['MS Scheduled']) || 0;
  MSL_SLOTS.forEach(function (s) { acc[s.k] += Number(r[s.k]) || 0; });
  acc.out += Number(r['Outside Slots']) || 0;
}
function mslBlank(key) { var o = { key: key, ms: 0, out: 0 }; MSL_SLOTS.forEach(function (s) { o[s.k] = 0; }); return o; }
function mslPct(n, d) { return d ? Math.round(n / d * 100) + '%' : '—'; }
function mslMix(o) {
  if (!o.ms) return '<div class="msl-mix"></div>';
  return '<div class="msl-mix" title="' + MSL_SLOTS.map(function (s) { return s.lab + ' ' + mslPct(o[s.k], o.ms); }).join(' · ') + ' · Outside ' + mslPct(o.out, o.ms) + '">' +
    MSL_SLOTS.map(function (s) { return o[s.k] ? '<i style="width:' + (o[s.k] / o.ms * 100) + '%;background:' + s.col + '"></i>' : ''; }).join('') +
    (o.out ? '<i class="out" style="width:' + (o.out / o.ms * 100) + '%"></i>' : '') + '</div>';
}

function renderMSSlots() {
  var panel = document.getElementById('msslotsPanel');
  if (!panel) return;
  var all = D.msScheduleRows || [];
  var wired = all.some(function (r) { return r['Slot 1'] !== null && r['Slot 1'] !== undefined; });
  var dayISO = mslISO(mslDay);
  var dayNames = ['Today', 'Tomorrow', 'Day after'];

  var h = '<div class="msl-wrap"><div class="msl-head"><div>' +
    '<div class="msl-title">Meetings scheduled for ' + esc(dayNames[mslDay].toLowerCase()) + ' · ' + esc(mslDayLabel(dayISO)) + ' — by slot</div>' +
    '<div class="msl-sub">Every lead currently confirmed for that day, split by the meeting\'s scheduled time. A meeting at exactly 12:00, 3:00 or 6:00 counts in the later slot.</div></div>' +
    '<div class="msl-ctls"><div class="msl-ctl"><span class="msl-lbl">Day</span>' +
    [1, 0, 2].map(function (d) { return '<button class="msl-chip' + (d === mslDay ? ' on' : '') + '" data-msl-day="' + d + '">' + dayNames[d] + '</button>'; }).join('') +
    '</div><div class="msl-ctl"><span class="msl-lbl">Rows</span>' +
    MSL_GRAINS.map(function (g) { return '<button class="msl-chip' + (g.k === mslGrain ? ' on' : '') + '" data-msl-grain="' + g.k + '">' + g.lab + '</button>'; }).join('') +
    '</div></div></div>';

  if (!all.length) {
    h += '<div class="msl-note">No rows in the <b>MS Schedule Inventory</b> tab yet. Run <code>setupMSScheduleTab()</code> in Apps Script.</div></div>';
    panel.innerHTML = h; mslBind(panel); if (activeTab === 'msslots') setCount(''); return;
  }
  if (!wired) {
    h += '<div class="msl-note">The slot columns haven\'t reached the sheet yet. To turn them on: paste <code>ms-inventory-lead-snapshot.sql</code> (v17) into Metabase question 3268, replace <code>Code.gs</code> in Apps Script, then run <code>autoUpdateMSSchedule()</code> once.</div>';
  }

  var rows = mslRows();
  var tot = mslBlank('Total');
  var g = MSL_GRAINS.filter(function (x) { return x.k === mslGrain; })[0];
  var groups = {};
  rows.forEach(function (r) {
    mslAdd(tot, r);
    var k = g.of(r, r._m);
    mslAdd(groups[k] || (groups[k] = mslBlank(k)), r);
  });
  var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.ms - a.ms; });
  if (activeTab === 'msslots') setCount(fmt(tot.ms) + ' meetings · ' + mslDayLabel(dayISO));

  var peak = wired ? MSL_SLOTS.reduce(function (p, s) { return tot[s.k] > tot[p.k] ? s : p; }, MSL_SLOTS[0]) : null;
  h += '<div class="msl-kpis"><div class="msl-kpi"><div class="msl-kpi-v">' + fmt(tot.ms) + '</div><div class="msl-kpi-l">MS scheduled</div><div class="msl-kpi-n">' + esc(mslDayLabel(dayISO)) + '</div></div>' +
    MSL_SLOTS.map(function (s) {
      return '<div class="msl-kpi' + (peak && peak.k === s.k && tot[s.k] ? ' pk' : '') + '"><div class="msl-kpi-v">' + (wired ? fmt(tot[s.k]) : '—') + '</div>' +
        '<div class="msl-kpi-l"><i style="background:' + s.col + '"></i>' + s.lab + '</div><div class="msl-kpi-n">' + s.time + (wired ? ' · ' + mslPct(tot[s.k], tot.ms) : '') + '</div></div>';
    }).join('') +
    (wired && tot.out ? '<div class="msl-kpi"><div class="msl-kpi-v">' + fmt(tot.out) + '</div><div class="msl-kpi-l">Outside slots</div><div class="msl-kpi-n">Before 9:30 / after 9 pm / no time · ' + mslPct(tot.out, tot.ms) + '</div></div>' : '') +
    '</div>';

  if (!rows.length) {
    h += '<div class="msl-note">No meetings confirmed for ' + esc(mslDayLabel(dayISO)) + ' in the current filters.</div></div>';
    panel.innerHTML = h; mslBind(panel); return;
  }

  var showOut = wired && tot.out > 0;
  var cell = function (o, k) {
    if (!wired) return '<td class="num">—</td>';
    var mx = Math.max.apply(null, MSL_SLOTS.map(function (s) { return o[s.k]; }));
    return '<td class="num' + (o[k] && o[k] === mx ? ' msl-pk' : '') + '">' + fmt(o[k]) + '<span class="msl-sh">' + mslPct(o[k], o.ms) + '</span></td>';
  };
  var label = function (o) {
    if (mslGrain !== 'lrm') return esc(o.key);
    var nm = typeof agentName === 'function' ? agentName(o.key) : o.key;
    return esc(nm) + (nm !== o.key ? '<span class="msl-sh">' + esc(o.key) + '</span>' : '');
  };
  var row = function (o, cls) {
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + (cls ? 'Total' : label(o)) + '</td><td class="num">' + fmt(o.ms) + '</td>' +
      MSL_SLOTS.map(function (s) { return cell(o, s.k); }).join('') +
      (showOut ? '<td class="num">' + fmt(o.out) + '<span class="msl-sh">' + mslPct(o.out, o.ms) + '</span></td>' : '') +
      '<td class="sep">' + (wired ? mslMix(o) : '') + '</td></tr>';
  };
  h += '<div class="tbl-wrap"><table><thead><tr><th>' + esc(g.lab) + '</th><th class="num">MS scheduled</th>' +
    MSL_SLOTS.map(function (s) { return '<th class="num">' + s.lab + '<span class="msl-sh">' + s.time + '</span></th>'; }).join('') +
    (showOut ? '<th class="num">Outside<span class="msl-sh">slots</span></th>' : '') + '<th class="sep">Slot mix</th></tr></thead><tbody>' +
    list.map(function (o) { return row(o); }).join('') + row(tot, 'msl-tot') + '</tbody></table></div>' +
    '<div class="msl-foot">Snapshot from the <b>MS Schedule Inventory</b> tab (refreshed by <code>autoUpdateMSSchedule()</code>). Meetings confirmed after the last refresh appear on the next pull. The highlighted figure in each row is its busiest slot.</div></div>';
  panel.innerHTML = h;
  mslBind(panel);
}

function mslBind(panel) {
  panel.querySelectorAll('[data-msl-day]').forEach(function (b) {
    b.addEventListener('click', function () { mslDay = +b.getAttribute('data-msl-day'); try { localStorage.setItem('lrmMslDay', mslDay); } catch (e) {} renderMSSlots(); });
  });
  panel.querySelectorAll('[data-msl-grain]').forEach(function (b) {
    b.addEventListener('click', function () { mslGrain = b.getAttribute('data-msl-grain'); try { localStorage.setItem('lrmMslGrain', mslGrain); } catch (e) {} renderMSSlots(); });
  });
}
