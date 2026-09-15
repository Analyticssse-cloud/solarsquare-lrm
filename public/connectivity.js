/* ════════════════════════════════════════════════════════════════════════════
   connectivity.js — the Connectivity and Behaviour tabs.

   WHY THESE TWO TABS EXIST AS A PAIR
   ----------------------------------
   Raw connectivity compares LEAD LISTS, not callers. First attempts answer at
   34.3%; sixth-to-tenth at 20.0%. Over 1–10 Sep the floor's headline
   connectivity FELL 4.0pp while within-bucket execution IMPROVED 3.8pp — the
   whole decline was the lead pool exhausting underneath the floor. Connect %
   unpaired with depth mix is a broken metric, and it is the reason Connect %
   was pulled from every view on 30 Aug.

   It comes back here, but never alone: always beside the depth-adjusted INDEX
   (actual ÷ expected connects, where expected sums the floor's answer rate for
   each attempt band) and the SHORTFALL (the same thing in conversations, so it
   adds up across a team). Index ranks; Connect % is the absolute level. Read
   them together or not at all.

   Connectivity = OUTCOME (index, shortfall, depth mix).
   Behaviour    = CONDUCT (patience, hang-ups, over-dialling, the hour curve).
   Split deliberately: the first is mostly lead supply and is NOT a coaching
   conversation; the second is.

   Reads only what the backend already returns:
     D.connDaily   one row per LRM × day  (conn_daily tab)
     D.connHourly  one row per Date × Hour, floor-wide (conn_hourly tab)
     D.connHas     which feeds exist at all
     filterAgents() the filter bar + viewer scope, same as every other view

   Absent feed ⇒ "no source yet" note, never a floor of zeroes. Absence is not
   zero (DESIGN.md §2).
   ════════════════════════════════════════════════════════════════════════════ */

var CONN_INK = '#18233f', CONN_MUTED = '#6b7590', CONN_RULE = '#eef1f7';
var connLevel = (function () { try { return localStorage.getItem('lrmConnLevel') || 'tl'; } catch (e) { return 'tl'; } })();
var connSort  = { col: 'shortfall', dir: 1 };   // worst shortfall first
var behavSort = { col: 'earlyPct',  dir: -1 };
/* Which measure the ranked-bar chart is drawing. The chart answers one
   question; this switch is how the others are reached (13 Sep 2026). */
var connMetric = (function () { try { return localStorage.getItem('lrmConnMetric') || 'index'; } catch (e) { return 'index'; } })();
var behavMetric = (function () { try { return localStorage.getItem('lrmBehavMetric') || 'earlyPct'; } catch (e) { return 'earlyPct'; } })();
var CONN_METRICS = {
  index:     { label: 'Index', baseline: 100, baselineLabel: '100 = par', suffix: '',
               sub: 'Connects &divide; expected connects &times; 100, depth-adjusted. <b>100 is par for the lead mix that caller actually worked</b> &mdash; so this ranks, and Conn % gives the absolute level.' },
  shortfall: { label: 'Shortfall', signed: true, suffix: '',
               sub: 'Actual minus expected connects, in <b>conversations</b> &mdash; the same statement as the index but in a unit that adds up across a team.' },
  connPct:   { label: 'Conn %', suffix: '%',
               sub: 'The absolute level, unadjusted. Read it beside the index, never instead of it: the index is estate-relative and reads ~100 if the whole floor degrades together.' },
  realPct:   { label: 'Real conv %', suffix: '%',
               sub: 'Share of dials that became 15 seconds or more of talking. A connect that ends in four seconds is not a conversation.' }
};
var BEHAV_METRICS = {
  earlyPct:  { label: 'Early hang-up %', suffix: '%', badAt: 35, goodHigh: false,
               sub: 'Share of dials the caller cut before 20 seconds of ringing. The median customer who answers takes 13s, and 40.5% of successful conversations start after 15s.' },
  shortPct:  { label: 'Short connect %', suffix: '%', badAt: 25, goodHigh: false,
               sub: 'Answered, then ended inside 15 seconds, as a share of that caller&rsquo;s own connects. Unlike ring-time patience this has no lead-quality defence: the customer picked up.' },
  medPatience: { label: 'Seconds waited', suffix: 's',
               sub: 'Median wait before the caller hangs up. Under about 20 seconds sits inside the window where customers do still answer.' },
  overCalls: { label: 'Calls beyond cap', suffix: '', goodHigh: false, badAt: 1,
               sub: 'Dials beyond 3 per customer per day. Ozonetel has already offered a campaign-level daily limit per number &mdash; it is free and would cap this at the queue.' },
  realPerDay:{ label: 'Conversations / day', suffix: '',
               sub: 'Real conversations per working day &mdash; the output the rest of this tab is trying to protect.' }
};

/* Attempt bands, in the order they must always be drawn. The floor-wide answer
   rate per band is the model's expectation; these are the measured 1–10 Sep
   rates, used ONLY as the fallback label when the feed cannot supply them. */
var CONN_BANDS = [
  { key: 'Attempts 1-3',  label: '1st–3rd',  ink: '#1f6b45' },
  { key: 'Attempts 4-10', label: '4th–10th', ink: '#8a6d1f' },
  { key: 'Attempts 11+',  label: '11th+',    ink: '#b0382c' }
];

/* ── Joining the feed to the hierarchy ───────────────────────────────────────
   conn_daily is per LRM × day and carries no hierarchy — by design: LRM → TL →
   ZSM → ADOS → City lives in the LRM_TL_MAP sheet and is attached once, in
   api/dashboard.js, for every view. So the feed is joined to the FILTERED agent
   rows by email. Two consequences worth knowing:
     · an LRM in the feed but not on the roster is dropped, not bucketed as
       "unmapped" — 17 callers carrying 7,488 calls are absent from the roster
       and a silent bucket would have them read as a team;
     · the filter bar narrows this view for free, because the join key is the
       filtered set.
   Rows are summed across the days in range: Connects and Expected Connects are
   both counts, so the index of a sum is the correct index of the period. Do NOT
   average the per-day index — that weights a 40-call day like a 400-call one. */
function connRows() {
  if (!D || !D.connDaily || !D.connDaily.length) return [];
  var meta = {};
  /* Match on the normalised address as well as the raw one: the roster carries
     some LRMs as @homes.solarsquare.in and the feeds as @solarsquare.in, and an
     exact-string join silently drops those people. */
  var normEm = function (v) {
    return String(v || '').trim().toLowerCase().replace('@homes.solarsquare.in', '@solarsquare.in');
  };
  filterAgents().forEach(function (r) {
    var raw = String(r['Agent Id'] || '').trim().toLowerCase();
    if (!raw) return;
    meta[raw] = r; meta[normEm(raw)] = r;
  });
  var acc = {}, order = [];
  D.connDaily.forEach(function (r) {
    var e = normEm(r._email || r['LRM Email'] || '');
    if (!e || !meta[e]) return;
    var a = acc[e];
    if (!a) {
      a = acc[e] = {
        email: e, name: r['LRM Name'] || agentName(e), row: meta[e],
        days: 0, calls: 0, uniq: 0, fresh: 0, connects: 0, expected: 0,
        real: 0, talkMin: 0, cuts: 0, early: 0, shortConn: 0, overCust: 0,
        overCalls: 0, redials: 0, b0: 0, b1: 0, b2: 0,
        patience: [], ring: [], medTalk: [], baselineDays: 0,
        connWow: null, earlyWow: null, hasFresh: false, hasCuts: false
      };
      order.push(e);
    }
    /* The live feed is one WEEKLY row per LRM and carries its own day count;
       the per-day card feed is one row per day. Both land here. */
    a.days += Number(r['Days']) || 1;
    if (r['Fresh Numbers'] !== undefined) a.hasFresh = true;
    if (r['Agent Cuts'] !== undefined) a.hasCuts = true;
    if (r['Conn vs Last Week'] !== undefined && r['Conn vs Last Week'] !== null && r['Conn vs Last Week'] !== '')
      a.connWow = Number(r['Conn vs Last Week']);
    if (r['Early vs Last Week'] !== undefined && r['Early vs Last Week'] !== null && r['Early vs Last Week'] !== '')
      a.earlyWow = Number(r['Early vs Last Week']);
    a.calls     += Number(r['Calls']) || 0;
    a.uniq      += Number(r['Unique Numbers']) || 0;
    a.fresh     += Number(r['Fresh Numbers']) || 0;
    a.connects  += Number(r['Connects']) || 0;
    a.expected  += Number(r['Expected Connects']) || 0;
    a.real      += Number(r['Real Conversations']) || 0;
    a.talkMin   += Number(r['Talk Min']) || 0;
    a.cuts      += Number(r['Agent Cuts']) || 0;
    a.early     += Number(r['Early Hangups']) || 0;
    a.shortConn += Number(r['Short Connects']) || 0;
    a.overCust  += Number(r['Customers Over 3']) || 0;
    a.overCalls += Number(r['Calls Beyond Cap']) || 0;
    a.redials   += Number(r['Rapid Redials']) || 0;
    a.b0        += Number(r['Attempts 1-3']) || 0;
    a.b1        += Number(r['Attempts 4-10']) || 0;
    a.b2        += Number(r['Attempts 11+']) || 0;
    a.baselineDays = Math.max(a.baselineDays, Number(r['Baseline Days']) || 0);
    // Medians cannot be summed. They are carried as the mean of the daily
    // medians, which is an approximation — labelled as such wherever shown.
    if (Number(r['Median Patience s'])) a.patience.push(Number(r['Median Patience s']));
    if (Number(r['Median Ring s']))     a.ring.push(Number(r['Median Ring s']));
    if (Number(r['Median Talk s']))     a.medTalk.push(Number(r['Median Talk s']));
  });
  var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
  return order.map(function (e) {
    var a = acc[e];
    a.index      = a.expected ? a.connects / a.expected * 100 : null;
    a.shortfall  = a.expected ? a.connects - a.expected : null;
    a.connPct    = a.calls ? a.connects / a.calls * 100 : 0;
    a.freshPct   = a.hasFresh && a.calls ? a.fresh / a.calls * 100 : null;
    a.realPct    = a.calls ? a.real / a.calls * 100 : 0;
    a.earlyPct   = a.calls ? a.early / a.calls * 100 : 0;
    a.cutPct     = a.hasCuts && a.calls ? a.cuts / a.calls * 100 : null;
    a.shortPct   = a.connects ? a.shortConn / a.connects * 100 : 0;
    a.redialPct  = a.calls ? a.redials / a.calls * 100 : 0;
    a.medPatience = mean(a.patience);
    a.medRing     = mean(a.ring);
    a.medTalkS    = mean(a.medTalk);
    a.realPerDay  = a.days ? a.real / a.days : 0;
    return a;
  });
}

function connGroupKey(level) {
  return {
    ados:    function (a) { return a.row['ADOS Name'] || '— Unmapped —'; },
    zsm:     function (a) { return a.row['ZSM Name'] || '— Unmapped —'; },
    tl:      function (a) { return a.row['TL Name'] || '— Unmapped —'; },
    city:    function (a) { return a.row['City'] || '— Unmapped —'; },
    lrm:     function (a) { return a.name; },
    overall: function () { return 'All LRMs in view'; }
  }[level] || function (a) { return a.row['TL Name'] || '— Unmapped —'; };
}

/* Roll the per-LRM rows up to the chosen grain. Counts sum; the index is
   recomputed from the summed counts at every level, which is why it rolls up
   with no change of formula — LRM to TL to ADOS to cluster. */
function connGroups(rows, level) {
  var keyOf = connGroupKey(level), g = {}, order = [];
  rows.forEach(function (a) {
    var k = String(keyOf(a) || '—').trim() || '—';
    if (!g[k]) {
      g[k] = { name: k, lrms: 0, calls: 0, connects: 0, expected: 0, real: 0,
               fresh: 0, early: 0, cuts: 0, shortConn: 0, redials: 0,
               overCalls: 0, talkMin: 0, b0: 0, b1: 0, b2: 0, below: 0, hasFresh: false, members: [] };
      order.push(k);
    }
    var b = g[k];
    b.lrms++; b.members.push(a);
    if (a.hasFresh) b.hasFresh = true;
    ['calls', 'connects', 'expected', 'real', 'fresh', 'early', 'cuts',
     'shortConn', 'redials', 'overCalls', 'talkMin', 'b0', 'b1', 'b2'
    ].forEach(function (f) { b[f] += a[f] || 0; });
    // Distribution over average (DESIGN.md §2): a team indexing 100 can hide an
    // LRM at 70, so the count below par travels with the mean.
    if (a.index !== null && a.index < 100) b.below++;
  });
  return order.map(function (k) {
    var b = g[k];
    b.index     = b.expected ? b.connects / b.expected * 100 : null;
    b.shortfall = b.expected ? b.connects - b.expected : null;
    b.connPct   = b.calls ? b.connects / b.calls * 100 : 0;
    b.freshPct  = b.hasFresh && b.calls ? b.fresh / b.calls * 100 : null;
    b.realPct   = b.calls ? b.real / b.calls * 100 : 0;
    b.earlyPct  = b.calls ? b.early / b.calls * 100 : 0;
    b.shortPct  = b.connects ? b.shortConn / b.connects * 100 : 0;
    return b;
  });
}

/* ── Small drawing helpers ───────────────────────────────────────────────── */
function connNum(v, dp) {
  if (v === null || v === undefined || v === '') return '<span style="color:#c0c4d6">&mdash;</span>';
  var n = Number(v);
  if (isNaN(n)) return esc(String(v));
  return dp ? n.toFixed(dp) : fmt(Math.round(n));
}
/* Index cell. 100 is par; the tint is doubled by the number itself being
   signed against 100, and the shortfall column says the same thing in
   conversations — so a colour-blind reader loses nothing. */
function connIndexCell(v, cls2) {
  if (v === null || v === undefined) return '<td class="' + (cls2 || '') + '"><span style="color:#c0c4d6">&mdash;</span></td>';
  var n = Number(v), cls = n >= 105 ? 'ok' : (n < 92 ? 'bad' : '');
  return '<td class="' + cls + ' ' + (cls2 || '') + '">' + Math.round(n) + '</td>';
}
function connShortCell(v) {
  if (v === null || v === undefined) return '<td><span style="color:#c0c4d6">&mdash;</span></td>';
  var n = Math.round(Number(v));
  if (n > 0) return '<td class="ok">+' + fmt(n) + '</td>';
  if (n < 0) return '<td class="bad">' + fmt(n) + '</td>';
  return '<td style="color:var(--muted)">0</td>';
}
/* Depth mix as one stacked bar. This is the lead-supply signal and the reason
   the index exists — a caller whose bar is mostly red is working an exhausted
   list and their raw connectivity cannot be compared to anyone else's. */
function connDepthBar(b0, b1, b2) {
  var t = (b0 || 0) + (b1 || 0) + (b2 || 0);
  if (!t) return '<span style="color:#c0c4d6">&mdash;</span>';
  var seg = [b0, b1, b2].map(function (v, i) {
    var pc = (Number(v) || 0) / t * 100;
    return pc <= 0 ? '' : '<i style="width:' + pc.toFixed(2) + '%;background:' + CONN_BANDS[i].ink + '"></i>';
  }).join('');
  return '<span class="conn-mix" title="1st–3rd ' + Math.round(b0 / t * 100) + '% · 4th–10th '
       + Math.round(b1 / t * 100) + '% · 11th+ ' + Math.round(b2 / t * 100) + '%">' + seg + '</span>';
}
/* The .panel host is a flex ROW container (it has to be, for the Action Center's
   full-height layout), so a view that returns sibling cards collapses to the
   height of the tallest one laid out side by side. Every renderer here returns
   ONE stacking child. This is why the cards carry no margins of their own — the
   gap lives on the stack, so a card can be reordered or removed without leaving
   a double space behind. */
function connStack(html) {
  return '<div class="conn-stack">' + html + '</div>';
}
function connNoSource(what) {
  /* A THROTTLED READ AND A MISSING TAB LOOK IDENTICAL from here, which is how
     a Sheets quota error read as "the feed was never wired" on 13 Sep. So the
     backend's error text is shown when there is one — blank must never be a
     mystery. */
  var err = (D && D.connHas && D.connHas.error) || '';
  var dg  = (D && D.connHas && D.connHas.diag) || {};
  var titles = dg.titles && dg.titles.length ? dg.titles.join(', ') : '';
  var picked = dg.picked ? Object.keys(dg.picked).map(function (k) { return k + ' → ' + dg.picked[k]; }).join(', ') : '';
  return '<div class="fb-box"><h4>' + esc(what) + '</h4>'
       + (err
          ? '<div class="fb-sub" style="padding:14px 0 4px;color:#b0382c;font-weight:700">' + esc(err) + '</div>'
          : '<div class="fb-sub" style="padding:14px 0 4px">No source tab yet. This view appears once the '
            + 'feed is landing in the sheet &mdash; it is deliberately blank rather than showing zeroes.</div>')
       + (titles ? '<div class="fb-sub" style="padding:0 0 10px">Tabs in the live sheet: ' + esc(titles)
            + (picked ? ' &middot; matched: ' + esc(picked) : '') + '</div>' : '')
       + '</div>';
}
/* Is the data in view the live 15-minute snapshot (weekly grain, no dates) or
   the per-day card feed? Every view that can be misread as date-filtered says
   which, in words, on the card. */
function connIsLive() { return !!(D && D.connHas && D.connHas.source === 'live'); }
function connGrainNote() {
  return connIsLive()
    ? 'Live feed, refreshed every 15 minutes &middot; <b>this week to date</b> &mdash; weekly totals per LRM, '
      + 'so the date filter above does not narrow this view'
    : esc((D && D.dateLabel) || '');
}
function connPctCell(v, dp) {
  return v === null || v === undefined || isNaN(Number(v))
    ? '<span style="color:#c0c4d6">&mdash;</span>' : Number(v).toFixed(dp === undefined ? 1 : dp) + '%';
}
/* Signed week-over-week move. Direction alone is not a verdict — for early
   hang-ups up is bad, for connectivity up is good — so the caller passes which
   way is good rather than the colour being baked in. */
function connWowCell(v, upIsGood) {
  if (v === null || v === undefined || isNaN(Number(v))) return '<td><span style="color:#c0c4d6">&mdash;</span></td>';
  var n = Number(v), good = upIsGood ? n > 0 : n < 0, bad = upIsGood ? n < -3 : n > 3;
  return '<td class="' + (bad ? 'bad' : (good && Math.abs(n) >= 3 ? 'ok' : '')) + '">'
    + (n > 0 ? '+' : '') + n.toFixed(1) + '</td>';
}

/* ── The floor beside its own baselines (Live_Floor) ─────────────────────────
   Today against the same day last week, the trailing 7-day mean and the same
   weekday over four weeks. It earns its place at the top of this tab because
   it is the only thing here that makes the volume growth visible — and that
   growth is exactly why every other comparison on this dashboard is expressed
   as a share or an index rather than a count. */
var CONN_FLOOR_COLS = [
  ['Calls', 'Dials', 0], ['Callers', 'Callers', 0], ['Calls per caller', 'Per caller', 0],
  ['Connectivity %', 'Conn %', 1], ['Real conversations %', 'Real %', 1],
  ['Early hang-up %', 'Early %', 1], ['Fair wait %', 'Fair wait %', 0],
  ['Seconds waited before hanging up', 'Waited', 0], ['Median talk (s)', 'Med talk', 0],
  ['Redial under a minute %', 'Redial %', 1], ['Fresh leads %', 'Fresh %', 1]
];
function connFloorCard() {
  var rows = (D && D.connFloor) || [];
  if (!rows.length) return '';
  var cols = CONN_FLOOR_COLS.filter(function (c) {
    return rows.some(function (r) { return r[c[0]] !== undefined && r[c[0]] !== ''; });
  });
  if (!cols.length) return '';
  var isDelta = function (r) { return /^change/i.test(String(r.Period || '')); };
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>The floor against its own baselines</h4>'
    +   '<span class="fh-note">floor-wide, unfiltered &middot; live</span></div>'
    + '<div class="tbl-wrap"><table class="dist"><thead><tr><th>Period</th>'
    + cols.map(function (c) { return '<th>' + esc(c[1]) + '</th>'; }).join('')
    + '</tr></thead><tbody>'
    + rows.map(function (r) {
        var d = isDelta(r);
        return '<tr' + (/^today/i.test(String(r.Period || '')) ? ' class="dist-total"' : '') + '>'
          + '<td class="nm">' + esc(r.Period) + '</td>'
          + cols.map(function (c) {
              var v = r[c[0]];
              if (v === undefined || v === '') return '<td><span style="color:#c0c4d6">&mdash;</span></td>';
              var n = Number(v);
              if (isNaN(n)) return '<td>' + esc(String(v)) + '</td>';
              return '<td' + (d ? ' style="color:var(--muted)"' : '') + '>'
                + (d && n > 0 ? '+' : '') + n.toFixed(c[2]) + '</td>';
            }).join('')
          + '</tr>';
      }).join('')
    + '</tbody></table></div>'
    + '<div class="fb-hrnote">The <b>same-weekday 4-week average</b> is the row to read carefully: the floor has '
    + 'roughly tripled since mid-August, so it sits far below today on volume and that is growth, not a spike. '
    + 'It is the reason the hour curve is compared as a <i>share of the day</i> and the per-caller figures as an '
    + '<i>index</i> &mdash; an absolute comparison against four weeks ago would call almost every hour a record.'
    + '</div></div>';
}

/* ════════════════════════════════════════════════════════════════════════════
   CONNECTIVITY TAB
   ════════════════════════════════════════════════════════════════════════════ */
/* The strip follows the Floor Board's markup exactly — <b> value, <span> label —
   so it inherits the established type hierarchy rather than restating it. The
   third line is this view's own addition: every figure here needs a definition
   beside it, because "connects" and "real conversations" are not the same
   number and the difference is the whole argument. */
function connStripCells(cells) {
  return '<div class="fb-strip" style="grid-template-columns:repeat(' + cells.length + ',1fr)">'
    + cells.map(function (c) {
        return '<div><b>' + c[1] + '</b><span>' + esc(c[0]) + '</span>'
             + (c[2] ? '<em class="conn-cs">' + esc(c[2]) + '</em>' : '') + '</div>';
      }).join('') + '</div>';
}

function connStrip(rows) {
  var t = { calls: 0, connects: 0, expected: 0, real: 0, fresh: 0 };
  rows.forEach(function (a) {
    t.calls += a.calls; t.connects += a.connects; t.expected += a.expected;
    t.real += a.real; t.fresh += a.fresh;
  });
  var idx = t.expected ? t.connects / t.expected * 100 : null;
  var sf  = t.expected ? t.connects - t.expected : null;
  var below = rows.filter(function (a) { return a.index !== null && a.index < 100; }).length;
  return connStripCells([
    ['Dials', fmt(t.calls), ''],
    ['Connects', fmt(t.connects) + ' <u>' + (t.calls ? (t.connects / t.calls * 100).toFixed(1) : '0') + '%</u>', 'absolute level'],
    ['Index', idx === null ? '&mdash;' : Math.round(idx), '100 = par for this lead mix'],
    ['Shortfall', sf === null ? '&mdash;' : (sf >= 0 ? '+' : '') + fmt(Math.round(sf)), 'conversations vs expected'],
    ['Real conversations', fmt(t.real), '15s+ of talking'],
    ['Below par', below + ' <u>of ' + rows.length + '</u>', 'LRMs indexing under 100']
  ]);
}

/* The ranked-bar chart behind the Connectivity tab. Sorted worst-first on the
   metric in view, so the top row is always where the next conversation is. */
var connLastTable = '';
function connChart(rows) {
  var M = CONN_METRICS[connMetric] || CONN_METRICS.index;
  var groups = connGroups(rows, connLevel).filter(function (b) { return b.calls > 0; });
  var items = groups.map(function (b) {
    var v = b[connMetric];
    return {
      label: b.name, value: v === null ? 0 : v, faint: v === null,
      sub: fmt(b.calls) + ' dials · ' + b.lrms + (b.lrms === 1 ? ' LRM' : ' LRMs')
    };
  }).sort(function (a, b) { return a.value - b.value; });
  if (connMetric === 'connPct' || connMetric === 'realPct') {
    // A rate needs its floor mean as the reference, or "26%" reads as a verdict
    // when it may be the estate norm.
    var tot = connGroups(rows, 'overall')[0];
    M = Object.assign({}, M, { baseline: tot ? Math.round(tot[connMetric] * 10) / 10 : undefined,
                               baselineLabel: 'floor ' + (tot ? tot[connMetric].toFixed(1) : '') + '%' });
  }
  return ccRankedBars(items, {
    baseline: M.baseline, baselineLabel: M.baselineLabel, signed: M.signed,
    suffix: M.suffix, goodHigh: true, aria: M.label + ' by ' + connLevel,
    fmt: function (v) { return (M.suffix === '' && Math.abs(v) >= 10 ? fmt(Math.round(v)) : (Math.round(v * 10) / 10)) + M.suffix; }
  });
}

function connTable(rows) {
  var level = connLevel;
  var groups = connGroups(rows, level);
  var keyName = { ados: 'AD', zsm: 'ZSM', tl: 'Team Lead', city: 'City', lrm: 'LRM', overall: 'Scope' }[level];
  groups.sort(function (a, b) {
    var k = connSort.col, av = a[k], bv = b[k];
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string') return String(av).localeCompare(String(bv)) * connSort.dir;
    return ((Number(av) || 0) - (Number(bv) || 0)) * connSort.dir;
  });
  var tot = connGroups(rows, 'overall')[0];
  var th = function (k, label, cls) {
    return '<th' + (cls ? ' class="' + cls + '"' : '') + ' data-conn="' + k + '" style="cursor:pointer">' + label + '</th>';
  };
  var row = function (b, isTot) {
    return '<tr' + (isTot ? ' class="dist-total"' : '') + '>'
      + '<td class="nm">' + esc(b.name) + (isTot ? '' : ' <span style="color:var(--muted);font-weight:400">(' + b.lrms + ')</span>') + '</td>'
      + '<td>' + fmt(b.calls) + '</td>'
      + '<td class="sep">' + fmt(b.connects) + '</td>'
      + '<td>' + b.connPct.toFixed(1) + '%</td>'
      + '<td>' + fmt(Math.round(b.expected)) + '</td>'
      + connIndexCell(b.index)
      + connShortCell(b.shortfall)
      + '<td class="sep">' + fmt(b.real) + '</td>'
      + '<td>' + b.realPct.toFixed(1) + '%</td>'
      + '<td class="sep">' + connDepthBar(b.b0, b.b1, b.b2) + '</td>'
      + '<td>' + (b.freshPct === null ? '<span style="color:#c0c4d6">&mdash;</span>' : b.freshPct.toFixed(0) + '%') + '</td>'
      + '<td class="sep">' + (isTot ? '' : b.below + ' of ' + b.lrms) + '</td>'
      + '</tr>';
  };
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th>' + keyName + '</th>'
    + th('calls', 'Dials')
    + th('connects', 'Connects', 'sep') + th('connPct', 'Conn %')
    + th('expected', 'Expected') + th('index', 'Index') + th('shortfall', 'Shortfall')
    + th('real', 'Real conv', 'sep') + th('realPct', 'Real %')
    + '<th class="sep">Depth mix</th>' + th('freshPct', 'Fresh %')
    + '<th class="sep">Below par</th>'
    + '</tr></thead><tbody>'
    + (tot ? row(tot, true) : '')
    + groups.map(function (b) { return row(b, false); }).join('')
    + '</tbody></table></div>';
}

function renderConnectivity() {
  var panel = document.getElementById('connPanel');
  if (!panel || !D) return;
  if (!D.connHas || !D.connHas.daily) {
    panel.innerHTML = connStack(connNoSource('Connectivity'));
    if (activeTab === 'conn') setCount('no connectivity feed');
    return;
  }
  var rows = connRows();
  if (activeTab === 'conn') setCount(rows.length + ' LRMs in view');
  if (!rows.length) {
    panel.innerHTML = connStack('<div class="fb-box"><h4>Connectivity</h4><div class="fb-sub" style="padding:14px 0">'
      + 'No connectivity rows for the current filter and date range.</div></div>');
    return;
  }
  var levels = [['ados', 'ADOS'], ['zsm', 'ZSM'], ['tl', 'Team Lead'], ['city', 'City'], ['lrm', 'LRM']];
  var baselineDays = rows.reduce(function (m, a) { return Math.max(m, a.baselineDays); }, 0);

  panel.innerHTML = connStack(
      connStrip(rows)
    + connFloorCard()
    + ccCard({
        title: 'Depth-adjusted connectivity',
        note: connGrainNote() + (baselineDays ? ' &middot; ' + baselineDays + '-day baseline' : ''),
        sub: CONN_METRICS[connMetric].sub,
        table: true, tableLabel: 'View table',
        seg: '<div style="display:flex;gap:10px;flex-wrap:wrap">'
           + ccSeg('data-connlvl', levels, connLevel)
           + ccSeg('data-connmet', Object.keys(CONN_METRICS).map(function (k) { return [k, CONN_METRICS[k].label]; }), connMetric)
           + '</div>',
        body: connChart(rows),
        foot: 'Bars are ranked worst first, so the top of the chart is where a conversation goes. '
            + '<b>Depth mix</b> is the lead-supply signal, not a performance one: fresh share fell 71.5% to 19.2% '
            + 'across 1&ndash;10 Sep while volume rose 54%, and headline connectivity fell 4.0pp over the same '
            + 'period while within-bucket execution improved 3.8pp. Attempt depth is bounded by the card&rsquo;s '
            + '90-day lookback, and ~20% of dial volume sits on numbers first dialled before it &mdash; those read '
            + 'shallower than reality, so their expected connects are overstated and the shortfall is pessimistic. '
            + 'Ranking is unaffected. The full table is one click away.'
      })
    + connDepthCard(rows));
  connLastTable = connTable(rows);
  ccWireTables(panel, 'Depth-adjusted connectivity · full table', connLastTable);

  panel.querySelectorAll('.dist-lvl button[data-connlvl]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      connLevel = btn.getAttribute('data-connlvl');
      try { localStorage.setItem('lrmConnLevel', connLevel); } catch (err) {}
      renderConnectivity();
    });
  });
  panel.querySelectorAll('.dist-lvl button[data-connmet]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      connMetric = btn.getAttribute('data-connmet');
      try { localStorage.setItem('lrmConnMetric', connMetric); } catch (err) {}
      renderConnectivity();
    });
  });
  panel.querySelectorAll('table.dist th[data-conn]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-conn');
      connSort.dir = (connSort.col === k) ? connSort.dir * -1 : (k === 'shortfall' || k === 'index' ? 1 : -1);
      connSort.col = k;
      renderConnectivity();
    });
  });
}

/* The depth curve: answer rate by attempt band, floor-wide for the scope in
   view. This is the picture the whole model rests on, so it is shown rather
   than asserted — a reader who does not believe the adjustment can check the
   gradient themselves. */
function connDepthCard(rows) {
  var t = [0, 0, 0], c = [0, 0, 0];
  rows.forEach(function (a) { t[0] += a.b0; t[1] += a.b1; t[2] += a.b2; });
  var total = t[0] + t[1] + t[2];
  if (!total) return '';
  /* Per-band CONNECTS are not in the feed (the card emits the mix and the
     expectation, not connects per band), so the curve is drawn from the
     expectation — which IS the floor's measured answer rate per band. Labelled
     as expected, not actual, because that is what it is. */
  var rows2 = CONN_BANDS.map(function (B, i) {
    return { label: B.label, ink: B.ink, calls: t[i], share: total ? t[i] / total * 100 : 0 };
  });
  var mx = Math.max.apply(null, rows2.map(function (r) { return r.share; })) || 1;
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>Where the dials are going</h4>'
    + '<span class="fh-note">' + fmt(total) + ' dials placed &middot; attempt depth per number</span></div>'
    + '<div class="fb-bars" style="margin-top:6px">'
    + rows2.map(function (r) {
        return '<div class="fb-bar"><span>' + esc(r.label) + ' attempt</span>'
          + '<div class="fb-trk"><i style="width:' + (r.share / mx * 100).toFixed(1) + '%;background:' + r.ink + '"></i></div>'
          + '<b>' + r.share.toFixed(1) + '%</b></div>';
      }).join('')
    + '</div>'
    + '<div class="fb-hrnote">Attempt depth is the number of times <i>that customer number</i> has been dialled, '
    + 'not the lead&rsquo;s age. The floor&rsquo;s answer rate falls from 34.3% on a first attempt to 20.0% by the '
    + 'sixth&ndash;tenth, which is the entire reason a raw connect rate cannot be compared between two callers. '
    + 'A bar leaning right is an exhausted list, and it is a <b>lead-supply</b> problem, not a calling one.</div>'
    + '</div>';
}

/* ════════════════════════════════════════════════════════════════════════════
   BEHAVIOUR TAB — conduct, and the only tab on this dashboard that is a
   coaching instrument.

   THE ONE RULE THIS TAB MUST NOT BREAK: a high cut rate on its own is NOT
   evidence of a problem. Controlled for attempt depth, the bottom three
   cut-rate quartiles perform IDENTICALLY (Q1 5.8% cut → 29.2% connectivity;
   Q3 42.7% cut → 29.2%); only the top quartile loses ~5pp. Cut rate is partly
   a SYMPTOM of a dead list — agents disproportionately cut calls that were
   going to fail anyway. An early estimate of 1,753 lost connects a day from
   hang-ups was revised to ~229 for exactly this reason.
   So the named list below requires BOTH an extreme rate AND a negative
   shortfall, and says so on the card.
   ════════════════════════════════════════════════════════════════════════════ */
function behavStrip(rows) {
  var t = { calls: 0, cuts: 0, early: 0, connects: 0, shortConn: 0, redials: 0, overCalls: 0, real: 0 };
  rows.forEach(function (a) {
    ['calls', 'cuts', 'early', 'connects', 'shortConn', 'redials', 'overCalls', 'real'
    ].forEach(function (f) { t[f] += a[f] || 0; });
  });
  var pat = rows.map(function (a) { return a.medPatience; }).filter(function (v) { return v !== null; });
  var medPat = pat.length ? pat.reduce(function (x, y) { return x + y; }, 0) / pat.length : null;
  return connStripCells([
    ['Early hang-ups', fmt(t.early) + ' <u>' + (t.calls ? (t.early / t.calls * 100).toFixed(1) : '0') + '%</u>',
      'agent cut before 20s of ringing'],
    ['Median patience', medPat === null ? '&mdash;' : Math.round(medPat) + 's', 'wait before an agent hangs up'],
    ['Short connects', fmt(t.shortConn) + ' <u>' + (t.connects ? (t.shortConn / t.connects * 100).toFixed(1) : '0') + '%</u>',
      'answered, then cut inside 15s'],
    ['Rapid redials', fmt(t.redials), 'same number, same agent, inside 60s'],
    ['Over the 3-dial cap', fmt(t.overCalls), 'dials beyond 3 per customer per day'],
    ['Real conversations', fmt(t.real), '15s+ of talking']
  ]);
}

/* The hour curve. Pooled over ten days, early hang-ups climb monotonically
   8.9% (09:00) → 21.8% (18:00) → 29.2% (19:00) → 52.5% (20:00) with no
   reversal, while connectivity falls 37.1% → 25.2%. The lead mix does not
   systematically worsen through the day, which is what makes this a DISCIPLINE
   curve rather than a supply artefact — and 09:00 is the best hour on every
   measure while carrying only ~2.3% of volume. */
/* The hour curve as a SMOOTH LINE (13 Sep 2026): dials as an area on the left
   axis, connectivity and early hang-ups as lines on the right. 09:00-21:00 —
   the floor works outside the old 10-19 window and cutting the axis there hid
   real dialling. An hour that has not happened is a GAP, not a zero. */
function behavHourChart() {
  if (!D.connHas || !D.connHas.hourly) return '';
  var byHour = {};
  (D.connHourly || []).forEach(function (r) {
    var hr = parseInt(String(r['Hour'] || '').slice(0, 2), 10);
    if (isNaN(hr)) return;
    var notYet = String(r['Status'] || '') === 'not yet';
    var b = byHour[hr] || (byHour[hr] = { calls: 0, conn: 0, early: 0, days: 0, notYet: true });
    if (notYet) return;
    b.notYet = false;
    var calls = Number(r['Calls']) || 0;
    b.calls += calls;
    b.conn  += calls * (Number(r['Connect %']) || 0) / 100;
    b.early += calls * (Number(r['Early Hangup %']) || 0) / 100;
    b.days++;
  });
  /* 09:00-21:00 means the hour BUCKETS 09 through 20 \u2014 the 20:00 bucket ends at
     21:00. A 21 bucket would be the hour AFTER 9pm and reads as a permanently
     empty column. Same derivation as DIST_HOURS on the Floor Board. */
  var hrs = [];
  for (var h = 9; h <= 20; h++) hrs.push(h);
  var labels = hrs.map(function (x) { return ('0' + x).slice(-2); });
  var dials = [], connPct = [], earlyPct = [];
  var any = false;
  hrs.forEach(function (x) {
    var b = byHour[x];
    if (!b || b.notYet || !b.calls) { dials.push(null); connPct.push(null); earlyPct.push(null); return; }
    any = true;
    dials.push(Math.round(b.calls));
    connPct.push(Math.round(b.conn / b.calls * 1000) / 10);
    earlyPct.push(Math.round(b.early / b.calls * 1000) / 10);
  });
  if (!any) return '';
  return ccSmoothLines(labels, [
    { name: 'Dials', values: dials, ink: CC_BLUE, area: 'rgba(35,72,168,.10)' },
    { name: 'Connectivity %', values: connPct, ink: CC_GREEN, axis: 'right' },
    { name: 'Early hang-up %', values: earlyPct, ink: CC_RED, axis: 'right', dash: '5 4' }
  ], { aria: 'connectivity and early hang-ups by hour', height: 256 });
}

/* Ranked bars per LRM for the conduct measure in view. */
function behavChart(rows) {
  var M = BEHAV_METRICS[behavMetric] || BEHAV_METRICS.earlyPct;
  var items = rows.filter(function (a) { return a.calls >= 100; }).map(function (a) {
    var v = a[behavMetric];
    return { label: agentName(a.email), value: v === null ? 0 : v, faint: v === null,
             sub: String(a.row['TL Name'] || '') + ' · ' + fmt(a.calls) + ' dials' };
  });
  var worstFirst = M.goodHigh === false;
  items.sort(function (a, b) { return worstFirst ? b.value - a.value : a.value - b.value; });
  items = items.slice(0, 18);
  var mean = rows.length ? rows.reduce(function (s, a) { return s + (Number(a[behavMetric]) || 0); }, 0) / rows.length : 0;
  return ccRankedBars(items, {
    suffix: M.suffix, goodHigh: M.goodHigh !== false, badAt: M.badAt,
    baseline: Math.round(mean * 10) / 10, baselineLabel: 'floor ' + (Math.round(mean * 10) / 10) + M.suffix,
    labelW: 172, aria: M.label + ' per LRM',
    fmt: function (v) { return (M.suffix === '' ? fmt(Math.round(v)) : (Math.round(v * 10) / 10)) + M.suffix; }
  });
}

function behavHourCard() {
  if (!D.connHas || !D.connHas.hourly) return '';
  var byHour = {}, hasReal = false;
  (D.connHourly || []).forEach(function (r) {
    var hr = parseInt(String(r['Hour'] || '').slice(0, 2), 10);
    if (isNaN(hr)) return;
    if (String(r['Status'] || '') === 'not yet') return;   // absence is not zero
    var b = byHour[hr] || (byHour[hr] = { hr: hr, calls: 0, conn: 0, early: 0, real: 0, normal: 0, days: 0, shape: '' });
    var calls = Number(r['Calls']) || 0;
    b.calls += calls;
    b.conn  += calls * (Number(r['Connect %']) || 0) / 100;
    b.early += calls * (Number(r['Early Hangup %']) || 0) / 100;
    if (r['Real Conversations'] !== undefined && r['Real Conversations'] !== '') {
      hasReal = true;
      b.real += Number(r['Real Conversations']) || 0;
    }
    b.normal += Number(r['Expected Calls']) || 0;
    var sh = String(r['Shape'] || '');
    if (sh === 'spike' || sh === 'collapse') b.shape = sh;
    b.days++;
  });
  var hrs = Object.keys(byHour).map(Number).sort(function (a, b) { return a - b; });
  if (!hrs.length) return '';
  var mxCalls = Math.max.apply(null, hrs.map(function (h) { return byHour[h].calls; })) || 1;
  var best = null, worst = null;
  hrs.forEach(function (h) {
    var b = byHour[h];
    if (b.calls < 200) return;              // a thin hour cannot be a verdict
    var e = b.early / b.calls * 100;
    if (best === null || e < best.e) best = { hr: h, e: e };
    if (worst === null || e > worst.e) worst = { hr: h, e: e };
  });
  var totCalls = 0, totNormal = 0;
  hrs.forEach(function (h) { totCalls += byHour[h].calls; totNormal += byHour[h].normal; });
  /* Last column: conversations where the feed has them, otherwise the hour's
     SHARE of the day against its normal share. Never both, and never a derived
     conversation count — the live hourly feed carries no talk data. */
  var lastHd = hasReal ? 'Real conv' : 'Share vs normal';
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>The hour curve &mdash; discipline through the day</h4>'
    + '<span class="fh-note">' + (connIsLive() ? 'today, live' : esc(D.dateLabel || '')) + ' &middot; floor-wide, unfiltered</span></div>'
    + '<div class="fb-sub" style="margin:-4px 0 10px">Bars are dial volume. The two percentages are the '
    + 'point: connectivity falls and early hang-ups climb as the day goes on.</div>'
    + '<div class="tbl-wrap"><table class="dist"><thead><tr><th>Hour</th><th>Dials</th>'
    + '<th class="sep">Share of day</th><th>Conn %</th><th>Early hang-up %</th><th class="sep">' + lastHd + '</th>'
    + '</tr></thead><tbody>'
    + hrs.map(function (h) {
        var b = byHour[h], e = b.calls ? b.early / b.calls * 100 : 0, c = b.calls ? b.conn / b.calls * 100 : 0;
        var thin = b.calls < 200;
        var last;
        if (hasReal) {
          last = fmt(Math.round(b.real));
        } else if (b.normal >= 50 && totCalls && totNormal) {
          var dev = (b.calls / totCalls) / (b.normal / totNormal) - 1;
          last = '<span' + (b.shape ? ' style="font-weight:800;color:#b0382c"' : '') + '>'
               + (dev > 0 ? '+' : '') + Math.round(dev * 100) + '%'
               + (b.shape ? ' ' + b.shape : '') + '</span>';
        } else {
          last = '<span style="color:#c0c4d6">&mdash;</span>';
        }
        return '<tr><td class="nm">' + ('0' + h).slice(-2) + ':00</td>'
          + '<td>' + fmt(Math.round(b.calls)) + '</td>'
          + '<td class="sep"><span class="conn-mix" style="width:90px"><i style="width:'
            + (b.calls / mxCalls * 100).toFixed(1) + '%;background:#3d5a99"></i></span></td>'
          + '<td' + (thin ? ' style="color:var(--muted)"' : (c >= 33 ? ' class="ok"' : (c < 27 ? ' class="bad"' : ''))) + '>' + c.toFixed(1) + '%</td>'
          + '<td' + (thin ? ' style="color:var(--muted)"' : (e >= 30 ? ' class="bad"' : (e < 12 ? ' class="ok"' : ''))) + '>' + e.toFixed(1) + '%</td>'
          + '<td class="sep">' + last + '</td></tr>';
      }).join('')
    + '</tbody></table></div>'
    + '<div class="fb-hrnote">'
    + (best && worst ? '<b>' + ('0' + best.hr).slice(-2) + ':00 is the cleanest hour (' + best.e.toFixed(1)
        + '% early hang-ups) and ' + ('0' + worst.hr).slice(-2) + ':00 the worst (' + worst.e.toFixed(1) + '%).</b> ' : '')
    + 'The climb is monotonic and the lead mix does not systematically worsen through the day, so this is '
    + 'discipline, not supply. The early hours are the best on every measure and carry the least volume &mdash; '
    + 'moving ~500 dials from the evening into 09:00 is worth roughly 60 extra conversations a day at no cost. '
    + 'Hours under 200 dials are greyed: too thin to be a verdict.'
    + (hasReal ? '' : ' <b>Share vs normal</b> compares this hour&rsquo;s share of the day with its share on a '
        + 'normal day, renormalised over the hours that have happened &mdash; a share, never a count, because the '
        + 'floor&rsquo;s volume has tripled since mid-August. A named break is a <b>systems or roster</b> event, '
        + 'not LRM behaviour.')
    + '</div>'
    + '</div>';
}

/* Named lists. These are the only place this dashboard names an individual on
   conduct, so the gate is deliberately double: an extreme rate AND a negative
   depth-adjusted shortfall. Volume floor too — a 40-call day swings every rate. */
function behavNamed(rows) {
  var cand = rows.filter(function (a) { return a.calls >= 150; });
  var early = cand.filter(function (a) { return a.earlyPct >= 35 && a.shortfall !== null && a.shortfall < 0; })
                  .sort(function (a, b) { return b.earlyPct - a.earlyPct; }).slice(0, 10);
  var shortC = cand.filter(function (a) { return a.shortPct >= 25 && a.connects >= 40; })
                   .sort(function (a, b) { return b.shortPct - a.shortPct; }).slice(0, 10);
  var over = cand.filter(function (a) { return a.overCalls > 0; })
                 .sort(function (a, b) { return b.overCalls - a.overCalls; }).slice(0, 10);
  var card = function (title, sub, list, cell, empty) {
    return '<div class="fb-box">'
      + '<div class="fh-hd"><h4>' + esc(title) + '</h4><span class="fh-note">' + list.length + ' named</span></div>'
      + '<div class="fb-sub" style="margin:-4px 0 8px">' + sub + '</div>'
      + (list.length
          ? '<div class="tbl-wrap"><table class="dist"><tbody>'
            + list.map(function (a) {
                return '<tr><td class="nm">' + esc(agentName(a.email)) + '</td>'
                  + '<td style="color:var(--muted);font-size:11px">' + esc(a.row['TL Name'] || '—') + '</td>'
                  + cell(a) + '</tr>';
              }).join('') + '</tbody></table></div>'
          : '<div class="fb-sub" style="padding:10px 0;color:var(--green)">' + esc(empty) + '</div>')
      + '</div>';
  };
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">'
    + card('Cutting early, and it is costing connects',
        'Both gates must be met: <b>35%+ of dials cut before 20s of ringing</b> AND a negative depth-adjusted '
        + 'shortfall. A high cut rate alone is not evidence &mdash; controlled for depth, the bottom three cut-rate '
        + 'quartiles perform identically, because agents disproportionately cut calls that were going to fail.',
        early, function (a) {
          return '<td class="bad">' + a.earlyPct.toFixed(1) + '%</td>'
            + '<td>' + fmt(a.calls) + ' dials</td>'
            + connShortCell(a.shortfall);
        }, 'Nobody clears both gates. Cut rates alone are not actionable.')
    + card('Hanging up on customers who answered',
        'Answered, then ended inside 15 seconds &mdash; <b>25%+ of their own connects</b>. Unlike ring-time '
        + 'patience this has no lead-quality defence: the customer picked up.',
        shortC, function (a) {
          return '<td class="bad">' + a.shortPct.toFixed(1) + '%</td>'
            + '<td>' + fmt(a.shortConn) + ' of ' + fmt(a.connects) + '</td>'
            + '<td>' + (a.medTalkS === null ? '—' : Math.round(a.medTalkS) + 's med talk') + '</td>';
        }, 'No LRM is cutting a quarter of their answered calls short.')
    + card('Over the 3-dial cap',
        'Dials beyond <b>3 per customer per day</b>. Estate-wide this ran at 13.1% of dial volume with 122 of 153 '
        + 'callers breaching, and the worst single number was dialled 124 times across six days with zero answers. '
        + 'Ozonetel has already offered a campaign-level daily limit per number &mdash; it is free and would cap this '
        + 'at the queue.',
        over, function (a) {
          return '<td class="bad">' + fmt(a.overCalls) + '</td>'
            + '<td>' + fmt(a.overCust) + ' numbers</td>'
            + '<td>' + a.redialPct.toFixed(1) + '% redial</td>';
        }, 'Nobody is over the cap in this range.')
    + '</div>';
}

function behavTable(rows) {
  rows = rows.slice().sort(function (a, b) {
    var k = behavSort.col, av = a[k], bv = b[k];
    if (av === null) return 1;
    if (bv === null) return -1;
    return ((Number(av) || 0) - (Number(bv) || 0)) * behavSort.dir;
  });
  var th = function (k, label, cls) {
    return '<th' + (cls ? ' class="' + cls + '"' : '') + ' data-behav="' + k + '" style="cursor:pointer">' + label + '</th>';
  };
  var hasWow = rows.some(function (a) { return a.connWow !== null || a.earlyWow !== null; });
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th>LRM</th><th>Team Lead</th>'
    + th('calls', 'Dials', 'sep')
    + th('cutPct', 'Agent cut %') + th('earlyPct', 'Early %')
    + (hasWow ? th('earlyWow', 'Early vs last wk') : '')
    + th('medPatience', 'Patience')
    + th('shortPct', 'Short conn %', 'sep') + th('medTalkS', 'Med talk')
    + th('realPerDay', 'Real conv / day', 'sep') + th('redialPct', 'Redial %')
    + th('overCalls', 'Over cap')
    + th('index', 'Index', 'sep') + th('shortfall', 'Shortfall')
    + (hasWow ? th('connWow', 'Conn vs last wk') : '')
    + '</tr></thead><tbody>'
    + rows.map(function (a) {
        return '<tr><td class="nm">' + esc(agentName(a.email)) + '</td>'
          + '<td style="color:var(--muted);font-size:11px">' + esc(a.row['TL Name'] || '—') + '</td>'
          + '<td class="sep">' + fmt(a.calls) + '</td>'
          + '<td>' + connPctCell(a.cutPct) + '</td>'
          + '<td' + (a.earlyPct >= 35 ? ' class="bad"' : (a.earlyPct < 10 ? ' class="ok"' : '')) + '>' + a.earlyPct.toFixed(1) + '%</td>'
          + (hasWow ? connWowCell(a.earlyWow, false) : '')
          + '<td>' + (a.medPatience === null ? '—' : Math.round(a.medPatience) + 's') + '</td>'
          + '<td class="sep' + (a.shortPct >= 25 ? ' bad' : '') + '">' + a.shortPct.toFixed(1) + '%</td>'
          + '<td>' + (a.medTalkS === null ? '—' : Math.round(a.medTalkS) + 's') + '</td>'
          + '<td class="sep">' + a.realPerDay.toFixed(1) + '</td>'
          + '<td>' + a.redialPct.toFixed(1) + '%</td>'
          + '<td>' + (a.overCalls ? fmt(a.overCalls) : '<span style="color:var(--muted)">0</span>') + '</td>'
          + connIndexCell(a.index, 'sep')
          + connShortCell(a.shortfall)
          + (hasWow ? connWowCell(a.connWow, true) : '')
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}

function renderBehaviour() {
  var panel = document.getElementById('behavPanel');
  if (!panel || !D) return;
  if (!D.connHas || !D.connHas.daily) {
    panel.innerHTML = connStack(connNoSource('Calling behaviour'));
    if (activeTab === 'behav') setCount('no connectivity feed');
    return;
  }
  var rows = connRows();
  if (activeTab === 'behav') setCount(rows.length + ' LRMs in view');
  if (!rows.length) {
    panel.innerHTML = connStack('<div class="fb-box"><h4>Calling behaviour</h4><div class="fb-sub" style="padding:14px 0">'
      + 'No rows for the current filter and date range.</div></div>');
    return;
  }
  window.__ccBehavHour = behavHourCard();
  window.__ccBehavTable = behavTable(rows);
  var hourChart = behavHourChart();
  panel.innerHTML = connStack(
      behavStrip(rows)
    + (hourChart ? ccCard({
        title: 'The hour curve &mdash; discipline through the day',
        note: (connIsLive() ? 'today, live' : esc(D.dateLabel || '')) + ' &middot; floor-wide, unfiltered',
        sub: 'Dials as the shaded area, connectivity and early hang-ups as lines on the right axis. '
           + 'Connectivity falls and early hang-ups climb as the day goes on — that is the point of the card. '
           + '09:00&ndash;21:00; an hour that has not happened is left open, never drawn as a zero.',
        table: true, tableLabel: 'View hourly table', tableSrc: '__ccBehavHour',
        tableTitle: 'Hour by hour · full table',
        body: hourChart,
        foot: 'The climb is monotonic and the lead mix does not systematically worsen through the day, so this is '
            + 'discipline, not supply. The early hours are the best on every measure and carry the least volume '
            + '&mdash; moving ~500 dials from the evening into 09:00 is worth roughly 60 extra conversations a day '
            + 'at no cost.'
      }) : behavHourCard())
    + behavNamed(rows)
    + ccCard({
        title: 'Per LRM',
        note: rows.length + ' LRMs',
        sub: BEHAV_METRICS[behavMetric].sub,
        table: true, tableLabel: 'View full table', tableSrc: '__ccBehavTable',
        tableTitle: 'Calling behaviour per LRM · full table',
        seg: ccSeg('data-behavmet', Object.keys(BEHAV_METRICS).map(function (k) { return [k, BEHAV_METRICS[k].label]; }), behavMetric),
        body: behavChart(rows),
        foot: 'Worst 18 shown, ranked, against the floor mean (dashed). Behaviour is a stable individual trait: '
            + 'within-agent day-to-day variation in early hang-up rate is about 6.7 percentage points, so these '
            + 'figures are characteristic of the person, not of the day. Under 100 dials in range is excluded — a '
            + 'short day swings every rate. <b>Ozonetel only</b> &mdash; Exotel runs in parallel, so every '
            + 'per-person count here is a partial record and must be merged before it touches an appraisal.'
      }));
  ccWireTables(panel, 'Calling behaviour · full table', window.__ccBehavTable);

  panel.querySelectorAll('.dist-lvl button[data-behavmet]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      behavMetric = btn.getAttribute('data-behavmet');
      try { localStorage.setItem('lrmBehavMetric', behavMetric); } catch (err) {}
      renderBehaviour();
    });
  });
  panel.querySelectorAll('table.dist th[data-behav]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-behav');
      behavSort.dir = (behavSort.col === k) ? behavSort.dir * -1 : -1;
      behavSort.col = k;
      renderBehaviour();
    });
  });
}

/* ── Action Center alerts (consumed by index.html) ────────────────────────────
   One card per LRM who broke their OWN baseline, from the conn_anomaly feed.
   The feed is already collapsed to one row per LRM per day (worst break leads,
   the rest named in "Also Broke"), so this is a straight read — no re-ranking.

   THE OWNER TAG IS NOT DECORATION. The feed's Owner column distinguishes a
   coaching conversation from a roster or systems event, and a volume collapse
   is almost always the latter. The most expensive mistake in this whole
   analysis was an inbound failure hypothesised as agents not being Ready — 61
   agents were Ready on average at the moment of a drop, and the real cause was
   routing configuration. An alert without an owner gets solved by hiring. */
function connAlertCards() {
  if (!D || !D.connHas || !D.connHas.anomaly || !D.connAnomaly || !D.connAnomaly.length) return [];
  var keep = {};
  filterAgents().forEach(function (r) {
    var e = String(r['Agent Id'] || '').trim().toLowerCase();
    if (e) keep[e] = r;
  });
  var maxDay = '';
  D.connAnomaly.forEach(function (r) {
    var d = String(r['Date'] || '').slice(0, 10);
    if (d > maxDay) maxDay = d;
  });
  return D.connAnomaly.filter(function (r) {
    return String(r['Date'] || '').slice(0, 10) === maxDay
        && keep[String(r._email || r['LRM Email'] || '').trim().toLowerCase()];
  }).sort(function (a, b) {
    return Math.abs(Number(b['Z']) || 0) - Math.abs(Number(a['Z']) || 0);
  }).map(function (r) {
    var owner = String(r['Owner'] || '');
    var isBehaviour = owner.indexOf('TL') === 0;
    var breaks = Number(r['Breaks']) || 1;
    return {
      email: String(r._email || r['LRM Email'] || ''),
      name: r['LRM Name'] || agentName(r['LRM Email']),
      metric: String(r['Worst Break'] || ''),
      today: Number(r['Today']),
      normal: Number(r['Own Normal']),
      z: Number(r['Z']),
      breaks: breaks,
      also: String(r['Also Broke'] || ''),
      calls: Number(r['Calls That Day']) || 0,
      owner: owner,
      readAs: String(r['Read As'] || ''),
      // Severity is the count of metrics that moved, not the z — a whole-day
      // slip outranks one sharp ratio.
      sev: breaks >= 3 ? 'red' : (Math.abs(Number(r['Z']) || 0) >= 4 ? 'gold' : 'blue'),
      coachable: isBehaviour
    };
  });
}

/* ── Own-baseline breaks (conn_anomaly feed) ─────────────────────────────────
   Alert CARDS were deliberately removed from this tab: most scored off Connect
   %, which is no longer user-facing, and the rest restated what the
   below-the-bar counts already say. These are neither. A break is an LRM moving
   away from THEIR OWN trailing 14-day normal, which the distribution table
   cannot express at all — it counts people below a fixed bar, so a consistently
   strong LRM having a bad day is invisible to it, and a consistently weak one is
   flagged every single day.

   The test is only legitimate because behaviour is a stable individual trait:
   within-agent day-to-day variation in early hang-up rate is about 6.7
   percentage points, and the extremes are stable to within a point or two. So a
   break is genuinely news.

   TWO THINGS THIS STRIP MUST KEEP DOING:
   · Lead with BREAKS, not with the z-score. Three metrics moving at once is a
     whole-day slip and outranks one sharp ratio.
   · Carry the OWNER. A volume collapse is roster or lead supply, not conduct —
     the single most expensive error in this analysis was an inbound failure
     hypothesised as agents not being Ready when 61 were Ready on average, and
     an unowned alert gets solved by hiring. Non-coachable breaks render grey
     and say so in words, not by colour alone.

   Renders nothing at all when the feed is absent or no one broke — an empty
   alert strip would train people to ignore the space. */
function connBreakStrip(){
  if(typeof connAlertCards!=='function') return '';
  var cards=connAlertCards();
  if(!cards.length) return '';
  var shown=cards.slice(0,6);
  var coach=cards.filter(function(c){return c.coachable;}).length;
  return '<div class="fb-box" style="margin:0 0 12px">'
    + '<div class="fh-hd"><h4>Broke their own baseline</h4>'
    +   '<span class="fh-note">'+cards.length+' LRM'+(cards.length===1?'':'s')+' &middot; '
    +   coach+' coachable &middot; latest day in range</span></div>'
    + '<div class="fb-sub" style="margin:-4px 0 9px">Measured against each LRM&rsquo;s own trailing 14 days, '
    +   'not against the floor &mdash; so a stable high performer having a bad day shows up, and a stable '
    +   'low performer is not flagged every day for being themselves.</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:9px">'
    + shown.map(function(c){
        var tint=c.coachable?(c.sev==='red'?'#b0382c':(c.sev==='gold'?'#8a6d1f':'#3d5a99')):'#8a93a8';
        return '<div style="border:1px solid var(--border);border-left:3px solid '+tint+';border-radius:6px;padding:8px 11px;background:var(--surface)">'
          + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">'
          +   '<b style="font-size:12.5px;color:var(--text)">'+esc(c.name)+'</b>'
          +   '<span style="font-size:10px;font-weight:800;color:'+tint+'">'+(c.breaks>1?c.breaks+' METRICS':'z '+(c.z>0?'+':'')+c.z.toFixed(1))+'</span>'
          + '</div>'
          + '<div style="font-size:11.5px;color:var(--text);margin-top:3px">'+esc(c.metric)+' '
          +   '<b>'+(Math.round(c.today*10)/10)+'</b> '
          +   '<span style="color:var(--muted)">vs their normal '+(Math.round(c.normal*10)/10)+'</span></div>'
          + (c.also?'<div style="font-size:10.5px;color:var(--muted);margin-top:2px">also: '+esc(c.also)+'</div>':'')
          + '<div style="font-size:10px;color:'+(c.coachable?'var(--muted)':'#8a93a8')+';margin-top:5px;font-weight:700">'
          +   esc(c.owner)+'</div>'
          + '</div>';
      }).join('')
    + '</div>'
    + (cards.length>shown.length?'<div class="fb-sub" style="margin-top:8px">'+(cards.length-shown.length)
        +' more on the Calling Behaviour tab.</div>':'')
    + '<div class="fb-hrnote">A <b>calls</b> break is almost always leave, a shift change or a lead-supply gap &mdash; '
    +   'it is tagged roster/systems and must not go to a TL as a performance note. A <b>shortfall</b> break means '
    +   'check lead supply before the person. Ozonetel only: Exotel runs in parallel, so these counts are a partial '
    +   'record and must be merged before anything touches an appraisal.</div>'
    + '</div>';
}

Object.assign(window, {
  renderConnectivity: renderConnectivity,
  renderBehaviour: renderBehaviour,
  connAlertCards: connAlertCards,
  connStripCells: connStripCells,
  connStack: connStack,
  connBreakStrip: connBreakStrip,
  connNoSource: connNoSource,
  connRows: connRows
});
