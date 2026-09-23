/**
 * COVERAGE — Apps Script  (v1, 20 Sep 2026)
 *
 * Pulls sql/coverage-daily.sql and sql/coverage-leads.sql from Metabase into two
 * tabs, `coverage` and `coverage_leads`, on a schedule. Same shape as Code.gs:
 * resolved date params, buffered chunk writes, a cursor-and-resume backfill, a
 * live trigger that replaces a trailing window.
 *
 * ── SAFE TO PASTE ALONGSIDE Code.gs ────────────────────────────────────────
 * Every function and global here is prefixed COV_ / cov*, so nothing collides
 * if this lands in the same Apps Script project. It also REUSES the Script
 * Properties Code.gs already set (BASE_URL / USERNAME / PASSWORD / TOKEN) —
 * in the same project there is nothing to configure. In a NEW project, run
 * covSetupCredentials() once.
 *
 * ── FIVE THINGS THAT ARE DELIBERATE ────────────────────────────────────────
 *  1. TWO FEEDS, ONE CURSOR. Both cards are pulled for the same window in the
 *     same pass. If they ever drift apart the drill lists leads the card above
 *     it does not count, and nobody on screen can reconcile the totals.
 *  2. COHORTS ARE RETROSPECTIVE, so the live window is 10 DAYS, not 1. A lead
 *     created on Monday can be connected on Thursday; re-pulling only today
 *     would freeze Monday's row at its immature value forever. This is the one
 *     real difference from the Ozontel feed, where a day is final once past.
 *  3. THE WORKLIST IS CAPPED at 5,000 rows (COV_LEADS_MAX_ROWS) and pulled over
 *     a SHORTER window than the daily feed (COV_LEADS_WINDOW_DAYS = 7).
 *     Measured 1-18 Sep: 5,886 uncovered leads = ~327/day, so 7 days is ~2,300
 *     — inside the dashboard's 4,000-row drill cap. A month would be ~10,000
 *     and the sheet read becomes the bottleneck.
 *  4. CHUNK_DAYS = 7 with a BISECTING retry. A failed window splits in half
 *     rather than collapsing to day-by-day, so widening cannot lose data: worst
 *     case log2(n) extra requests, not n.
 *  5. The daily feed is written SORTED BY DATE DESC then cluster; the worklist
 *     keeps the SQL's own order (never-dialled first, then oldest), because
 *     that order IS the work queue and re-sorting it destroys the point.
 *
 * ── SETUP ──────────────────────────────────────────────────────────────────
 *  1. Save the two SQL files as Metabase questions; put their ids in
 *     COV_DAILY_QID / COV_LEADS_QID below. Both params `start_date` /
 *     `end_date` must be type Date and Required.
 *  2. covSetupCredentials()   — only in a NEW script project.
 *  3. covRunBackfill()        — first full load. Re-run until the log says
 *                               "complete"; it resumes itself if it runs long.
 *  4. covInstallTriggers()    — hourly live refresh from then on.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
var COV_DAILY_QID  = 3313;         // <- Metabase card id for coverage-daily.sql
var COV_LEADS_QID  = 3314;         // <- Metabase card id for coverage-leads.sql

var COV_DAILY_SHEET = 'coverage';
var COV_LEADS_SHEET = 'coverage_leads';
var COV_TZ          = 'Asia/Kolkata';

var COV_BACKFILL_FROM     = '2026-08-01';
var COV_CHUNK_DAYS        = 7;     // days per Metabase request; bisects on failure
var COV_LIVE_WINDOW_DAYS  = 10;    // see note 2 — cohorts keep changing after the day
var COV_LEADS_WINDOW_DAYS = 7;     // see note 3 — the worklist is a queue, not history
var COV_LEADS_MAX_ROWS    = 5000;
var COV_TIME_BUDGET_MS    = 4.5 * 60 * 1000;   // headroom under the 6-minute limit

/**
 * Column order written to each tab. Values are matched to the CSV BY NAME, so a
 * re-order in the SQL is harmless — but a RENAME silently blanks the column.
 * Keep these in step with the SELECT lists in the two SQL files.
 */
var COV_DAILY_HEADERS = [
  'Date', 'Agent Id', 'City', 'Cluster', 'Status',
  'Leads Created', 'Leads Assigned', 'Leads Dialled',
  'Leads Connected', 'Leads Really Connected',
  'Never Dialled', 'Dialled Not Connected',
  'Connected D+0', 'Connected D+1', 'Connected D+3',
  'Total Dials', 'Total Connects',
  'Median Days To Connect', 'Avg Dials To Connect',
  'Negative Interval Leads', 'Leads Geo From Pincode'
];

var COV_LEADS_HEADERS = [
  'Date', 'Agent Id', 'Lead Id', 'City', 'Cluster', 'Stage', 'Status', 'Lead Source',
  'Lead Created At', 'Assigned At', 'Dial Attempts',
  'First Dial At', 'Last Dial At', 'Age (days)', 'Flag', 'Allocation'
];

/** The two feeds as data, so every routine below loops instead of duplicating. */
function covFeeds_() {
  return [
    { key: 'daily', qid: COV_DAILY_QID, sheet: COV_DAILY_SHEET, headers: COV_DAILY_HEADERS,
      sortCol: 1, sortDesc: true,
      formats: [[6, 12, '0'], [13, 5, '0'], [18, 2, '0.0'], [20, 2, '0']] },
    { key: 'leads', qid: COV_LEADS_QID, sheet: COV_LEADS_SHEET, headers: COV_LEADS_HEADERS,
      sortCol: null,                     // keep the SQL's queue order — see note 5
      maxRows: COV_LEADS_MAX_ROWS,
      formats: [[11, 1, '0'], [14, 1, '0']] }
  ].filter(function (f) { return f.qid > 0; });
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full history load, chunked, resumable. Chunks are buffered in memory and each
 * tab is written ONCE per run — writing per chunk would re-read and re-sort a
 * growing sheet on every iteration, which is quadratic and usually costs more
 * wall-clock than the Metabase calls themselves.
 */
function covRunBackfill() {
  var props = PropertiesService.getScriptProperties();
  var feeds = covFeeds_();
  if (!feeds.length) { console.error('Set COV_DAILY_QID / COV_LEADS_QID first.'); return; }

  var cursor = props.getProperty('COV_BACKFILL_CURSOR');
  covFatal_ = false;
  if (!cursor) {
    feeds.forEach(function (f) { covEnsureSheet_(f).clear(); });
    cursor = COV_BACKFILL_FROM;
  }

  var today = Utilities.formatDate(new Date(), COV_TZ, 'yyyy-MM-dd');
  var started = Date.now();
  var buffers = {};
  feeds.forEach(function (f) { buffers[f.key] = []; });

  while (cursor <= today) {
    var chunkEnd = covAddDays_(cursor, COV_CHUNK_DAYS - 1);
    if (chunkEnd > today) chunkEnd = today;

    for (var i = 0; i < feeds.length; i++) {
      // The worklist is a live queue, not history: backfilling a month of it
      // writes tens of thousands of rows that are stale the next morning.
      if (feeds[i].key === 'leads' && chunkEnd < covAddDays_(today, -COV_LEADS_WINDOW_DAYS)) continue;
      covFetchWindow_(feeds[i], cursor, chunkEnd, buffers[feeds[i].key]);
    }

    cursor = covAddDays_(chunkEnd, 1);

    if (covFatal_) {
      console.error('Stopping: the failure above is configuration, not data. '
                  + 'Nothing was written; the cursor is unchanged so a re-run resumes here.');
      return;
    }

    if (Date.now() - started > COV_TIME_BUDGET_MS && cursor <= today) {
      feeds.forEach(function (f) { covWriteChunks_(buffers[f.key], f); });
      props.setProperty('COV_BACKFILL_CURSOR', cursor);
      covScheduleResume_();
      console.log('Time budget reached — resuming at ' + cursor + ' in ~1 min.');
      return;
    }
  }

  feeds.forEach(function (f) { covWriteChunks_(buffers[f.key], f); });
  props.deleteProperty('COV_BACKFILL_CURSOR');
  covClearResumeTriggers_();
  console.log('Coverage backfill complete through ' + today + '.');
}

/**
 * The scheduled refresh. Re-pulls a TRAILING WINDOW, not just today — a lead
 * created on Monday and connected on Thursday changes Monday's row, so a
 * today-only refresh would freeze every past cohort at its immature value.
 * covWriteChunks_ replaces whole date ranges, so re-pulling is idempotent.
 */
function covAutoUpdate() {
  var feeds = covFeeds_();
  if (!feeds.length) { console.error('Set COV_DAILY_QID / COV_LEADS_QID first.'); return; }

  var today = Utilities.formatDate(new Date(), COV_TZ, 'yyyy-MM-dd');
  covFatal_ = false;
  feeds.forEach(function (f) {
    var days = (f.key === 'leads' ? COV_LEADS_WINDOW_DAYS : COV_LIVE_WINDOW_DAYS);
    var start = covAddDays_(today, -(days - 1));
    var buf = [];
    covFetchWindow_(f, start, today, buf);
    covWriteChunks_(buf, f);
  });
  console.log('Coverage refreshed through ' + today + '.');
}

/** Wipe the cursor so the next covRunBackfill() starts clean. */
function covResetBackfill() {
  PropertiesService.getScriptProperties().deleteProperty('COV_BACKFILL_CURSOR');
  covClearResumeTriggers_();
  console.log('Coverage backfill cursor cleared.');
}

/** Hourly refresh. Safe to re-run — it clears its own triggers first. */
function covInstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'covAutoUpdate') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('covAutoUpdate').timeBased().everyHours(1).create();
  console.log('Hourly covAutoUpdate trigger installed.');
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch one window for one feed, BISECTING on failure. A 7-day chunk that times
 * out costs 2 halves then 4 quarters — log2(n) extra requests at worst, against
 * n if a wide chunk fell back to day-by-day. Every window it does manage is
 * appended to `out`, so a partial failure loses only the days that cannot be read.
 *
 * An EMPTY window is indistinguishable from a failed one over HTTP (both return
 * < 2 lines), so an empty week is bisected once. That is cheap, and the
 * alternative — trusting the empty response — writes a silent gap into the sheet.
 */
function covFetchWindow_(feed, start, end, out) {
  var got = covFetchCsv_(feed.qid, start, end);
  if (got && got.length >= 2) { out.push({ start: start, end: end, values: got }); return true; }
  // A CONFIGURATION failure is not a window failure. Bisecting one produces
  // ~2n identical errors and buries the real message (seen 20 Sep: 60 lines of
  // "No start_date/end_date on card 3313"). Stop the run instead.
  if (covFatal_) return false;
  if (start === end) return false;
  var mid = covAddDays_(start, Math.floor(covDaysSpan_(start, end) / 2));
  console.warn('Coverage "' + feed.sheet + '" ' + start + ' .. ' + end + ' empty or failed — splitting.');
  var a = covFetchWindow_(feed, start, covAddDays_(mid, -1), out);
  var b = covFetchWindow_(feed, mid, end, out);
  return a && b;
}

/**
 * Metabase CSV for one window, parsed. null on any failure.
 *
 * The date parameter ids are RESOLVED FROM THE CARD and cached, never hardcoded.
 * A hardcoded id belonging to a different card is silently IGNORED by Metabase —
 * it does not error, it drops every date filter and returns the card's whole
 * history at once. That failure mode reads as massive inflation, not as an error,
 * and it cost a long debugging session on the Ozontel feed.
 */
/** Set when a failure is structural (bad card, bad credentials) rather than a
    window that happens to be empty. Stops the bisect and the chunk loop. */
var covFatal_ = false;

function covFetchCsv_(qid, startDate, endDate) {
  if (covFatal_) return null;
  var props = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty('BASE_URL');
  if (!baseUrl) { console.error('BASE_URL not set. Run covSetupCredentials().'); covFatal_ = true; return null; }
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  var token = covToken_(baseUrl);
  var params = covResolveDateParams_(baseUrl, token, qid);
  if (!params) { covFatal_ = true; return null; }

  var body = { parameters: [
    { id: params.start.id, type: 'date/single',
      target: ['variable', ['template-tag', params.start.name]], value: startDate },
    { id: params.end.id, type: 'date/single',
      target: ['variable', ['template-tag', params.end.name]], value: endDate }
  ] };

  var url = baseUrl + 'api/card/' + qid + '/query/csv';
  var resp;
  try {
    resp = covPost_(url, token, body);
  } catch (e) {
    console.error('Coverage ' + startDate + ' .. ' + endDate + ' timed out; skipped. ' + e);
    return null;
  }
  if (resp.getResponseCode() === 401) {          // expired session — one retry
    props.deleteProperty('TOKEN');
    resp = covPost_(url, covToken_(baseUrl), body);
  }
  if (resp.getResponseCode() !== 200) {
    console.error('Metabase error ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 400));
    return null;
  }

  var values = Utilities.parseCsv(resp.getContentText());
  if (!values || values.length < 2) { console.log('No rows for ' + startDate + ' .. ' + endDate); return null; }
  console.log('Coverage card ' + qid + ': ' + (values.length - 1) + ' rows for ' + startDate + ' .. ' + endDate);
  return covStripThousands_(values);
}

/** UrlFetchApp THROWS on timeout rather than returning a code, so retry once. */
function covPost_(url, token, body) {
  var opts = {
    method: 'post', contentType: 'application/json',
    headers: { 'X-Metabase-Session': token },
    payload: JSON.stringify(body), muteHttpExceptions: true
  };
  try { return UrlFetchApp.fetch(url, opts); }
  catch (e) { Utilities.sleep(2000); return UrlFetchApp.fetch(url, opts); }
}

/**
 * Metabase's CSV export applies COLUMN FORMATTING, so a value over 999 arrives
 * as '1,146.4'. Everything downstream coerces with Number(x) || 0, and
 * Number('1,146.4') is NaN -> 0 — a silent zero, not an error. Coverage hits
 * this on Total Dials immediately. Strip at the import boundary, once.
 * The pattern is strict (digit groups of exactly 3) so real text containing a
 * comma is never touched.
 */
function covStripThousands_(values) {
  var re = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
  for (var i = 1; i < values.length; i++) {
    for (var j = 0; j < values[i].length; j++) {
      var v = values[i][j];
      if (typeof v === 'string' && re.test(v)) values[i][j] = v.replace(/,/g, '');
    }
  }
  return values;
}

/** Session token, cached in Script Properties and re-minted on 401. */
function covToken_(baseUrl) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (token) return token;
  var resp = UrlFetchApp.fetch(baseUrl + 'api/session', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ username: props.getProperty('USERNAME'),
                              password: props.getProperty('PASSWORD') }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Metabase login failed: ' + resp.getContentText().slice(0, 200));
  token = JSON.parse(resp.getContentText()).id;
  props.setProperty('TOKEN', token);
  return token;
}

/**
 * Find the card's two date parameters. THREE sources, tried in order, because
 * the API shape varies with how the question was saved — the single-source
 * version of this function failed outright on card 3313.
 *   1. native template-tags, at either of the two nesting depths Metabase uses
 *   2. the card's own `parameters` array (slug, or the target's tag name)
 *   3. PARAM_ID_START / PARAM_ID_END in Script Properties, a manual override
 * Cached per card. Run covClearParamCache() after fixing a card in Metabase.
 */
function covResolveDateParams_(baseUrl, token, qid) {
  var props = PropertiesService.getScriptProperties();
  var key = 'COV_PARAMS_' + qid;
  var hit = props.getProperty(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  var resp = UrlFetchApp.fetch(baseUrl + 'api/card/' + qid, {
    headers: { 'X-Metabase-Session': token }, muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    console.error('Could not read card ' + qid + ': ' + resp.getContentText().slice(0, 300));
    return null;
  }

  var card = JSON.parse(resp.getContentText()), out = {};
  var q = card.dataset_query || {};
  var native = q.native || (q.query && q.query.native) || {};
  var tags = native['template-tags'] || native['template_tags'] || {};

  Object.keys(tags).forEach(function (k) {
    var t = tags[k] || {}, nm = t.name || k;
    if (nm === 'start_date') out.start = { id: t.id, name: nm };
    if (nm === 'end_date')   out.end   = { id: t.id, name: nm };
  });

  if (!out.start || !out.end) {
    (card.parameters || []).forEach(function (p) {
      var nm = p.slug || '';
      if (!nm && p.target && p.target[1] && p.target[1][1]) nm = p.target[1][1];
      if (nm === 'start_date' && !out.start) out.start = { id: p.id, name: nm };
      if (nm === 'end_date'   && !out.end)   out.end   = { id: p.id, name: nm };
    });
  }

  if (!out.start || !out.end) {
    var ms = props.getProperty('PARAM_ID_START'), me = props.getProperty('PARAM_ID_END');
    if (ms && me) {
      out.start = { id: ms, name: 'start_date' };
      out.end   = { id: me, name: 'end_date' };
      console.log('Using PARAM_ID_START / PARAM_ID_END overrides.');
    }
  }

  if (!out.start || !out.end) {
    console.error('Card ' + qid + ' exposes no start_date/end_date variable.');
    console.error('  template-tags found: [' + Object.keys(tags).join(', ') + ']');
    console.error('  parameters found: [' + (card.parameters || []).map(function (p) { return p.slug || p.id; }).join(', ') + ']');
    console.error('  query type: ' + (q.type || '(unknown)') + ', has native SQL: ' + (native.query ? 'yes' : 'no'));
    console.error('FIX: open question ' + qid + ' in Metabase, confirm the SQL contains {{start_date}}');
    console.error('     and {{end_date}}, set BOTH to Variable type "Date" and tick Required, SAVE,');
    console.error('     then run covClearParamCache().');
    return null;
  }

  props.setProperty(key, JSON.stringify(out));
  return out;
}

/** Drop the cached param ids after fixing a card in Metabase. */
function covClearParamCache() {
  var props = PropertiesService.getScriptProperties();
  [COV_DAILY_QID, COV_LEADS_QID].forEach(function (q) {
    if (q) props.deleteProperty('COV_PARAMS_' + q);
  });
  console.log('Coverage param cache cleared.');
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write buffered chunks to a tab in ONE operation.
 *
 * Rows are keyed by DATE: every date present in the buffer has its existing rows
 * REPLACED, and dates outside the buffer are left alone. That is what makes a
 * re-pull idempotent — a cohort day can be refreshed ten times without
 * duplicating, which matters here far more than on a finalised daily feed.
 */
function covWriteChunks_(chunks, feed) {
  if (!chunks || !chunks.length) return;
  var sheet = covEnsureSheet_(feed);
  var headers = feed.headers;

  // Incoming rows, mapped BY HEADER NAME so a SQL column re-order is harmless.
  var incoming = [], touched = {};
  chunks.forEach(function (ch) {
    // 23 Sep 2026: a pulled window REPLACES every date in it, not only the dates
    // that came back with rows. On the worklist a date whose leads all got
    // connected returns zero rows — before, its old rows were kept, so a lead
    // that had since been dialled kept reading "Never dialled" (LMP138635).
    if (ch.start && ch.end) {
      for (var dd = ch.start; dd <= ch.end; dd = covAddDays_(dd, 1)) touched[dd] = true;
    }
    var idx = {};
    ch.values[0].forEach(function (h, i) { idx[String(h).trim()] = i; });
    for (var r = 1; r < ch.values.length; r++) {
      var src = ch.values[r], row = [];
      for (var c = 0; c < headers.length; c++) {
        var i = idx[headers[c]];
        row.push(i === undefined ? '' : covCoerce_(src[i]));
      }
      incoming.push(row);
      touched[String(row[0])] = true;
    }
  });
  if (!incoming.length) return;

  // Keep only the rows whose date the buffer did NOT cover.
  // 23 Sep 2026: kept dates are normalised to 'yyyy-MM-dd' STRINGS, read in the
  // SPREADSHEET's time zone. Before, a kept Date cell sorted as "Tue Sep 01 …"
  // against incoming "2026-09-20", scrambling the tab by weekday name.
  var kept = [];
  var last = sheet.getLastRow();
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || COV_TZ;
  if (last > 1) {
    var old = sheet.getRange(2, 1, last - 1, headers.length).getValues();
    for (var i = 0; i < old.length; i++) {
      var d = old[i][0];
      if (d === '' || d === null) continue;
      d = (d instanceof Date) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d).trim().slice(0, 10);
      old[i][0] = d;
      if (!touched[d]) kept.push(old[i]);
    }
  }
  var beforeRows = last > 1 ? last - 1 : 0;

  // The worklist is a live queue: rows older than its window are never re-pulled,
  // so they would freeze at whatever dial count they had on their last pull.
  if (feed.key === 'leads') {
    var cutoff = covAddDays_(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), -(COV_LEADS_WINDOW_DAYS - 1));
    kept = kept.filter(function (r) { return String(r[0]) >= cutoff; });
  }

  // Worklist: fresh pull FIRST, so the maxRows cap trims old rows, not today's queue.
  var all = feed.sortCol ? kept.concat(incoming) : incoming.concat(kept);
  if (feed.sortCol) {
    var sc = feed.sortCol - 1, desc = !!feed.sortDesc;
    all.sort(function (a, b) {
      var x = String(a[sc]), y = String(b[sc]);
      if (x !== y) return desc ? (x < y ? 1 : -1) : (x < y ? -1 : 1);
      return String(a[3]) < String(b[3]) ? -1 : 1;     // then cluster, for stability
    });
  }
  // The worklist is a queue: SQL already ordered it never-dialled first, then
  // oldest. Truncate the TAIL, never the head, or the cap drops the urgent work.
  if (feed.maxRows && all.length > feed.maxRows) all = all.slice(0, feed.maxRows);

  // Never let one write halve a tab (the worklist is capped, so it is exempt).
  if (!feed.maxRows && beforeRows >= 200 && all.length < beforeRows * 0.5) {
    console.error('BLOCKED write to "' + feed.sheet + '": would shrink ' + beforeRows + ' -> ' + all.length + ' rows. Tab left as-is.');
    return;
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
       .setFontWeight('bold').setBackground('#f3f3f3');
  if (all.length) sheet.getRange(2, 1, all.length, headers.length).setValues(all);
  sheet.setFrozenRows(1);

  (feed.formats || []).forEach(function (f) {
    if (!all.length) return;
    sheet.getRange(2, f[0], all.length, f[1]).setNumberFormat(f[2]);
  });
  console.log('Wrote ' + all.length + ' rows to "' + feed.sheet + '".');
}

/**
 * Numbers must land as NUMBERS. A numeric string sorts and charts as text, and
 * the dashboard's Number(x) || 0 would survive it while the Sheet's own totals
 * would not. Dates are left as strings on purpose — they are the replace key
 * above, and a Date object would compare unequal to the CSV's 'YYYY-MM-DD'.
 */
function covCoerce_(v) {
  if (v === null || v === undefined || v === '') return '';
  var s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function covEnsureSheet_(feed) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(feed.sheet);
  if (!sheet) sheet = ss.insertSheet(feed.sheet);
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────────────────────────────────────

function covAddDays_(iso, n) {
  var p = iso.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, COV_TZ, 'yyyy-MM-dd');
}

/** Whole days inclusive: ('2026-09-01','2026-09-03') -> 3. */
function covDaysSpan_(a, b) {
  var pa = a.split('-'), pb = b.split('-');
  return Math.round((Date.UTC(+pb[0], pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], pa[1] - 1, +pa[2])) / 86400000) + 1;
}

function covScheduleResume_() {
  covClearResumeTriggers_();
  ScriptApp.newTrigger('covRunBackfill').timeBased().after(60 * 1000).create();
}

function covClearResumeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'covRunBackfill') ScriptApp.deleteTrigger(t);
  });
}

/**
 * ONLY needed in a NEW script project — if this file sits beside Code.gs the
 * credentials are already there. Run it once, then DELETE the values from the
 * source: anyone with edit access to the script can read them.
 * Prefer Project Settings > Script Properties.
 */
function covSetupCredentials() {
  PropertiesService.getScriptProperties().setProperties({
    BASE_URL: 'https://your-metabase-host/',
    USERNAME: 'you@solarsquare.in',
    PASSWORD: 'REPLACE_ME'
  });
  console.log('Credentials stored. Now clear them from the source.');
}

/** Quick check that everything is wired before a first backfill. */
function covCheckSetup() {
  var p = PropertiesService.getScriptProperties();
  console.log({
    BASE_URL: p.getProperty('BASE_URL') || '(missing)',
    USERNAME: p.getProperty('USERNAME') || '(missing)',
    PASSWORD: p.getProperty('PASSWORD') ? '(set)' : '(missing)',
    dailyCard: COV_DAILY_QID || '(not set)',
    leadsCard: COV_LEADS_QID || '(not set)',
    cursor: p.getProperty('COV_BACKFILL_CURSOR') || '(none — next run starts fresh)'
  });
}
