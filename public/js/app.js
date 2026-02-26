/* =======================================================
   app.js — Main App Controller (ApexCharts / Sky-Blue)
   ======================================================= */

/* -------- MISSION EVENTS (from anomalyDetector) -------- */
const MISSION_EVENTS={throttle_down_start:{time:48,label:'Throttle Down'},maxq:{time:54,label:'Max Q'},throttle_down_end:{time:68,label:'Throttle Up'},meco:{time:145,label:'MECO'},ses1:{time:156,label:'SES-1'}};

/* -------- STATE -------- */
let telemetryData=[], statsData=[], columnsData=[], redlineData=[];

const VIEW_TITLES={
  dashboard:'Mission Control',telemetry:'Telemetry Explorer',anomalies:'Anomaly Detection',
  analysis:'Deep Analysis',events:'Anomaly Events',chatbot:'AI Analyst',settings:'Settings'
};

/* -------- INIT -------- */
document.addEventListener('DOMContentLoaded',()=>{
  initApp();
  // Close param dropdown when clicking outside
  document.addEventListener('click',e=>{
    const dd=document.getElementById('param-dropdown');
    if(dd && !dd.contains(e.target)){
      document.getElementById('param-dropdown-toggle')?.classList.remove('open');
      document.getElementById('param-dropdown-menu')?.classList.remove('open');
    }
  });
});

async function initApp(){
  showNotification('Loading telemetry data…','info');
  try{
    const [statusRes,telRes,colRes,statsRes,rlRes]=await Promise.all([
      fetch('/api/status'),fetch('/api/telemetry'),fetch('/api/telemetry/columns'),fetch('/api/stats'),fetch('/api/redlines')
    ]);
    const status=await statusRes.json();
    telemetryData=await telRes.json();
    columnsData=await colRes.json();          // [{name,label,unit,isNumeric}]
    const statsObj=await statsRes.json();      // object keyed by param name
    statsData=Object.values(statsObj);          // → array
    const rlObj=await rlRes.json();             // object keyed by param name
    redlineData=Object.entries(rlObj).map(([k,v])=>({parameter:k,...v})); // → array with {parameter,min,max,unit,label}

    if(status.currentFile) document.getElementById('current-file').textContent=status.currentFile;
    await AnomalyModule.loadAnomalies();
    SettingsModule.loadStatus();

    renderDashboard();
    populateTelemetrySelects();
    const numericCols=columnsData.filter(c=>c.isNumeric);
    showNotification(`Loaded ${telemetryData.length} records, ${numericCols.length} parameters`,'success');
  }catch(e){
    console.error(e);
    showNotification('Failed to load data — is the server running?','error');
  }
}

/* -------- VIEW SWITCHING -------- */
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-view]').forEach(b=>b.classList.remove('active'));
  const v=document.getElementById('view-'+name); if(v) v.classList.add('active');
  const b=document.querySelector(`.nav-btn[data-view="${name}"]`); if(b) b.classList.add('active');
  document.getElementById('page-title').textContent=VIEW_TITLES[name]||name;

  // Render view content on switch
  if(name==='dashboard') renderDashboard();
  else if(name==='telemetry') loadTelemetryChart();
  else if(name==='anomalies') renderAnomaliesView();
  else if(name==='analysis') renderAnalysisView();
  else if(name==='events') renderEventsView();
  else if(name==='chatbot') ChatModule.init();
  else if(name==='settings') SettingsModule.loadStatus();
}

/* ========================================================
   DASHBOARD
   ======================================================== */
function renderDashboard(){
  const anomalies=AnomalyModule.getAnomalies();
  const events=AnomalyModule.getEvents();
  const T=k=>k.mission_time_s;  // time accessor
  const duration=telemetryData.length?T(telemetryData[telemetryData.length-1])-T(telemetryData[0]):0;

  // KPIs
  setKPI('kpi-records',telemetryData.length.toLocaleString());
  setKPI('kpi-anomalies',anomalies.length);
  setKPI('kpi-critical',anomalies.filter(a=>a.severity==='CRITICAL').length);
  setKPI('kpi-events',events.length);
  setKPI('kpi-duration',Math.round(duration)+'s');
  setKPI('kpi-params',columnsData.filter(c=>c.isNumeric).length);

  // Status indicator
  const crit=anomalies.filter(a=>a.severity==='CRITICAL').length;
  const eng=document.getElementById('engine-status');
  if(crit>0) eng.innerHTML='<span class="status-dot red"></span><span>Critical Anomalies</span>';
  else if(anomalies.length) eng.innerHTML='<span class="status-dot yellow"></span><span>Anomalies Detected</span>';
  else eng.innerHTML='<span class="status-dot green"></span><span>System Nominal</span>';

  if(!telemetryData.length) return;
  const ds=downsample(telemetryData,200);
  const labels=ds.map(d=>String(d.mission_time_s));
  const ann=buildMissionAnnotations(AnomalyModule.getRegions());

  // Velocity
  if(ds[0].velocity_ms!==undefined){
    ChartModule.createLineChart('dash-velocity-chart',labels,[{label:'Velocity',data:ds.map(d=>d.velocity_ms),color:'#0ea5e9'}],{xTitle:'Mission Time (s)',yTitle:'m/s',annotations:ann});
  }
  // Altitude
  if(ds[0].altitude_km!==undefined){
    ChartModule.createLineChart('dash-altitude-chart',labels,[{label:'Altitude',data:ds.map(d=>d.altitude_km),color:'#8b5cf6'}],{xTitle:'Mission Time (s)',yTitle:'km',annotations:ann});
  }
  // Dynamic Pressure
  if(ds[0].dynamic_pressure_pa!==undefined){
    ChartModule.createLineChart('dash-q-chart',labels,[{label:'Q',data:ds.map(d=>d.dynamic_pressure_pa),color:'#f59e0b'}],{xTitle:'Mission Time (s)',yTitle:'Pa',annotations:ann});
  }

  // Anomaly donut
  const sevCounts={CRITICAL:0,WARNING:0,CAUTION:0};
  anomalies.forEach(a=>{ if(sevCounts[a.severity]!==undefined) sevCounts[a.severity]++; });
  const sevLabels=Object.keys(sevCounts), sevData=Object.values(sevCounts);
  ChartModule.createDoughnutChart('dash-anomaly-chart',sevLabels,sevData,['#ef4444','#f59e0b','#0ea5e9']);

  // Recent events
  renderDashEvents();
}

function renderDashEvents(){
  const evts=AnomalyModule.getEvents().slice(0,5);
  const el=document.getElementById('dash-events-list'); if(!el) return;
  if(!evts.length){ el.innerHTML='<p style="color:#94a3b8;padding:12px">No events yet.</p>'; return; }
  el.innerHTML=evts.map(ev=>`<div class="event-card ${ev.severity}">
    <div class="event-header"><span class="event-id">${ev.id} <span class="severity-badge ${ev.severity}">${ev.severity}</span></span>
    <span class="event-time">T+${ev.startTime}s – T+${ev.endTime}s</span></div>
    <div style="font-size:12px;color:#64748b;margin-top:4px">${ev.count||ev.anomalies.length} anomalies — ${(ev.anomalyTypes||[...new Set(ev.anomalies.map(a=>a.type))]).join(', ')}</div>
  </div>`).join('');
}

/* ========================================================
   TELEMETRY
   ======================================================== */
let _selectedParams=new Set(['velocity_ms','altitude_km']);

function populateTelemetrySelects(){
  const menu=document.getElementById('param-dropdown-menu'); if(!menu) return;
  const numericCols=columnsData.filter(c=>c.isNumeric&&c.name!=='mission_time_s');

  let html=numericCols.map(c=>{
    const checked=_selectedParams.has(c.name)?'checked':'';
    const sel=_selectedParams.has(c.name)?' selected':'';
    return `<label class="param-dropdown-item${sel}" data-param="${c.name}">`
      +`<input type="checkbox" ${checked} onchange="toggleParam('${c.name}',this)">`
      +`<span class="param-dropdown-item-label">${c.label||c.name}</span>`
      +(c.unit?`<span class="param-dropdown-item-unit">${c.unit}</span>`:'')
      +`</label>`;
  }).join('');

  html+=`<div class="param-dropdown-actions">`
    +`<button class="select-all" onclick="paramSelectAll()">Select All</button>`
    +`<button onclick="paramDeselectAll()">Clear All</button></div>`;
  menu.innerHTML=html;
  updateDropdownLabel();

  // Update time range sliders
  if(telemetryData.length){
    const maxT=telemetryData[telemetryData.length-1].mission_time_s;
    document.getElementById('time-start').max=maxT;
    document.getElementById('time-end').max=maxT;
    document.getElementById('time-end').value=maxT;
    updateTimeRange();
  }
}

function toggleParamDropdown(){
  const toggle=document.getElementById('param-dropdown-toggle');
  const menu=document.getElementById('param-dropdown-menu');
  toggle.classList.toggle('open');
  menu.classList.toggle('open');
}

function toggleParam(name,cb){
  if(cb.checked) _selectedParams.add(name); else _selectedParams.delete(name);
  const item=cb.closest('.param-dropdown-item');
  if(item) item.classList.toggle('selected',cb.checked);
  updateDropdownLabel();
}

function paramSelectAll(){
  const menu=document.getElementById('param-dropdown-menu');
  menu.querySelectorAll('input[type="checkbox"]').forEach(cb=>{cb.checked=true;const n=cb.closest('.param-dropdown-item').dataset.param;_selectedParams.add(n);cb.closest('.param-dropdown-item').classList.add('selected');});
  updateDropdownLabel();
}

function paramDeselectAll(){
  const menu=document.getElementById('param-dropdown-menu');
  menu.querySelectorAll('input[type="checkbox"]').forEach(cb=>{cb.checked=false;cb.closest('.param-dropdown-item').classList.remove('selected');});
  _selectedParams.clear();
  updateDropdownLabel();
}

function updateDropdownLabel(){
  const lbl=document.getElementById('param-dropdown-label');
  const n=_selectedParams.size;
  if(n===0) lbl.innerHTML='Select Metrics';
  else if(n<=2){
    const colMap=Object.fromEntries(columnsData.map(c=>[c.name,c.label||c.name]));
    lbl.innerHTML=[..._selectedParams].map(p=>colMap[p]||p).join(', ')+`<span class="param-dropdown-count">${n}</span>`;
  } else lbl.innerHTML=`${n} metrics selected<span class="param-dropdown-count">${n}</span>`;
}

function updateTimeRange(){
  const s=parseInt(document.getElementById('time-start').value);
  const e=parseInt(document.getElementById('time-end').value);
  document.getElementById('time-range-label').textContent=`${s}s – ${e}s`;
}

function loadTelemetryChart(){
  const params=[..._selectedParams];
  if(!params.length) return;
  const s=parseInt(document.getElementById('time-start').value);
  const e=parseInt(document.getElementById('time-end').value);
  const filtered=telemetryData.filter(d=>d.mission_time_s>=s&&d.mission_time_s<=e);
  const ds=downsample(filtered,300);
  const labels=ds.map(d=>String(d.mission_time_s));
  const ann=buildMissionAnnotations(AnomalyModule.getRegions());

  const colMap=Object.fromEntries(columnsData.map(c=>[c.name,c.label||c.name]));
  const datasets=params.map((p,i)=>({label:colMap[p]||p,data:ds.map(d=>d[p]),color:ChartModule.COLORS[i%ChartModule.COLORS.length]}));
  ChartModule.createLineChart('telemetry-main-chart',labels,datasets,{xTitle:'Mission Time (s)',yTitle:params.map(p=>colMap[p]||p).join(', '),annotations:ann});

  renderParamCards(params);
}

function plotAllParams(){
  const keyParams=['velocity_ms','altitude_km','acceleration_ms2','dynamic_pressure_pa','mach_number','angle_deg'];
  _selectedParams=new Set(keyParams);
  const menu=document.getElementById('param-dropdown-menu');
  if(menu) menu.querySelectorAll('.param-dropdown-item').forEach(item=>{
    const p=item.dataset.param;
    const cb=item.querySelector('input[type="checkbox"]');
    if(cb){cb.checked=keyParams.includes(p);item.classList.toggle('selected',cb.checked);}
  });
  updateDropdownLabel();
  loadTelemetryChart();
}

function renderParamCards(highlight){
  const el=document.getElementById('param-cards'); if(!el) return;
  const colMap=Object.fromEntries(columnsData.map(c=>[c.name,c.label||c.name]));
  el.innerHTML=statsData.map(s=>{
    const hl=highlight&&highlight.includes(s.parameter)?'border:2px solid #0ea5e9':'';
    return `<div class="param-card" style="${hl}" onclick="selectParam('${s.parameter}')">
      <div class="pname">${colMap[s.parameter]||s.parameter}</div>
      <div class="pstats">
        <span>Min</span><strong>${fmt(s.min)}</strong>
        <span>Max</span><strong>${fmt(s.max)}</strong>
        <span>Mean</span><strong>${fmt(s.mean)}</strong>
        <span>Std</span><strong>${fmt(s.std)}</strong>
      </div>
    </div>`;
  }).join('');
}

function selectParam(p){
  _selectedParams=new Set([p]);
  const menu=document.getElementById('param-dropdown-menu');
  if(menu) menu.querySelectorAll('.param-dropdown-item').forEach(item=>{
    const cb=item.querySelector('input[type="checkbox"]');
    if(cb){cb.checked=(item.dataset.param===p);item.classList.toggle('selected',cb.checked);}
  });
  updateDropdownLabel();
  loadTelemetryChart();
}

/* ========================================================
   ANOMALIES VIEW
   ======================================================== */
function renderAnomaliesView(){
  AnomalyModule.renderSummaryBar('anomaly-summary-bar');
  AnomalyModule.renderTimeline('anomaly-timeline-chart',AnomalyModule.currentFilter);
  AnomalyModule.renderTable(AnomalyModule.currentFilter);
}

/* ========================================================
   ANALYSIS VIEW
   ======================================================== */
function renderAnalysisView(){
  if(!telemetryData.length) return;
  const ds=downsample(telemetryData,250);
  const labels=ds.map(d=>String(d.mission_time_s));
  const ann=buildMissionAnnotations(AnomalyModule.getRegions());

  // Scatter: Velocity vs Altitude
  if(ds[0].velocity_ms!==undefined&&ds[0].altitude_km!==undefined){
    ChartModule.createScatterChart('analysis-scatter-chart',[{label:'Velocity vs Altitude',data:ds.map(d=>({x:d.velocity_ms,y:d.altitude_km})),color:'#0ea5e9',pointRadius:2.5}],{xTitle:'Velocity (m/s)',yTitle:'Altitude (km)'});
  }
  // Acceleration
  if(ds[0].acceleration_ms2!==undefined){
    ChartModule.createLineChart('analysis-accel-chart',labels,[{label:'Acceleration',data:ds.map(d=>d.acceleration_ms2),color:'#ef4444'}],{xTitle:'Mission Time (s)',yTitle:'m/s²',annotations:ann});
  }
  // Mach + Q
  if(ds[0].mach_number!==undefined&&ds[0].dynamic_pressure_pa!==undefined){
    ChartModule.createLineChart('analysis-mach-chart',labels,[
      {label:'Mach',data:ds.map(d=>d.mach_number),color:'#8b5cf6'},
      {label:'Q (Pa)',data:ds.map(d=>d.dynamic_pressure_pa),color:'#f59e0b'}
    ],{xTitle:'Mission Time (s)',yTitle:'Mach',y1:true,y1Title:'Pa',annotations:ann});
  }
  // Angle
  if(ds[0].angle_deg!==undefined){
    ChartModule.createLineChart('analysis-angle-chart',labels,[{label:'Flight Angle',data:ds.map(d=>d.angle_deg),color:'#14b8a6'}],{xTitle:'Mission Time (s)',yTitle:'degrees',annotations:ann});
  }

  // Stats table
  renderStatsTable();
}

function renderStatsTable(){
  const tb=document.getElementById('stats-table-body'); if(!tb) return;
  const colMap=Object.fromEntries(columnsData.map(c=>[c.name,c.label||c.name]));
  tb.innerHTML=statsData.map(s=>{
    const rl=redlineData.find(r=>r.parameter===s.parameter);
    const exceedsLow=rl&&s.min<rl.min;
    const exceedsHigh=rl&&s.max>rl.max;
    const status=exceedsLow||exceedsHigh?'EXCEEDED':'OK';
    return `<tr>
      <td style="font-weight:600">${colMap[s.parameter]||s.parameter}</td>
      <td class="mono">${fmt(s.min)}</td><td class="mono">${fmt(s.max)}</td><td class="mono">${fmt(s.mean)}</td><td class="mono">${fmt(s.std)}</td><td class="mono">${fmt(s.median)}</td>
      <td class="mono">${rl?fmt(rl.min):'–'}</td><td class="mono">${rl?fmt(rl.max):'–'}</td>
      <td><span class="${status==='OK'?'status-ok':'status-crit'}">${status}</span></td>
    </tr>`;
  }).join('');
}

/* ========================================================
   EVENTS VIEW
   ======================================================== */
function renderEventsView(){
  AnomalyModule.renderEventsList('events-container');
}

/* ========================================================
   FILE UPLOAD
   ======================================================== */
async function uploadCSV(input){
  const file=input.files[0]; if(!file) return;
  showNotification('Uploading '+file.name+'…','info');
  const fd=new FormData(); fd.append('csvFile',file);
  try{
    const res=await fetch('/api/upload',{method:'POST',body:fd});
    const data=await res.json();
    if(data.success){
      showNotification(`Loaded ${data.records||data.recordCount||'?'} records from ${data.filename}`,'success');
      document.getElementById('current-file').textContent=data.filename;
      // Reload everything
      const [telRes,colRes,sRes,rlRes]=await Promise.all([
        fetch('/api/telemetry'),fetch('/api/telemetry/columns'),fetch('/api/stats'),fetch('/api/redlines')
      ]);
      telemetryData=await telRes.json(); columnsData=await colRes.json();
      const sObj=await sRes.json(); statsData=Object.values(sObj);
      const rObj=await rlRes.json(); redlineData=Object.entries(rObj).map(([k,v])=>({parameter:k,...v}));
      await AnomalyModule.loadAnomalies();
      populateTelemetrySelects();
      renderDashboard();
    } else {
      showNotification(data.error||'Upload failed','error');
    }
  }catch(e){ showNotification('Upload failed','error'); }
  input.value='';
}

/* ========================================================
   HELPERS
   ======================================================== */
function buildMissionAnnotations(regions){
  const ann=ChartModule.buildAnnotations(regions);
  for(const [key,ev] of Object.entries(MISSION_EVENTS)){
    ann['event_'+key]={type:'line',xMin:String(ev.time),xMax:String(ev.time),borderColor:'#64748b',borderDash:[5,3],label:{content:ev.label,color:'#fff',backgroundColor:'#64748b'}};
  }
  return ann;
}

function downsample(data,max){
  if(data.length<=max) return data;
  const step=Math.ceil(data.length/max);
  return data.filter((_,i)=>i%step===0);
}

function setKPI(id,val){ const el=document.getElementById(id); if(el) el.textContent=val; }
function fmt(v){ return typeof v==='number'?v.toLocaleString(undefined,{maximumFractionDigits:2}):v; }

function showNotification(msg,type){
  const el=document.createElement('div');
  el.className='notification '+type;
  el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .3s';setTimeout(()=>el.remove(),300);},3500);
}
