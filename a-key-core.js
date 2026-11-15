/* ---------- KEY SHAPE (no crypto happens in this file any more) ----------
   A key is only a *claim*. The checksum inside it is created with the owner's
   LICENSE_SECRET, which lives on the license server and is never shipped here.
   This file can therefore not mint or validate a key — it can only read a key's
   plan / validity so the owner console can display a register.
   --------------------------------------------------------------------- */
function normMail(g){ return String(g||'').trim().toLowerCase().replace(/\s+/g,''); }
function parseKey(key){
  const clean=String(key||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(clean.length!==19) return {ok:false,err:'Length must be 19 characters (GTC5-XXXXX-XXXXX-XXXXX).'};
  if(!clean.startsWith('GTC5')) return {ok:false,err:'Not a GOLD Calendar v5 key.'};
  const raw=clean.slice(4);              // 15 chars
  const payload=raw.slice(0,8), chk=raw.slice(8);
  const plan=CODE_PLAN[payload[0]];
  if(!plan) return {ok:false,err:'Unknown plan code.'};
  const issue=unb32('A'+payload.slice(1,5));
  const val=unb32('AA'+payload.slice(5,8));
  if(issue<0||val<0) return {ok:false,err:'Corrupted key.'};
  const keyF='GTC5-'+raw.slice(0,5)+'-'+raw.slice(5,10)+'-'+raw.slice(10,15);
  const issueDate=fromDayNo(issue);
  return {ok:true,plan,payload,chk,issueDate,days:val,key:keyF,
          expiry:val>0?new Date(issueDate.getTime()+val*86400000):null};
}
/* DELIBERATELY REMOVED in v5.1:
     makeKey()    — keys are created by the license server only (POST /v1/owner/issue)
     verifyKey()  — keys are verified by the license server only (POST /v1/activate)
   Anything that still calls them gets a clear, honest error instead of silent trust. */
function makeKey(){ throw new Error('Keys are issued by the license server — use Owner Console → Keys.'); }
function verifyKey(gmail,key){
  const p=parseKey(key);
  if(!p.ok) return p;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normMail(gmail))) return {ok:false,err:'Enter the Gmail you bought with.'};
  return {ok:true,plan:p.plan,days:p.days,issueDate:p.issueDate,expiry:p.expiry,gmail:normMail(gmail),local:true};
}

/* =====================================================================
   LICENSE CLIENT — talks to YOUR license server
   ---------------------------------------------------------------------
   · activation is checked online  → the server answers with a signed
     OFFLINE GRACE TOKEN so the app keeps working without internet
   · the token expires: the app re-checks with the server automatically
   · key, plan, expiry and revocation are all decided server-side, so a
     buyer who edits this file still cannot produce a working key
   ===================================================================== */
const LIC_TOKEN_LS = LS+'_tok';        // offline grace token
const LIC_OWNER_LS = LS+'_owner';      // owner console session
const LIC_SYNC = {busy:false, lastTry:0, lastOk:0, err:'', stale:false};
let LIC_OFFLINE = false;               // last conversation with the server failed

function licUrl(path){
  const base=String(typeof LICENSE_ENDPOINT==='string'?LICENSE_ENDPOINT:'').trim().replace(/\/+$/,'');
  return base+path;
}
function licConfigured(){
  const base=String(typeof LICENSE_ENDPOINT==='string'?LICENSE_ENDPOINT:'').trim();
  if(!/^https?:\/\//i.test(base)) return false;                       /* placeholder or empty */
  if(/__|CHANGE-ME|YOURNAME|example\.com/i.test(base)) return false;   /* build-time placeholder */
  const local=/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(base);
  if(local && !(typeof LICENSE_DEV!=='undefined' && LICENSE_DEV)) return false;   /* never ship a localhost build */
  return true;
}
async function licPost(path,body,auth){
  if(!licConfigured()) return {ok:false,err:'This copy has no license server configured. Contact '+own('gmail')+'.',noconf:true};
  const ctl=(typeof AbortController==='function')?new AbortController():null;
  const timer=ctl?setTimeout(()=>{try{ctl.abort();}catch(e){}},14000):null;
  try{
    const r=await fetch(licUrl(path),{method:'POST',headers:Object.assign({'Content-Type':'application/json'},auth?{Authorization:'Bearer '+auth}:{}),
      body:JSON.stringify(body||{}),signal:ctl?ctl.signal:undefined});
    if(timer)clearTimeout(timer);
    let j=null; try{ j=JSON.parse(await r.text()); }catch(e){ j=null; }
    if(!j) return {ok:false,err:'License server returned an unreadable answer (HTTP '+r.status+').'};
    LIC_OFFLINE=false; LIC_SYNC.lastOk=Date.now();
    return j;
  }catch(e){
    if(timer)clearTimeout(timer);
    LIC_OFFLINE=true; LIC_SYNC.err=String(e&&e.message||e);
    return {ok:false,offline:true,err:'Cannot reach the license server. Check your internet connection and try again.'};
  }
}
async function licGet(path,auth){
  if(!licConfigured()) return {ok:false,err:'No license server configured.',noconf:true};
  try{
    const r=await fetch(licUrl(path),{headers:auth?{Authorization:'Bearer '+auth}:{}});
    let j=null; try{ j=JSON.parse(await r.text()); }catch(e){ j=null; }
    return j||{ok:false,err:'Unreadable answer (HTTP '+r.status+')'};
  }catch(e){ LIC_OFFLINE=true; return {ok:false,offline:true,err:'Cannot reach the license server.'}; }
}

/* ---------- offline grace token: same maths as the server ---------- */
function tokSig(payloadB64){
  const hex=sha256(String(TOKEN_SECRET)+'|tok|'+payloadB64);
  const bytes=hex.match(/.{2}/g).map(x=>parseInt(x,16));
  let out='',acc=0,bits=0;
  for(const b of bytes){ acc=(acc<<8)|b; bits+=8;
    while(bits>=5){ bits-=5; out+=KEY_ALPHABET[(acc>>bits)&31]; if(out.length>=10)return out; } }
  return out.slice(0,10);
}
function tokDecode(b64){
  try{
    const s=String(b64).replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(decodeURIComponent(escape(atob(s+'==='.slice((s.length+3)%4)))));
  }catch(e){ return null; }
}
function tokenCheck(token){
  const [b64,sig]=String(token||'').split('.');
  if(!b64||!sig) return {ok:false,err:'No offline token'};
  if(tokSig(b64)!==sig) return {ok:false,err:'Offline token signature mismatch'};
  const p=tokDecode(b64);
  if(!p) return {ok:false,err:'Offline token unreadable'};
  const today=iso(new Date());
  if(p.e&&today>p.e) return {ok:false,err:'Offline grace period ended — connect to the internet to renew.',payload:p};
  return {ok:true,payload:p,stale:!!(p.r&&today>p.r)};
}
function licSession(){ try{ return JSON.parse(localStorage.getItem(LIC_TOKEN_LS)||'null'); }catch(e){ return null; } }
function licSaveToken(sess){
  localStorage.setItem(LIC_TOKEN_LS,JSON.stringify({gmail:normMail(sess.gmail),key:String(sess.key||'').trim(),
    fp:deviceFP(),token:sess.token,savedAt:iso(new Date())}));
  localStorage.setItem(LS+'_ever','1');
}
function licSessionState(){
  const s=licSession();
  if(!s||!s.token) return null;
  if(deviceLockOn()&&s.fp&&s.fp!==deviceFP()) return {device:true,gmail:s.gmail,key:s.key};
  const t=tokenCheck(s.token);
  if(!t.ok) return {dead:true,gmail:s.gmail,key:s.key,err:t.err};
  return {ok:true,gmail:s.gmail,key:s.key,payload:t.payload,stale:t.stale,offlineUntil:t.payload.e};
}
/* background heartbeat: renew the grace token while the app is open */
function licKick(force){
  const s=licSession(); if(!s||!s.token) return;
  const now=Date.now();
  if(!force && now-LIC_SYNC.lastTry<6*3600e3) return;
  if(LIC_SYNC.busy) return;
  LIC_SYNC.busy=true; LIC_SYNC.lastTry=now;
  licPost('/v1/refresh',{gmail:s.gmail,key:s.key,fp:deviceFP()}).then(r=>{
    LIC_SYNC.busy=false;
    if(r&&r.ok&&r.token){ licSaveToken({gmail:r.gmail||s.gmail,key:s.key,token:r.token}); LIC_SYNC.stale=false; lockHeader(); }
    else if(r&&(r.device||r.expired||/revoked|expired|another device/i.test(r.err||''))){ LIC_SYNC.stale=false; LIC=null; lockUI(); }
  }).catch(()=>{ LIC_SYNC.busy=false; });
}
function licServerBoot(){
  const st=licSessionState();
  if(st&&st.ok&&st.stale) licKick(true);
  else if(st&&st.ok) licKick(false);
  setInterval(()=>{ if(!ADM) licKick(false); },3600e3);
  document.addEventListener('visibilitychange',()=>{ if(!ADM&&!document.hidden) licKick(false); });
}
/* what the Settings tab shows instead of the old “default salt” warning */
function licServerBanner(){
  const bn=S.settings.lang==='bn';
  if(!licConfigured()) return `<div class="blk" style="border-color:var(--danger);margin-bottom:10px">
    <div class="bt" style="color:var(--danger)">⚠️ ${bn?'লাইসেন্স সার্ভার সেট করা হয়নি':'License server not configured'}</div>
    <div class="hint-t">${bn?'এই কপিতে LICENSE_ENDPOINT খালি/ডিফল্ট আছে, তাই কোনো কি অ্যাক্টিভেট হবে না। build.mjs চালিয়ে নিজের Worker URL বসান।':'LICENSE_ENDPOINT in this copy is empty or still the placeholder, so no key can activate. Run build.mjs with your Worker URL.'}</div></div>`;
  return `<div class="blk" style="border-color:rgba(46,204,113,.45);margin-bottom:10px">
    <div class="bt g">🔐 ${bn?'সার্ভার-সাইড কি ভেরিফিকেশন চালু':'Server-side key verification ON'}</div>
    <div class="hint-t">${bn?'কি তৈরি ও যাচাই দুটোই আপনার সার্ভারে হয়। এই ফাইলে কোনো সিক্রেট নেই, তাই সোর্স কপি করেও কেউ কি বানাতে পারবে না।':'Keys are minted and checked on your server. There is no secret in this file, so copying the source does not let anyone create a key.'}</div></div>`;
}
