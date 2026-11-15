/* ---------------- licensing boot: verify/trial + background token refresh ---- */
function licenseWatch(){
  if(document.__licWatch)return; document.__licWatch=true;
  const tick=()=>{ if(!ADM){ const l=licenseState(); lockHeader(); if(!l.ok)lockUI(true); } };
  setInterval(tick,30000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) tick(); });
  setInterval(()=>{ if(!ADM){ const l=licenseState(); if(!l.ok)lockUI(true); } },5*60000);
}
