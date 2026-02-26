/* =======================================================
   anomaly.js — Anomaly Module (ApexCharts version)
   ======================================================= */
const AnomalyModule = (() => {
  let anomalies=[], events=[], regions=[], currentFilter='all';

  async function loadAnomalies(){
    try{
      const [aRes,eRes]=await Promise.all([fetch('/api/anomalies'),fetch('/api/anomalies/events')]);
      anomalies=await aRes.json(); events=await eRes.json();
      regions=buildRegions(anomalies);
      updateBadge();
    }catch(e){ console.warn('Failed to load anomalies',e); }
  }

  function buildRegions(list){
    if(!list.length) return [];
    const out=[];let cur=null;
    const sorted=[...list].sort((a,b)=>a.missionTime-b.missionTime);
    sorted.forEach(a=>{
      if(!cur||a.missionTime-cur.end>5){
        if(cur) out.push(cur);
        cur={start:a.missionTime,end:a.missionTime,severity:a.severity,count:1,types:new Set([a.type])};
      } else {
        cur.end=a.missionTime; cur.count++;
        cur.types.add(a.type);
        if(a.severity==='CRITICAL') cur.severity='CRITICAL';
        else if(a.severity==='WARNING'&&cur.severity!=='CRITICAL') cur.severity='WARNING';
      }
    });
    if(cur) out.push(cur);
    return out;
  }

  function updateBadge(){
    const b=document.getElementById('anomaly-badge');
    if(b){ b.textContent=anomalies.length; b.style.display=anomalies.length?'flex':'none'; }
  }

  function getAnomalies(filter){
    if(!filter||filter==='all') return anomalies;
    return anomalies.filter(a=>a.severity===filter);
  }
  function getEvents(){ return events; }
  function getRegions(){ return regions; }

  /* Render anomaly summary bar */
  function renderSummaryBar(containerId){
    const el=document.getElementById(containerId); if(!el) return;
    const crit=anomalies.filter(a=>a.severity==='CRITICAL').length;
    const warn=anomalies.filter(a=>a.severity==='WARNING').length;
    const caut=anomalies.filter(a=>a.severity==='CAUTION').length;
    el.innerHTML=`
      <div class="kpi-card"><div class="kpi-icon blue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div><div class="kpi-body"><span class="kpi-label">Total</span><span class="kpi-value">${anomalies.length}</span></div></div>
      <div class="kpi-card"><div class="kpi-icon red"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="kpi-body"><span class="kpi-label">Critical</span><span class="kpi-value">${crit}</span></div></div>
      <div class="kpi-card"><div class="kpi-icon amber"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg></div><div class="kpi-body"><span class="kpi-label">Warning</span><span class="kpi-value">${warn}</span></div></div>
      <div class="kpi-card"><div class="kpi-icon teal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="kpi-body"><span class="kpi-label">Caution</span><span class="kpi-value">${caut}</span></div></div>
      <div class="kpi-card"><div class="kpi-icon purple"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></div><div class="kpi-body"><span class="kpi-label">Events</span><span class="kpi-value">${events.length}</span></div></div>
    `;
  }

  /* Render anomaly table */
  function renderTable(filter){
    const list=getAnomalies(filter);
    const tb=document.getElementById('anomaly-table-body'); if(!tb) return;
    if(!list.length){ tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:32px">No anomalies detected</td></tr>'; return; }
    tb.innerHTML=list.map(a=>`<tr>
      <td><span class="severity-badge ${a.severity}">${a.severity}</span></td>
      <td>${a.type||''}</td>
      <td>${a.paramLabel||a.parameter}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${typeof a.value==='number'?a.value.toFixed(2):a.value}${a.unit?' '+a.unit:''}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:12px">T+${a.missionTime}s</td>
      <td style="font-size:12px">${a.description||''}</td>
      <td><button class="btn-view" onclick="AnomalyModule.viewChart('${a.parameter}',${a.missionTime})">View</button></td>
    </tr>`).join('');
  }

  /* Render anomaly timeline bar chart */
  function renderTimeline(containerId, filter){
    const list=getAnomalies(filter);
    if(!list.length){ document.getElementById(containerId).innerHTML='<p style="text-align:center;padding:40px;color:#94a3b8">No anomalies to display</p>'; return; }
    const bins={};
    list.forEach(a=>{ const k=Math.floor(a.missionTime/10)*10; bins[k]=(bins[k]||0)+1; });
    const labels=Object.keys(bins).sort((a,b)=>a-b);
    const data=labels.map(k=>bins[k]);
    const colors=labels.map(k=>{
      const mx=list.filter(a=>Math.floor(a.missionTime/10)*10==k).reduce((s,a)=>a.severity==='CRITICAL'?'CRITICAL':a.severity==='WARNING'&&s!=='CRITICAL'?'WARNING':s,'CAUTION');
      return mx==='CRITICAL'?'#ef4444':mx==='WARNING'?'#f59e0b':'#0ea5e9';
    });
    ChartModule.createBarChart(containerId, labels.map(l=>l+'s'), [{label:'Anomalies',data,color:'#0ea5e9'}], {xTitle:'Mission Time',yTitle:'Count',hideLegend:true});
  }

  /* View anomaly in chart modal */
  function viewChart(param, time){
    let overlay=document.querySelector('.modal-overlay');
    if(overlay) overlay.remove();
    overlay=document.createElement('div');
    overlay.className='modal-overlay';
    overlay.onclick=e=>{ if(e.target===overlay) overlay.remove(); };
    overlay.innerHTML=`<div class="modal-card"><div class="modal-head"><h3>${param} around T+${time}s</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div><div id="anomaly-zoom-chart" class="chart-area chart-tall"></div></div>`;
    document.body.appendChild(overlay);

    // Fetch data around anomaly
    const t0=Math.max(0,time-30), t1=time+30;
    fetch(`/api/telemetry?startTime=${t0}&endTime=${t1}`).then(r=>r.json()).then(data=>{
      if(!data.length) return;
      const labels=data.map(d=>d.mission_time_s);
      const vals=data.map(d=>d[param]);
      const annotations={};
      annotations['anomaly_line']={type:'line',xMin:String(time),xMax:String(time),borderColor:'#ef4444',borderDash:[0],label:{content:'Anomaly',color:'#fff',backgroundColor:'#ef4444'}};
      ChartModule.createLineChart('anomaly-zoom-chart',labels,[{label:param,data:vals,color:'#0ea5e9'}],{xTitle:'Mission Time (s)',yTitle:param,annotations,hideLegend:true});
    }).catch(e=>console.error(e));
  }

  /* Render events list */
  function renderEventsList(containerId){
    const el=document.getElementById(containerId); if(!el) return;
    if(!events.length){ el.innerHTML='<div class="card" style="text-align:center;color:#94a3b8;padding:40px">No anomaly events detected</div>'; return; }
    el.innerHTML=events.map(ev=>{
      const params=ev.affectedParams||[...new Set(ev.anomalies.map(a=>a.paramLabel||a.parameter))];
      return `<div class="event-card ${ev.severity}">
        <div class="event-header">
          <span class="event-id">${ev.id} <span class="severity-badge ${ev.severity}">${ev.severity}</span></span>
          <span class="event-time">T+${ev.startTime}s – T+${ev.endTime}s</span>
        </div>
        <div class="event-params">${params.map(p=>`<span class="event-param-tag">${p}</span>`).join('')}</div>
        <div class="event-details">${ev.anomalies.slice(0,4).map(a=>`<div class="event-anomaly-item"><span class="severity-badge ${a.severity}">${a.severity}</span> ${a.description||''}</div>`).join('')}
        ${ev.anomalies.length>4?`<div style="font-size:11px;color:#94a3b8;margin-top:4px">+ ${ev.anomalies.length-4} more anomalies</div>`:''}</div>
      </div>`;
    }).join('');
  }

  return {loadAnomalies,getAnomalies,getEvents,getRegions,renderSummaryBar,renderTable,renderTimeline,viewChart,renderEventsList,
    set currentFilter(v){currentFilter=v}, get currentFilter(){return currentFilter}};
})();

/* Global filter function called from HTML */
function filterAnomalies(sev,btn){
  document.querySelectorAll('.fpill').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  AnomalyModule.currentFilter=sev;
  AnomalyModule.renderTable(sev);
  AnomalyModule.renderTimeline('anomaly-timeline-chart',sev);
}
