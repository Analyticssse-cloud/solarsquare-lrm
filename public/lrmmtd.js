/* LRM View — MTD toggle (23 Oct 2026).
   Adds a "Selected range | Month to date" switch above the LRM table. MTD = 1st of the
   month of the To date → the To date, pulled from the same /api/dashboard endpoint (so
   scope, dedup and the Avg Talk = Talk ÷ Connected rule are identical), cached per window.
   Columns are PER WORKED DAY (month total ÷ days with ≥1 dial, the dashboard's
   _workDays): Calls, Connected, Talk Time (min), Unique Leads; Avg Talk = Talk ÷ Connected. Wraps the existing renderAgent(); range mode is untouched. */
(function(){
  var css='.mtd-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px}'
    +'.mtd-seg{display:inline-flex;border:1px solid #d5dbe8;border-radius:6px;overflow:hidden;background:#fff}'
    +'.mtd-seg button{border:0;background:transparent;padding:6px 12px;font:600 12px/1 inherit;font-family:inherit;color:#4a5578;cursor:pointer}'
    +'.mtd-seg button+button{border-left:1px solid #d5dbe8}'
    +'.mtd-seg button:hover{background:#eef1f7}'
    +'.mtd-seg button.on{background:var(--blue,#1b3a8c);color:#fff}'
    +'.mtd-seg button:focus-visible{outline:2px solid var(--blue,#1b3a8c);outline-offset:2px}'
    +'.mtd-note{font-size:11.5px;color:#5b6582}'
    +'tr.mtd-total td{background:#f3f5fa;font-weight:700}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  var MODE='range'; try{ if(localStorage.getItem('lrmViewMode')==='mtd') MODE='mtd'; }catch(e){}
  var CACHE={}, LOADING={}, TTL=5*60*1000;
  var mtdSort={col:'_callsPD',dir:-1};
  var COLS=[
    {k:'Agent Id',l:'LRM'},
    {k:'_workDays',l:'Days Worked'},
    {k:'_callsPD',l:'Calls / Day'},
    {k:'_connPD',l:'Connected / Day'},
    {k:'_ttPD',l:'Talk Time / Day (min)'},
    {k:'Avg. Talk Time',l:'Avg Talk / Call (min)'},
    {k:'_uniqPD',l:'Unique Leads / Day'}
  ];
  var orig=window.renderAgent;

  function n(v){ return Number(v)||0; }
  function f0(v){ return n(v).toLocaleString('en-IN'); }
  function window_(){
    var to=document.getElementById('toDate').value; if(!to) return null;
    return {from:to.slice(0,8)+'01', to:to};
  }
  function fmtD(iso){ var d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}); }

  function bar(w){
    return '<div class="mtd-bar"><div class="mtd-seg" role="group" aria-label="LRM view period">'
      +'<button type="button" data-m="range" class="'+(MODE==='range'?'on':'')+'">Selected range</button>'
      +'<button type="button" data-m="mtd" class="'+(MODE==='mtd'?'on':'')+'">Month to date</button></div>'
      +(MODE==='mtd'&&w?'<span class="mtd-note">MTD · '+fmtD(w.from)+' – '+fmtD(w.to)+' · per worked day (days with ≥1 dial); Avg Talk = Talk ÷ Connected</span>':'')
      +'</div>';
  }
  function wire(panel){
    panel.querySelectorAll('.mtd-seg button').forEach(function(b){
      b.addEventListener('click',function(){
        var m=b.getAttribute('data-m'); if(m===MODE) return;
        MODE=m; try{ localStorage.setItem('lrmViewMode',m); }catch(e){}
        window.renderAgent();
      });
    });
  }

  function fetchMTD(w){
    var key=w.from+'|'+w.to;
    if(LOADING[key]) return;
    LOADING[key]=true;
    var tok=(window.AUTH&&AUTH.token)||(typeof AUTH!=='undefined'&&AUTH.token)||'';
    fetch('/api/dashboard?from='+w.from+'&to='+w.to,{headers:tok?{Authorization:'Bearer '+tok}:{}})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(d){ CACHE[key]={rows:d.agentRows||[],at:Date.now()}; })
      .catch(function(e){
        if(window.MOCK) CACHE[key]={rows:(window.MOCK.agentRows||[]),at:Date.now(),demo:true};
        else CACHE[key]={err:e.message,at:Date.now()};
      })
      .then(function(){ LOADING[key]=false; if(typeof activeTab!=='undefined'&&activeTab==='agent'&&MODE==='mtd') window.renderAgent(); });
  }

  function f1(v){ v=n(v); return v>0?(Math.round(v*10)/10).toLocaleString('en-IN',{minimumFractionDigits:1,maximumFractionDigits:1}):'—'; }
  function cell(c,r){
    if(c==='Agent Id') return agentCell('Agent Id',r,1);
    if(c==='_workDays'){ var d=n(r[c]); return d>0?f0(d):'—'; }
    return f1(r[c]);
  }
  function pd(v,d){ return d>0?n(v)/d:0; }

  function renderMTD(){
    var panel=document.getElementById('agentPanel');
    var w=window_(); if(!w){ panel.innerHTML=bar(null)+'<div class="empty">Pick a To date first.</div>'; wire(panel); return; }
    var key=w.from+'|'+w.to, c=CACHE[key];
    if(!c && typeof D!=='undefined' && D && D.from===w.from && D.to===w.to) c=CACHE[key]={rows:D.agentRows||[],at:Date.now()};
    if(!c || Date.now()-c.at>TTL){
      if(!c){ panel.innerHTML=bar(w)+'<div class="loading"><div class="spinner"></div>Fetching month-to-date…</div>'; wire(panel); }
      fetchMTD(w); if(!c) return;
    }
    if(c.err){ panel.innerHTML=bar(w)+'<div class="error-box">⚠ Could not load MTD: '+esc(c.err)+'</div>'; wire(panel); return; }

    var save=D.agentRows; D.agentRows=c.rows; var rows; try{ rows=filterAgents(); } finally { D.agentRows=save; }
    rows=rows.map(function(r){ var o={}; for(var k in r) o[k]=r[k]; o._ttMin=n(r['Total Talk Time'])*60; var d=n(r._workDays)||n(r._dayCount)||(n(r['Call Count'])>0?1:0); o._workDays=d; o._callsPD=pd(r['Call Count'],d); o._connPD=pd(r['Connected Calls'],d); o._ttPD=pd(o._ttMin,d); o._uniqPD=pd(r['Unique Leads Dialed'],d); return o; });
    rows.sort(function(a,b){ var av=a[mtdSort.col],bv=b[mtdSort.col]; if(typeof av==='string') return av.localeCompare(bv)*mtdSort.dir; return (n(av)-n(bv))*mtdSort.dir; });
    setCount(rows.length+' LRMs · MTD'+(c.demo?' (demo data)':''));
    if(!rows.length){ panel.innerHTML=bar(w)+'<div class="empty">No LRMs match the current filters this month.</div>'; wire(panel); return; }

    var T={calls:0,conn:0,tt:0,uniq:0,days:0};
    rows.forEach(function(r){ T.calls+=n(r['Call Count']); T.conn+=n(r['Connected Calls']); T.tt+=r._ttMin; T.uniq+=n(r['Unique Leads Dialed']); T.days+=n(r._workDays); });
    var tot={'Agent Id':'','_workDays':T.days,'_callsPD':pd(T.calls,T.days),'_connPD':pd(T.conn,T.days),'_ttPD':pd(T.tt,T.days),'Avg. Talk Time':T.conn?T.tt/T.conn:0,'_uniqPD':pd(T.uniq,T.days)};

    var html=bar(w)+'<div class="tbl-wrap"><table><thead><tr>';
    COLS.forEach(function(col){ var cls=(mtdSort.col===col.k?(mtdSort.dir===1?'sort-asc':'sort-desc'):'')+(col.k!=='Agent Id'?' num':''); html+='<th class="'+cls+'" data-sort="'+esc(col.k)+'">'+esc(col.l)+'</th>'; });
    html+='</tr></thead><tbody><tr class="mtd-total">';
    COLS.forEach(function(col){ html+=col.k==='Agent Id'?'<td title="Per LRM per worked day">Floor · per LRM-day</td>':'<td class="num">'+(col.k==='_workDays'?f0(tot[col.k])+' LRM-days':f1(tot[col.k]))+'</td>'; });
    html+='</tr>';
    rows.forEach(function(r){ html+='<tr>'; COLS.forEach(function(col){ html+='<td'+(col.k!=='Agent Id'?' class="num"':'')+'>'+cell(col.k,r)+'</td>'; }); html+='</tr>'; });
    panel.innerHTML=html+'</tbody></table></div>';
    wire(panel);
    panel.querySelectorAll('thead th').forEach(function(th){ th.addEventListener('click',function(){ var k=th.getAttribute('data-sort'); mtdSort.dir=(mtdSort.col===k)?mtdSort.dir*-1:(k==='Agent Id'?1:-1); mtdSort.col=k; renderMTD(); }); });
  }

  window.renderAgent=function(){
    if(typeof D==='undefined'||!D) return;
    if(MODE==='mtd') return renderMTD();
    orig();
    var panel=document.getElementById('agentPanel');
    if(panel){ panel.insertAdjacentHTML('afterbegin',bar(null)); wire(panel); }
  };
})();
