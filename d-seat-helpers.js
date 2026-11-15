/* ---------------- seat / activation helpers (thin views) ----------------
   The authoritative register lives on the license server (Owner Console →
   Keys → refresh). These helpers only read what this machine has cached so
   the dashboard still renders instantly while the pull is in flight. */
const issued=()=>{ try{return JSON.parse(localStorage.getItem(LS+'_issued')||'[]');}catch(e){return [];} };
const setIssued=a=>localStorage.setItem(LS+'_issued',JSON.stringify(a.slice(-2000)));
const putIssued=a=>setIssued(a);   /* alias used by tests / imports */
const revokedList=()=>{ try{return JSON.parse(localStorage.getItem(LS+'_revoked')||'[]');}catch(e){return [];} };
const activations=()=>{ try{return JSON.parse(localStorage.getItem(LS+'_acts')||'[]');}catch(e){return [];} };
function logActivation(v){
  const a=activations();
  a.push({gmail:v.gmail,plan:v.plan,key:v.key,at:iso(new Date()),fp:machineFP().slice(0,8)});
  localStorage.setItem(LS+'_acts',JSON.stringify(a.slice(-300)));
}
/* optional phone-home: if the owner pastes a webhook URL, every activation is
   also reported there so real seat counts land in a Google Sheet.
   With no URL the app sends nothing anywhere except the license server. */
function reportActivation(v){
  const url=(ownerCfg().sync||'').trim(); if(!url||!/^https:\/\//.test(url))return;
  try{
    const body=JSON.stringify({gmail:v.gmail,plan:v.plan,expiry:v.expiry?iso(v.expiry):'lifetime',
      at:new Date().toISOString(),fp:machineFP().slice(0,8),product:own('product')});
    if(typeof fetch==='function') fetch(url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body}).catch(()=>{});
  }catch(e){}
}
function seatRows(){
  const src=OWNER_ROWS.length?OWNER_ROWS.map(r=>({key:r.key,mail:normMail(r.mail),name:r.name||'',plan:r.plan,
      date:r.issued,days:r.days,revoked:r.revoked,expiryRaw:r.expiry})):issued();
  return src.map(k=>{
    const p=planOf(k.plan);
    const v=parseKey(k.key);
    const expiry=k.expiryRaw!==undefined?(k.expiryRaw?new Date(k.expiryRaw+'T00:00:00'):null)
      :(v.ok&&v.days>0?new Date(v.issueDate.getTime()+v.days*86400000):null);
    const isRev=!!k.revoked||revokedList().includes(k.mail)||revokedList().includes(k.key);
    let st='active';
    if(isRev)st='revoked'; else if(expiry&&TODAY>expiry)st='expired';
    else if(expiry&&dayDiff(expiry,TODAY)<=7)st='expiring';
    return {key:k.key,mail:k.mail,name:k.name||'',plan:k.plan,planName:p.n,price:p.bdt,usd:p.usd,date:k.date,
            expiry:expiry?iso(expiry):'lifetime',daysLeft:expiry?dayDiff(expiry,TODAY):null,st,
            _rank:expiry?expiry.getTime():8.64e15};
  }).sort((a,b)=>((b.date||'').localeCompare(a.date||''))||(b._rank-a._rank));
}
function seatStats(){
  const r=seatRows();
  const s={total:r.length,buyers:new Set(r.map(x=>x.mail)).size,active:0,expiring:0,expired:0,revoked:0,
           bdt:0,usd:0,byPlan:{},localActs:activations().length};
  const b={active:0,expiring:0,expired:0,revoked:0};
  r.forEach(x=>{ s[x.st==='active'||x.st==='expiring'?'active':x.st]++; b[x.st]++;
    s.bdt+=x.price||0; s.usd+=x.usd||0;
    s.byPlan[x.plan]=(s.byPlan[x.plan]||0)+1; });
  s.expiring=b.expiring;
  s.lifetime=r.filter(x=>x.expiry==='lifetime'&&x.st!=='revoked').length;
  s.buckets=b;
  return {s,rows:r};
}
