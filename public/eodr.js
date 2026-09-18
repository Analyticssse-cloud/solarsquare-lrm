/* ════════════════════════════════════════════════════════════════════════════
   eodr.js — the EODR tab: the end-of-day review sheet, one entity at a time.

   WHAT THIS IS
   ------------
   A rebuild of the EODR spreadsheet: ONE card — a fixed row list against
   Today / MTD / R7 / R30. It is deliberately NOT a leaderboard: the whole point
   is one scope's card, read down, with the baseline visible on every cell.

   SCOPE COMES FROM THE DASHBOARD'S OWN FILTER BAR (user, 16 Sep)
   --------------------------------------------------------------
   There were three blocks (LRM / TL-per-LRM / ZSM-per-LRM) with three private
   dropdowns. All four are GONE. The filter bar already selects ADOS / ZSM /
   City / TL / LRM for every other tab, so a second set of pickers here was a
   parallel control that could disagree with the one above it. `eodrInScope()`
   applies the SAME tests as `filterAgents()` — against the rows of each fetched
   window, not `D.agentRows`, which is why it is its own predicate rather than a
   call to that function.
   ONE consequence to hold on to: the card is per-LRM whenever more than one LRM
   is in scope, and absolute when the filter narrows to exactly one. The old
   three-block split WAS that distinction, so it is now automatic and stated in
   the subhead — never silently switched. Two rows only make sense across people
   (latest work start, shrinkage) and hide themselves at a single LRM.
   `F.band` / `F.flag` are deliberately NOT applied: they are performance cuts
   (low volume, idle, no meetings), and dropping idle LRMs would delete exactly
   the people shrinkage is counting.

   FOUR WINDOWS MEAN FOUR REQUESTS, AND THAT IS CHEAPER THAN IT LOOKS
   ------------------------------------------------------------------
   /api/dashboard returns rows already AGGREGATED over the requested range —
   there is no per-day breakdown in the payload — so Today/MTD/R7/R30 cannot be
   sliced from one response. They are four calls. The server reads the Ozontel
   tab once and serves the rest from `_sheetcache.js`, so this costs one sheet
   read, not four, and the result is cached here for the session.

   THE BASELINE IS PER DAY, SO IT IS SCALED PER WINDOW
   ---------------------------------------------------
   175 unique leads is a DAY's target. Painting MTD green against 175 would
   pass everyone by the 2nd of the month. Count rows scale the baseline by the
   number of days in the window; rates (MS Score, the ratios) do not.

   THE TIME ROWS MEASURE WORK START, NOT ARRIVAL — BY DESIGN (user, 16 Sep)
   -----------------------------------------------------------------------
   Login/arrival is NOT CAPTURED ANYWHERE — not in this dashboard, not upstream.
   There is no punch clock to be missing, so the first Ozonetel dial is not a
   stand-in for a better number: it IS the only observable truth, "this person
   started working". The user's own framing of the gap: someone can reach the
   office at 09:30 and not start working until 10:30 or 11:00. A number that
   credited the 09:30 would be the WRONG number for this sheet — the row exists
   to show when work began.
   So: do NOT relabel these rows as proxies awaiting a feed, and do not wire
   lrm_status / lrm_status_sessions in behind them (that work is parked; see
   CLAUDE.md). Two real limits stay stated on screen, because they are
   properties of the definition rather than gaps in it:
     · an LRM who never dialled has no row at all, so they are absent from the
       average, not a late start; and
     · EODR_CHECKIN_MIN_CALLS keeps a one-dial day from voting (see below).
   Shrinkage follows the same rule: no dials all day = did not work that day.

   WHAT IS NOT WIRED, AND SAYS SO
   ------------------------------
   · Effective talk is a LOWER BOUND, not an estimate. There is no talk-time-
     per-duration-bucket column anywhere in the feed, so talk on sub-15s
     connects cannot be subtracted exactly — but it is at most 15s per such
     call, so total minus 0.25 x (connects - real connects) is a floor the data
     supports. It is never dressed up as exact, and the A/B/C/D split the paper
     sheet asks for (ring / conversation / voicemail / one-sided cut) is NOT
     here: voicemail is not a field in the Ozonetel tables at all.
   · MS Score comes from the LRM_View matrix in its OWN spreadsheet (MS_SHEET_ID),
     unpivoted per LRM/day in api/_msscore.js. A window is the MEAN of that LRM's
     scored days, never a sum; a blank day stays blank rather than scoring 0 and
     is never carried forward from the previous day (user, 18 Sep 2026) — a
     scoring row showing zero for everyone looks like universal failure, not a
     missing feed. Coverage is partial by nature (~78 of ~190 LRMs), so the
     footnote states how many were scored.
   ════════════════════════════════════════════════════════════════════════════ */

var eodrCache = null;        // { key, windows: {today,mtd,r7,r30} }
var eodrLoading = false;
var eodrError = '';

/* ── Windows ─────────────────────────────────────────────────────────────────
   Anchored on the dashboard's own "to" date, not on the wall clock: if the
   sheet has not caught up yet, the whole tab must agree about which day
   "Today" is, and D.toDate is the day every other tab is showing. */
function eodrWindows() {
  var anchor = (D && (D.toDate || D.fromDate)) || new Date().toISOString().slice(0, 10);
  var d = new Date(anchor + 'T00:00:00');
  var iso = function (x) { return x.toISOString().slice(0, 10); };
  var back = function (n) { var y = new Date(d); y.setDate(y.getDate() - n); return iso(y); };
  var mStart = anchor.slice(0, 8) + '01';
  var dayNum = Number(anchor.slice(8, 10)) || 1;
  return {
    today: { key: 'today', label: 'Today',  from: anchor,  to: anchor, days: 1 },
    mtd:   { key: 'mtd',   label: 'MTD',    from: mStart,  to: anchor, days: dayNum },
    r7:    { key: 'r7',    label: 'R7',     from: back(6), to: anchor, days: 7 },
    r30:   { key: 'r30',   label: 'R30',    from: back(29), to: anchor, days: 30 }
  };
}

function eodrNum(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v == null ? '' : v).replace(/[, %]/g, ''));
  return isFinite(n) ? n : 0;
}

/* ── One window's rows -> one aggregate ──────────────────────────────────────
   `lrms` counts the PEOPLE in scope and `idle` those with no dial, because the
   per-LRM blocks divide by the first and shrinkage reads the second. Both are
   headcounts of rows present in the feed, so an LRM the Ozontel tab never
   wrote at all is invisible to either — stated in the footnote. */
/* Minimum dials before an LRM/day counts as a check-in observation — see the note at
   the First Call Min accumulator. */
var EODR_CHECKIN_MIN_CALLS = 5;
function eodrAgg(rows) {
  var a = { calls: 0, connected: 0, real: 0, leads: 0, talkHr: 0, trwHr: 0,
            ringHr: 0, wrapHr: 0, ringFill: 0, wrapFill: 0, hasTRW: false,
            firstMinSum: 0, firstMinN: 0, firstMinMax: null,
            msToday: 0, t0: 0, t1: 0, t2: 0, gt2: 0, md: 0,
            lrms: 0, idle: 0, scoreSum: 0, scoreN: 0 };
  (rows || []).forEach(function (r) {
    a.calls     += eodrNum(r['Call Count']);
    a.connected += eodrNum(r['Connected Calls']);
    a.real      += eodrNum(r['Real Connects (15s+)']);
    a.leads     += eodrNum(r['Unique Leads Dialed']);
    a.talkHr    += eodrNum(r['Total Talk Time']);
    a.ringHr    += eodrNum(r['Ring Time']);
    a.wrapHr    += eodrNum(r['Wrap Time']);
    a.ringFill  += eodrNum(r['Ring Filled']);
    a.wrapFill  += eodrNum(r['Wrap Filled']);
    if (r['Total Time (T+R+W)'] !== undefined && r['Total Time (T+R+W)'] !== '') {
      a.hasTRW = true; a.trwHr += eodrNum(r['Total Time (T+R+W)']);
    }
    // Check-in proxy. Averaged across the LRMs/days that HAVE a first call; a row
    // with no dial contributes nothing rather than a zero, which would read 00:00.
    // VOLUME FLOOR (14 Sep acceptance run): LRMs with a single dial showed first calls
    // at 19:06, 20:57 and 23:06 — real dials, meaningless as a start time, and the TL
    // block takes the LATEST, so one of them would name the whole team's slowest starter.
    // Under EODR_CHECKIN_MIN_CALLS the row simply does not vote.
    var fm = r['First Call Min'];
    if (fm !== undefined && fm !== '' && fm !== null && eodrNum(fm) > 0
        && eodrNum(r['Call Count']) >= EODR_CHECKIN_MIN_CALLS) {
      var v = eodrNum(fm);
      a.firstMinSum += v; a.firstMinN += 1;
      if (a.firstMinMax === null || v > a.firstMinMax) a.firstMinMax = v;
    }
    a.msToday   += eodrNum(r['MS Today']);
    a.t0        += eodrNum(r['MS T+0']);
    a.t1        += eodrNum(r['MS T+1']);
    a.t2        += eodrNum(r['MS T+2']);
    a.gt2       += eodrNum(r['MS >T+2']);
    a.md        += eodrNum(r['Meeting Done']);
    a.lrms      += 1;
    if (eodrNum(r['Call Count']) === 0) a.idle += 1;
    var sc = r['MS Score'];
    if (sc !== undefined && sc !== '' && sc !== null) { a.scoreSum += eodrNum(sc); a.scoreN += 1; }
  });
  a.talkMin   = a.talkHr * 60;
  a.msTotal   = a.t0 + a.t1 + a.t2 + a.gt2;
  // The user's definitions (15 Sep): payload_Duration IS talk, so the long-standing
  // "Total Talk Time" column is EFFECTIVE talk. "Total" is ring+talk+wrap, the new
  // column. Until the sheet carries it the total row says so, rather than printing
  // the same number twice under two names.
  a.effTalk   = a.talkMin;
  a.totalTime = a.hasTRW ? a.trwHr * 60 : null;
  a.firstCall = a.firstMinN ? a.firstMinSum / a.firstMinN : null;
  a.lastCheck = a.firstMinMax;
  a.msScore   = a.scoreN ? a.scoreSum / a.scoreN : null;
  a.shrinkage = a.lrms ? a.idle / a.lrms * 100 : null;
  return a;
}

/* ── The row definitions ─────────────────────────────────────────────────────
   ONE list for every scope. `per` divides by headcount, so the same row reads
   as an absolute when the filter holds a single LRM and as a per-LRM mean when
   it holds a team — the old three-block split, without three lists to keep in
   step. `base` is the per-DAY baseline; `flat` marks a row whose baseline must
   not be multiplied by the window length; `multiOnly` hides a row that is
   meaningless for one person. */
var EODR_FMT = {
  int:  function (v) { return v === null ? '—' : fmt(Math.round(v)); },
  one:  function (v) { return v === null ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-IN'); },
  pct:  function (v) { return v === null ? '—' : (Math.round(v * 10) / 10) + '%'; },
  // Minutes since midnight -> HH:MM. A null is a dash, never a 0 rendered as 00:00.
  clock: function (v) {
    if (v === null) return '—';
    var m = Math.round(v), h = Math.floor(m / 60) % 24;
    return (h < 10 ? '0' : '') + h + ':' + ((m % 60) < 10 ? '0' : '') + (m % 60);
  }
};
/* The check-in baseline is a DEADLINE, not a target to exceed: earlier is better, so
   the tint inverts and the window length never scales it. 600 = 10:00. */
var EODR_CHECKIN_BY = 600;
/* `g` is the band the row sits under. Fifteen undifferentiated rows read as a
   spreadsheet dump; four named groups read as a review sheet. The band is drawn
   whenever `g` changes, so the order of this list IS the grouping. */
var EODR_ROWS = [
  { id: 'checkin', g: 'Floor time', label: 'Work start (first dial)', get: function (a) { return a.firstCall; }, f: 'clock', deadline: EODR_CHECKIN_BY, baseTxt: '10:00', note: 'when dialling began' },
  { id: 'late',    g: 'Floor time', label: 'Latest start in scope', get: function (a) { return a.lastCheck; }, f: 'clock', deadline: EODR_CHECKIN_BY, baseTxt: '10:00', note: 'slowest starter', multiOnly: true },
  { id: 'shrink',  g: 'Floor time', label: 'Shrinkage', get: function (a) { return a.shrinkage; }, f: 'pct', flat: true, goodLow: true, note: 'no dials all day', multiOnly: true },
  { id: 'leads',   g: 'Activity', label: 'Unique leads dialled', get: function (a) { return a.leads; }, f: 'int', base: 175, per: true },
  { id: 'eff',     g: 'Activity', label: 'Effective talk', get: function (a) { return a.effTalk; }, f: 'int', base: 120, per: true, note: 'actual talk, minutes' },
  { id: 'talk',    g: 'Activity', label: 'Total talk', get: function (a) { return a.totalTime; }, f: 'int', base: 240, per: true, note: 'ring + talk + wrap, minutes', feedIf: 'trw' },
  { id: 'msTod',   g: 'Meetings created', label: 'MS scheduled for today', get: function (a) { return a.msToday; }, f: 'one', base: 10, per: true },
  { id: 't0',      g: 'Meetings created', label: 'MS created for today', get: function (a) { return a.t0; }, f: 'one', base: 10, per: true },
  { id: 't1',      g: 'Meetings created', label: 'MS created for tomorrow', get: function (a) { return a.t1; }, f: 'one', base: 10, per: true },
  { id: 't2',      g: 'Meetings created', label: 'MS created for T+2', get: function (a) { return a.t2; }, f: 'one', base: 10, per: true },
  { id: 'msTot',   g: 'Meetings created', label: 'MS created \u2014 total', get: function (a) { return a.msTotal; }, f: 'one', base: 12, per: true },
  { id: 'md',      g: 'Outcomes', label: 'Meetings done', get: function (a) { return a.md; }, f: 'one', base: 6, per: true },
  { id: 'score',   g: 'Outcomes', label: 'MS score', get: function (a) { return a.msScore; }, f: 'one', base: 75, flat: true, feedIf: 'score', note: 'mean of scored days' },
  { id: 'msmd',    g: 'Outcomes', label: 'MS \u2192 MD %', get: function (a) { return a.msTotal ? a.md / a.msTotal * 100 : null; }, f: 'pct', flat: true, note: 'MD \u00f7 MS' },
  { id: 'leadmd',  g: 'Outcomes', label: 'MD / lead %', get: function (a) { return a.leads ? a.md / a.leads * 100 : null; }, f: 'pct', flat: true }
];
/* ── Scope: the dashboard's own filter bar ───────────────────────────────────
   The SAME tests as filterAgents(), applied to the rows of a fetched window
   instead of D.agentRows — which is the only reason this is a predicate rather
   than a call to that function. Keep the two in step: a filter added to the bar
   must be added here, or the EODR card quietly ignores it.
   F.band / F.flag are deliberately NOT applied — they are performance cuts, and
   dropping idle LRMs would delete the very rows shrinkage counts. */
function eodrInScope(r) {
  if (typeof F === 'undefined' || !F) return true;
  if (F.ados && F.ados.length   && F.ados.indexOf(String(r['ADOS Name'] || '')) < 0) return false;
  if (F.zsms && F.zsms.length   && F.zsms.indexOf(String(r['ZSM Name'] || '')) < 0) return false;
  if (F.cities && F.cities.length && F.cities.indexOf(String(r['City'] || '')) < 0) return false;
  if (F.tls && F.tls.length     && F.tls.indexOf(String(r['TL Name'] || '')) < 0) return false;
  if (F.agents && F.agents.length && F.agents.indexOf(String(r['Agent Id'] || '')) < 0) return false;
  if (F.q && typeof fMatchQ === 'function' && !fMatchQ(r)) return false;
  return true;
}

/* What the card says it is showing. Reads the filter bar, not the rows, so it
   is right even in a window that loaded empty. */
function eodrScopeLabel() {
  if (typeof F === 'undefined' || !F) return 'All LRMs';
  var p = [];
  if (F.ados && F.ados.length) p.push('ADOS: ' + F.ados.join(', '));
  if (F.zsms && F.zsms.length) p.push('ZSM: ' + F.zsms.join(', '));
  if (F.cities && F.cities.length) p.push('City: ' + F.cities.join(', '));
  if (F.tls && F.tls.length) p.push('TL: ' + F.tls.join(', '));
  if (F.agents && F.agents.length) p.push('LRM: ' + (F.agents.length === 1 ? F.agents[0] : F.agents.length + ' selected'));
  if (F.q) p.push('Search: \u201c' + F.q + '\u201d');
  return p.length ? p.join(' \u00b7 ') : 'All LRMs \u2014 no filter set';
}

/* ── Fetch ───────────────────────────────────────────────────────────────────
   Four ranges, in parallel, once per anchor date. A failure is kept as text:
   the panel must say "R30 did not load" rather than silently paint a column of
   dashes that reads as a genuine zero. */
function eodrLoad(force) {
  var W = eodrWindows();
  var key = W.today.to;
  if (!force && eodrCache && eodrCache.key === key) return Promise.resolve(eodrCache);
  if (window.MOCK && !window.__forceApi) {
    eodrCache = { key: key, windows: eodrMockWindows(W) };
    return Promise.resolve(eodrCache);
  }
  eodrLoading = true; eodrError = '';
  var keys = ['today', 'mtd', 'r7', 'r30'];
  return Promise.all(keys.map(function (k) {
    var w = W[k];
    return fetch('/api/dashboard?from=' + w.from + '&to=' + w.to + '&_t=' + Date.now(),
      { cache: 'no-store', headers: (window.AUTH && AUTH.token) ? { Authorization: 'Bearer ' + AUTH.token } : {} })
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.error || r.status); }); })
      .then(function (j) { return { k: k, rows: j.agentRows || [] }; })
      .catch(function (e) { return { k: k, rows: null, err: String(e.message || e) }; });
  })).then(function (res) {
    var out = {};
    res.forEach(function (r) { out[r.k] = r.rows; if (r.err) eodrError = r.err; });
    eodrLoading = false;
    eodrCache = { key: key, windows: out };
    return eodrCache;
  });
}
/* Preview harness only: the four windows are scaled from the single mock
   window so the tab is inspectable without a backend. Nothing here ships to a
   signed-in user, and the panel labels it. */
function eodrMockWindows(W) {
  var base = (D && D.agentRows) || [];
  var scale = function (mult) {
    return base.map(function (r) {
      var o = {};
      Object.keys(r).forEach(function (k) { o[k] = r[k]; });
      ['Call Count', 'Connected Calls', 'Real Connects (15s+)', 'Unique Leads Dialed',
       'Total Talk Time', 'MS Today', 'MS T+0', 'MS T+1', 'MS T+2', 'MS >T+2', 'Meeting Done']
        .forEach(function (k) { o[k] = Math.round(eodrNum(r[k]) * mult * 10) / 10; });
      // Clock and derived-time columns are NOT scaled — multiplying a check-in time
      // by the window length is meaningless. Synthesised here only so the preview
      // shows the row; the live sheet supplies both from the v15 query.
      if (o['First Call Min'] === undefined) {
        var seed = 0, e = String(r['Agent Id'] || '');
        for (var i = 0; i < e.length; i++) seed = (seed * 31 + e.charCodeAt(i)) % 97;
        o['First Call Min'] = 570 + seed % 55;               // 09:30–10:24
      }
      if (o['Total Time (T+R+W)'] === undefined) {
        o['Total Time (T+R+W)'] = Math.round(eodrNum(o['Total Talk Time']) * 1.55 * 10) / 10;
      }
      return o;
    });
  };
  return { today: scale(1 / 5), mtd: scale(W.mtd.days / 5), r7: scale(7 / 5), r30: scale(30 / 5) };
}

/* ── Cells ───────────────────────────────────────────────────────────────────
   The baseline is a COLOUR CUE on the cell (the user's choice over a baseline
   column), with the scaled target in the title attribute so the number behind
   the colour is one hover away rather than invisible. */
/* The status rule, extracted so the cell tint and the row-label spine cannot
   disagree: the spine reads TODAY's status and must use the same thresholds. */
function eodrStatus(row, v, win, headcount) {
  if (v === null || v === undefined) return '';
  if (row.per && !row.flat && !row.deadline) v = headcount ? v / headcount : null;
  if (v === null) return '';
  if (row.deadline) return v <= row.deadline ? 'hit' : (v <= row.deadline + 30 ? 'near' : 'miss');
  if (row.goodLow) return v <= 5 ? 'hit' : (v <= 15 ? 'near' : 'miss');
  if (row.base) {
    var t = row.flat ? row.base : row.base * win.days;
    var r = t > 0 ? v / t : 0;
    return r >= 1 ? 'hit' : (r >= 0.8 ? 'near' : 'miss');
  }
  return '';
}
/* What the Target column prints. The baseline used to be floated into the row
   label, which is what forced a 34%-wide label column. */
function eodrTgtTxt(row) {
  if (row.baseTxt) return row.baseTxt;
  if (row.goodLow) return '\u22645%';
  if (row.base) return row.flat ? String(row.base) : row.base + '/day';
  return '\u2014';
}
/* Why the MS score row is blank. THREE different causes and the fix differs for
   each, so the cell names the one that applies instead of a generic dash: the
   feed is unreachable (sharing / MS_SHEET_ID), the feed is fine but nobody in
   this window was scored, or the matrix simply has no cells for these days (the
   user's rule: a blank day shows blank, never the previous day's score). */
function eodrScoreWhy() {
  var m = (D && D.msScore) || {};
  if (m.error) return m.error;
  if (m.inSheet) return 'No MS score for the LRMs in view on this window \u2014 ' + m.inSheet
    + ' LRM(s) are scored in the sheet, but not these people or not these days';
  return 'The LRM_View matrix returned no scores for ' + ((m.diag && m.diag.window) || 'this window');
}
/* Coverage sentence for the MS score. Stated rather than implied: the matrix
   scores ~78 people against a floor of ~190, so an unqualified average would
   read as the whole floor's score. */
function eodrScoreFoot() {
  var m = (D && D.msScore) || {};
  if (m.error) return 'MS score is not loading: ' + m.error;
  if (!m.inSheet) return '';
  return 'MS score is the mean of each LRM\u2019s scored days in the window, read from the LRM_View '
    + 'matrix \u2014 blank days are skipped, not counted as 0, and never carried forward. '
    + (m.scored || 0) + ' of ' + (m.lrms || 0) + ' LRMs in the current feed carry a score ('
    + m.inSheet + ' scored in the sheet for this window).';
}
function eodrCell(row, agg, win, headcount, isNow) {
  var now = isNow ? ' is-now' : '';
  if (row.feed === 'attendance') {
    return '<td class="eodr-na' + now + '" title="Not in the dashboard feed">—</td>';
  }
  var v = row.get(agg);
  if (row.per && v !== null && !row.flat && !row.deadline) v = headcount ? v / headcount : null;
  if (v === null) {
    var why = row.feedIf === 'score' ? eodrScoreWhy()
            : row.feedIf === 'trw'   ? 'Needs the "Total Time (T+R+W)" column — paste the v15 query into Metabase'
            : row.id === 'checkin'   ? 'No day in this window with at least ' + EODR_CHECKIN_MIN_CALLS + ' dials, so there is no usable first-call time'
            : 'No data in this window';
    return '<td class="eodr-na' + now + '" title="' + esc(why) + '">—</td>';
  }
  var txt = (EODR_FMT[row.f] || EODR_FMT.int)(v);
  // `v` is already per-LRM here, so the status is computed with `per` dropped
  // rather than dividing by the headcount twice.
  var st = eodrStatus({ deadline: row.deadline, goodLow: row.goodLow, base: row.base, flat: row.flat }, v, win, 1);
  var cls = st ? 'eodr-' + st : '', title = '';
  if (row.deadline) {
    // A deadline inverts the scale: at or before the hour is a hit, and it is never
    // scaled by window length (10:00 is 10:00 whether the column is a day or a month).
    title = 'Target ' + EODR_FMT.clock(row.deadline) + ' or earlier · over the '
          + agg.firstMinN + ' day/LRM row(s) with at least ' + EODR_CHECKIN_MIN_CALLS + ' dials';
  } else if (row.base) {
    var target = row.flat ? row.base : row.base * win.days;
    var ratio = target > 0 ? v / target : 0;
    title = 'Baseline ' + (Math.round(target * 10) / 10).toLocaleString('en-IN')
          + (row.flat ? '' : ' (' + row.base + ' \u00d7 ' + win.days + 'd)')
          + ' \u00b7 at ' + Math.round(ratio * 100) + '%';
  } else if (row.goodLow) {
    title = 'Lower is better \u00b7 5% or less reads as healthy';
  }
  return '<td class="' + cls + now + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>'
       + (isNow ? '<b>' + txt + '</b>' : txt) + '</td>';
}

function eodrBlock(o) {
  var W = eodrWindows();
  var order = ['today', 'mtd', 'r7', 'r30'];
  var h = '<div class="fb-box eodr-box"><div class="fh-hd"><h4>EODR</h4>'
        + '<span class="eodr-mode">' + esc(o.mode) + '</span>'
        + (o.hdNote ? '<span class="eodr-hdnote">' + esc(o.hdNote) + '</span>' : '') + '</div>';
  if (o.sub) h += '<div class="fb-sub eodr-sub">' + o.sub + '</div>';
  // Fixed column widths live in the colgroup: 230px metric, 64 target, 80 per
  // window. The table is width:auto, so it hugs that instead of stretching
  // every cell across the screen.
  h += '<div class="eodr-tbl-wrap"><table class="eodr-tbl"><colgroup><col class="c-metric"><col class="c-target">'
     + order.map(function () { return '<col class="c-win">'; }).join('') + '</colgroup>'
     + '<thead><tr><th class="eodr-rowhd">' + esc(o.rowHead) + '</th><th>Target</th>'
     + order.map(function (k, i) {
         return '<th class="' + (i === 0 ? 'is-now' : '') + '" title="'
              + esc(W[k].from + ' \u2192 ' + W[k].to) + '">' + W[k].label
              + '<span>' + W[k].days + 'd</span></th>';
       }).join('') + '</tr></thead><tbody>';
  var tds = new Array(order.length + 2).join('<td></td>');
  var lastG = null;
  o.rows.forEach(function (row) {
    if (row.g && row.g !== lastG) {
      lastG = row.g;
      h += '<tr class="eodr-grp"><th>' + esc(row.g) + '</th>' + tds + '</tr>';
    }
    // The spine on the row label carries TODAY's status, so the left edge is
    // scannable without reading four columns.
    var aNow = o.aggs.today;
    var sNow = aNow ? eodrStatus(row, row.get(aNow), W.today, o.heads.today) : '';
    h += '<tr><th class="' + (sNow ? 's-' + sNow : '') + '">' + esc(row.label)
       + (row.note ? '<i>' + esc(row.note) + '</i>' : '') + '</th>'
       + '<td class="eodr-tgt">' + esc(eodrTgtTxt(row)) + '</td>';
    order.forEach(function (k, i) {
      var a = o.aggs[k];
      h += a ? eodrCell(row, a, W[k], o.heads[k], i === 0)
             : '<td class="eodr-na' + (i === 0 ? ' is-now' : '') + '">\u2014</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>'
     + '<div class="eodr-legend"><i class="lg-hit">At or above target</i>'
     + '<i class="lg-near">Within 20%</i><i class="lg-miss">Below</i>'
     + '<span>Count targets scale by window length; rates and times do not.</span></div>';
  if (o.foot) h += '<div class="fb-foot eodr-foot">' + o.foot + '</div>';
  return h + '</div>';
}

function renderEODR() {
  var panel = document.getElementById('eodrPanel');
  if (!panel || !D) return;

  eodrLoad().then(function (c) {
    var W = eodrWindows();
    var order = ['today', 'mtd', 'r7', 'r30'];
    var aggs = {}, heads = {};
    order.forEach(function (k) {
      var rows = c.windows[k];
      if (rows === null) { aggs[k] = null; heads[k] = 0; return; }
      aggs[k] = eodrAgg(rows.filter(eodrInScope));
      heads[k] = aggs[k].lrms;
    });

    // The scope's size decides whether the card is absolute or per-LRM, and which
    // rows exist at all. Taken from TODAY's headcount so the card does not change
    // shape column by column; a filter naming one LRM who has no row today would
    // otherwise flip to the team reading.
    var single = (typeof F !== 'undefined' && F && F.agents && F.agents.length === 1)
              || heads.today === 1;
    var rows = EODR_ROWS.filter(function (r) { return !(r.multiOnly && single); });

    var mockNote = (window.MOCK && !window.__forceApi)
      ? '<div class="eodr-warn">Preview harness \u2014 the four windows are scaled from the demo day, not read from the sheet.</div>' : '';
    var errNote = eodrError
      ? '<div class="eodr-warn">One or more windows failed to load: ' + esc(eodrError) + '</div>' : '';
    var emptyNote = (heads.today === 0 && aggs.today)
      ? '<div class="eodr-warn">No LRM in the feed matches the current filters for '
        + esc(W.today.to) + '. Widen the filter bar above, or check an earlier window.</div>' : '';

    var h = '<div class="eodr-stack">'
      + '<div class="eodr-head">'
      + '<div><b>EODR</b> \u2014 end-of-day review, anchored on ' + esc(W.today.to)
      + '. Scope follows the filter bar above. Cells are tinted against the per-day baseline '
      + '(hover for the target).</div>'
      + '<button id="eodrRefresh" class="eodr-btn">\u21bb Reload windows</button>'
      + '</div>' + mockNote + errNote + emptyNote

      + eodrBlock({
          mode: single ? 'Absolute' : 'Per LRM',
          rowHead: 'Metric',
          hdNote: eodrScopeLabel(),
          rows: rows, aggs: aggs, heads: heads,
          sub: single
            ? 'One LRM in scope, so every number is that person\u2019s own \u2014 nothing is divided.'
            : (heads.today || 0) + ' LRMs in the feed for this scope today \u00b7 counts are divided by the '
              + 'headcount of each window, so the columns stay comparable as people come and go.',
          foot: 'Check-in is the clock time of the first Ozonetel call \u2014 when work STARTED, which is the '
              + 'number this row is for. Arrival is not captured anywhere, and it is not the same thing: '
              + 'someone can reach the office at 09:30 and start dialling at 10:40. An LRM who never dialled '
              + 'has no row at all, and a day under ' + EODR_CHECKIN_MIN_CALLS + ' dials does not vote \u2014 so a '
              + 'stray evening dial cannot name the scope\u2019s slowest starter. '
              + (single ? '' : 'Shrinkage is the share of LRMs in the feed who did not dial at all in the window: '
                  + 'no dials all day means the day was not worked, the only observable form of absence here. '
                  + 'The denominator is LRMs in the feed, not the roster \u2014 an LRM the Ozontel tab never wrote '
                  + 'a row for is invisible to it. ')
              + 'Effective talk is the actual talk time already being captured; total talk adds ring and '
              + 'after-call work on top of it. MS \u2192 MD will not reconcile within one day \u2014 Meeting Done is '
              + 'dated by the DONE date. ' + eodrScoreFoot()
        })
      + '</div>';

    panel.innerHTML = h;
    var btn = panel.querySelector('#eodrRefresh');
    if (btn) btn.addEventListener('click', function () { eodrLoad(true).then(renderEODR); });
  });

  if (!panel.querySelector('.eodr-stack')) {
    panel.innerHTML = '<div class="loading"><div class="spinner"></div>Building the four windows\u2026</div>';
  }
}

Object.assign(window, {
  renderEODR: renderEODR, eodrWindows: eodrWindows, eodrAgg: eodrAgg,
  EODR_ROWS: EODR_ROWS, eodrInScope: eodrInScope
});
