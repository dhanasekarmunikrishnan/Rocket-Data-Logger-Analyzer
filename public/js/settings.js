/* =======================================================
   settings.js — Settings Module
   ======================================================= */
const SettingsModule = (() => {

  async function loadStatus(){
    try{
      const res=await fetch('/api/settings/status');
      const data=await res.json();
      const banner=document.getElementById('api-key-status-banner');
      if(banner){
        if(data.hasKey){
          banner.innerHTML=`<div class="api-key-info connected">✓ Gemini API key configured${data.keyPreview?' — '+data.keyPreview:''}</div>`;
        } else {
          banner.innerHTML=`<div class="api-key-info disconnected">✗ No API key configured — AI features in fallback mode</div>`;
        }
      }
    }catch(e){ console.warn('Settings status fetch failed',e); }
  }

  async function saveApiKey(){
    const input=document.getElementById('settings-api-key');
    const key=input.value.trim();
    const status=document.getElementById('settings-status');
    if(!key){ showStatus(status,'Please enter an API key','error'); return; }
    showStatus(status,'Saving…','info');
    try{
      const res=await fetch('/api/settings/api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:key})});
      const data=await res.json();
      if(data.success){
        showStatus(status,'API key saved & activated!','saved');
        input.value='';
        loadStatus();
      } else {
        showStatus(status,data.error||'Failed to save','error');
      }
    }catch(e){ showStatus(status,'Connection error','error'); }
  }

  async function removeApiKey(){
    const status=document.getElementById('settings-status');
    try{
      const res=await fetch('/api/settings/api-key',{method:'DELETE'});
      const data=await res.json();
      if(data.success){
        showStatus(status,'API key removed','saved');
        loadStatus();
      } else {
        showStatus(status,data.error||'Failed to remove','error');
      }
    }catch(e){ showStatus(status,'Connection error','error'); }
  }

  function toggleKeyVisibility(){
    const input=document.getElementById('settings-api-key');
    const btn=document.getElementById('toggle-key-vis');
    if(input.type==='password'){ input.type='text'; btn.textContent='Hide'; }
    else { input.type='password'; btn.textContent='Show'; }
  }

  function showStatus(el,msg,cls){
    if(!el) return;
    el.className='status-text '+(cls||'');
    el.textContent=msg;
    if(cls!=='info') setTimeout(()=>{el.textContent='';},4000);
  }

  return {loadStatus,saveApiKey,removeApiKey,toggleKeyVisibility};
})();
