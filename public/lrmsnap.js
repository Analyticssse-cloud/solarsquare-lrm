/* Action Center · LRM Snapshot (24 Oct 2026).
   The LRM Snapshot (built hourly 09–21 IST; emailed nightly), rendered at the top of the Action Center from the same
   two tabs the email reads (D.lrmSnap = 'Daily Snapshot' rows 1-2 + ⚠ cells, last 5 dates of
   'Snapshot Log'). Rules mirror sendLrmSnapshotEmail(): Coverage = Covered / Assigned,
   Δ pts vs the previous log date, worst coverage first, "(non-LRM owner)" and <20 leads at
   the bottom, ND red when >10% of leads, RAG <70 / 70-79.9 / ≥80. Unlike the email, a stale
   snapshot still shows its last date under a red banner instead of stopping.
   Honours the ZSM filter. Collapsible; state remembered per browser. */
(function(){
  var css='.lsn{background:var(--surface);border:1px solid var(--border);border-radius:8px;margin:0 0 12px;flex:0 0 auto}'
    +'.lsn-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;cursor:pointer;user-select:none}'
    +'.lsn-hd h4{font-size:13px;font-weight:700;color:var(--text);margin:0}'
    +'.lsn-hd .lsn-meta{font-size:11px;color:var(--muted);font-weight:600}'
    +'.lsn-hd .lsn-chev{margin-left:auto;font-size:11px;color:var(--muted);font-weight:600}'
    +'.lsn-hd:hover .lsn-chev{color:var(--blue)}'
    +'.lsn-hd:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}'
    +'.lsn-bd{padding:0 14px 14px;display:flex;flex-direction:column;gap:12px}'
    +'.lsn.closed .lsn-bd{display:none}'
    +'.lsn-ban{font-size:12px;font-weight:700;padding:6px 10px;border-radius:6px}'
    +'.lsn-ban.red{color:#a3221a;background:#fde8e6}.lsn-ban.amber{color:#8a4b00;background:#fff1d6}'
    +'.lsn-note{font-size:11px;color:var(--muted);font-weight:600}'
    +'.lsn-head{font-size:15px;font-weight:700;color:var(--text);display:flex;gap:6px 14px;flex-wrap:wrap;align-items:baseline}'
    +'.lsn-head .up{color:var(--green)}.lsn-head .dn{color:var(--red)}.lsn-head small{font-size:11px;color:var(--muted);font-weight:600}'
    +'.lsn-grid{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}'
    +'.lsn-blk{display:flex;flex-direction:column;gap:6px;min-width:0;max-width:100%}'
    +'.lsn-blk h5{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--blue);font-weight:700;margin:0}'
    +'.lsn-tw{overflow-x:auto;border:1px solid var(--border);border-radius:6px;max-width:100%}'
    +'.lsn table{width:auto;font-size:12px}.lsn thead{position:static}'
    +'.lsn th,.lsn td{white-space:nowrap}'
    +'.lsn td.rag-r{background:#fde8e6;color:#a3221a}.lsn td.rag-a{background:#fff1d6;color:#8a4b00}.lsn td.rag-g{background:#e3f5ec;color:#11683d}'
    +'.lsn td.nd-hi{color:var(--red);font-weight:700}.lsn td.d-up{color:var(--green)}.lsn td.d-dn{color:var(--red)}'
    +'.lsn tr.lsn-small td{color:var(--muted)}'
    +'.lsn tr.lsn-tot td{font-weight:700;background:#f3f5fa;border-top:2px solid var(--border)}'
    +'.lsn-act{margin:0;padding:0 0 0 18px;font-size:12px;display:flex;flex-direction:column;gap:3px;color:var(--text)}'
    +'.lsn-act b{font-weight:700}'
    +'.lsn-foot{font-size:11px;color:var(--muted)}.lsn-foot a{color:var(--muted)}.lsn-foot a:hover{color:var(--blue)}'
    +'.lsn-empty{font-size:12px;color:var(--muted)}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  var MIN_LEADS=20, NON_LRM='(non-LRM owner)', SHEET='https://docs.google.com/spreadsheets/d/17iOry-amF9Qnw9HzMd1lsjKdj-HFvxBpP768uK-m4BU';
  var open=true; try{ open=localStorage.getItem('lrmSnapOpen')!=='0'; }catch(e){}
  var MON={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};

  function e(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function pct(a,b){ return b?a/b*100:null; }
  function f1(n){ return n===null||n===undefined||isNaN(n)?'–':(Math.round(n*10)/10).toFixed(1); }
  function sgn(n){ return n===null||isNaN(n)?'–':(n>=0?'+':'')+f1(n); }
  function i0(n){ return (Number(n)||0).toLocaleString('en-IN'); }
  function rag(p){ return p===null?'':p<70?'rag-r':p<80?'rag-a':'rag-g'; }
  function dLbl(iso){ if(!iso) return ''; var d=new Date(iso+'T12:00:00'); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); }
  function dLong(iso){ if(!iso) return ''; var d=new Date(iso+'T12:00:00'); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
  function sum(rows,f){ return rows.reduce(function(s,r){ return s+(Number(r[f])||0); },0); }
  function zsmPick(){
    var z=(typeof F!=='undefined'&&F&&F.zsms)||[]; if(!z.length) return null;
    var set={}; z.forEach(function(v){ var s=String(v).toLowerCase().trim(); set[s]=1; set[s.split('@')[0].replace(/\./g,' ')]=1; });
    return function(name){ var s=String(name||'').toLowerCase().trim(); return !!(set[s]||set[s.split('@')[0].replace(/\./g,' ')]); };
  }

  function compute(S){
    var log=S.log||[], dates=[]; log.forEach(function(r){ if(dates.indexOf(r.date)<0) dates.push(r.date); }); dates.sort();
    var cur=dates.filter(function(d){ return d<=S.today; }).pop()||dates[dates.length-1]||null;
    if(!cur) return null;
    var prev=dates.filter(function(d){ return d<cur; }).pop()||null;
    var pick=zsmPick(), filtered=false;
    var rowsFor=function(d,lvl){ var r=log.filter(function(x){ return x.date===d&&x.level===lvl; });
      if(pick){ var f=r.filter(function(x){ return pick(x.zsm); }); if(f.length){ filtered=true; return f; } } return r; };
    var key=function(r){ return r.level+'|'+r.zsm+'|'+(r.level==='TL'?r.tl:''); };
    var prevMap={}; if(prev) log.filter(function(r){ return r.date===prev; }).forEach(function(r){ prevMap[key(r)]=pct(r.cov,r.asg); });
    var Z=rowsFor(cur,'ZSM'), T=rowsFor(cur,'TL');
    var tot={asg:sum(Z,'asg'),cov:sum(Z,'cov'),cov15:sum(Z,'cov15'),nd:sum(Z,'nd'),na:sum(Z,'na')};
    tot.p=pct(tot.cov,tot.asg); tot.p15=pct(tot.cov15,tot.asg);
    var totD=null; if(prev){ var P=rowsFor(prev,'ZSM'), pp=pct(sum(P,'cov'),sum(P,'asg')); if(tot.p!==null&&pp!==null) totD=tot.p-pp; }
    var last3=dates.filter(function(d){ return d<=cur; }).slice(-3);
    var streak=last3.length===3?last3.map(function(d){ var t=rowsFor(d,'TL').slice().sort(function(a,b){ return b.under-a.under; })[0]; return t?{d:d,tl:t.tl,n:t.under}:null; }).filter(Boolean):null;
    return {cur:cur,prev:prev,Z:Z,T:T,tot:tot,totD:totD,prevMap:prevMap,key:key,streak:streak,filtered:filtered};
  }

  function covTable(C,rows,lvl){
    var small=function(r){ return r.zsm===NON_LRM||r.asg<MIN_LEADS; };
    var by=function(a,b){ var x=pct(a.cov,a.asg), y=pct(b.cov,b.asg); return (x===null?999:x)-(y===null?999:y); };
    var ord=rows.filter(function(r){ return !small(r); }).sort(by).concat(rows.filter(small).sort(by));
    var tl=lvl==='TL', hasD=!!C.prev;
    var h='<div class="lsn-tw"><table><thead><tr><th>ZSM</th>'+(tl?'<th>TL</th>':'')+'<th class="num">Leads</th><th class="num">Connected</th><th class="num">Coverage %</th>'+(hasD?'<th class="num">Δ pts</th>':'')+'<th class="num">Never Dialled</th></tr></thead><tbody>';
    ord.forEach(function(r){
      var c=pct(r.cov,r.asg), p=C.prevMap[C.key(r)], d=(c!==null&&p!=null)?c-p:null;
      h+='<tr'+(small(r)?' class="lsn-small"':'')+'><td>'+e(r.zsm)+'</td>'+(tl?'<td>'+e(r.tl)+'</td>':'')
        +'<td class="num">'+i0(r.asg)+'</td><td class="num">'+i0(r.cov)+'</td>'
        +'<td class="num '+rag(c)+'">'+(c===null?'–':f1(c)+'%')+'</td>'
        +(hasD?'<td class="num'+(d===null?'':d>=0?' d-up':' d-dn')+'">'+sgn(d)+'</td>':'')
        +'<td class="num'+(r.asg&&r.nd/r.asg>0.10?' nd-hi':'')+'">'+i0(r.nd)+'</td></tr>';
    });
    var t=C.tot;
    h+='<tr class="lsn-tot"><td>TOTAL</td>'+(tl?'<td></td>':'')+'<td class="num">'+i0(t.asg)+'</td><td class="num">'+i0(t.cov)+'</td>'
      +'<td class="num '+rag(t.p)+'">'+(t.p===null?'–':f1(t.p)+'%')+'</td>'
      +(hasD?'<td class="num'+(C.totD===null?'':C.totD>=0?' d-up':' d-dn')+'">'+sgn(C.totD)+'</td>':'')
      +'<td class="num'+(t.asg&&t.nd/t.asg>0.10?' nd-hi':'')+'">'+i0(t.nd)+'</td></tr>';
    return h+'</tbody></table></div>';
  }

  function ttTable(C,thr){
    var tt=C.Z.filter(function(r){ return r.present>0; }).sort(function(a,b){ return b.under-a.under||b.present-a.present; });
    if(!tt.length) return '<div class="lsn-empty">No present LRMs logged for '+e(dLbl(C.cur))+'.</div>';
    var P=sum(tt,'present'), U=sum(tt,'under');
    var h='<div class="lsn-tw"><table><thead><tr><th>ZSM</th><th class="num">Present</th><th class="num">&lt;'+thr+' min</th><th class="num">%</th></tr></thead><tbody>';
    tt.forEach(function(r){ h+='<tr><td>'+e(r.zsm)+'</td><td class="num">'+i0(r.present)+'</td><td class="num">'+i0(r.under)+'</td><td class="num">'+f1(pct(r.under,r.present))+'%</td></tr>'; });
    return h+'<tr class="lsn-tot"><td>TOTAL</td><td class="num">'+i0(P)+'</td><td class="num">'+i0(U)+'</td><td class="num">'+f1(pct(U,P))+'%</td></tr></tbody></table></div>';
  }

  function actions(C,thr){
    var a=[];
    C.Z.filter(function(r){ return r.zsm!==NON_LRM&&r.asg>=MIN_LEADS; })
      .sort(function(x,y){ return pct(x.cov,x.asg)-pct(y.cov,y.asg); }).slice(0,2).forEach(function(r){
        var nd=r.nd>=r.na;
        a.push('<b>'+e(r.zsm)+'</b>: '+(nd?'clear the undialled queue / fix allocation (Never Dialled-driven)':'retry no-answer leads at alternate slots (No Answer-driven)')
          +' — '+f1(pct(r.cov,r.asg))+'% coverage; ND '+i0(r.nd)+' vs NA '+i0(r.na)+' of '+i0(r.asg)+' leads');
      });
    if(C.streak&&C.streak.length){
      a.push('<b>TL talk-time</b>: highest &lt;'+thr+' count, last 3 days — '+C.streak.map(function(s){ return e(dLbl(s.d))+' '+e(s.tl)+' ('+s.n+')'; }).join(', '));
    } else {
      var t=C.T.slice().sort(function(x,y){ return y.under-x.under; })[0];
      if(t&&t.under) a.push('<b>'+e(t.tl)+'</b> ('+e(t.zsm)+'): review low talk-time LRMs — '+t.under+' of '+t.present+' present under '+thr+' min');
    }
    return a.slice(0,3);
  }

  function parseRow1(row1){
    var m=String(row1||'').match(/generated\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})/);
    if(!m||!MON[m[2].toLowerCase()]) return null;
    return {iso:m[3]+'-'+MON[m[2].toLowerCase()]+'-'+m[1].padStart(2,'0'), hh:Number(m[4]), time:m[4].padStart(2,'0')+':'+m[5]};
  }

  window.lrmSnapHTML=function(){
    if(typeof D==='undefined'||!D) return '';
    var S=D.lrmSnap;
    var shell=function(meta,body){
      return '<div class="lsn'+(open?'':' closed')+'" id="lsnBox"><div class="lsn-hd" id="lsnHd" tabindex="0" role="button" aria-expanded="'+open+'">'
        +'<h4>LRM Snapshot · 7D lead coverage</h4><span class="lsn-meta">'+meta+'</span><span class="lsn-chev">'+(open?'Hide ▴':'Show ▾')+'</span></div>'
        +'<div class="lsn-bd">'+body+'</div></div>';
    };
    if(!S||(!S.log||!S.log.length)&&!S.row1){
      var G=D.lrmSnapDiag, why;
      if(!G) why='The server is still on the old <b>api/dashboard.js</b> — push it and redeploy.';
      else if(G.error) why='Could not read the sheet: '+e(G.error);
      else if(!G.snapTab||!G.logTab) why='Tab not found: '+[!G.snapTab?'<b>Daily Snapshot</b>':'',!G.logTab?'<b>Snapshot Log</b>':''].filter(Boolean).join(' and ')
        +(G.titles?'. Tabs the server sees: '+e(G.titles.join(', ')):'');
      else why='Both tabs read, but <b>Snapshot Log</b> has no rows with a date in column A and ZSM/TL in column B ('+(G.logRows||0)+' rows read).';
      return shell('not loaded','<div class="lsn-empty">'+why+'</div>');
    }
    var g=parseRow1(S.row1), C=compute(S), ban='';
    if(!g||g.iso!==S.today) ban+='<div class="lsn-ban red">Snapshot not generated today — Apps Script did not run (row 1: '+e(S.row1||'blank')+')'+(C?'. Showing the last logged day, '+e(dLong(C.cur))+'.':'')+'</div>';
    else{
      var ist=new Date(Date.now()+5.5*3600000), nowMin=ist.getUTCHours()*60+ist.getUTCMinutes(), genMin=g.hh*60+Number(g.time.slice(3));
      if(nowMin>=10*60&&nowMin<22*60&&nowMin-genMin>130) ban+='<div class="lsn-ban amber">Hourly refresh missed — last snapshot '+e(g.time)+' IST ('+Math.round((nowMin-genMin)/60)+' h ago).</div>';
      else if(g.hh<18) ban+='<div class="lsn-note">Intraday snapshot · refreshed hourly · today\'s talk-time figures are partial-day.</div>';
    }
    (S.warns||[]).forEach(function(w){ ban+='<div class="lsn-ban red">'+e(w)+'</div>'; });
    if(!C) return shell('no log rows',ban+'<div class="lsn-empty">Snapshot Log has no dated ZSM/TL rows yet.</div>');
    var thr=(C.Z.concat(C.T).map(function(r){ return r.thr; }).filter(Boolean)[0])||75;
    var win=(String(S.row2||'').match(/(\d{1,2}-[A-Za-z]{3})\s*→\s*(\d{1,2}-[A-Za-z]{3})/)||[null,'?','?']);
    var t=C.tot;
    var head='<div class="lsn-head"><span>7D Coverage '+f1(t.p)+'%</span><span>15s+ '+f1(t.p15)+'%</span><span>Never Dialled '+i0(t.nd)+'</span><span>No Answer '+i0(t.na)+'</span>'
      +(C.totD!==null?'<span class="'+(C.totD>=0?'up':'dn')+'">'+sgn(C.totD)+' pts vs '+e(dLbl(C.prev))+'</span>':'')
      +(C.filtered?'<small>ZSM filter applied</small>':'')+'</div>';
    var acts=actions(C,thr);
    var body=ban+head
      +'<div class="lsn-grid"><div class="lsn-blk"><h5>ZSM-wise (7D '+e(win[1])+' – '+e(win[2])+')</h5>'+covTable(C,C.Z,'ZSM')+'</div>'
      +'<div class="lsn-blk"><h5>Talk time &lt;'+thr+' min · '+e(dLbl(C.cur))+' (present LRMs)</h5>'+ttTable(C,thr)+'</div></div>'
      +'<div class="lsn-blk"><h5>TL-wise (7D)</h5>'+covTable(C,C.T,'TL')+'</div>'
      +(acts.length?'<div class="lsn-blk"><h5>Actions for tomorrow</h5><ul class="lsn-act">'+acts.map(function(x){ return '<li>'+x+'</li>'; }).join('')+'</ul></div>':'')
      +'<div class="lsn-foot">'+e(String(S.row1||'').replace(/^Daily Snapshot\s*—\s*/,''))+' · <a href="'+SHEET+'" target="_blank" rel="noopener">Open sheet</a></div>';
    var meta=e(dLong(C.cur))+(g?' · generated '+e(g.time)+' IST':'')+' · coverage '+f1(t.p)+'%';
    return shell(meta,body);
  };

  window.lrmSnapWire=function(panel){
    var hd=panel&&panel.querySelector('#lsnHd'); if(!hd) return;
    var tog=function(){ open=!open; try{ localStorage.setItem('lrmSnapOpen',open?'1':'0'); }catch(err){}
      var b=panel.querySelector('#lsnBox'); b.classList.toggle('closed',!open); hd.setAttribute('aria-expanded',open);
      hd.querySelector('.lsn-chev').textContent=open?'Hide ▴':'Show ▾'; };
    hd.addEventListener('click',tog);
    hd.addEventListener('keydown',function(ev){ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); tog(); } });
  };
})();
