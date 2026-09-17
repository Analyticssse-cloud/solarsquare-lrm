/* ════════════════════════════════════════════════════════════════════════════
   didview.js — the DID estate tab, built on the two feeds Code.gs actually
   writes (18 Sep 2026).

   WHY THIS FILE EXISTS
   --------------------
   The DID view used to read ONE feed: `did_rep`, the depth-adjusted reputation
   index. That card's id (`DID_REP_QUESTION_ID`) is still an empty string in
   Code.gs, so the tab is never written — the view rendered "no DID feed" while
   the sheet carried two populated DID tabs nobody was reading:

     did_overall      card 3305, PARAMETERLESS. One row per DID, connect % per
                      lead type at four windows (today / 7d / 15d / overall),
                      computed inside the SQL via NOW(). No Date column, full
                      replace every 15 minutes.
     did_day_on_day   card 3304, one row per Date × DID, same five rates.
                      History hard-pasted by its backfill; only today moves.

   WHAT THE FEEDS ALLOW, AND WHAT THEY DO NOT
   ------------------------------------------
   Every value in both is a PERCENTAGE. There are no dials and no connects
   anywhere — no denominators at all. Three consequences drive every decision
   below, and each is printed on the view rather than left in this comment:

   1. An estate figure can only be an UNWEIGHTED MEAN across DIDs. A DID that
      took 12 dials counts the same as one that took 900. It is a shape
      indicator, not the floor's connect rate — the floor's rate lives on the
      LRM feeds.
   2. A rate with no volume cannot be ranked safely. 14 Sep in this feed is a
      Sunday-shaped day of 0.0s and 100.0s off tiny denominators. So per-DID
      rows are a WATCH LIST sorted by movement, never a league table, and a DID
      with a blank `today` is left out of the movement ranking rather than
      drawn as zero.
   3. `did_overall` does NOT honour the date picker — it cannot, it has no Date
      column. The card says so in its own note. `did_day_on_day` does.

   THE ONE FINDING THIS VIEW IS BUILT TO CARRY
   -------------------------------------------
   Connectivity is a property of the LEAD TYPE far more than of the number:
   fresh leads run ~40-45%, retargeting ~20%, on the same DIDs in the same
   hours. So "bad numbers" is mostly the wrong frame — and the lead-type matrix
   is the first thing on the tab, above anything per-DID.

   The did_rep cards (callhealth.js → didRepCards) are appended underneath and
   appear automatically the day that card id is set.
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

/* ── The headline: connect % by lead type, four windows ────────────────────
   A matrix, not bars. The comparison that matters runs BOTH ways — across
   lead types (fresh vs retargeting, the finding) and across windows (is today
   below the 15-day line?) — and only a grid lets the eye do both. */
function dvTypeMatrix(rows) {
  var body = DID_TYPES.map(function(t){
    var isTotal = t.pre === 'total';
    /* The totals row is styled EXPLICITLY, not with class="grp". The shell's only
       .grp rule targets `tr.grp th` — a band row of header cells — so putting it
       on a row of <td>s applies nothing at all, which is how this row shipped
       looking like a fifth lead type. It is not a peer of the four above it: it
       is their blend, and the card's argument is reading those four AGAINST this
       line, so it has to carry the totals fill the rest of the dashboard uses. */
    var tdStyle = isTotal ? ' style="background:var(--blue-soft,#eef1f7);font-weight:600"' : '';
    var cells = DID_WINDOWS.map(function(w){
      var m = dvMean(rows, t.pre + w.suf);
      return '<td num="1"' + (w.suf === 'Today' ? ' class="sep"' : '') + tdStyle + '>' + dvPct(m) + '</td>';
    }).join('');
    /* Today against the 15-day line, which is the only honest "is this moving"
       read available: today and 15d are computed the same way by the same card
       over the same estate. */
    var mv = (function(){
      var a = dvMean(rows, t.pre + 'Today'), b = dvMean(rows, t.pre + '15d');
      return (a === null || b === null) ? null : a - b;
    })();
    return '<tr>'
      + '<td style="text-align:left' + (isTotal ? ';background:var(--blue-soft,#eef1f7);font-weight:600' : '') + '">'
      + (isTotal ? '<b>' + esc(t.label) + '</b>' : esc(t.label))
      + ' <u style="text-decoration:none;color:var(--muted);font-size:10.5px">' + esc(t.note) + '</u></td>'
      + cells
      + '<td num="1" class="sep"' + tdStyle + '>' + dvSigned(mv) + '</td></tr>';
  }).join('');
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th style="text-align:left">Lead type</th>'
    + DID_WINDOWS.map(function(w){ return '<th' + (w.suf === 'Today' ? ' class="sep"' : '') + '>' + esc(w.label) + '</th>'; }).join('')
    + '<th class="sep">Today vs 15d</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

/* ── Movement per DID ──────────────────────────────────────────────────────
   Today minus the 15-day line, worst first. This is deliberately NOT a
   ranking of connect rate: with no denominators a raw rate ranks noise, but a
   number that has moved several points against its OWN recent baseline is
   worth a look whatever its level. DIDs with no reading today are dropped. */
function dvMovementChart(rows) {
  var items = rows.map(function(r){
    var t = dvVal(r, 'totalToday'), b = dvVal(r, 'total15d');
    if (t === null || b === null) return null;
    return { label: String((r._c && r._c.did) || ''), value: t - b,
             sub: 'today ' + t.toFixed(1) + '% · 15d ' + b.toFixed(1) + '%' };
  }).filter(Boolean).sort(function(a, b){ return a.value - b.value; }).slice(0, 18);
  if (!items.length) return '';
  return ccRankedBars(items, { suffix: 'pp', goodHigh: true, signed: true, labelW: 132,
    aria: 'Movement in connect % per DID, today against the 15-day line',
    fmt: function(v){ return (v > 0 ? '+' : '') + (Math.round(v * 10) / 10) + 'pp'; } });
}

/* ── The estate curve, from did_day_on_day ─────────────────────────────────
   Unweighted mean per DAY across every DID in the feed, so the shape of the
   estate over time is visible at all — the one thing did_overall's four fixed
   windows cannot show. Deliberately drawn from EVERY day the tab holds, not
   the picked window, and labelled as such: a trend clipped to one picked day
   is not a trend. */
function dvTrend() {
  var src = (D && (D.didDodAllDays || D.didDod)) || [];
  if (!src.length) return '';
  var byDay = {};
  src.forEach(function(r){
    var c = r._c || {}, d = String(c.date || r['Date'] || '').trim().slice(0, 10);
    if (!d) return;
    if (!byDay[d]) byDay[d] = { total: [], fresh: [], ret: [], dids: 0 };
    var g = byDay[d];
    g.dids++;
    ['total', 'fresh', 'ret'].forEach(function(k){
      var v = c[k];
      if (v !== undefined && v !== null && v !== '' && isFinite(Number(v))) g[k].push(Number(v));
    });
  });
  var days = Object.keys(byDay).sort();
  if (days.length < 2) return '';
  var mean = function(a){ return a.length ? a.reduce(function(s, x){ return s + x; }, 0) / a.length : null; };
  var rows = days.map(function(d){
    var g = byDay[d];
    return { d: d, total: mean(g.total), fresh: mean(g.fresh), ret: mean(g.ret), dids: g.dids };
  });
  var vals = rows.map(function(r){ return r.total; }).filter(function(v){ return v !== null; });
  /* AXIS ZOOMED TO THE DATA, not anchored at zero. Daily estate means cluster in
     a narrow band (~22-30%), so a 0-based axis puts every bar in the top few
     percent of the track and the column reads as a rendering fault rather than a
     trend. The zoom is stated in the caption, because a non-zero baseline must
     never be implied: these bars compare days WITH EACH OTHER, and the figures
     beside them are the absolute read. */
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  var pad = Math.max(0.5, (hi - lo) * 0.25);
  var mn = Math.max(0, lo - pad), mx = hi + pad;
  var last = rows[rows.length - 1], first = rows[0];
  var band = function(v){ return v === null ? 0 : Math.max(2, (v - mn) / (mx - mn) * 100); };
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th style="text-align:left">Date</th><th class="sep">DIDs</th>'
    + '<th class="sep">All calls</th><th style="text-align:left;width:34%">Day against day</th>'
    + '<th class="sep">Fresh</th><th>Retargeting</th>'
    + '</tr></thead><tbody>'
    + rows.slice().reverse().map(function(r){
        return '<tr><td style="text-align:left" class="nm">' + esc(r.d) + '</td>'
          + '<td num="1" class="sep">' + r.dids + '</td>'
          + '<td num="1" class="sep">' + dvPct(r.total) + '</td>'
          + '<td><div class="fb-trk" style="margin:0"><i style="width:' + band(r.total).toFixed(1) + '%"></i></div></td>'
          + '<td num="1" class="sep">' + dvPct(r.fresh) + '</td>'
          + '<td num="1">' + dvPct(r.ret) + '</td></tr>';
      }).join('')
    + '</tbody></table></div>'
    + '<div class="fb-sub" style="padding-top:10px">' + days.length + ' days in the tab, '
    + esc(first.d) + ' to ' + esc(last.d) + '. Unweighted mean across the DIDs present each day \u2014 '
    + 'a day on which only a handful of numbers were used reads as loudly as a full one. '
    + '<b>The bars compare days with each other on a zoomed axis (' + mn.toFixed(1) + ' to '
    + mx.toFixed(1) + '%), not against zero</b> — the figures beside them are the absolute read.</div>';
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

function renderDID() {
  var panel = document.getElementById('didPanel');
  if (!panel || !D) return;
  var rows = dvRows();
  var hasOverall = D.connHas && D.connHas.didOverall && rows.length;
  var hasDod = D.connHas && D.connHas.didDod;
  var hasRep = D.connHas && D.connHas.did && D.didRows && D.didRows.length;

  if (activeTab === 'did') {
    setCount(hasOverall ? rows.length + ' DIDs' : (hasDod ? 'day-on-day only' : 'no DID feed'));
  }

  if (!hasOverall && !hasDod && !hasRep) {
    var g = (D && D.didOverallDiag) || {};
    panel.innerHTML = connStack(chNoSource('DID estate',
      'No DID feed for this view yet. ' + (g.tab ? 'Read ' + (g.rows || 0) + ' rows from ' + g.tab + '.'
        : 'Neither did_overall nor did_day_on_day answered \u2014 run setupDidOverallTab() and setupDidDodTab() '
        + 'in Apps Script, then installDidDodTrigger().')));
    return;
  }

  var html = '';

  if (hasOverall) {
    html += connStripCells([
      ['Numbers in estate', fmt(rows.length), 'every DID the card returned'],
      ['All calls today', dvPct(dvMean(rows, 'totalToday'), 1), 'unweighted mean across DIDs'],
      ['15-day line', dvPct(dvMean(rows, 'total15d'), 1), 'the same figure, 15 days'],
      ['Fresh leads today', dvPct(dvMean(rows, 'freshToday'), 1), 'first contact'],
      ['Retargeting today', dvPct(dvMean(rows, 'retToday'), 1), 'previously worked'],
      ['Fresh advantage', (function(){
        var a = dvMean(rows, 'freshToday'), b = dvMean(rows, 'retToday');
        return (a === null || b === null) ? '&mdash;' : (a - b).toFixed(1) + ' <u>pp</u>';
      })(), 'the gap the estate turns on']
    ]);

    window.__dvTable = dvTable(rows);

    html += ccCard({
      title: 'Connectivity is a property of the LEAD TYPE, not the number',
      note: rows.length + ' DIDs &middot; four fixed windows',
      sub: 'Connect % by lead type, averaged across every number in the estate. Fresh leads and retargeting run '
         + 'on the <b>same numbers in the same hours</b> \u2014 so a gap between those two rows is not a number '
         + 'problem, and the last column shows whether today sits below each type&rsquo;s own 15-day line.',
      body: dvTypeMatrix(rows),
      foot: '<b>These four windows are computed inside the card via NOW(), so they do not follow the date '
          + 'picker</b> \u2014 today means today, whatever range is selected above. Every figure is an '
          + '<b>unweighted mean across DIDs</b>: this feed carries no dials and no connects, so a number that '
          + 'took twelve calls counts as much as one that took nine hundred. Read it as the estate&rsquo;s shape, '
          + 'never as the floor&rsquo;s connect rate \u2014 that one comes off the LRM feeds.'
    });

    var mv = dvMovementChart(rows);
    if (mv) {
      html += ccCard({
        title: 'Numbers that moved against their own baseline',
        note: 'today vs 15-day line',
        sub: 'Worst 18. <b>This is not a ranking of connect rate</b> \u2014 with no denominators a raw rate ranks '
           + 'noise, and a three-dial number at 100% would lead it. A number several points below its own '
           + 'recent line is worth a look whatever its level. Numbers with no reading today are left out '
           + 'rather than drawn as zero.',
        table: true, tableLabel: 'View every number', tableSrc: '__dvTable',
        tableTitle: 'Every DID \u00b7 all lead types',
        body: mv,
        foot: 'Movement is the honest read available from this feed: today and the 15-day line are computed the '
            + 'same way, by the same card, over the same estate. A cohort of numbers live only a few days will '
            + 'show a large move for that reason alone \u2014 check first-seen before acting on one.'
      });
    }
  }

  var trend = dvTrend();
  if (trend) {
    html += ccCard({
      title: 'The estate day by day',
      note: 'did_day_on_day',
      sub: 'Mean connect % per day across the numbers in use that day, with fresh and retargeting beside the '
         + 'blended figure. This is the only curve the DID feeds can draw \u2014 <b>did_overall</b> above has four '
         + 'fixed windows and no history.',
      body: trend,
      foot: 'Drawn from <b>every day the tab holds</b>, not the picked range, because a trend clipped to one '
          + 'selected day is not a trend. Weekends and holidays sit on tiny denominators \u2014 a day of 0.0s and '
          + '100.0s is a volume artefact, not a collapse. Gate on the DIDs column before reading a spike.'
    });
  }

  if (hasRep) {
    html += '<div style="margin-top:18px;padding-top:4px;border-top:1px solid #e4e7f0">'
          + '<div style="font-weight:600;font-size:11px;line-height:1.2;letter-spacing:.09em;'
          + 'text-transform:uppercase;color:var(--muted);margin:10px 0 12px">Depth-adjusted reputation index '
          + '\u00b7 did_rep</div></div>'
          + didRepCards();
  }

  html += ccCard({
    title: 'Before this is used to buy or retire numbers',
    note: 'read this',
    sub: 'What these two feeds can and cannot settle.',
    body: '<ol style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.6;color:var(--ink,#2b3245)">'
        + '<li><b>There are no denominators in this data.</b> Every column is a percentage; no dials, no '
        + 'connects. So there is no volume gate available, no weighting, and no depth adjustment \u2014 a number '
        + 'handed fresher leads will read better for that reason alone. The depth-adjusted index that fixes '
        + 'this is <code>did_rep</code>, and <b>its Metabase card id is still unset in Code.gs</b>, so it '
        + 'never lands. Setting <code>DID_REP_QUESTION_ID</code> is the single highest-value change here.</li>'
        + '<li><b>The lead-type gap is the finding, not the number-quality gap.</b> Fresh leads run roughly '
        + 'twice retargeting on the same numbers. Any comparison between two DIDs that ignores their lead mix '
        + 'is measuring the mix.</li>'
        + '<li><b>A fresh cohort reads high, and that may be exposure, not identity.</b> Ten numbers live from '
        + '11 Sep ran 37\u201345% against an aged estate at ~26%, but five aged numbers carrying only ~6 dials a '
        + 'day ran 33\u201346%. Fresh ~41%, aged-but-idle ~40%, aged-and-hammered ~26% points at a <b>volume '
        + 'ceiling</b> \u2014 in which case buying numbers buys weeks, not a fix. Run '
        + '<code>sql/did-decay-v1.sql</code> before signing off provisioning.</li>'
        + '<li><b>Outranking all of it:</b> these are ordinary 10-digit numbers, and under the TCCCPR Second '
        + 'Amendment of 12 February 2025 promotional calls must originate from the 140 series. Get that '
        + 'answered by legal before provisioning more.</li>'
        + '</ol>',
    foot: 'Dial assignment is round-robin per CALL, not sticky per lead, so a DID difference can never be '
        + '&ldquo;this number pestered this customer&rdquo;. It also means the index earns its keep at caller '
        + 'grain more than at DID grain.'
  });

  panel.innerHTML = connStack(html);
  if (typeof ccWireTables === 'function') ccWireTables(panel, 'Every DID \u00b7 all lead types', window.__dvTable || '');
  if (hasRep && typeof didRepWire === 'function') didRepWire(panel);

  panel.querySelectorAll('table.dist th[data-dvsort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-dvsort');
      if (dvSort.col === k) dvSort.dir = -dvSort.dir; else { dvSort.col = k; dvSort.dir = 1; }
      window.__dvTable = dvTable(dvRows());
      renderDID();
    });
  });
}

Object.assign(window, { renderDID: renderDID });
