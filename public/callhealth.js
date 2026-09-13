/* ════════════════════════════════════════════════════════════════════════════
   callhealth.js — the Call Health tab: the DID estate and inbound routing.

   WHY THIS IS ONE TAB AND NOT TWO
   -------------------------------
   Both halves answer the same question — "is the phone system costing us
   conversations?" — and both have the same owner, which is NOT the floor. The
   DID half is vendor management; the inbound half is a routing defect sitting
   with Ozonetel. Keeping them together makes the owner unmistakable and stops
   either being read as LRM performance.

   THE RULE THIS TAB EXISTS TO ENFORCE
   -----------------------------------
   It was first concluded that three-quarters of missed inbound was LRMs not
   being Ready. The agent login-event file disproved it outright: at the moment
   of a dropped business-hours call the mean was 61.4 agents Ready (median 63),
   and only 16 of 6,168 drops had zero Ready. 70.8% of failures were never
   offered to any agent at all. If this panel is read as a people problem it
   gets solved by hiring, which fixes nothing — so every card here carries its
   owner in words.

   Reads:
     D.didRows      one row per DID for the window   (did_rep tab)
     D.inboundRows  one row per Date × Path          (inbound_route tab)
     D.connHas      which feeds exist
   Floor-wide and UNFILTERED — neither feed has an agent dimension, so the
   filter bar cannot narrow them. The sub-line says so on every card rather
   than letting a filtered reader assume otherwise.
   ════════════════════════════════════════════════════════════════════════════ */

var didSort = { col: 'Index', dir: 1 };          // worst index first
var didCohort = 'all';

function chNoSource(what, why) {
  return '<div class="fb-box"><h4>' + esc(what) + '</h4>'
       + '<div class="fb-sub" style="padding:14px 0">' + esc(why) + '</div></div>';
}
function chPct(v, dp) {
  var n = Number(v);
  return isNaN(n) ? '<span style="color:#c0c4d6">&mdash;</span>' : n.toFixed(dp === undefined ? 1 : dp) + '%';
}

/* ── DID estate ──────────────────────────────────────────────────────────── */
function didBlocks(rows) {
  var g = {}, order = [];
  rows.forEach(function (r) {
    var k = String(r['Block'] || '—');
    if (!g[k]) { g[k] = { name: k, dids: 0, calls: 0, connects: 0, expected: 0, inbound: 0 }; order.push(k); }
    var b = g[k];
    b.dids++;
    b.calls    += Number(r['Calls']) || 0;
    b.connects += Number(r['Connects']) || 0;
    b.expected += Number(r['Expected Connects']) || 0;
    b.inbound  += Number(r['Inbound Calls']) || 0;
  });
  return order.map(function (k) {
    var b = g[k];
    b.connPct = b.calls ? b.connects / b.calls * 100 : 0;
    b.index   = b.expected ? b.connects / b.expected * 100 : null;
    return b;
  }).sort(function (a, b) { return (b.index || 0) - (a.index || 0); });
}

/* Cohort summary — the finding the 500-call ranking gate used to hide.
   Connectivity tracks CUMULATIVE EXPOSURE, not number identity: fresh numbers
   ran ~41%, aged-but-idle ~40%, aged-and-hammered ~26%. That is the difference
   between "retire the bad numbers and buy more" and "we have a volume ceiling
   and buying numbers buys weeks". The two readings lead to opposite spends, so
   the cohort split is the first thing on the card. */
function didCohorts(rows) {
  var g = {}, order = [];
  rows.forEach(function (r) {
    var k = String(r['Cohort'] || 'established');
    if (!g[k]) { g[k] = { name: k, dids: 0, calls: 0, connects: 0, expected: 0 }; order.push(k); }
    var b = g[k];
    b.dids++;
    b.calls    += Number(r['Calls']) || 0;
    b.connects += Number(r['Connects']) || 0;
    b.expected += Number(r['Expected Connects']) || 0;
  });
  var want = ['new (entered mid-window)', 'low volume', 'established', 'withdrawn'];
  return order.sort(function (a, b) { return want.indexOf(a) - want.indexOf(b); }).map(function (k) {
    var b = g[k];
    b.connPct  = b.calls ? b.connects / b.calls * 100 : 0;
    b.index    = b.expected ? b.connects / b.expected * 100 : null;
    b.perDay   = b.dids ? b.calls / b.dids : 0;
    return b;
  });
}

function didCohortCard(rows) {
  var co = didCohorts(rows);
  if (co.length < 2) return '';
  var mx = Math.max.apply(null, co.map(function (b) { return b.connPct; })) || 1;
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>Fresh numbers versus worked numbers</h4>'
    + '<span class="fh-note">the provisioning decision turns on this</span></div>'
    + '<div class="fb-sub" style="margin:-4px 0 10px">Connectivity by how hard the number has been used, '
    + 'not by which number it is.</div>'
    + '<div class="fb-bars">'
    + co.map(function (b) {
        return '<div class="fb-bar"><span>' + esc(b.name) + ' <u style="text-decoration:none;color:var(--muted)">('
          + b.dids + ')</u></span>'
          + '<div class="fb-trk"><i style="width:' + (b.connPct / mx * 100).toFixed(1) + '%;background:'
          + (b.connPct >= 35 ? '#1f6b45' : (b.connPct < 28 ? '#b0382c' : '#8a6d1f')) + '"></i></div>'
          + '<b>' + b.connPct.toFixed(1) + '%</b></div>';
      }).join('')
    + '</div>'
    + '<div class="fb-hrnote"><b>This is the open question that decides whether buying more numbers helps.</b> '
    + 'Ten numbers that entered service on 11 September ran about 41% connectivity after two days at ~230 dials a '
    + 'day each, against 24&ndash;32% across the aged estate &mdash; and five long-lived numbers carrying only ~6 '
    + 'dials a day ran 33&ndash;46%. Fresh ~41%, aged-but-idle ~40%, aged-and-hammered ~26%: that points at a '
    + '<b>volume ceiling</b>, in which case more DIDs buy a few weeks rather than a fix. It is a cross-section, '
    + 'not a curve &mdash; two days is not a burn-in, and new numbers may be getting a different lead mix, which is '
    + 'why the Index column (depth-adjusted) is the figure to compare, not the raw rate. '
    + '<b>Run sql/did-decay-v1.sql before any provisioning decision.</b></div>'
    + '</div>';
}

function didBlockCard(rows) {
  var bl = didBlocks(rows);
  if (bl.length < 2) return '';
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>By number block</h4><span class="fh-note">' + bl.length + ' blocks</span></div>'
    + '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th>Block</th><th>DIDs</th><th>Dials</th><th class="sep">Connects</th><th>Conn %</th>'
    + '<th>Index</th><th class="sep">Return calls</th></tr></thead><tbody>'
    + bl.map(function (b) {
        return '<tr><td class="nm">' + esc(b.name) + '</td><td>' + b.dids + '</td><td>' + fmt(b.calls) + '</td>'
          + '<td class="sep">' + fmt(b.connects) + '</td>'
          + '<td' + (b.connPct >= 30 ? ' class="ok"' : (b.connPct < 27 ? ' class="bad"' : '')) + '>' + b.connPct.toFixed(1) + '%</td>'
          + '<td' + (b.index >= 105 ? ' class="ok"' : (b.index < 95 ? ' class="bad"' : '')) + '>' + (b.index === null ? '—' : Math.round(b.index)) + '</td>'
          + '<td class="sep">' + fmt(b.inbound) + '</td></tr>';
      }).join('')
    + '</tbody></table></div>'
    + '<div class="fb-hrnote">Block differences inside the aged estate are real and survive every obvious '
    + 'confound: 194 agents used both a strong and a weak block, the mean <i>within-agent</i> difference was '
    + '+4.81pp, 169 of the 194 show it, and the gap holds at every attempt depth and every hour of the day. '
    + 'Bringing the weak estate to the strong block&rsquo;s level is worth roughly 500&ndash;900 extra conversations '
    + 'a day &mdash; two to four times the agent-coaching prize. <b>But if the decay reading above is right, part of '
    + 'that gap is age, and moving volume onto the strong block would simply age it faster.</b> Both findings are '
    + 'live; neither has been separated from the other yet.</div>'
    + '</div>';
}

function didTable(rows) {
  var hasIdxW = rows.some(function (r) {
    return r['Index vs Last Week'] !== undefined && r['Index vs Last Week'] !== null && r['Index vs Last Week'] !== '';
  });
  var view = rows.filter(function (r) {
    if (didCohort === 'all') return true;
    if (didCohort === 'retire') return String(r['Verdict'] || '') === 'retire';
    return String(r['Cohort'] || '') === didCohort;
  });
  view.sort(function (a, b) {
    var k = didSort.col, av = a[k], bv = b[k];
    if (av === '' || av === undefined || av === null) return 1;
    if (bv === '' || bv === undefined || bv === null) return -1;
    if (typeof av === 'string') return String(av).localeCompare(String(bv)) * didSort.dir;
    return ((Number(av) || 0) - (Number(bv) || 0)) * didSort.dir;
  });
  var th = function (k, label, cls) {
    return '<th' + (cls ? ' class="' + cls + '"' : '') + ' data-did="' + k + '" style="cursor:pointer">' + label + '</th>';
  };
  var verdictCell = function (v, conf) {
    var cls = v === 'retire' ? 'bad' : (v === 'strong' ? 'ok' : '');
    var txt = v || '—';
    if (conf === 'too few calls') cls = '';
    return '<td class="' + cls + '" style="text-align:left">' + esc(txt) + '</td>';
  };
  return '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + th('DID', 'DID') + '<th style="text-align:left">Cohort</th>'
    + th('Calls', 'Dials', 'sep') + th('Calls per Day', 'Per day') + th('Active Days', 'Days')
    + th('Connects', 'Connects', 'sep') + th('Connect %', 'Conn %')
    + th('Index', 'Index') + th('Shortfall', 'Shortfall')
    + th('Inbound per 1000 Out', 'Return / 1k', 'sep')
    + (hasIdxW ? th('Index vs Last Week', 'Index vs last wk') : '')
    + '<th style="text-align:left">Verdict</th>'
    + '</tr></thead><tbody>'
    + view.map(function (r) {
        var conf = String(r['Confidence'] || '');
        var idx = Number(r['Index']);
        var sf = Number(r['Shortfall']);
        var thin = conf === 'too few calls';
        var iw = r['Index vs Last Week'];
        return '<tr><td class="nm">' + esc(r['DID']) + '</td>'
          + '<td style="text-align:left;color:var(--muted);font-size:11px">' + esc(r['Cohort'] || '') + '</td>'
          + '<td class="sep">' + fmt(r['Calls']) + '</td>'
          + '<td>' + fmt(r['Calls per Day']) + '</td>'
          + '<td>' + fmt(r['Active Days']) + '</td>'
          + '<td class="sep">' + fmt(r['Connects']) + '</td>'
          + '<td>' + chPct(r['Connect %']) + '</td>'
          + '<td' + (thin ? ' style="color:var(--muted)"' : (idx >= 110 ? ' class="ok"' : (idx < 90 ? ' class="bad"' : ''))) + '>'
            + (isNaN(idx) ? '—' : idx.toFixed(1)) + '</td>'
          + '<td' + (sf > 0 ? ' class="ok"' : (sf < 0 ? ' class="bad"' : '')) + '>'
            + (isNaN(sf) ? '—' : (sf > 0 ? '+' : '') + fmt(sf)) + '</td>'
          + '<td class="sep">' + (Number(r['Inbound per 1000 Out']) || 0).toFixed(1) + '</td>'
          + (hasIdxW ? '<td' + (Number(iw) <= -10 ? ' class="bad"' : (Number(iw) >= 10 ? ' class="ok"' : ''))
              + '>' + (iw === null || iw === undefined || iw === '' || isNaN(Number(iw))
                ? '<span style="color:#c0c4d6">&mdash;</span>'
                : (Number(iw) > 0 ? '+' : '') + Number(iw).toFixed(1)) + '</td>' : '')
          + verdictCell(String(r['Verdict'] || ''), conf)
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}

/* ── Inbound routing ─────────────────────────────────────────────────────── */
function inbTotals(rows) {
  var t = { calls: 0, answered: 0, missed: 0, platform: 0, never: 0, under5: 0, talk: 0, noAgent: 0, storm: 0 };
  rows.forEach(function (r) {
    t.calls    += Number(r['Calls']) || 0;
    t.answered += Number(r['Answered']) || 0;
    t.missed   += Number(r['Missed']) || 0;
    t.platform += Number(r['Platform Dropped']) || 0;
    t.never    += Number(r['Never Offered']) || 0;
    t.under5   += (Number(r['Ended <1s']) || 0) + (Number(r['Ended 1-4s']) || 0);
    t.talk     += Number(r['Talk Min']) || 0;
    t.noAgent  += Number(r['Reached No Agent']) || 0;
    t.storm     = Math.max(t.storm, Number(r['Worst Retry Storm']) || 0);
  });
  return t;
}

function inbPathCard(rows) {
  var g = {}, order = [];
  rows.forEach(function (r) {
    var k = String(r['Path'] || '—');
    if (!g[k]) { g[k] = { name: k, calls: 0, answered: 0, missed: 0, platform: 0, never: 0, talk: 0, lrms: 0 }; order.push(k); }
    var b = g[k];
    b.calls    += Number(r['Calls']) || 0;
    b.answered += Number(r['Answered']) || 0;
    b.missed   += Number(r['Missed']) || 0;
    b.platform += Number(r['Platform Dropped']) || 0;
    b.never    += Number(r['Never Offered']) || 0;
    b.talk     += Number(r['Talk Min']) || 0;
    b.lrms      = Math.max(b.lrms, Number(r['LRMs Reached']) || 0);
  });
  var paths = order.map(function (k) {
    var b = g[k];
    b.ansPct   = b.calls ? b.answered / b.calls * 100 : 0;
    b.neverPct = b.missed ? b.never / b.missed * 100 : 0;
    return b;
  }).sort(function (a, b) { return b.calls - a.calls; });
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>Where inbound calls go</h4>'
    + '<span class="fh-note">' + esc(D.dateLabel || '') + ' &middot; floor-wide, unfiltered</span></div>'
    + '<div class="fb-sub" style="margin:-4px 0 10px"><b>General_Sticky</b> routes a caller to the LRM their lead '
    + 'is registered to. Anything that leg does not pick up overflows to <b>LRM_Agents_Busy_26</b>, which holds '
    + 'only three LRMs &mdash; and that path carries close to half of all inbound.</div>'
    + '<div class="tbl-wrap"><table class="dist"><thead><tr>'
    + '<th>Path</th><th>Calls</th><th class="sep">Answered</th><th>Answer %</th>'
    + '<th class="sep">Platform dropped</th><th>Never offered</th><th>% of misses</th>'
    + '<th class="sep">Talk min</th><th>LRMs reached</th></tr></thead><tbody>'
    + paths.map(function (b) {
        return '<tr><td class="nm">' + esc(b.name) + '</td><td>' + fmt(b.calls) + '</td>'
          + '<td class="sep">' + fmt(b.answered) + '</td>'
          + '<td' + (b.ansPct >= 50 ? ' class="ok"' : (b.ansPct < 30 ? ' class="bad"' : '')) + '>' + b.ansPct.toFixed(1) + '%</td>'
          + '<td class="sep">' + fmt(b.platform) + '</td>'
          + '<td>' + fmt(b.never) + '</td>'
          + '<td' + (b.neverPct >= 50 ? ' class="bad"' : '') + '>' + b.neverPct.toFixed(0) + '%</td>'
          + '<td class="sep">' + fmt(Math.round(b.talk)) + '</td>'
          + '<td>' + (b.lrms || '—') + '</td></tr>';
      }).join('')
    + '</tbody></table></div>'
    + '<div class="fb-hrnote"><b>Owner: the vendor, not the floor.</b> The platform ends most failed inbound '
    + 'itself, at a median duration of zero seconds; 94.3% end inside five seconds and over half inside one, and '
    + 'Queue Time is populated on 80 rows out of 218,724 &mdash; there is no queue wait to record. Agents were '
    + 'available throughout: at the moment of a dropped business-hours call the mean was <b>61.4 agents Ready</b> '
    + '(median 63), and only 16 of 6,168 drops had zero Ready. Ports are not the constraint either &mdash; peak '
    + 'concurrent ports never exceeded 74 in eleven days, and at 30 ports the platform was still killing 27 '
    + 'inbound calls an hour. <b>It was first concluded that three-quarters of this was LRMs not being Ready; the '
    + 'login-event file disproved it. Read this as a people problem and it gets solved by hiring, which fixes '
    + 'nothing.</b></div>'
    + '<div class="fb-hrnote" style="font-style:normal;color:var(--text)"><b>AOH is a blind spot:</b> the CSV shows '
    + '585 inbound calls on that skill for 1&ndash;10 Sep; the webhook returns 3. Everything else reconciles. Treat '
    + 'the AOH row as missing, not as small, until Ozonetel confirms whether AOH fires a webhook at all.</div>'
    + '</div>';
}

function inbFixList() {
  var fixes = [
    ['Raise the configuration question with Ozonetel', 'Nothing else matters until calls are offered to Ready '
      + 'agents. Ask with three numbers &mdash; 7,008 failures, 70.8% never offered to any agent, 2.3% attributable '
      + 'to network faults &mdash; and request the skill configuration exports for both skills, the agent-to-skill '
      + 'subscription lists as active, the concurrent-channel licence limit with any throttle events, and a '
      + 'root-cause statement for the zero-second SystemHangup with a date.', 'vendor'],
    ['Widen the overflow group', 'Three people is not a net. Overflow arrives at ~50 calls an hour; three agents '
      + 'at a 39s median talk plus wrap could handle ~156, so the group runs at about 32% occupancy &mdash; and at '
      + 'the moment of each dropped overflow call a median of 3 of them were Ready. Ten rotating LRMs costs almost '
      + 'nothing and survives one person&rsquo;s leave.', 'config'],
    ['Kill the delayed auto-callback batch', 'Under one minute connects at 40.7%; two to twenty-four hours at '
      + '2.4% &mdash; and 63% of campaign volume sits in the 2&ndash;24 hour bucket. Note the 40.7% needs re-reading: '
      + 'Autocallback_Inbound runs agent-dial-first, so an &ldquo;answered&rdquo; row records the agent leg '
      + 'connecting, not the customer being reached. The comparison survives; the absolute number must not be '
      + 'quoted as a contact rate.', 'config'],
    ['Take the daily outbound limit per number', 'Ozonetel has already offered it. It is the queue-level '
      + 'over-dialling cap, worth about 13.7% of manual dial volume, and it is free. Still not taken.', 'free'],
    ['Fix the 14:00 and 19:00 holes', 'Answer rates of 28.7% and 26.7%. A lunch-cover rota problem, not a '
      + 'technology one. 786 calls in the 19:00&ndash;21:00 window currently get nothing, and 840 drops fall '
      + 'between 20:00 and 08:00 with essentially no staffing.', 'floor'],
    ['Attack the 44% sticky miss rate', 'The upstream valve: every point gained removes ~50 overflow calls a day. '
      + 'This half <i>is</i> floor behaviour &mdash; and it is about 17% of the problem, not 100%.', 'floor']
  ];
  var tag = { vendor: ['#b0382c', 'VENDOR'], config: ['#8a6d1f', 'CONFIG'], free: ['#1f6b45', 'FREE'], floor: ['#3d5a99', 'FLOOR'] };
  return '<div class="fb-box">'
    + '<div class="fh-hd"><h4>What to do about it, in order</h4>'
    + '<span class="fh-note">owner tagged on every item</span></div>'
    + '<div style="display:flex;flex-direction:column;gap:9px;margin-top:6px">'
    + fixes.map(function (f, i) {
        var t = tag[f[2]];
        return '<div style="display:grid;grid-template-columns:26px 1fr;gap:10px;padding:9px 0;border-top:1px solid ' + CONN_RULE + '">'
          + '<div style="font-size:17px;font-weight:800;color:#c3cbdd;font-variant-numeric:tabular-nums">' + (i + 1) + '</div>'
          + '<div><div style="font-size:12.5px;font-weight:700;color:var(--text)">' + esc(f[0])
          + ' <span style="font-size:9px;font-weight:800;letter-spacing:.5px;color:' + t[0]
          + ';border:1px solid ' + t[0] + ';border-radius:3px;padding:1px 4px;margin-left:4px;vertical-align:1px">' + t[1] + '</span></div>'
          + '<div class="fb-sub" style="margin-top:3px">' + f[1] + '</div></div></div>';
      }).join('')
    + '</div>'
    + '<div class="fb-hrnote">And the one that reframes all of it: <b>91.8% of the numbers that abandoned are '
    + 'already in the manual dialling list.</b> These are leads being chased with ~27,000 dials a day while six in '
    + 'ten of their own inbound calls go unanswered.</div>'
    + '</div>';
}

function renderCallHealth() {
  var panel = document.getElementById('healthPanel');
  if (!panel || !D) return;
  var hasDid = D.connHas && D.connHas.did && D.didRows && D.didRows.length;
  var hasInb = D.connHas && D.connHas.inbound && D.inboundRows && D.inboundRows.length;
  if (activeTab === 'health') {
    setCount((hasDid ? D.didRows.length + ' DIDs' : 'no DID feed')
      + (hasInb ? ' · inbound live' : ''));
  }
  if (!hasDid && !hasInb) {
    panel.innerHTML = connStack(chNoSource('Call health',
      (D.connHas && D.connHas.error)
        ? D.connHas.error
        : 'No DID or inbound feed in the sheet yet. This view appears once those tabs are landing — '
          + 'deliberately blank rather than showing zeroes.'));
    return;
  }

  var html = '';

  if (hasInb) {
    var t = inbTotals(D.inboundRows);
    html += connStripCells([
      ['Inbound calls', fmt(t.calls), 'demand arriving, not dials'],
      ['Answered', fmt(t.answered) + ' <u>' + (t.calls ? (t.answered / t.calls * 100).toFixed(0) : '0') + '%</u>', 'of calls that arrived'],
      ['Platform dropped', fmt(t.platform), 'ended by the system, not the caller'],
      ['Never offered', fmt(t.never) + ' <u>' + (t.missed ? (t.never / t.missed * 100).toFixed(0) : '0') + '%</u>', 'of misses, no agent ever rang'],
      ['Reached no agent', fmt(t.noAgent), 'cannot enter any LRM&rsquo;s denominator'],
      ['Talk time', fmt(Math.round(t.talk)) + ' <u>min</u>', 'end leg lands since 4 Sep']
    ]);
    html += inbPathCard(D.inboundRows) + inbFixList();
  } else {
    html += chNoSource('Inbound routing', 'No inbound routing feed in the sheet. The live tabs cover outbound '
      + 'calling and the DID estate only, so the routing findings are not shown rather than shown stale.');
  }

  if (hasDid) {
    /* The cohort filter is built from what the feed actually carries. The live
       tab has no in-service date, so there are no cohorts — and a fixed button
       row would then filter every number away. "Retire list" is always offered:
       it reads the Verdict column, which is derived from the index. */
    var seen = {}, cohorts = ['all'];
    D.didRows.forEach(function (r) {
      var c = String(r['Cohort'] || '').trim();
      if (c && !seen[c]) { seen[c] = true; cohorts.push(c); }
    });
    cohorts.push('retire');
    var labels = { all: 'All', 'new (entered mid-window)': 'New', established: 'Established', 'low volume': 'Low volume', retire: 'Retire list' };
    html += didCohortCard(D.didRows)
      + didBlockCard(D.didRows)
      + '<div class="fb-box">'
      +   '<div class="fh-hd"><h4>Every number</h4>'
      +     '<span class="fh-note">' + D.didRows.length + ' DIDs &middot; ' + esc(D.dateLabel || '') + '</span></div>'
      +   '<div class="fb-sub" style="margin:-4px 0 10px">Index = connects &divide; expected connects &times; 100, '
      +     'depth-adjusted so a number handed fresher leads cannot look healthy on that alone. '
      +     '<b>Under 90 is the retirement threshold; ~500 dials are needed before the figure is rankable.</b></div>'
      +   '<div class="dist-lvl">' + cohorts.map(function (c) {
            return '<button data-didco="' + esc(c) + '" class="' + (didCohort === c ? 'on' : '') + '">' + esc(labels[c] || c) + '</button>';
          }).join('') + '</div>'
      +   didTable(D.didRows)
      +   '<div class="fb-hrnote"><b>Two things this index cannot do, and both must travel with it.</b> '
      +     'It is <i>estate-relative</i>: if every number degrades together it still reads ~100 and sees nothing, '
      +     'so read Conn % beside it. And it is <b>not a spam detector</b> &mdash; Google&rsquo;s dialler painted '
      +     'calls red (&ldquo;Suspected junk caller&rdquo;) while Truecaller returned &ldquo;VERIFIED '
      +     'BUSINESS&rdquo; for the same number in the same instant, and the flagged DID indexes 103.1, top '
      +     'quartile. Google has identified the caller by name and flagged it anyway, so this is not spoofing: '
      +     'its classifier has seen ~320 dials per number per day, 18% of pick-ups killed inside 15 seconds, and '
      +     'numbers dialled 124 times with zero answers. <b>The labelling audit &mdash; one Android handset, dial '
      +     'from each DID, record whether the red screen appears &mdash; is two hours and still not started.</b></div>'
      +   '<div class="fb-hrnote" style="font-style:normal;color:var(--text)"><b>The 4 September removal was '
      +     'untargeted.</b> Sixteen numbers were withdrawn; over 1&ndash;3 Sep the removed averaged index 95.4 and '
      +     'the retained averaged 95.4 &mdash; identical. 919240270684 indexed 121.6, the second-best number in '
      +     'the estate, and was cut; reinstating it is free and still not done. Load then rose from 214&ndash;293 '
      +     'to 344&ndash;398 dials per number per day and nothing broke &mdash; the retained estate&rsquo;s index '
      +     'went <i>up</i>, 90&ndash;98 to 97&ndash;106. That is why the imported 175/day ceiling was withdrawn, '
      +     'the working default is 300, and rest days should be zero until rest is proven to restore anything.</div>'
      +   '<div class="fb-hrnote" style="font-style:normal;color:#b0382c"><b>Outranking all of the above:</b> these '
      +     'are ordinary 10-digit landline numbers. Under the TCCCPR Second Amendment of 12 February 2025 '
      +     'promotional calls must originate from the 140 series and 10-digit numbers cannot be used for '
      +     'telemarketing &mdash; penalties from &#8377;2 lakh, escalating to &#8377;10 lakh per instance, plus '
      +     'possible blacklisting of telecom resources. A rotation scheme designed to stay ahead of spam '
      +     'labelling is functionally the pattern the traceability provisions were written to catch. '
      +     '<b>Get the 140-series question answered by legal before provisioning more numbers.</b></div>'
      + '</div>';
  }

  panel.innerHTML = connStack(html);

  panel.querySelectorAll('.dist-lvl button[data-didco]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      didCohort = btn.getAttribute('data-didco');
      renderCallHealth();
    });
  });
  panel.querySelectorAll('table.dist th[data-did]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-did');
      didSort.dir = (didSort.col === k) ? didSort.dir * -1 : (k === 'Index' || k === 'Shortfall' ? 1 : -1);
      didSort.col = k;
      renderCallHealth();
    });
  });
}

Object.assign(window, { renderCallHealth: renderCallHealth });
