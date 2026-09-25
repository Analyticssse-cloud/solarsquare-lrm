/* ═════════════════════════════════════════════════════════════════
   Lead-level calling depth — appended under the Calling depth tab.

   Source: the "call depth" sheet (1m7A3ajj… gid 188258233), one row per
   LEAD x DAY: lead_id, Call_log LRM Email, Cluster, count of call dial,
   count of connected, meeting schedule count, meeting done count,
   Call / Schedule Date, Light House Link, payload_LeadStage,
   payload_LeadStatus, marketing_lead_source, TL, ZSM, ADOS.

   The index above answers "is this caller connecting as often as the
   attempt mix allows". This answers the other half: "how many times are
   we dialling one lead, and does the extra depth ever buy a meeting".

   PREVIEW ONLY for now: D.leadDepth is filled from LD_MOCK when the page
   runs in MOCK mode. Wiring to the live sheet is a dashboard.js read.
   ═════════════════════════════════════════════════════════════════ */

var LD_BANDS = [
  { k: 'b1', lab: '1–2 dials', lo: 1, hi: 2 },
  { k: 'b2', lab: '3–5 dials', lo: 3, hi: 5 },
  { k: 'b3', lab: '6–9 dials', lo: 6, hi: 9 },
  { k: 'b4', lab: '10+ dials', lo: 10, hi: 1e9 }
];
var LD_OVER = 6; // "over-dialled" = this many dials or more in the day
var LD_GRAINS = [
  { k: 'lrm', lab: 'LRM', f: 'lrm' }, { k: 'tl', lab: 'TL', f: 'tl' },
  { k: 'zsm', lab: 'ZSM', f: 'zsm' }, { k: 'ados', lab: 'ADOS', f: 'ados' },
  { k: 'cluster', lab: 'Cluster', f: 'cluster' }
];
var ldGrain = 'lrm', ldSort = { col: 'overZero', dir: -1 }, ldListMode = 'all';
try { ldGrain = localStorage.getItem('lrmLeadDepthGrain') || 'lrm'; } catch (e) {}

function ldName(e) {
  e = String(e || '').split('@')[0];
  if (!e || /^lrm-/i.test(e)) return e || '—';
  return e.split(/[._]/).filter(Boolean).map(function (p) {
    p = p.replace(/\d+$/, ''); return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
  }).filter(Boolean).join(' ');
}
function ldEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function ldFmt(n) { return (typeof fmt === 'function') ? fmt(n) : String(n); }
function ldPct(a, b) { return b ? Math.round(1000 * a / b) / 10 : 0; }

/* ── Mock: real rows from the 24 Sep sheet (the sheet is sorted by dials, so
   the real extract is the deep end); the 1–4 dial tail is synthesised so the
   band table has a shallow end to compare against. ── */
var LD_MOCK_REAL = [
  ['LTN31097','nithya.kumari','Chennai',21,3,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','reshma.rh','shrishail.h','naresh.c','6ab4b0470cfe6585b023ef16'],
  ['LUP201608','subash.singh','Lucknow',15,4,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','ritesh.konde','prabhat.samal','noor.alam','6ab4b63678601a0259e74f83'],
  ['LTN31144','nithya.kumari','Chennai',13,1,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','reshma.rh','shrishail.h','naresh.c','6ab4ec5e78601ad67de759d0'],
  ['LUP201386','shreya.jain','Lucknow',12,2,1,1,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','muskan.yadav','prabhat.samal','noor.alam','6ab3e68033ff73000d81dbc2'],
  ['LMP142649','shubhangi.kesharwani','Indore',11,1,0,0,'Call Later','Open','Digital Marketing','ishika.s','parag.bhattad','anurag.mishra','6ab495d3952b601ae460e050'],
  ['LMH120539','ansh.sahi','Pune',11,0,0,0,'Lead - Not Interested','Closed - Lost','Digital Marketing','manish.c','amit.jaiswar','naresh.c','696ed572264f2847f4d5c62f'],
  ['LUP198148','shubham.singh','Lucknow',10,7,0,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','muskan.yadav','prabhat.samal','noor.alam','6aacc1d0264916e6ce230f02'],
  ['LUP201682','saloni.singh','Lucknow',10,4,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','muskan.yadav','prabhat.samal','noor.alam','6ab4d70a840a14b14fbb3104'],
  ['RMH59733','swami.dehankar','Nagpur',10,0,0,0,'Call Not Connected','Open','Solarpro','kshitij.jain','lav.pandey','prithviraj.p','6aaa5920f0c360ee843c8029'],
  ['LMP142425','onik.s','Jabalpur',10,0,0,0,'Call Later','Open','Digital Marketing','simran.p','parag.bhattad','anurag.mishra','6ab366cd9339745fe63e7cd5'],
  ['LNU3627','astha.rath','Raipur',9,2,0,0,'Call Not Connected','Open','Digital Marketing','simran.p','parag.bhattad','anurag.mishra','6ab4b2d90cfe6559f023ef92'],
  ['LMP142768','shubhangi.kesharwani','Indore',9,1,1,0,'Meeting Postponed','Connected','MNRE','ishika.s','parag.bhattad','anurag.mishra','6ab4ad8a0cfe65d9f523ee68'],
  ['LTN30941','nithya.kumari','Chennai',9,1,1,0,'Meeting Confirmed - Customer Home','Connected','N/A','reshma.rh','shrishail.h','naresh.c','6ab37db693397473363e8245'],
  ['LTN31090','nithya.kumari','Chennai',9,0,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','reshma.rh','shrishail.h','naresh.c','6ab4aa0d952b60444660e2b3'],
  ['LTN31060','nithya.kumari','Chennai',9,2,0,0,'Lead - Not Qualified','Closed - Lost','Digital Marketing','reshma.rh','shrishail.h','naresh.c','6ab435a56649fc0d3ec362c9'],
  ['RUP18288','arati.boggawar','Kanpur',9,0,0,0,'','','Solarpro','yash2.kakde','monesh.chavan','harpreet.bhamara','6ab3d37fce421a765f5e5696'],
  ['LMH253780','ansh.sahi','Pune',9,0,0,0,'Meeting Confirmed - Customer Home','Connected','N/A','manish.c','amit.jaiswar','naresh.c','6ab0c6256ff4ca361297e9a3'],
  ['LMH253698','anushka.kokate','Pune',9,0,0,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','sanjana.c','amit.jaiswar','naresh.c','6ab09c813209518f61de8a5e'],
  ['LMH239484','kaveri.dange','Pune',9,0,0,0,'Call Not Connected','Open','Digital Marketing','sanjana.c','amit.jaiswar','naresh.c','6a8f172cb60584c9f20a2b03'],
  ['LMH255738','ajay.jaunjal','Nashik',8,1,0,0,'Call Not Connected','Open','Digital Marketing','nilesh.solapure','shirshendu.adhikari','anurag.mishra','6ab4fb3f6649fc27aac37570'],
  ['LMH251628','kaveri.dange','Pune',8,0,0,0,'Call Not Connected','Open','BTL Activity','sanjana.c','amit.jaiswar','naresh.c','6aabd0f4e5c9e80b3a57f02b'],
  ['LMH255457','ansh.sahi','Pune',8,0,0,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','manish.c','amit.jaiswar','naresh.c','6ab48464840a146122bb255c'],
  ['LRJ44912','manmohan.s','Jaipur',8,3,1,0,'Meeting Postponed','Connected','N/A','pooja.chauhan','mufeed.a','noor.alam','6ab4c25678601a0859e751e6'],
  ['LTN31163','nithya.kumari','Chennai',8,3,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','reshma.rh','shrishail.h','naresh.c','6ab509f66649fc4476c37867'],
  ['LRJ43911','abhimanyu.parihar','Jaipur',8,0,1,0,'Call Later','Open','Digital Marketing','pooja.chauhan','mufeed.a','noor.alam','6aaee6fed5d7de66a2e032ca'],
  ['LUP201035','zaid.s','Meerut',8,0,0,0,'Meeting Postponed','Connected','Digital Marketing','shefali.salve','monesh.chavan','harpreet.bhamara','6ab34ddc93397455613e787e'],
  ['LUP199529','shruti.chaudhary','Lucknow',8,3,1,1,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','meenu.k','prabhat.samal','noor.alam','6aafa1fb022966e4b2097fc2'],
  ['RMH60744','sanika.londhe','Nagpur',8,0,0,0,'Assigned','Open','Referral','nikhil.a','somya.p','prithviraj.p','6ab4fe4e840a146be7bb385e'],
  ['RMH60117','swami.dehankar','Nagpur',8,0,0,0,'Meeting Postponed','Connected','Solarpro','kshitij.jain','lav.pandey','prithviraj.p','6aae86df5abaf3cf1f3252c1'],
  ['RMP39492','onik.s','Jabalpur',8,3,1,0,'Meeting Confirmed - Customer Home','Connected','Referral','simran.p','parag.bhattad','anurag.mishra','6ab4ced278601a3628e754df'],
  ['RMH60633','sanika.londhe','Nagpur',8,0,0,0,'Call Later','Open','Referral','nikhil.a','somya.p','prithviraj.p','6ab3c8b8b994a00aa3a54900'],
  ['LTN4635','yogeswari.babu','Chennai',7,0,0,0,'Call Not Connected','Open','N/A','reshma.rh','shrishail.h','naresh.c','68fdc387e0983534bc2bec2f'],
  ['LTL40040','hemanth.babu','Hyderabad',7,0,0,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','raviteja.j','shrishail.h','naresh.c','6a86793e5ea081372e19dc8e'],
  ['LMP142560','ashmika.jha','Bhopal',7,0,0,0,'Call Not Connected','Open','Digital Marketing','ishika.rungta','parag.bhattad','anurag.mishra','6ab3e58637152052ca2f2cf6'],
  ['LMP142613','aastha.priya','Indore',7,6,0,0,'Call Later','Open','Digital Marketing','ishika.s','parag.bhattad','anurag.mishra','6ab4279b0cfe65ea3b23ea13'],
  ['LUP201297','rajpratap.rajput','Kanpur',7,0,0,0,'','','BTL Activity','priyank.chandrakar','monesh.chavan','harpreet.bhamara','6ab3ba193715205ff62f25b8'],
  ['LUP194556','promit.d','Kanpur',7,0,0,0,'','','Digital Marketing','priyank.chandrakar','monesh.chavan','harpreet.bhamara','6aa567e7aaba20702c893f5d'],
  ['LUP192235','sakshi.kumari','Lucknow',7,5,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','meenu.k','prabhat.samal','noor.alam','6aa0edf018e56465e8b207b4'],
  ['LUP199677','faizan.deshmukh','Meerut',7,7,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','shefali.salve','monesh.chavan','harpreet.bhamara','6aafe0b8eaf880827984baf1'],
  ['RMH31189','swami.dehankar','Nagpur',7,0,0,0,'Call Not Connected','Open','Digital Marketing','kshitij.jain','lav.pandey','prithviraj.p','690451d05593735dc5cfea3a'],
  ['LUP177029','saloni.singh','Lucknow',7,7,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','muskan.yadav','prabhat.samal','noor.alam','6a7c2eb08c662d25d96cadfb'],
  ['LMH255208','akshada.t','Pune',6,6,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','manish.c','amit.jaiswar','naresh.c','6ab3b802be88152344adf2bb'],
  ['LMH255376','kaveri.dange','Pune',6,0,0,0,'Call Later','Open','BTL Activity','sanjana.c','amit.jaiswar','naresh.c','6ab3f974d18e15e726642552'],
  ['LMH88442','divya.iyer','Pune',6,0,0,0,'Meeting Confirmed - Customer Home','Connected','N/A','vaibhav.w','amit.jaiswar','naresh.c','6913131b1d697330e8e66a79'],
  ['LTL40344','gopala.krishna','Hyderabad',6,0,0,0,'DEV Scheduled','Connected','Digital Marketing','raviteja.j','shrishail.h','naresh.c','6a8a5e7a471ed30b58c0b0a1'],
  ['LDL63113','tanisha.meena','Delhi',6,0,0,0,'Design Created','Connected','Digital Marketing','shivam.b','mufeed.a','noor.alam','6aae4daa45fdcd3a1da63be3'],
  ['LMP142805','kalpana.yadav','Bhopal',6,0,0,0,'Call Not Connected','Open','BTL Activity','mohit.k','parag.bhattad','anurag.mishra','6ab4d0b8952b6032a760ea23'],
  ['LUP201396','safal.panday','Noida',6,6,1,1,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','deepanshi.s','mufeed.a','noor.alam','6ab3ebe033ff73dec381dc2d'],
  ['LUP201480','subash.singh','Lucknow',6,0,0,0,'Speed Order','Connected','Digital Marketing','ritesh.konde','prabhat.samal','noor.alam','6ab4232a6649fc3944c3627d'],
  ['LTL36806','aniket.kumar','Hyderabad',5,2,0,1,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','raviteja.j','shrishail.h','naresh.c','6a58952e60e7d95dd19379b0'],
  ['LTL43236','pooja.singam','Hyderabad',5,5,1,0,'Meeting Confirmed - Customer Home','Connected','Digital Marketing','raviteja.j','shrishail.h','naresh.c','6ab48f6e0cfe656bc223eb26'],
  ['LUP197515','garima.srivastava','Lucknow',5,5,0,0,'Meeting Postponed','Connected','BTL Activity','muskan.yadav','prabhat.samal','noor.alam','6aab78f8f4b76b625a80eef9'],
  ['RKA4863','mustaqueem.wate','Bengaluru',5,0,0,0,'','','Referral','akshay.shrivant','shrishail.h','naresh.c','6aabecda7ffd9558fa32bed6']
];

function ldMock() {
  var dom = '@solarsquare.in', out = [];
  LD_MOCK_REAL.forEach(function (r) {
    out.push({ lead: r[0], lrm: r[1] + dom, cluster: r[2], dials: r[3], conn: r[4], ms: r[5], md: r[6],
      date: '2026-09-24', link: 'https://lighthouse.solarsquare.in/#/menu/lead/details/' + r[13],
      stage: r[7], status: r[8], source: r[9], tl: r[10] + dom, zsm: r[11] + dom, ados: r[12] + dom });
  });
  // Synthesised shallow tail, reusing the real LRM → TL → ZSM → ADOS chains.
  var seed = 7; var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Per LRM: a realistic day's volume (110–240 dials), its own connect rate and
  // its own meetings-per-connect, so the effort planner has real spread to work on.
  var chains = {}, used = {}, n = 0;
  out.forEach(function (r) { chains[r.lrm] = chains[r.lrm] || r; used[r.lrm] = (used[r.lrm] || 0) + r.dials; });
  Object.keys(chains).forEach(function (lrm) {
    var c = chains[lrm], V = 110 + Math.floor(rnd() * 130), p = 0.16 + rnd() * 0.2, q = 0.04 + rnd() * 0.12;
    while (used[lrm] < V) {
      var dials = rnd() < 0.55 ? 1 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 2);
      var conn = 0; for (var d = 0; d < dials; d++) if (rnd() < p) conn++;
      var ms = conn && rnd() < q * conn * 1.6 ? 1 : 0;
      used[lrm] += dials;
      out.push({ lead: 'MOCK' + (++n), lrm: c.lrm, cluster: c.cluster, dials: dials, conn: conn, ms: ms,
        md: ms && rnd() < 0.15 ? 1 : 0, date: '2026-09-24', link: '', stage: conn ? 'Call Later' : 'Call Not Connected',
        status: 'Open', source: c.source, tl: c.tl, zsm: c.zsm, ados: c.ados, mock: true });
    }
  });
  return out;
}

/* Live: D.leadDepthAgg = weighted groups {n leads at depth d, reached rch}
   from the LA x Data join (api/_leaddepth.js); D.leadDepth = per-lead list of
   6+ dial leads only. Preview: per-lead mock rows serve as both (n absent = 1). */
function ldRows() {
  if (!window.D) window.D = {};
  if (window.MOCK && !D.leadDepthAgg) { D.__ldMock = D.__ldMock || ldMock(); return D.__ldMock; }
  return D.leadDepthAgg || [];
}
function ldOverRows() {
  if (window.MOCK && !D.leadDepthAgg) return ldRows().filter(function (r) { return r.dials >= LD_OVER; });
  return D.leadDepth || [];
}
function ldW(r) { return r.n || 1; }
function ldDepth(r) { return r.n ? r.d : r.dials; }
function ldReached(r) { return r.n ? !!r.rch : r.conn > 0; }

/* Per-lead verdict. The order matters: a closed lead is a stop whatever else
   is true of it, and an engaged-stage lead with no connect is a confirmation
   chase, not prospecting — it needs a message, not a ninth dial. */
function ldAction(r) {
  var st = (r.stage + ' ' + r.status).toLowerCase();
  if (/closed|not interested|not qualified|inactive/.test(st)) return { k: 'closed', t: 'Stop calling — lead is closed', c: 'bad' };
  if (!r.conn && /meeting|design|dev |speed|connected/.test(st)) return { k: 'confirm', t: 'Send confirmation WhatsApp / SMS; stop redialling', c: 'warn' };
  if (!r.conn) return { k: 'park', t: 'Park 48 h, then retry in a different hour', c: 'bad' };
  if (r.conn >= 3 && !r.ms) return { k: 'coach', t: 'TL to listen in — ' + r.conn + ' connects, no meeting', c: 'warn' };
  if (r.ms) return { k: 'ok', t: 'Converted — no action', c: 'ok' };
  return { k: 'watch', t: 'Connected — one more attempt, then park', c: '' };
}

function ldAgg(rows) {
  var a = { leads: 0, dials: 0, conn: 0, ms: 0, md: 0, over: 0, overZero: 0, overDials: 0, wasted: 0, reached: 0, lrms: {} };
  rows.forEach(function (r) {
    var w = ldW(r), rch = ldReached(r);
    a.leads += w; a.dials += r.dials; a.conn += r.conn; a.ms += r.ms; a.md += r.md;
    if (rch) a.reached += w;
    if (ldDepth(r) >= LD_OVER) { a.over += w; a.overDials += r.dials; if (!rch) { a.overZero += w; a.wasted += r.dials; } }
    a.lrms[r.lrm] = 1;
  });
  a.n = Object.keys(a.lrms).length;
  a.perLead = a.leads ? Math.round(10 * a.dials / a.leads) / 10 : 0;
  a.reachPct = ldPct(a.reached, a.leads);
  a.msPct = ldPct(a.ms, a.leads);
  a.dialsPerMs = a.ms ? Math.round(a.dials / a.ms) : 0;
  a.overShare = ldPct(a.overDials, a.dials);
  a.wastePct = ldPct(a.wasted, a.dials);
  return a;
}

function renderLeadDepth(panel) {
  var flt = window.ldFilter || function () { return true; };
  var rows = ldRows().filter(flt).filter(function (r) { return ldDepth(r) > 0; });
  var host = document.createElement('div');
  host.className = 'ld-wrap';
  var scroller = panel.querySelector('.dp-wrap');
  if (!scroller) { scroller = document.createElement('div'); scroller.className = 'dp-wrap'; panel.innerHTML = ''; panel.appendChild(scroller); }
  if (!rows.length) {
    host.innerHTML = '<div class="dp-empty"><b>No lead-depth feed yet.</b> Point the dashboard at the call-depth sheet.</div>';
    scroller.appendChild(host); return;
  }
  var t = ldAgg(rows);
  var mock = rows.some(function (r) { return r.mock; });
  var day = (window.D && D.fromDate && D.toDate) ? (D.fromDate === D.toDate ? D.fromDate : D.fromDate + ' → ' + D.toDate) : (rows[0].date || '');
  var h = '';

  h += '<div class="ld-head"><div><div class="dp-title">Lead-level depth · ' + ldEsc(day) + '</div>' +
    '<div class="ld-sub">Leads assigned in this range and every dial made on them since, and what to do about the ones being over-dialled. ' +
    '<b>Over-dialled</b> = ' + LD_OVER + '+ dials on one lead.</div></div>' +
    (mock ? '<span class="ld-mock">Preview data · deep-end rows are real (24 Sep), 1–4 dial tail synthesised</span>' : '') + '</div>';

  // ── Today's actions ─────────────────────────────────────────────────────
  var over = ldOverRows().filter(flt);
  var cnt = {}; over.forEach(function (r) { var a = ldAction(r).k; cnt[a] = (cnt[a] || 0) + 1; });
  var dialsOf = function (k) { return over.filter(function (r) { return ldAction(r).k === k; }).reduce(function (s, r) { return s + r.dials; }, 0); };
  var byLrm = {}; over.forEach(function (r) { if (!r.conn) byLrm[r.lrm] = (byLrm[r.lrm] || 0) + 1; });
  var worst = Object.keys(byLrm).sort(function (a, b) { return byLrm[b] - byLrm[a]; })[0];
  var worstTl = worst ? (over.filter(function (r) { return r.lrm === worst; })[0] || {}).tl : '';

  var act = function (cls, n, title, body, filter) {
    return '<button class="ld-act ' + cls + '"' + (filter ? ' data-lf="' + filter + '"' : '') + '>' +
      '<span class="ld-act-n">' + n + '</span><span class="ld-act-t">' + title + '</span>' +
      '<span class="ld-act-b">' + body + '</span>' + (filter ? '<span class="ld-act-go">Show leads →</span>' : '') + '</button>';
  };
  h += '<div class="ld-acts">' +
    act('bad', ldFmt(cnt.park || 0), 'Park these leads',
      'Dialled ' + LD_OVER + '+ times, never picked up. ' + ldFmt(dialsOf('park')) + ' dials spent. Stop for 48 h, retry at a different hour.', 'park') +
    act('warn', ldFmt(cnt.confirm || 0), 'Confirm by message, not call',
      'Stage says engaged (meeting / design / speed order) but never connected. Send a WhatsApp confirmation instead.', 'confirm') +
    act('bad', ldFmt(cnt.closed || 0), 'Closed leads still being dialled',
      'Not interested / not qualified / inactive — ' + ldFmt(dialsOf('closed')) + ' dials. Remove from the queue.', 'closed') +
    act('warn', ldFmt(cnt.coach || 0), 'Connected but no meeting',
      '3+ conversations and still no MS. TL should listen to one call before the next attempt.', 'coach') +
    (worst ? act('', ldEsc(ldName(worst)), 'Most dead over-dials',
      byLrm[worst] + ' leads dialled ' + LD_OVER + '+ times with 0 connects. Review with ' + ldEsc(ldName(worstTl)) + ' today.', '') : '') +
    '</div>';

  // ── Summary strip ───────────────────────────────────────────────────────
  var stat = function (v, l, cls) { return '<div class="ld-stat' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>' + l + '</span></div>'; };
  h += '<div class="ld-stats">' +
    stat(ldFmt(t.leads), 'leads dialled (1+)') + stat(ldFmt(t.dials), 'dials') + stat(t.perLead, 'dials per lead') +
    stat(t.reachPct + '%', 'leads reached') + stat(ldFmt(t.over), 'over-dialled leads') +
    stat(t.wastePct + '%', 'of dials on dead over-dials', t.wastePct >= 10 ? 'bad' : '') +
    stat(t.dialsPerMs || '—', 'dials per meeting') + '</div>';

  // ── Rollup ──────────────────────────────────────────────────────────────
  var G = LD_GRAINS.filter(function (g) { return g.k === ldGrain; })[0] || LD_GRAINS[0];
  var by = {};
  rows.forEach(function (r) { var k = r[G.f] || '—'; (by[k] = by[k] || []).push(r); });
  var groups = Object.keys(by).map(function (k) { var a = ldAgg(by[k]); a.key = k; a.label = G.k === 'cluster' ? k : ldName(k); return a; });
  groups.sort(function (a, b) {
    var x = a[ldSort.col], y = b[ldSort.col];
    if (typeof x === 'string') return x.localeCompare(y) * ldSort.dir;
    return ((x || 0) - (y || 0)) * ldSort.dir;
  });
  h += '<div class="ld-card"><div class="ld-card-hd"><b>Who is over-dialling</b><span>worst first · click a column to re-sort</span>' +
    '<div class="ld-seg">';
  LD_GRAINS.forEach(function (g) { h += '<button class="' + (g.k === ldGrain ? 'on' : '') + '" data-lg="' + g.k + '">' + g.lab + '</button>'; });
  h += '</div></div>';
  var th = function (k, lab, cls) {
    return '<th class="' + (k === 'label' ? '' : 'num ') + (cls || '') + '" data-ls="' + k + '">' + lab +
      (ldSort.col === k ? (ldSort.dir < 0 ? ' ▾' : ' ▴') : '') + '</th>';
  };
  h += '<div class="ld-tbl"><table class="ld-grid"><thead><tr>' + th('label', G.lab) +
    (G.k === 'lrm' ? '' : th('n', 'LRMs')) + th('leads', 'Leads', 'sep') + th('perLead', 'Dials / lead') +
    th('reachPct', 'Reached') + th('overZero', 'Dead over-dials', 'sep') + th('wastePct', '% dials wasted') +
    th('ms', 'MS', 'sep') + th('dialsPerMs', 'Dials / MS') + '<th class="sep">What to do</th></tr></thead><tbody>';
  groups.forEach(function (g) {
    var todo = g.overZero >= 3 ? ['bad', 'Park ' + g.overZero + ' dead leads today'] : g.overZero ? ['warn', 'Park ' + g.overZero + ' dead lead' + (g.overZero > 1 ? 's' : '')] :
      (g.leads >= 5 && !g.ms) ? ['warn', 'Dialling but no meetings — coach'] : ['ok', 'On track'];
    h += '<tr><td title="' + ldEsc(g.key) + '"><b>' + ldEsc(g.label) + '</b></td>' + (G.k === 'lrm' ? '' : '<td class="num">' + g.n + '</td>') +
      '<td class="num sep">' + ldFmt(g.leads) + '</td>' +
      '<td class="num' + (g.perLead >= 4 ? ' t-warn' : '') + '">' + g.perLead.toFixed(1) + '</td>' +
      '<td class="num">' + g.reachPct.toFixed(0) + '%</td>' +
      '<td class="num sep' + (g.overZero ? ' t-bad' : ' t-mute') + '">' + (g.overZero || '–') + '</td>' +
      '<td class="num' + (g.wastePct >= 10 ? ' t-bad' : ' t-mute') + '">' + (g.wastePct ? g.wastePct.toFixed(0) + '%' : '–') + '</td>' +
      '<td class="num sep">' + (g.ms || '–') + '</td><td class="num">' + (g.dialsPerMs || '–') + '</td>' +
      '<td class="sep"><span class="ld-pill ' + todo[0] + '">' + todo[1] + '</span></td></tr>';
  });
  h += '</tbody></table></div></div>';

  // ── Worklist ────────────────────────────────────────────────────────────
  if (!/^(all|park|confirm|closed|coach)$/.test(ldListMode)) ldListMode = 'all';
  var list = over.filter(function (r) { return ldListMode === 'all' || ldAction(r).k === ldListMode; })
    .sort(function (a, b) { return b.dials - a.dials || a.conn - b.conn; });
  var modes = [['all', 'All over-dialled', over.length], ['park', 'Park', cnt.park || 0], ['confirm', 'Confirm by message', cnt.confirm || 0],
               ['closed', 'Closed', cnt.closed || 0], ['coach', 'Connected, no MS', cnt.coach || 0]];
  h += '<div class="ld-card" id="ldList"><div class="ld-card-hd"><b>Over-dialled leads</b><span>' + LD_OVER + '+ dials today · deepest first · lead id opens Lighthouse</span>' +
    '<div class="ld-seg">';
  modes.forEach(function (m) { h += '<button class="' + (ldListMode === m[0] ? 'on' : '') + '" data-lm="' + m[0] + '">' + m[1] + ' <em>' + m[2] + '</em></button>'; });
  h += '</div></div><div class="ld-tbl"><table class="ld-grid"><thead><tr><th>Lead</th><th>LRM · TL</th><th>Cluster</th>' +
    '<th class="num sep">Dials</th><th class="num">Connects</th><th class="num">MS</th>' +
    '<th class="sep">Stage · Status</th><th class="sep">Next step</th></tr></thead><tbody>';
  list.forEach(function (r) {
    var a = ldAction(r);
    var lead = r.link ? '<a href="' + ldEsc(r.link) + '" target="_blank" rel="noopener">' + ldEsc(r.lead) + '</a>' : ldEsc(r.lead);
    h += '<tr><td><b>' + lead + '</b><div class="ld-mini">' + ldEsc(r.source || '—') + '</div></td>' +
      '<td>' + ldEsc(ldName(r.lrm)) + '<div class="ld-mini">TL ' + ldEsc(ldName(r.tl)) + '</div></td><td>' + ldEsc(r.cluster || '—') + '</td>' +
      '<td class="num sep"><b>' + r.dials + '</b></td><td class="num' + (r.conn ? '' : ' t-bad') + '">' + r.conn + '</td>' +
      '<td class="num">' + (r.ms || '–') + '</td>' +
      '<td class="sep">' + ldEsc(r.stage || 'No stage') + '<div class="ld-mini">' + ldEsc(r.status || '—') + '</div></td>' +
      '<td class="sep"><span class="ld-pill ' + a.c + '">' + ldEsc(a.t) + '</span></td></tr>';
  });
  if (!list.length) h += '<tr><td colspan="8" class="ld-none">No leads in this list.</td></tr>';
  h += '</tbody></table></div></div>';

  host.innerHTML = h;
  scroller.appendChild(host);

  var rerender = function () { var y = scroller.scrollTop; renderDepth(); var s2 = document.querySelector('#depthPanel .dp-wrap'); if (s2) s2.scrollTop = y; };
  host.querySelectorAll('[data-lg]').forEach(function (b) {
    b.addEventListener('click', function () { ldGrain = b.getAttribute('data-lg'); try { localStorage.setItem('lrmLeadDepthGrain', ldGrain); } catch (e) {} rerender(); });
  });
  host.querySelectorAll('[data-lm]').forEach(function (b) {
    b.addEventListener('click', function () { ldListMode = b.getAttribute('data-lm'); rerender(); });
  });
  host.querySelectorAll('[data-lf]').forEach(function (b) {
    b.addEventListener('click', function () {
      ldListMode = b.getAttribute('data-lf'); rerender();
      var s2 = document.querySelector('#depthPanel .dp-wrap'), l = document.getElementById('ldList');
      if (s2 && l) s2.scrollTop = l.offsetTop - s2.offsetTop - 8;
    });
  });
  host.querySelectorAll('th[data-ls]').forEach(function (th) {
    th.style.cursor = 'pointer';
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-ls');
      ldSort.dir = ldSort.col === k ? -ldSort.dir : (k === 'label' ? 1 : -1); ldSort.col = k; rerender();
    });
  });
}

(function () {
  var css = '.ld-wrap{margin-top:26px;padding-top:22px;border-top:2px solid #e3e8f3;display:flex;flex-direction:column;gap:16px}' +
    '.ld-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}' +
    '.ld-sub{font-size:12px;color:#4a5474;margin-top:4px;max-width:720px;line-height:1.5}' +
    '.ld-mock{font-size:11px;color:#8a5a00;background:#fff6e0;border:1px solid #f3dca4;border-radius:6px;padding:5px 10px;white-space:nowrap;flex:0 0 auto}' +
    '.ld-acts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}' +
    '.ld-act{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:13px 14px;background:#fff;border:1px solid #e3e8f3;border-top:3px solid #9fb0d8;border-radius:8px;transition:box-shadow .15s,border-color .15s}' +
    '.ld-act:hover{box-shadow:0 3px 12px rgba(24,35,63,.08);border-color:#c9d3ea}' +
    '.ld-act.bad{border-top-color:#c0453a}.ld-act.warn{border-top-color:#e09e00}' +
    '.ld-act-n{font-size:24px;font-weight:800;color:#18233f;line-height:1.1;letter-spacing:-.5px}' +
    '.ld-act.bad .ld-act-n{color:#b0382c}.ld-act.warn .ld-act-n{color:#a86a00}' +
    '.ld-act-t{font-size:12.5px;font-weight:700;color:#18233f}' +
    '.ld-act-b{font-size:11.5px;color:#5a6484;line-height:1.45}' +
    '.ld-act-go{font-size:11px;font-weight:700;color:#2348a8;margin-top:auto;padding-top:4px}' +
    '.ld-stats{display:flex;flex-wrap:wrap;gap:0;background:#fff;border:1px solid #e3e8f3;border-radius:8px}' +
    '.ld-stat{flex:1 1 120px;padding:10px 14px;border-right:1px solid #eef1f7;display:flex;flex-direction:column;gap:2px}' +
    '.ld-stat:last-child{border-right:0}.ld-stat b{font-size:17px;font-weight:800;color:#18233f;font-variant-numeric:tabular-nums}' +
    '.ld-stat span{font-size:10.5px;color:#6a7494}.ld-stat.bad b{color:#b0382c}' +
    '.ld-card{background:#fff;border:1px solid #e3e8f3;border-radius:8px;padding:14px 16px}' +
    '.ld-card-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}' +
    '.ld-card-hd b{font-size:13px;color:#18233f;white-space:nowrap;flex:0 0 auto}.ld-card-hd>span{font-size:11px;color:#6a7494;white-space:nowrap}' +
    '.ld-seg{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap}' +
    '.ld-seg button{border:1px solid #e3e8f3;background:#fff;color:#18233f;font:inherit;font-size:11.5px;font-weight:600;line-height:1;white-space:nowrap;padding:6px 10px;border-radius:6px;cursor:pointer}' +
    '.ld-seg button:hover{border-color:#9fb0d8}.ld-seg button.on{background:#18233f;border-color:#18233f;color:#fff}' +
    '.ld-seg button em{font-style:normal;opacity:.65;margin-left:3px}' +
    '.ld-bands{display:flex;flex-direction:column}' +
    '.ld-band{display:grid;grid-template-columns:minmax(170px,240px) minmax(120px,1fr) 96px 70px 70px 80px 80px;align-items:center;gap:14px;padding:9px 0;border-top:1px solid #eef1f7}' +
    '.ld-band:first-child{border-top:0}' +
    '.ld-band-l b{display:block;font-size:12.5px;color:#18233f}.ld-band-l span{font-size:10.5px;color:#6a7494}' +
    '.ld-band-bar{height:8px;background:#eef1f7;border-radius:4px;overflow:hidden}.ld-band-bar i{display:block;height:100%;background:#5d7bab;border-radius:4px}' +
    '.ld-band-m{text-align:right}.ld-band-m b{display:block;font-size:14px;color:#18233f;font-variant-numeric:tabular-nums}.ld-band-m span{font-size:10px;color:#6a7494}' +
    '.ld-verdict{font-size:11.5px;font-weight:700;padding:5px 9px;border-radius:6px;background:#f4f6fb;color:#4a5474}' +
    '.ld-verdict.ok{background:#e9f5ec;color:#1f7a45}.ld-verdict.warn{background:#fff4dc;color:#8a5a00}.ld-verdict.bad{background:#fbeae8;color:#a3342a}' +
    '.ld-tbl{overflow-x:auto;border:1px solid #eef1f7;border-radius:6px}' +
    'table.ld-grid{width:100%;border-collapse:collapse;font-size:12px}' +
    'table.ld-grid th{background:#f6f8fc;color:#18233f;font-size:9.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;text-align:left;padding:8px 10px;border-bottom:1px solid #e3e8f3;white-space:nowrap;position:sticky;top:0}' +
    'table.ld-grid td{padding:8px 10px;border-bottom:1px solid #eef1f7;vertical-align:middle;color:#2b3245}' +
    'table.ld-grid tr:last-child td{border-bottom:0}table.ld-grid tbody tr:hover td{background:#f9fafd}' +
    'table.ld-grid .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    'table.ld-grid .sep{border-left:1px solid #eef1f7}' +
    'table.ld-grid a{color:#2348a8;text-decoration:none}table.ld-grid a:hover{text-decoration:underline}' +
    '.ld-mini{font-size:10.5px;color:#6a7494;margin-top:1px;white-space:nowrap}' +
    '.t-bad{color:#b0382c;font-weight:700}.t-warn{color:#a86a00;font-weight:700}.t-mute{color:#a3aac0}' +
    '.ld-pill{display:inline-block;font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px;background:#f4f6fb;color:#4a5474;white-space:nowrap}' +
    '.ld-pill.ok{background:#e9f5ec;color:#1f7a45}.ld-pill.warn{background:#fff4dc;color:#8a5a00}.ld-pill.bad{background:#fbeae8;color:#a3342a}' +
    '.ld-none{text-align:center;padding:18px;color:#6a7494}' +
    '@media (max-width:1100px){.ld-band{grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr));gap:10px}.ld-band-bar{display:none}.ld-verdict{grid-column:1/-1}}';
  var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  var base = window.renderDepth;
  if (typeof base !== 'function') return;
  window.renderDepth = function () {
    base.apply(this, arguments);
    var panel = document.getElementById('depthPanel');
    if (panel) renderLeadDepth(panel);
  };
})();
