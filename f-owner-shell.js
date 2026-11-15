/* ---------------- owner console shell (server-first) ---------------- */
let OWNER_TAB='dash';
function ownerTab(t){ OWNER_TAB=t; renderOwner(); }
function renderOwner(){
  if(!ADM||!ownerSession()){ renderOwnerGate(); openModal('ownerGateModal'); return; }
  const bn=S.settings.lang==='bn';
  const tabs=[['dash','📊 '+(bn?'ড্যাশবোর্ড':'Dashboard')],['keys','🔑 '+(bn?'কি':'Keys')],
              ['buyers','👥 '+(bn?'বায়ার ও সিট':'Buyers & seats')],['set','⚙️ '+(bn?'সেটিংস':'Settings')]];
  document.getElementById('ownerBody').innerHTML=`
    <div class="tabs">${tabs.map(t=>`<button class="btn btn-sm ${OWNER_TAB===t[0]?'btn-gold':''}" onclick="ownerTab('${t[0]}')">${t[1]}</button>`).join('')}
      <div class="spacer" style="flex:1"></div>
      <button class="btn btn-sm" onclick="ownerLock()">🔒 ${bn?'লক':'Lock'}</button></div>
    <div id="licBannerBox" style="margin-bottom:10px"></div><div id="ownerPane"></div>`;
  const lb=document.getElementById('licBannerBox'); if(lb)lb.innerHTML=licServerBanner();
  if(OWNER_TAB==='dash')renderOwnerDash();
  else if(OWNER_TAB==='keys')renderOwnerKeys();
  else if(OWNER_TAB==='buyers')renderOwnerBuyers();
  else renderOwnerSet();
}

/* ---------------- optional webhook (Google Sheet) ---------------- */
function testSync(){
  const u=(ownerCfg().sync||'').trim();
  if(!/^https:\/\//.test(u)){ toast('⚠️ '+(S.settings.lang==='bn'?'আগে URL দিন':'Enter a URL first')); return; }
  reportActivation({gmail:'test@owner.local',plan:'pro',expiry:null});
  toast('📡 '+(S.settings.lang==='bn'?'টেস্ট রিপোর্ট পাঠানো হয়েছে':'test report fired'));
}
function syncSnippet(){
  copy(`function doPost(e){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('activations') || ss.insertSheet('activations');
  if (sh.getLastRow() === 0) sh.appendRow(['when','gmail','plan','expiry','machine','product']);
  var d = JSON.parse(e.postData.contents);
  sh.appendRow([new Date(), d.gmail, d.plan, d.expiry, d.fp, d.product]);
  return ContentService.createTextOutput('ok');
}`);
  toast('📄 Apps Script code copied — deploy as Web App (Anyone) and paste the /exec URL');
}
/* password change now happens on the server */
function changeOwnerPw(){
  const bn=S.settings.lang==='bn';
  const cur=prompt(bn?'বর্তমান পাসওয়ার্ড:':'Current password:'); if(cur==null)return;
  const nw=prompt(bn?'নতুন পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর):':'New password (8+ chars):'); if(!nw||nw.length<8){ toast('⚠️ 8+ chars'); return; }
  licPost('/v1/owner/password',{current:cur,next:nw},ownerSession()).then(r=>{
    toast(r.ok?('🔐 '+(bn?'পাসওয়ার্ড বদলেছে':'password changed')):('⚠️ '+(r.err||'failed')));
  });
}
function ownerPreview(){ closeModal('ownerModal'); lockUI(true); toast('👁️ '+(S.settings.lang==='bn'?'এটা বায়ার যা দেখবে':'this is what a buyer sees')); }
function resetTrialOwner(){ [LS+'_trial',TRIAL_MIRROR,LS+'_twipe',LS+'_ever',LS+'_blocked',LS+'_lic',LIC_TOKEN_LS].forEach(k=>localStorage.removeItem(k));
  LIC=null; lockUI(); renderOwnerSet(); toast('⏳ trial reset — 7 fresh days on this machine'); }
function unblockOwner(){ localStorage.removeItem(LS+'_blocked'); localStorage.removeItem(LS+'_revoked');
  LIC=null; lockUI(); renderOwnerSet(); toast('🔓 block cleared'); }
function wipeRegister(){ if(!confirm('Clear the CACHE of the register on this machine? The server copy is untouched.'))return;
  [LS+'_issued',LS+'_acts',LS+'_revoked',LS+'_blocked'].forEach(k=>localStorage.removeItem(k)); OWNER_ROWS=[];
  renderOwner(); toast('🗑️ local cache wiped (server register intact)'); }
