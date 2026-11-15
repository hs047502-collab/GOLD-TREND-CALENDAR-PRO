/* ---------- license state (rewritten: the SERVER is the source of truth) ---------- */
let LIC=null;
function licenseState(){
  if(LIC&&LIC.ok){
    if(LIC.expiry&&TODAY>LIC.expiry){ LIC={ok:false,expired:true}; return LIC; }
    if(LIC.offlineUntil&&iso(new Date())>LIC.offlineUntil){ LIC=null; }   /* grace over → re-read below */
    else return LIC;
  }
  const st=licSessionState();
  if(st&&st.device){
    return (LIC={ok:false,device:true,gmail:st.gmail,plan:(parseKey(st.key)||{}).plan,
      err:'This licence was activated on another device.'});
  }
  if(st&&st.ok){
    const p=st.payload;
    return (LIC={ok:true,gmail:st.gmail,key:st.key,plan:p.p,expiry:p.x?new Date(p.x+'T00:00:00'):null,
      offline:true,offlineUntil:st.offlineUntil,stale:st.stale});
  }
  /* no usable token: trial, or locked */
  const tr=trialState();
  const blocked=localStorage.getItem(LS+'_blocked')==='1'||!!tr.everLicensed;
  if(!tr.expired&&!tr.frozen&&!blocked){ LIC={ok:true,trial:true,plan:'trial',days:tr.left,left:tr.left,gmail:'trial'}; return LIC; }
  LIC={ok:false,trial:tr,frozen:tr.frozen,blocked,everLicensed:tr.everLicensed,
       err:tr.frozen?'System clock was rolled back — trial disabled.':(tr.expired?'Your trial period has ended.':'License not activated.')};
  return LIC;
}

/* activation now needs the network — the server decides, then issues a token */
async function activateRemote(gmail,key){
  const sp=splitActivation(gmail,key);
  gmail=normMail(sp.gmail); key=String(sp.key||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(gmail)) return {ok:false,err:'Enter the Gmail you bought with.'};
  const p=parseKey(key);
  if(!p.ok) return {ok:false,err:p.err};
  const r=await licPost('/v1/activate',{gmail,key,fp:deviceFP()});
  if(r.ok&&r.token){
    licSaveToken({gmail,key,token:r.token});
    localStorage.removeItem(LS+'_blocked');
    try{ localStorage.setItem(LS+'_issued',JSON.stringify([].concat(issued(),[{key,mail:gmail,plan:r.plan,date:iso(TODAY),days:p.days,by:'server'}]))); }catch(e){}
    LIC={ok:true,gmail,key,plan:r.plan,expiry:r.expiry?new Date(r.expiry+'T00:00:00'):null,offlineUntil:r.offlineUntil};
    lockHeader();                                   /* badge flips to the plan immediately */
    logActivation(LIC); reportActivation(LIC);
    return LIC;
  }
  if(r.noconf||r.offline) return {ok:false,err:r.err||'License server unreachable.'};
  return {ok:false,err:r.err||'Activation refused.'};
}
/* kept so older call-sites do not crash: now simply async + server-checked */
function activate(gmail,key){
  return new Promise(res=>{
    activateRemote(gmail,key).then(v=>{
      if(!v.ok){ toast('⚠️ '+(v.err||'Invalid key')); res(false); return; }
      const pn=(typeof planOf==='function'?planOf(v.plan):PLANS.find(x=>x.id===v.plan))||{n:v.plan};
      toast('✅ '+pn.n+' activated'+(v.expiry?' — until '+fmtDate(v.expiry,true):' — lifetime'));
      lockUI(false); res(true);
    });
  });
}
