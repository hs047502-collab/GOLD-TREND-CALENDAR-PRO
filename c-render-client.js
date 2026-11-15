/* buyer-side activation: online check + clear messages, owner-side key issue/
   extend/revoke all go through the license server (the app cannot mint keys) */
function doActivate(){
  const sp=splitActivation(document.getElementById('licMail').value,document.getElementById('licKey').value);
  const g=sp.gmail, k=sp.key, msg=document.getElementById('licMsg');
  document.getElementById('licMail').value=g; document.getElementById('licKey').value=k;   /* show what was detected */
  msg.style.color='var(--muted)'; msg.textContent='⏳ checking with the license server…';
  activateRemote(g,k).then(v=>{
    if(!v.ok){ msg.style.color='var(--danger)'; msg.textContent='❌ '+(v.err||'Activation refused.'); return; }
    msg.style.color='var(--success)'; msg.textContent='✅ Activated!';
    lockUI(false); lockHeader();
    setTimeout(()=>{lockUI(false);renderAll();lockHeader();},450);
  });
}
/* ---------------------------------------------------------------- owner ---
   No key is ever created in this file. The owner console logs in to the
   license server and asks IT to issue / extend / revoke. The owner session
   token lives in memory + localStorage and expires after 12 hours. */
function ownerSession(){ const t=localStorage.getItem(LIC_OWNER_LS)||''; return t; }
function ownerEndpointsOk(){ return licConfigured(); }
function ownerLogin(pw){
  return licPost('/v1/owner/login',{password:String(pw||'')}).then(r=>{
    if(r.ok&&r.session){ localStorage.setItem(LIC_OWNER_LS,String(r.session)); ADM=true; return {ok:true}; }
    return {ok:false,err:r.err||'Login failed.'};
  });
}
function ownerLogout(){ localStorage.removeItem(LIC_OWNER_LS); ADM=false; OWNER_ROWS=[]; }
let OWNER_ROWS=[];   /* last register pulled from the server */
function ownerPull(){
  return licGet('/v1/owner/list',ownerSession()).then(r=>{
    if(r.ok&&Array.isArray(r.rows)){ OWNER_ROWS=r.rows.map(x=>Object.assign({},x,{mail:normMail(x.mail)})); return {ok:true,rows:OWNER_ROWS}; }
    if(r.err&&/session/i.test(r.err)){ ownerLogout(); }
    return {ok:false,err:r.err||'Could not load the register.'};
  });
}
function ownerIssue(req){
  return licPost('/v1/owner/issue',req,ownerSession()).then(r=>{
    if(r.ok){ const l=issued(); (r.keys||[]).forEach(k=>l.push({key:k,mail:normMail(req.gmail),name:req.name||'',plan:r.plan,date:iso(TODAY),days:r.days,by:'server'})); setIssued(l); ownerPull(); }
    return r;
  });
}
function ownerExtend(req){
  return licPost('/v1/owner/extend',req,ownerSession()).then(r=>{ if(r.ok)ownerPull(); return r; });
}
function ownerRevoke(req){
  return licPost('/v1/owner/revoke',req,ownerSession()).then(r=>{ if(r.ok)ownerPull(); return r; });
}
function renderOwnerKeys(){
  const bn=S.settings.lang==='bn', on=!!ownerSession();
  document.getElementById('ownerPane').innerHTML=`
  ${on?`<div class="grid2" style="align-items:start">
    <div class="blk"><div class="bt">⚡ ${bn?'লাইসেন্স কি তৈরি করুন (সার্ভারে)':'Issue a license key (on the server)'}</div>
      <label class="lb">${bn?'বায়ারের নাম':'Buyer name'}</label>
      <input id="kgName" style="width:100%" placeholder="${bn?'যে কিনছে তার নাম':'who is buying'}">
      <label class="lb" style="margin-top:8px">${bn?'বায়ারের Gmail':'Buyer Gmail'} <span style="color:var(--danger)">*</span></label>
      <input id="kgMail" style="width:100%" placeholder="buyer@gmail.com" onkeydown="if(event.key==='Enter')genKeys()">
      <label class="lb" style="margin-top:8px">${bn?'প্ল্যান':'Plan'}</label>
      <select id="kgPlan" style="width:100%" onchange="kgSyncDays()">${allPlans().filter(p=>p.id!=='trial').map(p=>`<option value="${p.id}">${p.n} — ${p.days?p.days+' '+(bn?'দিন':'days'):(bn?'আজীবন':'lifetime')} (৳${p.bdt} / $${p.usd})</option>`).join('')}</select>
      <div class="grid2" style="gap:8px;margin-top:8px">
        <div><label class="lb">${bn?'মেয়াদ (দিন), ০ = আজীবন':'Validity days, 0 = lifetime'}</label><input id="kgDays" type="number" min="0" max="3650" style="width:100%"></div>
        <div><label class="lb">${bn?'কতটা কি':'How many'}</label><input id="kgCount" type="number" min="1" max="50" value="1" style="width:100%"></div>
      </div>
      <button class="btn btn-gold" style="width:100%;margin-top:11px;padding:11px" onclick="genKeys()">⚡ ${bn?'সার্ভারে তৈরি করুন':'Issue on server'}</button>
      <div id="kgOut" style="margin-top:11px"></div>
      <div class="hint-t" style="margin-top:9px">${bn?'কি আপনার সার্ভারে তৈরি হয়, এই ফাইলে কিছুই জমা থাকে না। সার্ভার যা দেয় সেটাই এখানে দেখানো হয়।':'Keys are created on your server; nothing secret is stored in this file. What you see here is what the server returned.'}</div>
    </div>
    <div class="blk"><div class="bt g">📋 ${bn?'সার্ভার রেজিস্টার':'Server register'} <button class="btn btn-sm" style="float:right" onclick="ownerPull().then(()=>drawIssuedList(''))">↻ ${bn?'রিফ্রেশ':'refresh'}</button></div>
      <input id="kgFindK" style="width:100%;margin-bottom:8px" placeholder="🔍 ${bn?'Gmail বা কি খুঁজুন':'find Gmail or key'}" oninput="drawIssuedList(this.value)">
      <div class="scroll" style="max-height:430px" id="kgList"><div class="empty">${bn?'“রিফ্রেশ” চাপুন':'Press refresh'}</div></div>
    </div></div>`
  :`<div class="blk" style="border-color:var(--danger)"><div class="bt" style="color:var(--danger)">🔐 ${bn?'সার্ভার লগইন দরকার':'Server login required'}</div>
     <div class="hint-t">${bn?'কি তৈরি, মেয়াদ বাড়ানো ও বাতিল — সব আপনার সার্ভারে হয়। তাই আগে সার্ভার পাসওয়ার্ড দিয়ে লগইন করুন।':'Issuing, extending and revoking all happen on your server, so log in with the server password first.'}</div></div>`}`;
  setTimeout(()=>{ if(on)ownerPull().then(()=>drawIssuedList('')); },60);
}
function drawIssuedList(filter){
  const bn=S.settings.lang==='bn';
  const box0=document.getElementById('kgFindK');
  const f=(filter!=null?filter:(box0?box0.value:'')).toLowerCase();
  const box=document.getElementById('kgList'); if(!box)return;
  const rows=(OWNER_ROWS.length?OWNER_ROWS:[]).map(r=>{
    const p=planOf(r.plan), today=iso(TODAY);
    const st=r.revoked?'revoked':(r.expiry&&today>r.expiry?'expired':(r.expiry&&new Date(r.expiry+'T00:00:00')-TODAY<=7*864e5?'expiring':'active'));
    const daysLeft=r.expiry?Math.round((new Date(r.expiry+'T00:00:00')-TODAY)/864e5):null;
    return {key:r.key,mail:normMail(r.mail),name:r.name||'',plan:r.plan,planName:p.n,price:r.price||0,
            date:r.issued,expiry:r.expiry||'lifetime',daysLeft,st,fp:r.fp||''};
  }).filter(r=>!f||r.mail.includes(f)||r.key.toLowerCase().includes(f)||String(r.name||'').toLowerCase().includes(f));
  box.innerHTML=rows.length?rows.map(r=>{
    const pill={active:'p-opt',expiring:'p-dl',expired:'p-pass',revoked:'p-last'}[r.st];
    return `<div class="li" style="cursor:default;padding:8px 10px">
      <div class="t"><b style="color:var(--white);font-size:11.5px">${r.name?esc(r.name)+' <span style="color:var(--muted);font-weight:400">·</span> ':''}${r.mail}</b><span class="pill ${pill}">${r.st.toUpperCase()}</span></div>
      <div class="d"><span class="mono" style="font-size:10px;color:var(--gold)">${r.key}</span></div>
      <div class="d">${r.planName} · ${bn?'ইস্যু':'issued'} ${r.date} · ${r.daysLeft==null?(bn?'আজীবন':'lifetime'):(bn?'বাকি':'left')+' '+r.daysLeft+(bn?' দিন':' d')}${r.fp?' · 🔒 '+r.fp.slice(0,6):''}</div>
      <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="copy('${r.key}')">📋 ${bn?'কি':'key'}</button>
        <button class="btn btn-sm" onclick="copy('${r.mail} ${r.key}')">📋 ${bn?'অ্যাক্টিভেশন লাইন':'activation line'}</button>
        <button class="btn btn-sm" onclick="extendKey('${r.mail}','${r.plan}',30)">+30d</button>
        <button class="btn btn-sm" onclick="extendKey('${r.mail}','${r.plan}',90)">+90d</button>
        <button class="btn btn-sm" onclick="mailKey('${r.mail}','${r.key}','${r.plan}','${esc(r.name||'').replace(/'/g,"\\'")}')">📨</button>
        ${r.st!=='revoked'?`<button class="btn btn-sm" onclick="revokeKey('${r.mail}','${r.key}')">🚫</button>`:''}
      </div></div>`;}).join('')
    :`<div class="empty">${bn?'সার্ভারে কোনো কি নেই':'No keys on the server yet'}</div>`;
}
function genKeys(){
  const bn=S.settings.lang==='bn';
  const nmEl=document.getElementById('kgName');
  const name=nmEl?String(nmEl.value||'').trim():'';
  const mail=(document.getElementById('kgMail').value||'').trim();
  const plan=document.getElementById('kgPlan').value;
  const days=Math.max(0,+document.getElementById('kgDays').value||0);
  const n=clamp(+document.getElementById('kgCount').value||1,1,50);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)){ toast('⚠️ '+(bn?'সঠিক Gmail দিন':'Enter a valid Gmail')); return; }
  const out=document.getElementById('kgOut');
  out.innerHTML='<div class="hint-t">⏳ '+(bn?'সার্ভারে তৈরি হচ্ছে…':'issuing on the server…')+'</div>';
  ownerIssue({gmail:normMail(mail),plan,days,count:n,name,price:planOf(plan).bdt}).then(r=>{
    if(!r.ok){ out.innerHTML=`<div class="hint-t" style="color:var(--danger)">❌ ${esc(r.err||'failed')}</div>`; return; }
    out.innerHTML=(r.keys||[]).map(k=>`<div class="li">
      <div class="t" style="cursor:pointer" onclick="copy('${k}')"><span class="mono" style="font-size:12px;color:var(--gold)">${k}</span><span style="font-size:9.5px;color:var(--muted)">${bn?'ক্লিক = কপি':'click to copy'}</span></div>
      <div class="d">${name?esc(name)+' · ':''}${normMail(mail)} · ${planOf(plan).n} · ${days?days+(bn?' দিন':' days'):(bn?'আজীবন':'lifetime')}</div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="copy('${normMail(mail)} ${k}')">📋 ${bn?'অ্যাক্টিভেশন লাইন':'activation line'}</button>
        <button class="btn btn-sm" onclick="mailKey('${normMail(mail)}','${k}','${plan}','${esc(name).replace(/'/g,"\\'")}')">📨 ${bn?'মেইল':'mail it'}</button>
      </div></div>`).join('');
    toast('⚡ '+(r.keys||[]).length+(bn?'টা কি সার্ভারে তৈরি':' key(s) issued on the server'));
    drawIssuedList('');
  });
}
function extendKey(mail,plan,days){
  if(!confirm((S.settings.lang==='bn'?'সার্ভারে মেয়াদ বাড়াবেন?':'Extend on the server?')+' '+mail+' +'+days+'d'))return;
  ownerExtend({gmail:normMail(mail),days,plan}).then(r=>{
    if(!r.ok){ toast('⚠️ '+(r.err||'failed')); return; }
    toast('⏳ +'+days+'d → '+(r.keys||[])[0]); if((r.keys||[])[0])copy(r.keys[0]);
    drawIssuedList('');
  });
}
function revokeKey(mail,key){
  if(!confirm((S.settings.lang==='bn'?'সার্ভারে বাতিল করবেন?':'Revoke on the server?')+' '+mail))return;
  ownerRevoke({gmail:normMail(mail),key:String(key||'')}).then(r=>{
    if(!r.ok){ toast('⚠️ '+(r.err||'failed')); return; }
    toast('🚫 '+(S.settings.lang==='bn'?'বাতিল হয়েছে':'revoked')+' '+mail);
    drawIssuedList('');
  });
}
