/* ── Day-on-day trend: calls, connected calls, talk time (30 Sep 2026) ──────────
   One bar per calling day in the picked range, for the LRMs in view — so every
   dashboard filter (ADOS / ZSM / City / TL / LRM / search / band) narrows it,
   exactly like the hero above it.
   Source: D.dodRows = one row per LRM per day from the DAILY Ozontel tab (the same
   rows the hero and the LRM table sum), emitted by api/dashboard.js. If that feed is
   absent (older API, preview mock) it falls back to summing D.hourlyRows by day.
   TOTAL vs PER LRM: the floor's headcount moves day to day, so a total bar can fall
   because fewer people logged in. Per LRM divides by LRMs who dialled that day.
   Today, while the shift is still running, is hatched and is never the day the
   "vs previous day" change is read from — a half day against a full one is not a trend. */
(function () {
  if (document.getElementById('dodCss')) return;
  var css =
    '.dod-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
    '.dod-seg{display:flex;gap:4px;margin-left:auto;flex-shrink:0}' +
    '.dod-seg button{border:1px solid var(--border,#e3e8f3);background:#fff;color:var(--ink,#18233f);font:700 11px/1 inherit;padding:5px 10px;border-radius:20px;cursor:pointer;white-space:nowrap}' +
    '.dod-seg button:hover{border-color:#9fb0d8}' +
    '.dod-seg button.on{background:#18233f;border-color:#18233f;color:#fff}' +
    '.dod-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}' +
    '.dod-card{border:1px solid var(--border,#e3e8f3);border-radius:8px;padding:10px 12px 6px;background:var(--surface,#fff);min-width:0}' +
    '.dod-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}' +
    '.dod-top h4{margin:0;white-space:nowrap;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#6a7494)}' +
    '.dod-v{font-size:22px;font-weight:800;letter-spacing:-.6px;color:var(--ink,#18233f);line-height:1.1}' +
    '.dod-v u{text-decoration:none;font-size:12px;font-weight:700;color:var(--muted,#6a7494);margin-left:3px}' +
    '.dod-d{font-size:11px;font-weight:800;white-space:nowrap}.dod-d.up{color:#1f6b45}.dod-d.dn{color:#b0382c}.dod-d.eq{color:var(--muted,#6a7494)}' +
    '.dod-hd h4{flex:1 1 auto;min-width:0}.dod-hd .fh-note{white-space:nowrap}' +
    '.dod-s{font-size:10.5px;color:var(--muted,#6a7494);margin-bottom:6px}' +
    '.dod-foot{font-size:10.5px;color:var(--muted,#6a7494);line-height:1.55;margin-top:8px;max-width:940px}' +
    '.dod-empty{border:1px dashed var(--border,#e3e8f3);padding:22px;text-align:center;color:var(--muted,#6a7494);font-size:12px}';
  var el = document.createElement('style');
  el.id = 'dodCss'; el.textContent = css;
  document.head.appendChild(el);
})();

var dodMode = 'total';
try { dodMode = localStorage.getItem('lrmDodMode') === 'per' ? 'per' : 'total'; } catch (e) {}

var DOD_METRICS = [
  { key: 'calls', label: 'Calls',           ink: '#2348a8', unitT: '',   unitP: '/LRM' },
  { key: 'conn',  label: 'Connected calls', ink: '#18233f', unitT: '',   unitP: '/LRM' },
  { key: 'tt',    label: 'Talk time',       ink: '#1f6b45', unitT: 'hr', unitP: 'min/LRM' }
];

function dodToday() {
  if (typeof todayIST === 'function') return todayIST();
  var d = new Date(Date.now() + 330 * 60000);
  return d.toISOString().slice(0, 10);
}

function dodData() {
  var keep = {};
  filterAgents().forEach(function (r) {
    var e = String(r['Agent Id'] || '').trim().toLowerCase();
    if (e) keep[e] = 1;
  });
  var daily = D.dodRows && D.dodRows.length;
  var src = daily ? D.dodRows : (D.hourlyRows || []);
  var by = {};
  src.forEach(function (h) {
    var e = String(h.agent || h['Agent Id'] || '').trim().toLowerCase();
    if (!keep[e]) return;
    var d = String(h.date || h['Date'] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    var b = by[d] || (by[d] = { date: d, calls: 0, conn: 0, tt: 0, who: {} });
    var c = Number(h.calls) || 0;
    b.calls += c;
    b.conn  += Number(h.connected) || 0;
    b.tt    += Number(h.talkHr) || 0;
    if (c > 0) b.who[e] = 1;
  });
  var days = Object.keys(by).sort().map(function (d) {
    var b = by[d]; b.lrms = Object.keys(b.who).length; delete b.who; return b;
  });
  var last = days[days.length - 1];
  var live = !!last && last.date === dodToday()
    && typeof distElapsed === 'function' && typeof DIST_HOURS !== 'undefined'
    && distElapsed() < DIST_HOURS.length;
  if (last) last.partial = live;
  return { days: days, source: daily ? 'daily' : 'hourly' };
}

function dodVal(M, b) {
  var per = dodMode === 'per', n = b.lrms || 0;
  if (M.key === 'tt') return per ? (n ? b.tt * 60 / n : 0) : b.tt;
  return per ? (n ? b[M.key] / n : 0) : b[M.key];
}
function dodFmt(M, v) {
  if (M.key === 'tt' && dodMode !== 'per') return (Math.round(v * 10) / 10).toFixed(1);
  if (dodMode === 'per') return String(Math.round(v * 10) / 10);
  return fmt(Math.round(v));
}
function dodDay(iso) {
  var p = iso.split('-'), m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(p[1]) - 1];
  return Number(p[2]) + ' ' + m;
}
function dodDow(iso) {
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(iso + 'T00:00:00Z').getUTCDay()];
}

function dodSvg(M, days) {
  var W = 520, H = 172, L = 8, R = 8, T = 20, B = 30;
  var n = days.length, vals = days.map(function (b) { return dodVal(M, b); });
  var mx = Math.max.apply(null, vals.concat([0])) || 1;
  var slot = (W - L - R) / n, bw = Math.max(3, Math.min(34, slot * 0.64));
  var Y = function (v) { return T + (H - T - B) * (1 - v / mx); };
  var every = Math.max(1, Math.ceil(n / 12)), labelAll = n <= 14;
  var pid = 'dodHatch' + M.key;
  var s = '<defs><pattern id="' + pid + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        + '<rect width="6" height="6" fill="#eef1f8"/><rect width="3" height="6" fill="#c3ccdd"/></pattern></defs>';
  s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#e3e8f3"/>';
  days.forEach(function (b, i) {
    var v = vals[i], cx = L + slot * i + slot / 2, y = Y(v), last = i === n - 1;
    var tip = dodDow(b.date) + ' ' + dodDay(b.date) + ': ' + dodFmt(M, v) + ' ' + (dodMode === 'per' ? M.unitP : M.unitT)
            + ' · ' + fmt(b.lrms) + ' LRMs dialled'
            + (M.key === 'conn' && b.calls ? ' · ' + Math.round(b.conn / b.calls * 100) + '% of calls connected' : '')
            + (b.partial ? ' · shift still running' : '');
    s += '<g><title>' + esc(tip) + '</title>'
       + '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, Y(0) - y).toFixed(1)
       + '" rx="2" fill="' + (b.partial ? 'url(#' + pid + ')' : M.ink) + '"' + (b.partial ? '' : (last ? '' : ' fill-opacity=".78"')) + '/>';
    if (labelAll || last || v === mx) {
      s += '<text x="' + cx.toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" font-size="' + (n > 20 ? 8.5 : 9.5)
         + '" font-weight="700" fill="' + (b.partial ? '#6a7494' : '#18233f') + '">' + dodFmt(M, v) + '</text>';
    }
    if (i % every === 0 || last) {
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 16) + '" text-anchor="middle" font-size="9.5" font-weight="' + (last ? 700 : 400) + '" fill="#6a7494">' + dodDay(b.date) + '</text>'
         + '<text x="' + cx.toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="8.5" fill="#aab3c8">' + dodDow(b.date) + '</text>';
    }
    s += '</g>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="'
       + esc(M.label) + ' day on day" font-family="Segoe UI, system-ui, sans-serif">' + s + '</svg>';
}

function dodCard(M, days) {
  var full = days.filter(function (b) { return !b.partial; });
  var cur = full[full.length - 1], prev = full[full.length - 2];
  var unit = dodMode === 'per' ? M.unitP : M.unitT;
  var head = '', sub = '';
  if (cur) {
    var v = dodVal(M, cur);
    head = '<span class="dod-v">' + dodFmt(M, v) + (unit ? '<u>' + unit + '</u>' : '') + '</span>';
    if (prev) {
      var pv = dodVal(M, prev), ch = pv ? Math.round((v - pv) / pv * 1000) / 10 : 0;
      var cls = Math.abs(ch) < 0.5 ? 'eq' : (ch > 0 ? 'up' : 'dn');
      head += '<span class="dod-d ' + cls + '">' + (cls === 'eq' ? '±0%' : (ch > 0 ? '▲ +' : '▼ ') + ch + '%') + '</span>';
    }
    sub = dodDow(cur.date) + ' ' + dodDay(cur.date) + (prev ? ' vs ' + dodDow(prev.date) + ' ' + dodDay(prev.date) : ' · only one full day in range');
    if (M.key === 'conn' && cur.calls) sub += ' · ' + Math.round(cur.conn / cur.calls * 100) + '% of calls connected';
  } else {
    sub = 'No finished day in range yet';
  }
  return '<div class="dod-card"><div class="dod-top"><h4>' + esc(M.label) + '</h4>' + head + '</div>'
       + '<div class="dod-s">' + sub + '</div>' + dodSvg(M, days) + '</div>';
}

function renderDodTrend() {
  var host = document.getElementById('distDod');
  if (!host || !D) return;
  var d = dodData(), days = d.days;
  var seg = '<div class="dod-seg">'
    + '<button data-dod="total" class="' + (dodMode === 'total' ? 'on' : '') + '">Total</button>'
    + '<button data-dod="per" class="' + (dodMode === 'per' ? 'on' : '') + '">Per LRM</button></div>';
  var body;
  if (!days.length) {
    body = '<div class="dod-empty">No calling days for the LRMs in view in this range.</div>';
  } else if (days.length < 2) {
    body = '<div class="dod-empty">Only one day in range &mdash; widen the date filter to see a day-on-day trend.</div>';
  } else {
    body = '<div class="dod-grid">' + DOD_METRICS.map(function (M) { return dodCard(M, days); }).join('') + '</div>';
  }
  var partial = days.length && days[days.length - 1].partial;
  host.innerHTML =
    '<div class="fb-box"><div class="fh-hd dod-hd"><h4>Day-on-day &mdash; calls, connected calls, talk time</h4>'
    + '<span class="fh-note">' + fmt(days.length) + ' days &middot; ' + fmt(filterAgents().length) + ' LRMs in view'
    + (filtersActive() ? ' (filtered)' : '') + '</span>' + seg + '</div>'
    + body
    + '<div class="dod-foot">One bar per calling day for the LRMs in view. The change is the latest <b>finished</b> day '
    + 'against the one before it' + (partial ? '; today is <b>hatched</b> and left out of the change until the shift ends' : '')
    + '. <b>Per LRM</b> divides by LRMs who dialled that day, so a day with fewer people on the floor does not read as a drop '
    + '&mdash; use it before reading a Total dip as performance. Connected = customer answered (all durations). '
    + 'Hover a bar for the exact figures.'
    + (d.source === 'hourly' ? ' <i>Built from the hourly feed &mdash; the daily feed is not in this build yet.</i>' : '')
    + '</div></div>';
  host.querySelectorAll('[data-dod]').forEach(function (b) {
    b.addEventListener('click', function () {
      dodMode = b.getAttribute('data-dod');
      try { localStorage.setItem('lrmDodMode', dodMode); } catch (e) {}
      renderDodTrend();
    });
  });
}
