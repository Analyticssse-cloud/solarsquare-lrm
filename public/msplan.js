/* ── Action Center · MS Plan ──────────────────────────────────────────────────
   "How much effort does each city need to hit TOMORROW's MS target?"

   Read left to right, one metric at a time, in the same grammar as the Effort
   per MS table:

     done today  →  per MS (today's cost of a meeting)  →  needed for the target

   so `needed = (effort per MS) x (MS still to book)`. The per-MS ratios are the
   city's own, measured over the selected range; a city with a thin sample
   (under MSPLAN.minConn connects or MSPLAN.minMs meetings) borrows the
   floor-wide ratio and is marked with a dagger.

   ⚠ THE TARGET IS TOMORROW'S. This is now a real BURN-DOWN, not a full-target
   restatement: `sql/ms-inventory-lead-snapshot.sql` (v14) feeds `msScheduleRows`
   — every lead currently confirmed for tomorrow, however long ago it was
   booked, cluster + city + LRM email. `MS Left (Site)` / `MS Left (LRM)` =
   target minus what's already on the calendar, in each cut, and CAN GO
   NEGATIVE (user, 6 Sep 2026: overbooking a day is real and should read as a
   surplus, not clamp to 0). The dials/connects/TT "needed" columns use
   MS Left (LRM) — clamped at 0 only for that arithmetic, never for display —
   so the requirement shrinks as the day fills instead of restating the whole
   target every time. If `msScheduleRows` is empty (feed not wired yet), MS
   Left falls back to the full target automatically — safe no-op, not a crash.

   TWO CUTS, BOTH SHOWN, PER THE USER (6 Sep 2026):
   - MS Left (Site): grouped by the feed's own `Cluster`/`City` — the customer's
     address, i.e. market demand where the meeting physically is.
   - MS Left (LRM): each scheduled lead's `Assigned LRM` resolved through the
     LRM_TL_MAP roster to THAT LRM's own City — matches how the effort side
     (dials/connects/TT) is already grouped, so effort and remaining-target are
     apples-to-apples for the requirement math. The two disagree only for
     cross-city LRMs; both are shown rather than picking a winner.

   Deliberately NOT pace-scored: a full day's plan, not a "where should we be at
   14:00" bar. distPace() / distBar() do not apply.
   ───────────────────────────────────────────────────────────────────────────── */
var MS_TARGETS = {
  'Nagpur':133,'Amravati':19,'Ahmedabad':30,'Aurangabad':26,'Nashik':37,'Pune':94,
  'Kolhapur':13,'Bhopal':52,'Gwalior':39,'Indore':60,'Jabalpur':35,'Kanpur':75,
  'Varanasi':16,'Lucknow':111,'Delhi':46,'Jodhpur':13,'Kota':4,'Gurgaon':11,
  'Faridabad':14,'Agra':24,'Ghaziabad':20,'Noida':17,'Jaipur':56,'Bareilly':0,
  'Meerut':13,'Hyderabad':53,'Bangalore':47,'Chennai':50,'Coimbatore':4,
  'Jalgaon':8,'Solapur':10,'Vijayawada':6,'Salem':7,'Vizag':4,'Raipur':6,
  'Erode':3,'Trichy':0,'Prayagraj':0,'Madurai':0
};
var MS_TARGET_TOTAL = 1156;            // Pan India (the city targets sum to exactly this)
var MSPLAN = { minConn:150, minMs:5 }; // sample floor for trusting a city's own ratios
/* FUNNEL BASIS (user, 6 Sep 2026) — the default requirement math.
   The observed "dials per MS" is not a cost: it divides TODAY's dials by the
   meetings booked today, while today's dials also produce meetings for T+1/T+2
   and the meetings already on a day's calendar were produced by EARLIER days'
   dials. Reading 10 dials/MS off that says the floor needs 11,000 dials for
   1,100 meetings, which is arithmetically wrong.
   The requirement is a funnel instead: dials → connects at `connRate` →
   meetings at `msRate` of connects. So
     connects needed = MS left / msRate
     dials needed    = MS left / (connRate x msRate)
   Already-scheduled meetings never enter a denominator — they only reduce
   MS left. */
var MSPLAN_FUNNEL = { connRate:0.25, msRate:0.20 };
var planBasis = (function(){ try { return localStorage.getItem('lrmPlanBasis') || 'funnel'; } catch(e) { return 'funnel'; } })();
/* The sheet's Cluster spelling and the target list's spelling differ in a handful
   of cities. Normalise both sides through this map so a rename upstream cannot
   silently orphan a target row. */
var MSPLAN_ALIAS = {
  'bengaluru':'Bangalore','bangalore':'Bangalore','blr':'Bangalore',
  'visakhapatnam':'Vizag','vishakhapatnam':'Vizag','vizag':'Vizag',
  'tiruchirappalli':'Trichy','trichy':'Trichy',
  'allahabad':'Prayagraj','prayagraj':'Prayagraj',
  'gurugram':'Gurgaon','gurgaon':'Gurgaon',
  'new delhi':'Delhi','delhi ncr':'Delhi','delhi':'Delhi',
  'chhatrapati sambhajinagar':'Aurangabad','sambhajinagar':'Aurangabad','aurangabad':'Aurangabad',
  'vijaywada':'Vijayawada','vijayawada':'Vijayawada'
};
function msPlanCity(raw){
  var s=String(raw||'').trim(); if(!s) return '— Unmapped —';
  var k=s.toLowerCase().replace(/\s+/g,' ');
  if(MSPLAN_ALIAS[k]) return MSPLAN_ALIAS[k];
  return s.replace(/\b\w/g,function(c){return c.toUpperCase();});
}
var planSort = { col:'dialGap', dir:-1 };
/* WHICH DAY the plan is stated against (user, 6 Sep 2026): a Sunday floor is
   working on Tuesday's calendar because Monday is a holiday, so a hard-coded
   T+1 is wrong on any day before a break. Cohort 0/1/2 = today / tomorrow /
   day after, matching the feed's own `Days Out`. Remembered per user. */
var planDay = (function(){ try { var v=localStorage.getItem('lrmPlanDay'); return v===null?1:Number(v); } catch(e) { return 1; } })();
function planDayLabel(off){
  var d=new Date(); d.setDate(d.getDate()+off);
  var wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return wd+' '+d.getDate()+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
}
function planDayName(off){ return off===0?'today':off===1?'tomorrow':planDayLabel(off); }
/* Days covered by the range, taken from the aggregation's own day count so it
   matches whatever the API actually returned (a missing day must not divide). */
function msPlanDays(rows){
  var d=1; rows.forEach(function(r){ d=Math.max(d, Number(r._dayCount)||1); }); return d;
}
/* Which cohort a feed row belongs to. `Days Out` is the feed's own column, but it
   is optional (dashboard.js sends null when the sheet lacks it) — in that case
   derive it from `Schedule Date` against the real local today, so a feed written
   before the column existed cannot silently collapse three days into one sum
   (the old code returned every row for every cohort → MS Left triple-counted,
   while the floor row required Days Out === 1 and read 0. The two disagreed). */
function msPlanCohortOf(r){
  var d=r['Days Out'];
  if(d!==null&&d!==undefined&&String(d).trim()!==''&&isFinite(Number(d))) return Number(d);
  var s=String(r['Schedule Date']||'').trim(); if(!s) return null;
  var dt=null, m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) dt=new Date(+m[1],+m[2]-1,+m[3]);
  else { var p=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); if(p) dt=new Date(+p[3],+p[2]-1,+p[1]); }
  if(!dt||isNaN(dt.getTime())) return null;
  var n=new Date(), t0=new Date(n.getFullYear(),n.getMonth(),n.getDate());
  return Math.round((dt-t0)/86400000);
}
/* Rows belonging to one cohort. Rows whose cohort cannot be resolved at all are
   kept ONLY when the whole feed is unresolvable — otherwise a half-tagged feed
   would double-count. Single source of truth for the table, the floor row and
   the strip, so they can never state different totals. */
function msPlanCohortRows(schedRows, cohort){
  var rows=schedRows||[];
  var res=rows.map(msPlanCohortOf);
  var any=res.some(function(c){ return c!==null; });
  return rows.filter(function(r,i){ return any ? res[i]===cohort : true; });
}
/* Sum `sql/ms-inventory-lead-snapshot.sql` (v16, T+0/T+1/T+2 cohort) rows two
   ways: by the feed's own Cluster/City (site/demand cut), and by the scheduled
   lead's Assigned LRM resolved through the roster to that LRM's own City
   (effort-matching cut). Filtered to ONE cohort — the plan is stated against
   TOMORROW (T+1) — the other two days ride along in the feed for later use
   (e.g. a 3-day strip) but don't enter this table's math. */
function msPlanSchedule(schedRows, roster, cohort){
  var bySite={}, byLRM={}, total=0;
  var rosterCity={};
  (roster||[]).forEach(function(r){
    var email=String(r['Agent Id']||'').trim().toLowerCase();
    if(email) rosterCity[email]=r['City']||'';
  });
  msPlanCohortRows(schedRows, cohort).forEach(function(r){
    var n=Number(r['MS Scheduled'])||0; if(!n) return;
    total+=n;
    var siteKey=msPlanCity(r['Cluster']||r['City']);
    bySite[siteKey]=(bySite[siteKey]||0)+n;
    var email=String(r['Assigned LRM']||'').trim().toLowerCase();
    var lrmCity=rosterCity[email];
    var lrmKey=msPlanCity(lrmCity||r['Cluster']||r['City']);
    byLRM[lrmKey]=(byLRM[lrmKey]||0)+n;
  });
  return { bySite:bySite, byLRM:byLRM, total:total };
}
/* per-MS ratios + the requirement they imply, for one city or the floor total */
function planDerive(b,fl,sched){
  b.thin = !(b.conn>=MSPLAN.minConn && b.ms>=MSPLAN.minMs);
  var src = (b.thin && fl) ? fl : b;
  // Minutes of talk per CONNECT is a real measured cost and stays measured in
  // both bases; only the dial/connect requirement changes basis.
  var minPerConn = src.conn ? src.ttMin/src.conn : null;
  if(planBasis==='funnel'){
    var F=MSPLAN_FUNNEL;
    b.connPerMs  = 1/F.msRate;
    b.dialsPerMs = 1/(F.connRate*F.msRate);
    b.ttPerMs    = minPerConn===null?null:minPerConn*b.connPerMs;
  } else {
    b.dialsPerMs = src.ms ? src.dials/src.ms : null;
    b.connPerMs  = src.ms ? src.conn /src.ms : null;
    b.ttPerMs    = src.ms ? src.ttMin/src.ms : null;
  }
  var msSite = sched && sched.bySite[b.name] || 0;
  var msLRM  = sched && sched.byLRM[b.name]  || 0;
  b.msSite = msSite; b.msLRM = msLRM;
  b.msLeftSite = (b.target===null) ? null : (b.target - msSite);
  b.msLeftLRM  = (b.target===null) ? null : (b.target - msLRM);
  // Requirement basis: MS Left (LRM) clamped at 0 for arithmetic only — a
  // surplus city needs zero more effort, never negative dials.
  var t = (b.msLeftLRM===null) ? b.target : Math.max(b.msLeftLRM, 0);
  b.reqDials = (t!==null && b.dialsPerMs!==null) ? b.dialsPerMs*t : null;
  b.reqConn  = (t!==null && b.connPerMs !==null) ? b.connPerMs *t : null;
  b.reqTT    = (t!==null && b.ttPerMs   !==null) ? b.ttPerMs   *t : null;
  b.dialGap  = b.reqDials===null?null:b.reqDials-b.dials;
  b.connGap  = b.reqConn ===null?null:b.reqConn -b.conn;
  return b;
}
function computeMSPlan(rows, schedRows, roster){
  var num=function(r,k){return Number(r[k])||0;};
  var days=msPlanDays(rows), g={};
  rows.forEach(function(r){
    if(num(r,'Call Count')<DIST.presentMin) return;
    var k=msPlanCity(r['City']);
    if(!g[k]) g[k]={name:k,present:0,dials:0,conn:0,ttMin:0,ms:0,msT1:0,days:1};
    var b=g[k];
    /* PER-LRM DAILY MEAN, then summed — not city-total ÷ max(day count).
       `Call Count` etc. are RANGE SUMS per LRM and `_dayCount` is that LRM's own
       number of active days, and the two are only comparable per LRM. The old
       code summed the whole city and divided by the LARGEST day count in it, so
       one LRM with rows on 30 days deflated every colleague with 1 day by ~30x
       — the floor read ~500 dials/day against a real ~22,000, and the per-MS
       ratios were wrong by a different factor in every city (bug found 6 Sep). */
    var d=Math.max(1, Number(r._dayCount)||1);
    b.present++;
    b.dials+=num(r,'Call Count')/d; b.conn+=num(r,'Connected Calls')/d;
    b.ttMin+=num(r,'Total Talk Time')*60/d; b.ms+=num(r,'MS Today')/d; b.msT1+=num(r,'MS T+1')/d;
    b.days=Math.max(b.days, d);
  });
  // Floor-wide ratios: the fallback for thin cities and the Pan India row's own
  // basis. Already per-day (the city buckets are), so it is a plain sum.
  var fl={name:'Pan India',present:0,dials:0,conn:0,ttMin:0,ms:0,msT1:0,target:MS_TARGET_TOTAL};
  Object.keys(g).forEach(function(k){ var b=g[k];
    fl.present+=b.present; fl.dials+=b.dials; fl.conn+=b.conn; fl.ttMin+=b.ttMin; fl.ms+=b.ms; fl.msT1+=b.msT1; });
  // Every TARGET city gets a row even with no calls in range — a city quietly
  // absent from the data is exactly what this table should surface.
  Object.keys(MS_TARGETS).forEach(function(k){ if(!g[k]) g[k]={name:k,present:0,dials:0,conn:0,ttMin:0,ms:0,msT1:0,days:1}; });
  /* A city that appears in the schedule feed but has no target and no calls in
     range still gets a row — otherwise its scheduled meetings are counted in the
     Pan India total and nowhere else, and the floor row stops reconciling with
     the column of cities under it. */
  var sched = msPlanSchedule(schedRows, roster, planDay);   // the selected target day, not a fixed T+1
  Object.keys(sched.bySite).concat(Object.keys(sched.byLRM)).forEach(function(k){
    if(!g[k]) g[k]={name:k,present:0,dials:0,conn:0,ttMin:0,ms:0,msT1:0,days:1};
  });

  // Per-day means are already applied per LRM in the loop above — nothing to divide here.

  // Floor total comes from the SAME cohort pass as the city rows (was a second,
  // stricter loop that could read 0 while the cities showed sums).
  var flSchedMS = sched.total;
  fl.msSite = flSchedMS; fl.msLRM = flSchedMS;
  planDerive(fl, null, { bySite:{'Pan India':flSchedMS}, byLRM:{'Pan India':flSchedMS} });

  var out=Object.keys(g).map(function(k){
    var b=g[k];
    b.target=MS_TARGETS[k]!==undefined?MS_TARGETS[k]:null;
    b.noData=!b.present;
    return planDerive(b,fl,sched);
  });
  var c=planSort.col, d=planSort.dir;
  out.sort(function(a,b){
    if(c==='name') return String(a.name).localeCompare(String(b.name))*d;
    var av=a[c], bv=b[c];
    if(av===null&&bv===null) return (b.target||0)-(a.target||0);
    if(av===null) return 1; if(bv===null) return -1;
    return (av-bv)*d;
  });
  return { rows:out, days:days, floor:fl };
}
function planNum(v,dec,cls){
  if(v===null||v===undefined) return '<td class="'+(cls||'')+'"><span style="color:#c0c4d6">—</span></td>';
  var n=dec?(Math.round(v*10)/10).toFixed(1):Math.round(v).toLocaleString('en-IN');
  return '<td class="'+(cls||'')+'">'+n+'</td>';
}
/* Signed variant for MS Left — negative (overbooked) reads as a green surplus
   rather than a clamped zero or a scary red negative. */
function planLeft(v,cls){
  var k=cls?(' class="'+cls+'"'):'';
  if(v===null||v===undefined) return '<td'+k+'><span style="color:#c0c4d6">—</span></td>';
  var r=Math.round(v);
  if(r<0) return '<td class="ok'+(cls?' '+cls:'')+'">+'+Math.abs(r).toLocaleString('en-IN')+' <span class="fb-sub" style="font-size:10px">over</span></td>';
  return '<td class="'+(r>0?'bad':'')+(cls?' '+cls:'')+'">'+r.toLocaleString('en-IN')+'</td>';
}
/* Column spec — grouped so the header reads as plain language instead of 17
   cryptic flat labels. PLAN_GROUPS drives the two-row table header (group row +
   short sub-labels); PLAN_COLS is the flat list, with QUALIFIED labels, kept for
   the PDF/CSV export where there is no group row to give context.
   The Meetings block is DAY-AWARE (6 Sep): `On calendar` is the selected day's
   own inventory from the schedule feed, so On calendar + Left to book = Target
   and picking a different day visibly moves the block. The old `Tomorrow`
   column was the Ozontel booking-velocity `MS T+1` — meetings BOOKED today that
   land tomorrow — which reads ~0 early in the day and never responded to the
   picker, so it looked like the table was frozen. Removed from the table;
   still computed (`msT1`) for anything else that wants it. */
var PLAN_GROUPS=[
  { label:'', cols:[['name','City','nm'],['present','LRM','']] },
  { label:'Meetings', cols:[['ms','Booked today'],['msLRM','On calendar'],['target','Target']] },
  { label:'Left to book', cols:[['msLeftSite','by city'],['msLeftLRM','by LRM']] },
  { label:'Dials', cols:[['dials','Done'],['dialsPerMs','per MS'],['reqDials','Needed'],['dialGap','Gap']] },
  { label:'Connects', cols:[['conn','Done'],['connPerMs','per MS'],['reqConn','Needed']] },
  { label:'Talk time (min)', cols:[['ttMin','Done'],['ttPerMs','per MS'],['reqTT','Needed']] }
];
var PLAN_COLS=(function(){
  var out=[];
  PLAN_GROUPS.forEach(function(g){
    g.cols.forEach(function(c,i){
      out.push([c[0], g.label ? g.label+' — '+c[1] : c[1], (i===0&&g.label)?'g':(c[2]||'')]);
    });
  });
  return out;
})();
var PLAN_CSS='<style>table.dist.plan th,table.dist.plan td{padding:3px 8px;font-size:11px;line-height:1.35}'
  +'table.dist.plan th.grp{text-align:center;font-size:10px;letter-spacing:.06em;text-transform:uppercase;opacity:.65;padding-bottom:1px;border-bottom:1px solid rgba(0,0,0,.08);position:sticky;top:0;z-index:3}'
  +'table.dist.plan th.sub{font-weight:600;font-size:10px;padding-top:2px;position:sticky;top:17px;z-index:2}'
  /* td.sep is styled globally but th.sep was not, so the group separators stopped
     at the header. Same hairline on both rows of the header. */
  +'table.dist.plan th.sep{border-left:1px solid var(--border)}'
  /* The panel is a flex column: without this the button row and the callout are
     shrinkable flex items, so a short viewport squashes the view selector to
     half height and the callout draws over it (the reported overlap). */
  +'.act-head,.dist-lvl,.dist-lead,.plan-days{flex:0 0 auto}'
  +'.plan-days{display:flex;gap:8px;align-items:stretch;margin-bottom:8px;position:relative;z-index:4}'
  +'.plan-days-lb{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);align-self:center;margin-right:2px}'
  +'.plan-days button{display:flex;flex-direction:column;gap:1px;text-align:left;border:1px solid var(--border);background:var(--surface);border-radius:6px;padding:5px 12px;cursor:pointer;font-family:inherit;color:var(--muted);line-height:1.25}'
  +'.plan-days button b{font-size:12px;color:var(--text)}'
  +'.plan-days button span{font-size:10px}'
  +'.plan-days button .plan-days-ms{font-weight:700}'
  +'.plan-days button:hover{border-color:var(--blue)}'
  +'.plan-days button.on{background:var(--blue);border-color:var(--blue);color:rgba(255,255,255,.78)}'
  +'.plan-days button.on b{color:#fff}'
  +'.plan-basis{display:flex;gap:8px;align-items:center;margin-left:auto}'
  /* The view-selector row must stay above the lead callout: both sit in the same
     panel and the sticky table headers otherwise raise their stacking context
     over it, clipping the Below-the-bar / Effort-per-MS / MS-Plan buttons. */
  +'.dist-view{position:relative;z-index:5}'
  +'.dist-lead{position:relative;z-index:0;margin-top:4px}</style>';
/* 3-day cohort strip (T+0/T+1/T+2), a plain sum per day — the "cohort view"
   alongside the LRM-cut "effort view" above. Read-only context row; the plan's
   own math stays anchored on T+1 regardless of what this shows. */
function msPlanCohortStrip(schedRows){
  var byDay={};
  (schedRows||[]).forEach(function(r){
    var d=msPlanCohortOf(r); if(d===null||d===undefined) return;
    var k=String(d);
    if(!byDay[k]) byDay[k]={cohort:r['Cohort']||('T+'+k),ms:0,leads:0};
    byDay[k].ms+=Number(r['MS Scheduled'])||0;
    byDay[k].leads+=Number(r['Distinct Leads'])||0;
  });
  return ['0','1','2'].map(function(k){ return byDay[k]||{cohort:'T+'+k,ms:0,leads:0}; });
}
function renderMSPlan(rows, schedRows, roster){
  var P=computeMSPlan(rows, schedRows, roster), fl=P.floor;
  var hasSched = (schedRows||[]).length>0;
  var strip = msPlanCohortStrip(schedRows);
  /* The strip doubles as the day PICKER — the plan follows whichever day is
     selected, so a holiday tomorrow just means planning the day after. */
  var stripHTML = '<div class="plan-days">'
    + '<span class="plan-days-lb">Planning for</span>'
    + strip.map(function(c,i){
        return '<button data-planday="'+i+'" class="'+(planDay===i?'on':'')+'">'
          + '<b>'+planDayLabel(i)+'</b>'
          + '<span>'+(i===0?'today':i===1?'tomorrow':'day after')+'</span>'
          + '<span class="plan-days-ms">'+(hasSched?Math.round(c.ms).toLocaleString('en-IN')+' booked':'—')+'</span>'
          + '</button>';
      }).join('')
    + '<span class="plan-basis">'
      + '<span class="plan-days-lb">Basis</span>'
      + '<button data-planbasis="funnel" class="'+(planBasis==='funnel'?'on':'')+'"><b>Funnel</b><span>'
        + Math.round(MSPLAN_FUNNEL.connRate*100)+'% connect × '+Math.round(MSPLAN_FUNNEL.msRate*100)+'% conv</span></button>'
      + '<button data-planbasis="observed" class="'+(planBasis==='observed'?'on':'')+'"><b>Observed</b><span>today’s dials per MS</span></button>'
    + '</span>'
    + '</div>';
  var basisNote = planBasis==='funnel'
    ? '<b>Needed</b> is a funnel: connects = MS left ÷ '+Math.round(MSPLAN_FUNNEL.msRate*100)+'%, dials = MS left ÷ ('
      + Math.round(MSPLAN_FUNNEL.connRate*100)+'% × '+Math.round(MSPLAN_FUNNEL.msRate*100)+'%) = '
      + Math.round(1/(MSPLAN_FUNNEL.connRate*MSPLAN_FUNNEL.msRate))+' dials per meeting. Meetings already on the calendar only reduce MS left — they are never in a denominator. '
    : '<b>Needed</b> = today\'s observed cost of one meeting × meetings still to book. Read with care: it divides today\'s dials by meetings booked TODAY, while those dials also produce meetings for later days. ';
  var lead='<div class="dist-lead"><b>Done &rarr; per MS &rarr; Needed</b> in each block, for meetings on <b>'+planDayLabel(planDay)+'</b>. '
    + basisNote
    + (hasSched
        ? '<b>On calendar</b> = already confirmed for '+planDayName(planDay)+', <b>Left to book</b> = target minus that (<b>by city</b> = customer\'s cluster, <b>by LRM</b> = the booking LRM\'s own city) — a green <b>+N over</b> means the day is already past target. '
        : '<span style="color:#b45309">Schedule-inventory feed not loaded yet, so <b>Left to book</b> still shows the full target.</span> ')
    + '<b>&dagger;</b> = sample too thin (under '+fmt(MSPLAN.minConn)+' connects or '+MSPLAN.minMs+' meetings), so the floor-wide ratio is used. '
    + '<b>Booked today</b> = meetings this city\'s LRMs booked today, for any future date (velocity). '
    + (P.days>1?'Actuals are each LRM\'s own daily average over the '+P.days+' days in range, summed. ':'')
    + 'Present LRMs only ('+DIST.presentMin+'+ dials).</div>';
  var grpRow='<tr>'+PLAN_GROUPS.map(function(g){
    return '<th class="grp'+(g.label?' sep':'')+'" colspan="'+g.cols.length+'">'+esc(g.label)+'</th>';
  }).join('')+'</tr>';
  var subRow='<tr>'+PLAN_GROUPS.map(function(g){
    return g.cols.map(function(c,i){
      var ar=planSort.col===c[0]?(planSort.dir===1?' ▲':' ▼'):'';
      return '<th class="sub'+(i===0&&g.label?' sep':'')+'" data-plan="'+c[0]+'" style="cursor:pointer">'+c[1]+ar+'</th>';
    }).join('');
  }).join('')+'</tr>';
  var head=grpRow+subRow;
  var row=function(b,cls){
    var gapCls=b.dialGap===null?'':(b.dialGap>0?'bad':'ok');
    var nameCell='<td class="nm">'+esc(b.name)+(b.thin&&b.present?' <span title="Thin sample — floor-wide ratio used">&dagger;</span>':'')
      + (b.target===null?' <span class="fb-sub" style="font-size:10px">no target</span>':'')
      + (b.noData?' <span class="fb-sub" style="font-size:10px">no LRM on floor</span>':'')+'</td>';
    return '<tr class="'+(cls||'')+'">'+nameCell
      + '<td>'+(b.present||'—')+'</td>'
      + planNum(b.ms,0,'g2 sep')+planNum(b.msLRM,0)+planNum(b.target,0)
      + planLeft(b.msLeftSite,'sep')+planLeft(b.msLeftLRM)
      + planNum(b.dials,0,'g2 sep')+planNum(b.dialsPerMs,1)+planNum(b.reqDials,0)+planNum(b.dialGap,0,cls?'':gapCls)
      + planNum(b.conn,0,'g2 sep')+planNum(b.connPerMs,1)+planNum(b.reqConn,0)
      + planNum(b.ttMin,0,'g2 sep')+planNum(b.ttPerMs,1)+planNum(b.reqTT,0)+'</tr>';
  };
  var body=P.rows.length?row(fl,'dist-total')+P.rows.map(function(b){return row(b);}).join('')
    :'<tr><td colspan="'+PLAN_COLS.length+'" class="fb-sub" style="text-align:center;padding:20px">No LRMs in this range.</td></tr>';
  return PLAN_CSS+stripHTML+lead+'<div class="dist-wrap"><table class="dist plan">'+head+body+'</table></div>';
}
