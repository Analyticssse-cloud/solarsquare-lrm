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
   The API coerces durations to MINUTES into r._c, and the unit is a PROPERTY OF
   THE FEED, not a guess: this card emits Total Talk Time, Avg. Talk Time, Avg.
   Wrapup Time and Avg. Hold Time in **SECONDS** (Code.gs says so, and warns
   against cross-reconciling with the Ozontel tab's 'Total Talk Time', which is
   HOURS). dur() below is the fallback for a pre-rebuild payload and divides by
   60 for the same reason. Reading these as minutes inflates talk time 60x — the
   first cut of this file did exactly that.

   CANONICAL FIELDS (rebuild, 18 Sep 2026)
   ---------------------------------------
   Every row carries r._c — date, email, name, calls, answered, answerPct,
   unanswered, unansPct, talk, avgTalk, wrap, hold, custDisc, agentDisc, ring,
   queue, did, legs — bound by NORMALISED header key, so casing, spacing,
   underscores, a trailing % and the sheet's 'Unanswred' typo are all
   irrelevant. A field the sheet does not have is ABSENT from _c, never 0: a
   missing column and a zero are different facts. cv() below prefers _c and
   falls back to the old header-name lookup, so this file works against either
   payload.
   ════════════════════════════════════════════════════════════════════════════ */

var inbMetric = (function(){ try { return localStorage.getItem('lrmInbMetric') || 'answerPct'; } catch(e){ return 'answerPct'; } })();
var inbSort = { col: 'answerPct', dir: 1 };
var INB_MIN_CALLS = 5;   // below this an answer % is noise, not a reading

/* Duration -> MINUTES. 'hh:mm:ss' and 'mm:ss' are parsed by position; a bare
   number is SECONDS, because that is what card 3301 emits (see header). */
function dur(v) {
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).trim();
  if (s.indexOf(':') >= 0) {
    var p = s.split(':').map(function(x){ return Number(x) || 0; });
    if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
    if (p.length === 2) return p[0] + p[1] / 60;
  }
  var n = Number(s.replace(/,/g, ''));
  return isFinite(n) ? n / 60 : 0;
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
/* Canonical value. field = a key of r._c; names = the legacy header spellings
   to fall back on; kind 'num' | 'dur' | 'text'. _c values are ALREADY coerced
   (durations in minutes, percents in points), so the fallback parsers only run
   on a pre-rebuild payload. */
function cv(r, field, names, kind) {
  var c = r._c || {};
  if (c[field] !== undefined && c[field] !== null && c[field] !== '') {
    return kind === 'text' ? c[field] : (Number(c[field]) || 0);
  }
  if (!names) return kind === 'text' ? '' : 0;
  return kind === 'text' ? inbPick(r, names)
       : kind === 'dur' ? dur(inbPick(r, names))
       : inbPickNum(r, names);
}
/* Legacy header names per canonical field. Needed because a payload from before
   the rebuild (and the preview harness's mock) carries raw headers only, with no
   _c block — without this, every column would test as "absent from the sheet"
   and the table would collapse to three columns against perfectly good data. */
var INB_LEGACY = {
  date:['Date'], email:['LRM email','LRM Email','Agent Id'], name:['Agent Name','LRM Name'],
  calls:['Total Calls','Calls'], answered:['Answered Calls','Answered'],
  unanswered:['Unanswered Calls','Unanswred Calls','Missed'], talk:['Total Talk Time'],
  wrap:['Avg. Wrapup Time','Avg Wrapup Time'], hold:['Avg. Hold Time','Avg Hold Time'],
  custDisc:['Customer Disconnect'], agentDisc:['Agent Disconnect'],
  ring:['Avg Ring Time'], queue:['Avg Queue Time'], legs:['Dial Legs'], did:['DID']
};
/* Does the SHEET carry this column at all, anywhere in the window? Drives
   "column absent" vs "column reads zero" — never conflate them. */
function inbHasField(field) {
  if (!D || !D.inboundPerf) return false;
  var legacy = INB_LEGACY[field] || [];
  for (var i = 0; i < D.inboundPerf.length; i++) {
    var r = D.inboundPerf[i], c = r._c;
    if (c && c[field] !== undefined && c[field] !== null && c[field] !== '') return true;
    for (var j = 0; j < legacy.length; j++) {
      if (r[legacy[j]] !== undefined && r[legacy[j]] !== null && r[legacy[j]] !== '') return true;
    }
  }
  return false;
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
  /* Date scope, client side as well as server side. The API already narrows
     Inbound_perf to the picked window, but the preview harness and any stale
     payload do not — and a tab that silently sums the sheet's whole history
     against one selected day is the defect this guard exists for. */
  var from = String((D && D.fromDate) || ''), to = String((D && D.toDate) || '');
  /* Client-side date guard. This is the SECOND filter — the API already narrowed
     `inbound perf` to the picked window — and it exists for the preview harness
     and for a stale payload, because a tab that sums its whole history against
     one selected day is the defect it is here to stop.

     It must be tolerant and it must FAIL OPEN. v1 accepted only yyyy-mm-dd and
     dropped everything else, so a sheet writing 17/09/2026 or an ISO timestamp
     would have emptied the table even though the server had scoped it properly.
     Now: yyyy-mm-dd (or any string starting with one), dd/mm/yyyy and mm/dd/yyyy
     are parsed; anything unparseable is KEPT and left to the server's filter. */
  var inbISO = function(v){
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) {
      /* Ambiguous when both parts are <= 12. The sheet is written by Apps Script
         in Asia/Kolkata, so day-first is the right assumption; it only matters
         for the first twelve days of a month and both readings fall in the same
         month, which the window test tolerates. */
      var a = Number(m[1]), b = Number(m[2]);
      var day = a > 12 ? a : (b > 12 ? b : a), mon = a > 12 ? b : (b > 12 ? a : b);
      return m[3] + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    return '';
  };
  var inWindow = function(v){
    if (!from || !to) return true;
    var d = inbISO(v);
    if (!d) return true;   // unparseable -> trust the server, do not silently drop
    return d >= from && d <= to;
  };
  var acc = {}, order = [];
  D.inboundPerf.forEach(function(r){
    if (!inWindow(cv(r, 'date', ['Date'], 'text'))) return;
    var e = normEm(r._email || cv(r, 'email', ['LRM email','LRM Email','Agent Id'], 'text'));
    if (!e || !meta[e]) return;
    var a = acc[e];
    if (!a) {
      a = acc[e] = { email: e, name: cv(r, 'name', ['Agent Name','LRM Name'], 'text') || agentName(e),
                     row: meta[e], days: 0, calls: 0, answered: 0, unanswered: 0,
                     talk: 0, wrap: 0, hold: 0, custDisc: 0, agentDisc: 0, ring: 0, queue: 0,
                     legs: 0, avgN: 0 };
      order.push(e);
    }
    a.days++;
    a.calls      += cv(r, 'calls',      ['Total Calls','Calls'], 'num');
    a.answered   += cv(r, 'answered',   ['Answered Calls','Answered'], 'num');
    a.unanswered += cv(r, 'unanswered', ['Unanswered Calls','Unanswred Calls','Missed'], 'num');
    a.custDisc   += cv(r, 'custDisc',   ['Customer Disconnect'], 'num');
    a.agentDisc  += cv(r, 'agentDisc',  ['Agent Disconnect'], 'num');
    a.legs       += cv(r, 'legs',       ['Dial Legs'], 'num');
    a.talk       += cv(r, 'talk',       ['Total Talk Time'], 'dur');
    /* Averages are per-day figures in the sheet, so they are re-weighted by
       that day's answered calls rather than averaged flat — a 2-call day must
       not pull the mean as hard as a 40-call one. */
    var ans = cv(r, 'answered', ['Answered Calls','Answered'], 'num');
    a.wrap  += cv(r, 'wrap',  ['Avg. Wrapup Time','Avg Wrapup Time'], 'dur') * ans;
    a.hold  += cv(r, 'hold',  ['Avg. Hold Time','Avg Hold Time'], 'dur') * ans;
    a.ring  += cv(r, 'ring',  ['Avg Ring Time'], 'dur') * ans;
    a.queue += cv(r, 'queue', ['Avg Queue Time'], 'dur') * ans;
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
    a.avgRing   = a.avgN ? a.ring / a.avgN : 0;
    a.avgQueue  = a.avgN ? a.queue / a.avgN : 0;
    /* Legs per call is a DIALLER reading, not an LRM one — see caveat 2. */
    a.legsPer   = a.calls && a.legs ? a.legs / a.calls : null;
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
  t.legs = 0;
  rows.forEach(function(a){ t.legs += a.legs || 0; });
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
  var AV = inbMetricsAvail();
  if (!AV[inbMetric]) inbMetric = Object.keys(AV)[0];
  var M = AV[inbMetric];
  var view = rows.filter(function(a){ return a.calls >= INB_MIN_CALLS; });
  if (!view.length) view = rows;
  var items = view.map(function(a){
    return { label: a.name, value: Number(a[inbMetric]) || 0,
             sub: fmt(a.calls) + ' rung · ' + fmt(a.answered) + ' answered' + (a.city ? ' · ' + a.city : '') };
  }).sort(function(x,y){ return M.goodHigh ? x.value - y.value : y.value - x.value; }).slice(0, 20);
  return ccRankedBars(items, { suffix: M.suffix, goodHigh: M.goodHigh, labelW: 150,
                               aria: M.label + ' per LRM', fmt: M.fmt });
}

/* Only offer a ranking metric the sheet can actually feed. A metric bar for a
   column that does not exist draws a floor of zeroes and reads as a finding. */
var INB_METRIC_NEEDS = { answerPct:'calls', calls:'calls', talk:'talk', avgTalk:'talk',
                         avgWrap:'wrap', discPct:'custDisc' };
function inbMetricsAvail() {
  var out = {};
  Object.keys(INB_METRICS).forEach(function(k){
    var need = INB_METRIC_NEEDS[k];
    if (!need || inbHasField(need)) out[k] = INB_METRICS[k];
  });
  return Object.keys(out).length ? out : { answerPct: INB_METRICS.answerPct };
}

/* ══ COLUMN SPEC — the rebuild ═══════════════════════════════════════════
   The table used to be a fixed fourteen columns, which is why a sheet that does
   not carry one of them rendered a column of zeroes — indistinguishable from a
   real zero. Now every column declares the canonical field it needs and is NOT
   DRAWN when no header bound to that field. Consequences worth keeping:
     • the tab is correct against whatever `inbound perf` currently carries;
     • a column added to the sheet appears with no code change;
     • 'column absent' and 'column reads zero' stay different on screen.
   need:null = always drawn (roster-derived, or computed from required columns).
   grp starts a rule group — the leading vertical hairline, suppressed when the
   column happens to be the first one drawn. */
var INB_COLS = [
  { key:'name',      label:'LRM',            align:'left', need:null,     txt:true, fmt:function(a){ return esc(a.name); } },
  { key:'city',      label:'City',           align:'left', need:null,     txt:true, sortable:false, fmt:function(a){ return esc(a.city); } },
  { key:'tl',        label:'TL',             align:'left', need:null,     txt:true, sortable:false, fmt:function(a){ return esc(a.tl); } },
  { key:'calls',     label:'Calls rung',     need:'calls',     grp:true, fmt:function(a){ return fmt(a.calls); } },
  { key:'answered',  label:'Answered',       need:'answered',  fmt:function(a){ return fmt(a.answered); } },
  { key:'answerPct', label:'Answer %',       need:'answered',  status:true, fmt:function(a){ return inbPct(a.answerPct); } },
  { key:'unanswered',label:'Unanswered',     need:'unanswered',grp:true, fmt:function(a){ return fmt(a.unanswered); } },
  { key:'talk',      label:'Talk time',      need:'talk',      fmt:function(a){ return inbMin(a.talk); } },
  { key:'avgTalk',   label:'Avg talk',       need:'talk',      fmt:function(a){ return (Math.round(a.avgTalk*10)/10) + 'm'; } },
  { key:'avgWrap',   label:'Avg wrap-up',    need:'wrap',      grp:true, fmt:function(a){ return (Math.round(a.avgWrap*10)/10) + 'm'; } },
  { key:'avgHold',   label:'Avg hold',       need:'hold',      fmt:function(a){ return (Math.round(a.avgHold*10)/10) + 'm'; } },
  { key:'avgRing',   label:'Avg ring',       need:'ring',      fmt:function(a){ return (Math.round(a.avgRing*10)/10) + 'm'; } },
  { key:'avgQueue',  label:'Avg queue',      need:'queue',     fmt:function(a){ return (Math.round(a.avgQueue*10)/10) + 'm'; } },
  { key:'custDisc',  label:'Cust. hung up',  need:'custDisc',  grp:true, fmt:function(a){ return fmt(a.custDisc); } },
  { key:'discPct',   label:'% of answered',  need:'custDisc',  fmt:function(a){ return inbPct(a.discPct); } },
  { key:'agentDisc', label:'LRM hung up',    need:'agentDisc', fmt:function(a){ return fmt(a.agentDisc); } },
  /* Legs is a DIALLER reading. It is drawn apart from the handling columns and
     labelled as such, because a high value is an Ozonetel retry storm and must
     never be read as the LRM taking more calls. */
  { key:'legs',      label:'Dial legs',      need:'legs',      grp:true, fmt:function(a){ return fmt(a.legs); } },
  { key:'legsPer',   label:'Legs / call',    need:'legs',      fmt:function(a){ return a.legsPer === null ? '<span style="color:#c0c4d6">&mdash;</span>' : (Math.round(a.legsPer*10)/10); } },
  { key:'days',      label:'Days',           need:null,        grp:true, fmt:function(a){ return a.days; } }
];
function inbColsLive() {
  var live = INB_COLS.filter(function(c){ return !c.need || inbHasField(c.need); });
  if (live.length) live[0] = Object.assign({}, live[0], { grp:false });
  return live;
}

function inbTable(rows) {
  var cols = inbColsLive();
  /* A sort column that is no longer drawn would sort by undefined — fall back
     to the first sortable one rather than silently shuffling. */
  if (!cols.some(function(c){ return c.key === inbSort.col && c.sortable !== false; })) {
    inbSort = { col: cols.some(function(c){ return c.key === 'answerPct'; }) ? 'answerPct' : cols[0].key, dir: 1 };
  }
  var head = cols.map(function(c){
    var cls = (c.grp ? 'sep' : '') + (inbSort.col === c.key ? ' sorted' : '');
    var arrow = inbSort.col === c.key ? (inbSort.dir > 0 ? ' ▲' : ' ▼') : '';
    var style = c.align === 'left' ? ' style="text-align:left"' : '';
    if (c.sortable === false) return '<th class="' + cls + '"' + style + '>' + esc(c.label) + '</th>';
    return '<th class="' + cls + '"' + style + ' data-inbsort="' + c.key + '">' + esc(c.label) + arrow + '</th>';
  }).join('');
  var sorted = rows.slice().sort(function(x,y){
    var a = x[inbSort.col], b = y[inbSort.col];
    if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b)) * inbSort.dir;
    return ((Number(a)||0) - (Number(b)||0)) * inbSort.dir;
  });
  var body = sorted.map(function(a){
    var thin = a.calls < INB_MIN_CALLS;
    /* Status lives on the FIGURE, and only where the reading is thick enough to
       mean something — an answer rate off three calls is noise, so the row is
       drawn faint and carries no colour at all. */
    var ansCls = a.answerPct === null ? '' : (a.answerPct >= 80 ? 'ok' : a.answerPct >= 60 ? 'warn' : 'bad');
    return '<tr' + (thin ? ' style="opacity:.55"' : '') + '>' + cols.map(function(c){
      var cls = (c.grp ? 'sep' : '') + (c.status && !thin ? ' ' + ansCls : '');
      var style = c.align === 'left' ? ' style="text-align:left"' : '';
      return '<td class="' + cls.trim() + '"' + style + (c.txt ? '' : ' num="1"') + '>' + c.fmt(a) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>' + head
    + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function renderInbound() {
  var panel = document.getElementById('inboundPanel');
  if (!panel || !D) return;
  var has = D.connHas && D.connHas.inboundPerf && D.inboundPerf && D.inboundPerf.length;
  if (!has) {
    /* The empty state now REPORTS, because the last time this card was blank the
       cause was a tab-name typo ('inbound perf' vs 'Inbound_perf') and the card
       said "not in the sheet yet" for a tab that was full of data. */
    var g = (D && D.inboundDiag) || {};
    var lines = [];
    lines.push('Tab resolved: ' + (g.tab ? '<b>' + esc(g.tab) + '</b>' : '<b>none</b> — no tab answered any known spelling'));
    if (g.rows !== undefined) lines.push('Rows in tab: <b>' + g.rows + '</b>');
    if (g.kept !== undefined) lines.push('Rows kept after exclusions: <b>' + g.kept + '</b>');
    if (g.undated) lines.push('Dropped with no parseable date: <b>' + g.undated + '</b>');
    if (g.inWindow !== undefined) lines.push('In the picked window (' + esc(g.window || '') + '): <b>' + g.inWindow + '</b>');
    if (g.unmapped && g.unmapped.length) lines.push('Fields no header bound to: ' + esc(g.unmapped.join(', ')));
    if (g.headers && g.headers.length) lines.push('Header row the tab actually carries: <span style="font-family:ui-monospace,monospace;font-size:11.5px">' + esc(g.headers.join(' · ')) + '</span>');
    if (g.mapped && g.mapped.length) lines.push('Bound: <span style="font-family:ui-monospace,monospace;font-size:11.5px">' + esc(g.mapped.join(' · ')) + '</span>');
    if (g.error) lines.push('Last read error: ' + esc(g.error));
    panel.innerHTML = connStack(chNoSource('Inbound handling',
      'No per-LRM inbound rows for this window. What the feed actually did:')
      + '<div style="margin-top:10px;font-size:12.5px;line-height:1.7;color:var(--ink,#2b3245)">'
      + lines.join('<br>') + '</div>');
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
  var g = (D && D.inboundDiag) || {};

  /* The strip is built the same way as the table: a cell whose column the sheet
     does not carry is omitted, not drawn as zero. */
  var cells = [
    ['Calls rung', fmt(t.calls), 'reached an LRM\u2019s phone']
  ];
  if (inbHasField('answered')) cells.push(['Answered', fmt(t.answered) + ' <u>' + t.answerPct.toFixed(0) + '%</u>', 'of calls that rang']);
  if (inbHasField('unanswered')) cells.push(['Unanswered', fmt(t.unanswered), 'rang, nobody picked up']);
  if (inbHasField('talk')) {
    cells.push(['Talk time', inbMin(t.talk), 'inbound only, not in dial totals']);
    cells.push(['Avg talk', (Math.round(t.avgTalk*10)/10) + ' <u>min</u>', 'per answered call']);
  }
  if (inbHasField('custDisc')) cells.push(['Customer hung up', fmt(t.custDisc), 'caller ended it, not the LRM']);
  if (inbHasField('legs')) cells.push(['Dial legs', fmt(t.legs), 'dialler retries, not calls']);
  var html = connStripCells(cells);

  html += ccCard({
    title: 'Who is missing the calls that ring them',
    note: rows.length + ' LRMs &middot; ' + esc(D.dateLabel || ''),
    sub: 'Per-LRM inbound from the <b>' + esc(g.tab || 'inbound perf') + '</b> tab, scoped by the filter bar, '
       + 'worst answer rate first. Click any column to re-sort. LRMs under ' + INB_MIN_CALLS + ' calls are drawn '
       + 'faint — at three calls an answer rate is noise, not a reading. Columns the tab does not carry are not '
       + 'drawn at all, so an empty column here means the sheet has no such figure, never that the figure is zero.',
    body: window.__inbTable
        + (g.tab ? '<div style="margin-top:8px;font-size:11px;line-height:1.5;color:var(--muted)">Read from '
        + (g.rows || 0) + ' rows in <b>' + esc(g.tab) + '</b> · ' + (g.inWindow || rows.length) + ' in window'
        + (g.undated ? ' · ' + g.undated + ' dropped with no date' : '')
        + ((g.unmapped && g.unmapped.length) ? ' · not in this sheet: ' + esc(g.unmapped.join(', ')) : '')
        + '</div>' : ''),
    foot: '<b>This is an answer rate of calls that RANG the LRM</b> — not of inbound demand. Roughly a third of '
        + 'inbound legs reach no agent at all and carry no owner, so they cannot enter anyone&rsquo;s denominator; '
        + 'the floor&rsquo;s real miss rate is worse than the worst row here and is in the <b>routing</b> section '
        + 'below. '
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
    foot: 'Talk, wrap-up and hold arrive from card 3301 in <b>seconds</b> and are converted to minutes in one '
        + 'place — never cross-reconcile them with the Ozontel tab’s <i>Total Talk Time</i>, which is in hours. '
        + 'Columns bind by normalised header name, so re-spelling a header in the sheet cannot blank a column.'
  });

  /* Inbound ROUTING, moved here from the retired Call Health tab (18 Sep 2026).
     It belongs under Inbound and it belongs BELOW the per-LRM table, in that
     order: the handling table is about people, the routing section is about the
     platform, and the routing figures are where the floor's real miss rate
     lives — the one the per-LRM answer rate cannot show. */
  if (typeof inbRoutingSection === 'function') {
    var routing = inbRoutingSection();
    if (routing) {
      html += '<div style="margin-top:18px;padding-top:4px;border-top:1px solid #e4e7f0">'
            + '<div style="font-weight:600;font-size:11px;line-height:1.2;letter-spacing:.09em;'
            + 'text-transform:uppercase;color:var(--muted);margin:10px 0 12px">Routing · where inbound demand is lost '
            + 'before an LRM ever rings — owner: Ozonetel, not the floor</div></div>' + routing;
    }
  }

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
