/* ════════════════════════════════════════════════════════════════════════════
   inbound.js — the Inbound tab: per-LRM inbound handling.

   SOURCE
   ------
   D.inboundPerf — the `Inbound_perf` tab of the Ozontel sheet, one row per
   Date × LRM. This is a DIFFERENT GRAIN from D.inboundRows (`inbound_route`,
   floor-wide per Date × Path, which stays on the Call Health tab). The two are
   not alternatives: routing is a vendor defect, this is handling, and the
   owners differ. Both can be live at once.

   WHY INBOUND IS ITS OWN TAB AND NEVER A DIAL COLUMN
   --------------------------------------------------
   Inbound is demand ARRIVING, not a dial. Folding it into the per-LRM dial
   denominator flatters the number and was ruled out deliberately. Nothing here
   feeds Call Count, the Floor Board bars or the EODR dial target.

   THREE CAVEATS THAT MUST TRAVEL WITH EVERY FIGURE ON THIS TAB
   ------------------------------------------------------------
   1. A per-LRM answer rate is "of calls that RANG me". ~35.5% of inbound legs
      reach no agent at all and have no owner column, so they can never enter
      anyone's denominator. The floor's true miss rate is worse than the best
      LRM row here, and lives on Call Health.
   2. The dialler posts RETRY LEGS, not calls — one call drew 49 zero-second
      legs in 25 seconds. If this sheet counts legs, "Total Calls" is inflated
      and that is a dialler/availability problem, never LRM behaviour.
   3. Disposition on inbound is not an outcome metric yet: 33 of 55 answered
      calls on 4 Sep were tagged "Call Not Connected", 9 of them after 2+ min
      of talk.

   DURATIONS
   ---------
   dur() accepts both shapes the sheet can hold — hh:mm:ss / mm:ss text, or a
   bare number — and returns MINUTES. A bare number is read as minutes and the
   card says so, because guessing hours would scale talk time by 60. If the
   column turns out to be hours, change ONE line in dur().
   ════════════════════════════════════════════════════════════════════════════ */

var inbMetric = (function(){ try { return localStorage.getItem('lrmInbMetric') || 'answerPct'; } catch(e){ return 'answerPct'; } })();
var inbSort = { col: 'answerPct', dir: 1 };
var INB_MIN_CALLS = 5;   // below this an answer % is noise, not a reading

/* Duration -> minutes. 'hh:mm:ss' and 'mm:ss' are parsed by position; a bare
   number is MINUTES (see header). Blank/garbage -> 0. */
function dur(v) {
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).trim();
  if (s.indexOf(':') >= 0) {
    var p = s.split(':').map(function(x){ return Number(x) || 0; });
    if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
    if (p.length === 2) return p[0] + p[1] / 60;
  }
  return Number(s.replace(/,/g, '')) || 0;
}
function inbPickNum(r, names) {
  for (var i = 0; i < names.length; i++) {
    var v = r[names[i]];
    if (v !== undefined && v !== null && v !== '') return Number(String(v).replace(/,/g, '')) || 0;
  }
  return 0;
}
function inbPick(r, names) {
  for (var i = 0; i < names.length; i++) if (r[names[i]] !== undefined && r[names[i]] !== '') return r[names[i]];
  return '';
}
function inbMin(v) { var n = Math.round(v); return n >= 60 ? (Math.floor(n / 60) + 'h ' + (n % 60) + 'm') : (n + 'm'); }
function inbPct(v, dp) {
  var n = Number(v);
  return isNaN(n) ? '<span style="color:#c0c4d6">&mdash;</span>' : n.toFixed(dp === undefined ? 1 : dp) + '%';
}

/* Per-LRM rollup, scoped by the filter bar — unlike the routing feed this one
   HAS an agent column, so the filter genuinely applies. Percentages are
   recomputed from the summed counts, never averaged across days. */
function inbRows() {
  if (!D || !D.inboundPerf || !D.inboundPerf.length) return [];
  var normEm = function(v){ return String(v||'').trim().toLowerCase().replace('@homes.solarsquare.in','@solarsquare.in'); };
  var meta = {};
  filterAgents().forEach(function(r){
    var raw = String(r['Agent Id']||'').trim().toLowerCase();
    if (!raw) return;
    meta[raw] = r; meta[normEm(raw)] = r;
  });
  var acc = {}, order = [];
  D.inboundPerf.forEach(function(r){
    var e = normEm(r._email || inbPick(r, ['LRM email','LRM Email','Agent Id']));
    if (!e || !meta[e]) return;
    var a = acc[e];
    if (!a) {
      a = acc[e] = { email: e, name: inbPick(r, ['Agent Name','LRM Name']) || agentName(e),
                     row: meta[e], days: 0, calls: 0, answered: 0, unanswered: 0,
                     talk: 0, wrap: 0, hold: 0, custDisc: 0, avgN: 0 };
      order.push(e);
    }
    a.days++;
    a.calls      += inbPickNum(r, ['Total Calls','Calls']);
    a.answered   += inbPickNum(r, ['Answered Calls','Answered']);
    a.unanswered += inbPickNum(r, ['Unanswered Calls','Unanswred Calls','Missed']);
    a.custDisc   += inbPickNum(r, ['Customer Disconnect']);
    a.talk       += dur(inbPick(r, ['Total Talk Time']));
    /* Averages are per-day figures in the sheet, so they are re-weighted by
       that day's answered calls rather than averaged flat — a 2-call day must
       not pull the mean as hard as a 40-call one. */
    var ans = inbPickNum(r, ['Answered Calls','Answered']);
    a.wrap += dur(inbPick(r, ['Avg. Wrapup Time','Avg Wrapup Time'])) * ans;
    a.hold += dur(inbPick(r, ['Avg. Hold Time','Avg Hold Time'])) * ans;
    a.avgN += ans;
  });
  return order.map(function(e){
    var a = acc[e], m = a.row || {};
    a.city = m['City'] || ''; a.tl = m['TL Name'] || '';
    a.answerPct = a.calls ? a.answered / a.calls * 100 : null;
    a.missPct   = a.calls ? a.unanswered / a.calls * 100 : null;
    a.avgTalk   = a.answered ? a.talk / a.answered : 0;
    a.avgWrap   = a.avgN ? a.wrap / a.avgN : 0;
    a.avgHold   = a.avgN ? a.hold / a.avgN : 0;
    a.discPct   = a.answered ? a.custDisc / a.answered * 100 : null;
    return a;
  });
}

function inbTotalsPerf(rows) {
  var t = { calls:0, answered:0, unanswered:0, talk:0, custDisc:0, lrms:rows.length, wrap:0, avgN:0 };
  rows.forEach(function(a){
    t.calls += a.calls; t.answered += a.answered; t.unanswered += a.unanswered;
    t.talk += a.talk; t.custDisc += a.custDisc; t.wrap += a.avgWrap * a.avgN; t.avgN += a.avgN;
  });
  t.answerPct = t.calls ? t.answered / t.calls * 100 : 0;
  t.avgTalk   = t.answered ? t.talk / t.answered : 0;
  t.avgWrap   = t.avgN ? t.wrap / t.avgN : 0;
  return t;
}

var INB_METRICS = {
  answerPct: { label: 'Answer %',      suffix: '%', goodHigh: true,  fmt: function(v){ return v.toFixed(1) + '%'; } },
  calls:     { label: 'Calls rung',    suffix: '',  goodHigh: true,  fmt: function(v){ return fmt(Math.round(v)); } },
  talk:      { label: 'Talk time',     suffix: '',  goodHigh: true,  fmt: function(v){ return inbMin(v); } },
  avgTalk:   { label: 'Avg talk',      suffix: '',  goodHigh: true,  fmt: function(v){ return (Math.round(v*10)/10) + 'm'; } },
  avgWrap:   { label: 'Avg wrap-up',   suffix: '',  goodHigh: false, fmt: function(v){ return (Math.round(v*10)/10) + 'm'; } },
  discPct:   { label: 'Cust. hung up', suffix: '%', goodHigh: false, fmt: function(v){ return v.toFixed(1) + '%'; } }
};

/* Ranked bars, worst first. LRMs under the call floor are dropped from the
   ranking rather than drawn — a 3-call LRM at 0% answered is not the floor's
   problem, and it used to sit at the top looking like one. */
function inbChart(rows) {
  var M = INB_METRICS[inbMetric] || INB_METRICS.answerPct;
  var view = rows.filter(function(a){ return a.calls >= INB_MIN_CALLS; });
  if (!view.length) view = rows;
  var items = view.map(function(a){
    return { label: a.name, value: Number(a[inbMetric]) || 0,
             sub: fmt(a.calls) + ' rung · ' + fmt(a.answered) + ' answered' + (a.city ? ' · ' + a.city : '') };
  }).sort(function(x,y){ return M.goodHigh ? x.value - y.value : y.value - x.value; }).slice(0, 20);
  return ccRankedBars(items, { suffix: M.suffix, goodHigh: M.goodHigh, labelW: 150,
                               aria: M.label + ' per LRM', fmt: M.fmt });
}

function inbTable(rows) {
  var th = function(key, label, cls) {
    var on = inbSort.col === key;
    return '<th class="' + (cls||'') + (on ? ' sorted' : '') + '" data-inbsort="' + key + '">'
         + esc(label) + (on ? (inbSort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
  };
  var sorted = rows.slice().sort(function(x,y){
    var a = x[inbSort.col], b = y[inbSort.col];
    if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b)) * inbSort.dir;
    return ((Number(a)||0) - (Number(b)||0)) * inbSort.dir;
  });
  var body = sorted.map(function(a){
    var thin = a.calls < INB_MIN_CALLS;
    var ansCls = a.answerPct === null ? '' : (a.answerPct >= 80 ? 'ok' : a.answerPct >= 60 ? 'warn' : 'bad');
    return '<tr' + (thin ? ' style="opacity:.55"' : '') + '>'
      + '<td style="text-align:left">' + esc(a.name) + '</td>'
      + '<td style="text-align:left">' + esc(a.city) + '</td>'
      + '<td style="text-align:left">' + esc(a.tl) + '</td>'
      + '<td class="sep">' + fmt(a.calls) + '</td>'
      + '<td>' + fmt(a.answered) + '</td>'
      + '<td class="' + (thin ? '' : ansCls) + '">' + inbPct(a.answerPct) + '</td>'
      + '<td class="sep">' + fmt(a.unanswered) + '</td>'
      + '<td>' + inbMin(a.talk) + '</td>'
      + '<td>' + (Math.round(a.avgTalk*10)/10) + 'm</td>'
      + '<td class="sep">' + (Math.round(a.avgWrap*10)/10) + 'm</td>'
      + '<td>' + (Math.round(a.avgHold*10)/10) + 'm</td>'
      + '<td class="sep">' + fmt(a.custDisc) + '</td>'
      + '<td>' + inbPct(a.discPct) + '</td>'
      + '<td>' + a.days + '</td></tr>';
  }).join('');
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + th('name','LRM') + '<th style="text-align:left">City</th><th style="text-align:left">TL</th>'
    + th('calls','Calls rung','sep') + th('answered','Answered') + th('answerPct','Answer %')
    + th('unanswered','Unanswered','sep') + th('talk','Talk time') + th('avgTalk','Avg talk')
    + th('avgWrap','Avg wrap-up','sep') + th('avgHold','Avg hold')
    + th('custDisc','Cust. hung up','sep') + th('discPct','% of answered') + th('days','Days')
    + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function renderInbound() {
  var panel = document.getElementById('inboundPanel');
  if (!panel || !D) return;
  var has = D.connHas && D.connHas.inboundPerf && D.inboundPerf && D.inboundPerf.length;
  if (!has) {
    panel.innerHTML = connStack(chNoSource('Inbound handling',
      'No Inbound_perf tab in the sheet yet. This view appears once that tab is landing — '
      + 'deliberately blank rather than showing zeroes.'));
    if (activeTab === 'inbound') setCount('no inbound feed');
    return;
  }
  var rows = inbRows();
  if (activeTab === 'inbound') setCount(rows.length + ' LRMs · inbound');
  if (!rows.length) {
    panel.innerHTML = connStack(chNoSource('Inbound handling',
      'The Inbound_perf tab has rows, but none for the LRMs currently in the filter.'));
    return;
  }
  var t = inbTotalsPerf(rows);
  window.__inbTable = inbTable(rows);

  var html = connStripCells([
    ['Calls rung', fmt(t.calls), 'reached an LRM\u2019s phone'],
    ['Answered', fmt(t.answered) + ' <u>' + t.answerPct.toFixed(0) + '%</u>', 'of calls that rang'],
    ['Unanswered', fmt(t.unanswered), 'rang, nobody picked up'],
    ['Talk time', inbMin(t.talk), 'inbound only, not in dial totals'],
    ['Avg talk', (Math.round(t.avgTalk*10)/10) + ' <u>min</u>', 'per answered call'],
    ['Customer hung up', fmt(t.custDisc), 'caller ended it, not the LRM']
  ]);

  html += ccCard({
    title: 'Who is missing the calls that ring them',
    note: rows.length + ' LRMs &middot; ' + esc(D.dateLabel || ''),
    sub: 'Per-LRM inbound from the <b>Inbound_perf</b> tab, scoped by the filter bar, worst answer rate first. '
       + 'Click any column to re-sort. LRMs under ' + INB_MIN_CALLS + ' calls are drawn faint — at three calls an '
       + 'answer rate is noise, not a reading.',
    body: window.__inbTable,
    foot: '<b>This is an answer rate of calls that RANG the LRM</b> — not of inbound demand. Roughly a third of '
        + 'inbound legs reach no agent at all and carry no owner, so they cannot enter anyone&rsquo;s denominator; '
        + 'the floor&rsquo;s real miss rate is worse than the worst row here and lives on <b>Call Health</b>. '
        + 'Inbound is deliberately kept out of every dial metric — it is demand arriving, not a dial, and folding '
        + 'it into the dial denominator flatters the number.'
  });

  html += ccCard({
    title: 'Before this is used to score anyone',
    note: 'read this',
    sub: 'Three known defects in the inbound feed, none of them LRM behaviour.',
    body: '<ol style="margin:0;padding-left:20px;font-size:12.5px;line-height:1.6;color:var(--ink,#2b3245)">'
        + '<li><b>The dialler posts retry legs, not calls.</b> One call on 4 Sep drew 49 zero-second legs in 25 '
        + 'seconds. If this tab&rsquo;s call count reads far above what the LRM remembers, check legs before '
        + 'checking the person — it is a dialler and availability problem. <i>Owner: Ozonetel.</i></li>'
        + '<li><b>Disposition is not yet an outcome.</b> On 4 Sep, 33 of 55 answered inbound calls were tagged '
        + '&ldquo;Call Not Connected&rdquo;, nine of them after more than two minutes of talk, and exactly one '
        + 'carried a real outcome. <i>Owner: floor coaching, and it must be fixed before any inbound outcome '
        + 'metric ships.</i></li>'
        + '<li><b>Talk-time coverage is uneven.</b> Ozonetel only began posting the call-end leg on 4 Sep; '
        + 'floor-wide coverage measured 41%. Read talk time as a floor, not a total, until a CDR cross-check '
        + 'agrees with it. <i>Owner: Ozonetel.</i></li>'
        + '</ol>',
    foot: 'Durations are read from the sheet as hh:mm:ss when they carry colons and as <b>minutes</b> when they '
        + 'are bare numbers. If the Inbound_perf columns are actually hours, say so and it is a one-line change.'
  });

  panel.innerHTML = connStack(html);
}

/* Delegated on document, ONCE: the table is moved into a modal appended to
   document.body, so a panel-scoped listener can never see these headers. */
if (!window.__inbSortWired) {
  window.__inbSortWired = true;
  document.addEventListener('click', function(e){
    var h = e.target && e.target.closest && e.target.closest('th[data-inbsort]');
    if (!h) return;
    var k = h.getAttribute('data-inbsort');
    if (inbSort.col === k) inbSort.dir = -inbSort.dir; else { inbSort.col = k; inbSort.dir = 1; }
    renderInbound();
  });
}
