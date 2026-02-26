/* =======================================================
   charts.js — ApexCharts wrapper (sky-blue theme)
   ======================================================= */
const ChartModule = (() => {
  const instances = {};
  const COLORS = ['#0ea5e9','#06b6d4','#14b8a6','#f59e0b','#ef4444','#8b5cf6','#f97316','#ec4899','#6366f1','#84cc16','#e11d48','#0284c7'];
  const font = "'DM Sans', system-ui, sans-serif";

  function destroyChart(id){ if(instances[id]){ try{instances[id].destroy()}catch(e){} delete instances[id]; } }
  function getColor(i){ return COLORS[i % COLORS.length]; }

  /* Convert annotation objects (Chart.js style) → ApexCharts xaxis annotations */
  function toApexAnnotations(annotations){
    if(!annotations) return [];
    const out = [];
    for(const [,a] of Object.entries(annotations)){
      if(a.type==='box'){
        out.push({ x:parseFloat(a.xMin), x2:parseFloat(a.xMax),
          fillColor: a.backgroundColor||'rgba(14,165,233,.08)', opacity:1, borderColor:'transparent' });
      } else if(a.type==='line'){
        out.push({ x:parseFloat(a.xMin), borderColor:a.borderColor||'#94a3b8',
          strokeDashArray: a.borderDash?a.borderDash[0]:0,
          label: a.label?{ text:a.label.content||'', orientation:'horizontal',
            style:{color:'#fff',background:a.borderColor||'#64748b',fontSize:'10px',padding:{left:4,right:4,top:2,bottom:2}}}:undefined
        });
      }
    }
    return out;
  }

  /* ---- LINE / AREA CHART ---- */
  function createLineChart(containerId, labels, datasets, options={}){
    destroyChart(containerId);
    const el=document.getElementById(containerId); if(!el) return null; el.innerHTML='';

    const nums=labels.map(Number);
    const series=datasets.map((d,i)=>({ name:d.label||`Series ${i+1}`, data:d.data.map((v,j)=>({x:nums[j],y:v??null})) }));
    const hasY1=options.y1 && datasets.length>=2;

    const yaxis=hasY1?[
      {title:{text:options.yTitle||'',style:{fontSize:'12px',fontFamily:font}},labels:{formatter:v=>v!=null?v.toFixed(1):'',style:{fontSize:'11px'}}},
      {opposite:true,title:{text:options.y1Title||'',style:{fontSize:'12px',fontFamily:font}},labels:{formatter:v=>v!=null?v.toFixed(1):'',style:{fontSize:'11px'}}}
    ]:[{title:{text:options.yTitle||'',style:{fontSize:'12px',fontFamily:font}},labels:{formatter:v=>v!=null?v.toFixed(1):'',style:{fontSize:'11px'}}}];

    const cfg={
      chart:{type:'area',height:'100%',background:'transparent',fontFamily:font,
        toolbar:{show:true,tools:{download:false,selection:true,zoom:true,zoomin:true,zoomout:true,pan:true,reset:true}},
        animations:{enabled:true,easing:'easeinout',speed:700,dynamicAnimation:{speed:350}},
        zoom:{enabled:true,type:'x'}},
      series,
      xaxis:{type:'numeric',title:{text:options.xTitle||'',style:{fontSize:'12px',fontFamily:font}},
        labels:{formatter:v=>Math.round(v),style:{fontSize:'11px'}},tickAmount:options.maxTicksX||12},
      yaxis,
      annotations:{xaxis:toApexAnnotations(options.annotations)},
      colors:datasets.map((d,i)=>d.color||getColor(i)),
      stroke:{curve:'smooth',width:datasets.length>3?1.5:2.2},
      fill:{type:'gradient',gradient:{shadeIntensity:1,opacityFrom:0.4,opacityTo:0.05,stops:[0,92,100]}},
      dataLabels:{enabled:false},
      tooltip:{theme:'light',x:{formatter:v=>`T+${v}s`},style:{fontSize:'12px',fontFamily:font}},
      grid:{borderColor:'rgba(0,0,0,0.05)',strokeDashArray:3,padding:{left:8,right:8}},
      legend:{position:'top',fontSize:'12px',fontFamily:font,markers:{width:8,height:8,radius:2}}
    };
    if(options.hideLegend) cfg.legend.show=false;
    const c=new ApexCharts(el,cfg); c.render(); instances[containerId]=c; return c;
  }

  /* ---- BAR CHART ---- */
  function createBarChart(containerId, labels, datasets, options={}){
    destroyChart(containerId);
    const el=document.getElementById(containerId); if(!el) return null; el.innerHTML='';

    const series=datasets.map((d,i)=>({name:d.label||`Series ${i+1}`,data:d.data}));
    const cfg={
      chart:{type:'bar',height:'100%',stacked:!!options.stacked,background:'transparent',fontFamily:font,
        toolbar:{show:false},animations:{enabled:true,easing:'easeinout',speed:600}},
      series,
      xaxis:{categories:labels,title:{text:options.xTitle||''},labels:{style:{fontSize:'10px'},rotate:0,maxHeight:40},tickAmount:15},
      yaxis:{title:{text:options.yTitle||''}},
      colors:datasets.map((d,i)=>d.color||getColor(i)),
      plotOptions:{bar:{borderRadius:3,columnWidth:'55%'}},
      dataLabels:{enabled:false},
      tooltip:{theme:'light'},
      grid:{borderColor:'rgba(0,0,0,0.05)',strokeDashArray:3},
      legend:{position:'top',fontSize:'12px',fontFamily:font}
    };
    if(options.hideLegend) cfg.legend.show=false;
    const c=new ApexCharts(el,cfg); c.render(); instances[containerId]=c; return c;
  }

  /* ---- SCATTER CHART ---- */
  function createScatterChart(containerId, datasets, options={}){
    destroyChart(containerId);
    const el=document.getElementById(containerId); if(!el) return null; el.innerHTML='';

    const series=datasets.map((d,i)=>({name:d.label||`Series ${i+1}`,data:d.data.map(p=>({x:p.x,y:p.y}))}));
    const cfg={
      chart:{type:'scatter',height:'100%',background:'transparent',fontFamily:font,
        toolbar:{show:false},zoom:{enabled:true,type:'xy'},animations:{enabled:true}},
      series,
      xaxis:{title:{text:options.xTitle||''},tickAmount:10,labels:{style:{fontSize:'11px'}}},
      yaxis:{title:{text:options.yTitle||''},labels:{style:{fontSize:'11px'}}},
      colors:datasets.map((d,i)=>d.color||getColor(i)),
      markers:{size:datasets[0]?.pointRadius||3,strokeWidth:0},
      tooltip:{theme:'light'},
      grid:{borderColor:'rgba(0,0,0,0.05)',strokeDashArray:3}
    };
    const c=new ApexCharts(el,cfg); c.render(); instances[containerId]=c; return c;
  }

  /* ---- DONUT CHART ---- */
  function createDoughnutChart(containerId, labels, data, colors, options={}){
    destroyChart(containerId);
    const el=document.getElementById(containerId); if(!el) return null; el.innerHTML='';

    const cfg={
      chart:{type:'donut',height:'100%',background:'transparent',fontFamily:font,
        animations:{enabled:true,easing:'easeinout',speed:700}},
      series:data,
      labels,
      colors:colors||labels.map((_,i)=>getColor(i)),
      plotOptions:{pie:{donut:{size:'68%',labels:{show:true,total:{show:true,label:'Total',fontSize:'14px',fontWeight:600,color:'#475569'}}}}},
      dataLabels:{enabled:false},
      legend:{position:'bottom',fontSize:'12px',fontFamily:font},
      stroke:{show:true,width:3,colors:['#fff']},
      tooltip:{theme:'light'}
    };
    if(options.hideLegend) cfg.legend.show=false;
    const c=new ApexCharts(el,cfg); c.render(); instances[containerId]=c; return c;
  }

  /* ---- BUILD ANNOTATIONS (same API as before) ---- */
  function buildAnnotations(anomalyRegions, redlines){
    const ann={};
    if(anomalyRegions){
      anomalyRegions.forEach((r,i)=>{
        const clr=r.severity==='CRITICAL'?'rgba(239,68,68,.10)':r.severity==='WARNING'?'rgba(245,158,11,.10)':'rgba(14,165,233,.10)';
        ann['region_'+i]={type:'box',xMin:r.start,xMax:r.end,backgroundColor:clr};
      });
    }
    return ann;
  }

  function getInstances(){ return instances; }
  return {createLineChart,createBarChart,createScatterChart,createDoughnutChart,destroyChart,buildAnnotations,getInstances,COLORS};
})();
