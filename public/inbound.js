/* ════════════════════════════════════════════════════════════════════════════
   inbound.js — the Inbound tab. REBUILT 18 Sep 2026 to the LRM tab's shape:
   a floor-board metric strip over ONE plain sortable table, one row per LRM.

   WHY THE SHAPE CHANGED
   ---------------------
   The tab used to be a ranked-bar card plus a `.dist` table plus two prose
   cards. Nobody reads a second grammar for the same kind of data: this is a
   per-LRM roster table exactly like the LRM tab, so it sorts, scrolls and
   prints like one, with the Floor Board's `.fb-strip` cards above it.

   WHAT THE SHEET ACTUALLY CARRIES (header row read live, 18 Sep 2026)
   ------------------------------------------------------------------
   Date · LRM email · Total Calls Received · Answered Calls · Not Answered
   Calls · Talk Time · Not Answered Reasons · Agent Name · Rang & Missed ·
   Not Routed - Owner Busy · Not Routed - Other · Pickup % (when rang) ·
   Answered % (overall) · Talk Time (s) · Avg. Talk Time (s) ·
   Avg. Wrapup Time (s) · Avg. Hold Time (s) · Customer Disconnect

   Two bindings that were wrong and emptied the tab: `Total Calls Received`
   matched no key (the map only knew 'Total Calls'), and the tab carries BOTH
   'Talk Time' and 'Talk Time (s)', so the seconds column had to be made the
   preferred key rather than whichever column came first.

   THE ROUTING COLUMNS ARE THE POINT OF THIS FEED
   ----------------------------------------------
   `Rang & Missed`, `Not Routed - Owner Busy` and `Not Routed - Other` split a
   not-answered call by WHOSE failure it was. Rang & missed is the LRM's;
   not-routed is the platform's and must never be scored against a person.
   Hence two rates, never one: Pickup % (of calls that RANG) beside Answered %
   (of everything that arrived).

   CAVEATS THAT TRAVEL WITH EVERY FIGURE HERE
   ------------------------------------------
   1. ~35.5% of inbound legs reach no agent at all and carry no owner, so they
      cannot enter anybody's denominator — the floor's real miss rate is in the
      routing section below, not in this table.
   2. The dialler posts RETRY LEGS (one call drew 49 in 25 seconds). A call
      count far above what the LRM remembers is a dialler problem.
   3. Disposition is not yet an outcome metric: 33 of 55 answered calls on
      4 Sep were tagged "Call Not Connected", nine after 2+ min of talk.

   DURATIONS ARE SECONDS IN THE FEED, MINUTES IN _c
   ------------------------------------------------
   Talk / Avg talk / Wrap-up / Hold arrive in SECONDS (the card says so) and the
   API divides by 60 once. Reading them as minutes inflates talk time 60x — the
   first cut of this file did exactly that. Never cross-reconcile with the
   Ozontel tab's 'Total Talk Time', which is HOURS.
   ════════════════════════════════════════════════════════════════════════════ */

var inbSort = { col: 'calls', dir: -1 };
var INB_MIN_CALLS = 5;   // below this a rate is noise, not a reading

/* Fallback duration parser for a pre-rebuild payload with no _c block.
   'hh:mm:ss' / 'mm:ss' by position; a bare number is SECONDS -> minutes. */
function inbDur(v) {
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
/* Legacy header spellings per canonical field — the compatibility layer for a
   payload written before the rebuild (and for the preview harness's mock). */
var INB_LEGACY = {
  date:['Date'], email:['LRM email','LRM Email','Agent Id'], name:['Agent Name','LRM Name'],
  calls:['Total Calls Received','Total Calls','Calls'], answered:['Answered Calls','Answered'],
  unanswered:['Not Answered Calls','Unanswered Calls','Unanswred Calls','Missed'],
  answerPct:['Answered % (overall)'], pickupPct:['Pickup % (when rang)'],
  rangMissed:['Rang & Missed'], nrBusy:['Not Routed - Owner Busy'], nrOther:['Not Routed - Other'],
  talk:['Talk Time (s)','Total Talk Time','Talk Time'], avgTalk:['Avg. Talk Time (s)'],
  wrap:['Avg. Wrapup Time (s)','Avg. Wrapup Time'], hold:['Avg. Hold Time (s)','Avg. Hold Time'],
  custDisc:['Customer Disconnect'], agentDisc:['Agent Disconnect'],
  ring:['Avg Ring Time'], queue:['Avg Queue Time'], legs:['Dial Legs'], did:['DID']
};
function inbPickRaw(r, names) {
  for (var i = 0; i < (names || []).length; i++) {
    var v = r[names[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}
/* Canonical value. _c is authoritative and ALREADY coerced (durations in
   minutes, percents in points); the legacy path only runs on an old payload. */
function inbVal(r, field, kind) {
  var c = r._c || {};
  if (c[field] !== undefined && c[field] !== null && c[field] !== '') {
    return kind === 'text' ? c[field] : (Number(c[field]) || 0);
  }
  var raw = inbPickRaw(r, INB_LEGACY[field]);
  if (kind === 'text') return raw;
  if (kind === 'dur') return inbDur(raw);
  return raw === '' ? 0 : (Number(String(raw).replace(/[,%\s]/g, '')) || 0);
}
/* Does the SHEET carry this column at all? Drives "column absent" vs "column
   reads zero" — a missing column and a zero are different facts, and a column
   of honest-looking zeroes for a figure the feed never had is the failure this
   guard exists to prevent. */
function inbHasField(field) {
  if (!D || !D.inboundPerf) return false;
  for (var i = 0; i < D.inboundPerf.length; i++) {
    var r = D.inboundPerf[i], c = r._c;
    if (c && c[field] !== undefined && c[field] !== null && c[field] !== '') return true;
    if (inbPickRaw(r, INB_LEGACY[field]) !== '') return true;
  }
  return false;
}
function inbMin(v) { var n = Math.round(v); return n >= 60 ? (Math.floor(n / 60) + 'h ' + (n % 60) + 'm') : (n + 'm'); }
function inbDash() { return '<span style="color:#c0c4d6">&mdash;</span>'; }
function inbPct(v, dp) {
  var n = Number(v);
  if (v === null || v === undefined || isNaN(n)) return inbDash();
  return n.toFixed(dp === undefined ? 1 : dp) + '%';
}
function inbM(v) { return (Math.round((Number(v) || 0) * 10) / 10) + 'm'; }

/* ── Per-LRM rollup, scoped by the filter bar ───────────────────────────────
   Percentages are recomputed from the summed counts, never averaged across
   days; the sheet's own per-day averages are re-weighted by that day's
   answered calls so a 2-call day cannot pull the mean like a 40-call one. */
function inbRows() {
  if (!D || !D.inboundPerf || !D.inboundPerf.length) return [];
  var normEm = function(v){ return String(v||'').trim().toLowerCase().replace('@homes.solarsquare.in','@solarsquare.in'); };
  var meta = {}, anyFilter = (typeof filtersActive === 'function') ? filtersActive() : false;
  filterAgents().forEach(function(r){
    var raw = String(r['Agent Id']||'').trim().toLowerCase();
    if (!raw) return;
    meta[raw] = r; meta[normEm(raw)] = r;
  });
  /* Client-side date guard — the SECOND filter (the API already narrowed the
     tab to the picked window). It exists for the preview harness and a stale
     payload, and it FAILS OPEN: yyyy-mm-dd, dd/mm/yyyy, mm/dd/yyyy and ISO
     timestamps are parsed, anything else is kept and left to the server.
     It is switched OFF when the server served its most-recent-day fallback,
     because those rows are deliberately outside the picked window. */
  var g = (D && D.inboundDiag) || {};
  var from = g.fallbackDate ? '' : String((D && D.fromDate) || '');
  var to   = g.fallbackDate ? '' : String((D && D.toDate) || '');
  var inbISO = function(v){
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) {
      /* Ambiguous when both parts are <= 12. The sheet is written by Apps
         Script in Asia/Kolkata, so day-first is the right reading. */
      var a = Number(m[1]), b = Number(m[2]);
      var day = a > 12 ? a : (b > 12 ? b : a), mon = a > 12 ? b : (b > 12 ? a : b);
      return m[3] + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + ('0' + (d.getMonth()+1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    return '';
  };
  var inWindow = function(v){
    if (!from || !to) return true;
    var d = inbISO(v);
    if (!d) return true;
    return d >= from && d <= to;
  };
  var acc = {}, order = [];
  D.inboundPerf.forEach(function(r){
    if (!inWindow(inbVal(r, 'date', 'text'))) return;
    var e = normEm(r._email || inbVal(r, 'email', 'text'));
    if (!e) return;
    var m = meta[e];
    /* No roster row: keep the LRM when no filter is active (the roster is
       scoped to the Ozontel window and inbound can run ahead of it), drop it
       when a filter IS active — a filter that silently lets rows through is
       worse than a short table. */
    if (!m && anyFilter) return;
    var a = acc[e];
    if (!a) {
      a = acc[e] = { email:e, name: inbVal(r, 'name', 'text') || agentName(e), row:m || null, days:0,
                     calls:0, answered:0, unanswered:0, rangMissed:0, nrBusy:0, nrOther:0,
                     talk:0, wrap:0, hold:0, ring:0, queue:0, custDisc:0, agentDisc:0, legs:0, avgN:0 };
      order.push(e);
    }
    a.days++;
    a.calls      += inbVal(r, 'calls', 'num');
    a.answered   += inbVal(r, 'answered', 'num');
    a.unanswered += inbVal(r, 'unanswered', 'num');
    a.rangMissed += inbVal(r, 'rangMissed', 'num');
    a.nrBusy     += inbVal(r, 'nrBusy', 'num');
    a.nrOther    += inbVal(r, 'nrOther', 'num');
    a.custDisc   += inbVal(r, 'custDisc', 'num');
    a.agentDisc  += inbVal(r, 'agentDisc', 'num');
    a.legs       += inbVal(r, 'legs', 'num');
    a.talk       += inbVal(r, 'talk', 'dur');
    var ans = inbVal(r, 'answered', 'num');
    a.wrap  += inbVal(r, 'wrap',  'dur') * ans;
    a.hold  += inbVal(r, 'hold',  'dur') * ans;
    a.ring  += inbVal(r, 'ring',  'dur') * ans;
    a.queue += inbVal(r, 'queue', 'dur') * ans;
    a.avgN  += ans;
  });
  return order.map(function(e){
    var a = acc[e], m = a.row || {};
    a.city = m['City'] || ''; a.tl = m['TL Name'] || '';
    a.rang      = a.answered + a.rangMissed;
    a.notRouted = a.nrBusy + a.nrOther;
    a.answerPct = a.calls ? a.answered / a.calls * 100 : null;
    /* Pickup % is of calls that RANG this LRM. It is the only rate a person can
       be held to; Answer % includes calls the platform never routed. */
    a.pickupPct = a.rang ? a.answered / a.rang * 100 : null;
    a.avgTalk   = a.answered ? a.talk / a.answered : 0;
    a.avgWrap   = a.avgN ? a.wrap / a.avgN : 0;
    a.avgHold   = a.avgN ? a.hold / a.avgN : 0;
    a.avgRing   = a.avgN ? a.ring / a.avgN : 0;
    a.avgQueue  = a.avgN ? a.queue / a.avgN : 0;
    a.legsPer   = a.calls && a.legs ? a.legs / a.calls : null;
    a.discPct   = a.answered ? a.custDisc / a.answered * 100 : null;
    return a;
  });
}

function inbLrmTotals(rows) {
  var t = { calls:0, answered:0, unanswered:0, rangMissed:0, nrBusy:0, nrOther:0,
            talk:0, custDisc:0, agentDisc:0, legs:0, wrap:0, avgN:0, lrms:rows.length };
  rows.forEach(function(a){
    t.calls += a.calls; t.answered += a.answered; t.unanswered += a.unanswered;
    t.rangMissed += a.rangMissed; t.nrBusy += a.nrBusy; t.nrOther += a.nrOther;
    t.talk += a.talk; t.custDisc += a.custDisc; t.agentDisc += a.agentDisc;
    t.legs += a.legs || 0; t.wrap += a.avgWrap * a.avgN; t.avgN += a.avgN;
  });
  t.rang      = t.answered + t.rangMissed;
  t.notRouted = t.nrBusy + t.nrOther;
  t.answerPct = t.calls ? t.answered / t.calls * 100 : 0;
  t.pickupPct = t.rang ? t.answered / t.rang * 100 : null;
  t.avgTalk   = t.answered ? t.talk / t.answered : 0;
  t.avgWrap   = t.avgN ? t.wrap / t.avgN : 0;
  return t;
}

/* ── COLUMN SPEC ───────────────────────────────────────────────────────────
   Every column names the canonical field it needs and is NOT DRAWN when no
   header bound to it, so the table is correct against whatever the tab
   currently carries, a new sheet column appears with no code change, and
   "absent" never renders as a column of zeroes. need:null = always drawn
   (roster-derived, or computed from required columns). */
var INB_COLS = [
  { key:'name',      label:'LRM',                  need:null,         txt:true, fmt:function(a){ return '<span class="cell-agent">' + esc(a.name) + '</span>'; } },
  { key:'calls',     label:'Calls Received',       need:'calls',      fmt:function(a){ return fmt(a.calls); } },
  { key:'answered',  label:'Answered',             need:'answered',   fmt:function(a){ return fmt(a.answered); } },
  { key:'unanswered',label:'Not Answered',         need:'unanswered', fmt:function(a){ return fmt(a.unanswered); } },
  { key:'answerPct', label:'Answered % (overall)', need:'answered',   status:'ans', fmt:function(a){ return inbPct(a.answerPct); } },
  { key:'rangMissed',label:'Rang & Missed',        need:'rangMissed', fmt:function(a){ return fmt(a.rangMissed); } },
  { key:'pickupPct', label:'Pickup % (when rang)', need:'rangMissed', status:'pick', fmt:function(a){ return inbPct(a.pickupPct); } },
  { key:'nrBusy',    label:'Not Routed \u2013 Owner Busy', need:'nrBusy',  fmt:function(a){ return fmt(a.nrBusy); } },
  { key:'nrOther',   label:'Not Routed \u2013 Other',      need:'nrOther', fmt:function(a){ return fmt(a.nrOther); } },
  { key:'talk',      label:'Talk Time',            need:'talk',       fmt:function(a){ return inbMin(a.talk); } },
  { key:'avgTalk',   label:'Avg Talk (min)',       need:'talk',       fmt:function(a){ return inbM(a.avgTalk); } },
  { key:'avgWrap',   label:'Avg Wrap-up (min)',    need:'wrap',       fmt:function(a){ return inbM(a.avgWrap); } },
  { key:'avgHold',   label:'Avg Hold (min)',       need:'hold',       fmt:function(a){ return inbM(a.avgHold); } },
  { key:'avgRing',   label:'Avg Ring (min)',       need:'ring',       fmt:function(a){ return inbM(a.avgRing); } },
  { key:'avgQueue',  label:'Avg Queue (min)',      need:'queue',      fmt:function(a){ return inbM(a.avgQueue); } },
  { key:'custDisc',  label:'Customer Hung Up',     need:'custDisc',   fmt:function(a){ return fmt(a.custDisc); } },
  { key:'discPct',   label:'% of Answered',        need:'custDisc',   fmt:function(a){ return inbPct(a.discPct); } },
  { key:'agentDisc', label:'LRM Hung Up',          need:'agentDisc',  fmt:function(a){ return fmt(a.agentDisc); } },
  /* Legs is a DIALLER reading: a high value is an Ozonetel retry storm and must
     never be read as the LRM taking more calls. */
  { key:'legs',      label:'Dial Legs',            need:'legs',       fmt:function(a){ return fmt(a.legs); } },
  { key:'legsPer',   label:'Legs / Call',          need:'legs',       fmt:function(a){ return a.legsPer === null ? inbDash() : (Math.round(a.legsPer*10)/10); } },
  { key:'days',      label:'Days',                 need:null,         fmt:function(a){ return a.days; } }
];
function inbColsLive() {
  return INB_COLS.filter(function(c){ return !c.need || inbHasField(c.need); });
}

/* The table is built exactly like the LRM tab's: a plain <table> in .tbl-wrap,
   sortable headers carrying sort-asc / sort-desc, numeric columns tagged per
   COLUMN with class="num". No second table grammar for the same kind of data. */
function inbTable(rows) {
  var cols = inbColsLive();
  if (!cols.some(function(c){ return c.key === inbSort.col; })) inbSort = { col: cols[0].key, dir: -1 };
  var head = cols.map(function(c){
    var cls = (inbSort.col === c.key ? (inbSort.dir === 1 ? 'sort-asc' : 'sort-desc') : '') + (c.txt ? '' : ' num');
    return '<th class="' + cls.trim() + '" data-inbsort="' + c.key + '">' + esc(c.label) + '</th>';
  }).join('');
  var sorted = rows.slice().sort(function(x,y){
    var a = x[inbSort.col], b = y[inbSort.col];
    if (typeof a === 'string' || typeof b === 'string') return String(a||'').localeCompare(String(b||'')) * inbSort.dir;
    if (a === null && b !== null) return 1;
    if (b === null && a !== null) return -1;
    return ((Number(a)||0) - (Number(b)||0)) * inbSort.dir;
  });
  var body = sorted.map(function(a){
    /* A rate off three calls is noise, so a thin row is drawn faint and carries
       no status colour at all. */
    var thin = a.calls < INB_MIN_CALLS;
    var band = function(v){ return v === null ? '' : (v >= 80 ? 'badge badge-high' : v >= 60 ? 'badge badge-mid' : 'badge badge-low'); };
    return '<tr' + (thin ? ' style="opacity:.55"' : '') + '>' + cols.map(function(c){
      var v = c.fmt(a);
      if (c.status && !thin) v = '<span class="' + band(c.status === 'ans' ? a.answerPct : a.pickupPct) + '">' + v + '</span>';
      return '<td' + (c.txt ? '' : ' class="num"') + '>' + v + '</td>';
    }).join('') + '</tr>';
  }).join('');
  /* The panel is a FIXED viewport-derived height and .tbl-wrap carries
     flex:1 1 auto; min-height:0 from the shell, so on the LRM tab — where the
     table is the panel's only child — it fills the panel and scrolls inside.
     Here it has siblings (the stamp, the metric strip, the footnote), and those
     keep their intrinsic heights, so the table absorbed the whole shortfall and
     collapsed to 2px on a 540px-tall viewport. The table is given a FLOOR and
     takes itself out of the flex competition; the stack scrolls instead (see
     renderInbound). Fix the constraint, not the pixel. */
  return '<div class="tbl-wrap" style="flex:0 0 auto;min-height:260px;max-height:none">'
    + '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

/* ── Floor Board metric cards ───────────────────────────────────────────────
   The Floor Board's own white boxes: .fb-hero grid of .fb-card, each an
   .fb-lab label over an .fb-num figure over an .fb-sub definition. This
   deliberately is NOT the dark .fb-strip the connectivity tabs use — the user
   asked for the Floor Board's cards and they are the right grammar here anyway,
   because every figure on this tab needs a definition beside it ("of calls that
   rang" and "of everything that arrived" are different denominators).
   A card whose column the sheet does not carry is OMITTED, never drawn as zero. */
function inbCards(t) {
  var cards = [['Calls received', fmt(t.calls), 'inbound demand that arrived']];
  if (inbHasField('rangMissed')) {
    cards.push(['Pickup % (when rang)', t.pickupPct === null ? '&mdash;' : t.pickupPct.toFixed(1) + '%',
                'of calls that reached an LRM — the only rate a person owns']);
  }
  if (inbHasField('answered')) {
    cards.push(['Answered', fmt(t.answered) + ' <u>' + t.answerPct.toFixed(1) + '%</u>',
                'of everything that arrived, routed or not']);
  }
  if (inbHasField('rangMissed')) cards.push(['Rang &amp; missed', fmt(t.rangMissed), 'reached an LRM, not picked up']);
  else if (inbHasField('unanswered')) cards.push(['Not answered', fmt(t.unanswered), 'arrived, nobody spoke']);
  if (inbHasField('nrBusy') || inbHasField('nrOther')) {
    cards.push(['Not routed', fmt(t.notRouted), 'platform never offered the call — Ozonetel&rsquo;s, not the floor&rsquo;s']);
  }
  if (inbHasField('talk')) {
    cards.push(['Talk time', inbMin(t.talk), 'inbound only, never in dial totals']);
    cards.push(['Avg talk', (Math.round(t.avgTalk*10)/10) + ' <u>min</u>', 'per answered call']);
  }
  if (inbHasField('custDisc')) cards.push(['Customer hung up', fmt(t.custDisc), 'the caller ended it, not the LRM']);
  if (inbHasField('legs')) cards.push(['Dial legs', fmt(t.legs), 'dialler retries, not calls']);
  return '<div class="fb-hero">' + cards.map(function(c){
    return '<div class="fb-card"><div class="fb-lab">' + c[0] + '</div>'
         + '<div class="fb-num">' + c[1] + '</div>'
         + '<div class="fb-sub" style="margin-top:6px">' + c[2] + '</div></div>';
  }).join('') + '</div>';
}

function renderInbound() {
  var panel = document.getElementById('inboundPanel');
  if (!panel || !D) return;
  var g = (D && D.inboundDiag) || {};
  var has = D.connHas && D.connHas.inboundPerf && D.inboundPerf && D.inboundPerf.length;
  if (!has) {
    /* The empty state REPORTS, because the last two times this card was blank
       the cause was a NAME — a tab spelled 'Inbound_perf', then a header spelled
       'Total Calls Received' — and the card said "not in the sheet yet" for a
       tab that was full of data. */
    var lines = [];
    lines.push('Tab resolved: ' + (g.tab ? '<b>' + esc(g.tab) + '</b>' : '<b>none</b> — no tab answered any known spelling'));
    if (g.rows !== undefined) lines.push('Rows in tab: <b>' + g.rows + '</b>');
    if (g.kept !== undefined) lines.push('Rows kept after exclusions: <b>' + g.kept + '</b>');
    if (g.undated) lines.push('Dropped with no parseable date: <b>' + g.undated + '</b>');
    if (g.inWindowStrict !== undefined) lines.push('In the picked window (' + esc(g.window || '') + '): <b>' + g.inWindowStrict + '</b>');
    if (g.unmapped && g.unmapped.length) lines.push('Fields no header bound to: ' + esc(g.unmapped.join(', ')));
    if (g.headers && g.headers.length) lines.push('Header row the tab actually carries: <span style="font-family:ui-monospace,monospace;font-size:11.5px">' + esc(g.headers.join(' · ')) + '</span>');
    if (g.mapped && g.mapped.length) lines.push('Bound: <span style="font-family:ui-monospace,monospace;font-size:11.5px">' + esc(g.mapped.join(' · ')) + '</span>');
    if (g.error) lines.push('Last read error: ' + esc(g.error));
    panel.innerHTML = '<div class="fb-wrap">' + chNoSource('Inbound handling',
      'No per-LRM inbound rows for this window. What the feed actually did:')
      + '<div style="margin-top:10px;font-size:12.5px;line-height:1.7;color:var(--ink,#2b3245)">'
      + lines.join('<br>') + '</div></div>';
    if (activeTab === 'inbound') setCount('no inbound feed');
    return;
  }
  var rows = inbRows();
  if (activeTab === 'inbound') setCount(rows.length + ' LRMs · inbound');
  if (!rows.length) {
    panel.innerHTML = '<div class="fb-wrap">' + chNoSource('Inbound handling',
      'The ' + (g.tab || 'inbound_perf') + ' tab has rows, but none for the LRMs currently in the filter.') + '</div>';
    return;
  }
  var t = inbLrmTotals(rows);

  /* The date the figures are FOR, stated whenever it is not the picked window —
     the feed is written on Ozonetel's schedule and can lag the picker by days,
     and the previous build reported that as "0 rows" over a full tab. */
  var stamp = g.fallbackDate
    ? '<span class="fb-live">' + esc(g.fallbackDate) + '</span><span>No inbound rows in the picked window ('
      + esc(g.window || '') + ') — showing the latest day the feed carries. '
      + 'The Ozonetel card is written on its own schedule and lags the picker.</span>'
    : '<span class="fb-live">' + esc(D.dateLabel || '') + '</span><span>Per-LRM inbound from the <b>'
      + esc(g.tab || 'inbound_perf') + '</b> tab &middot; ' + (g.rows || 0) + ' rows in tab &middot; '
      + (g.inWindowStrict !== undefined ? g.inWindowStrict : rows.length) + ' in window'
      + ((typeof filtersActive === 'function' && filtersActive()) ? ' &middot; filtered' : '') + '</span>';

  var html = '<div class="fb-stamp">' + stamp + '</div>'
    + inbCards(t)
    + inbTable(rows);

  /* Inbound ROUTING, below the per-LRM table. The order is the argument: the
     table is about people, routing is about the platform, and routing is where
     the floor's real miss rate lives. */
  if (typeof inbRoutingSection === 'function') {
    var routing = inbRoutingSection();
    if (routing) {
      html += '<div style="margin-top:18px;padding-top:4px;border-top:1px solid #e4e7f0">'
            + '<div style="font-weight:600;font-size:11px;line-height:1.2;letter-spacing:.09em;'
            + 'text-transform:uppercase;color:var(--muted);margin:10px 0 12px">Routing &middot; where inbound demand is '
            + 'lost before an LRM ever rings — owner: Ozonetel, not the floor</div></div>' + routing;
    }
  }

  /* The Floor Board's own scrolling column (.fb-wrap), not .conn-stack: it is
     flex:1 1 auto / overflow:auto, so the cards, the table and the footnote
     scroll together inside the panel's fixed height and the table keeps the
     floor it is given in inbTable. */
  panel.innerHTML = '<div class="fb-wrap">' + html + '</div>';
}

/* Delegated on document, ONCE — the table can be lifted into a modal appended
   to document.body, where a panel-scoped listener would never see its headers. */
if (!window.__inbSortWired) {
  window.__inbSortWired = true;
  document.addEventListener('click', function(e){
    var h = e.target && e.target.closest && e.target.closest('th[data-inbsort]');
    if (!h) return;
    var k = h.getAttribute('data-inbsort');
    if (inbSort.col === k) inbSort.dir = -inbSort.dir; else { inbSort.col = k; inbSort.dir = -1; }
    renderInbound();
  });
}
