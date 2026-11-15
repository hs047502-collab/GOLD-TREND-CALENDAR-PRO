/* ---------------- owner gate: the password now lives on the SERVER -------
   The old local hash was crackable because the salt was inside this file.
   Now the password is verified by the license server (PBKDF2-style hash in
   KV, 8 attempts / 15 min), and the console receives a 12-hour session. */
const ownerSet=()=>!!ownerSession();
function openOwnerGate(){ openModal('ownerGateModal'); renderOwnerGate(); }
function renderOwnerGate(){
  const first=!ownerSet();
  document.getElementById('ogBody').innerHTML=`
  <div class="blk" style="border-color:rgba(212,175,55,.4);background:linear-gradient(150deg,rgba(212,175,55,.09),var(--card3))">
    <div class="bt">👑 ${S.settings.lang==='bn'?'ওনার কনসোল':'Owner console'}</div>
    <div class="kv"><span>${S.settings.lang==='bn'?'ওনার Gmail':'Owner Gmail'}</span><b class="mono" style="font-size:11.5px;color:var(--gold)">${own('gmail')}</b></div>
    <div class="kv"><span>${S.settings.lang==='bn'?'প্রোডাক্ট':'Product'}</span><b style="font-size:11px">${own('product')}</b></div>
    <div class="kv"><span>${S.settings.lang==='bn'?'লাইসেন্স সার্ভার':'License server'}</span><b style="font-size:10px;color:${licConfigured()?'var(--success)':'var(--danger)'}">${licConfigured()?esc(licUrl('')):'⚠️ not set'}</b></div>
  </div>
  <div class="blk" style="margin-top:11px">
    <div class="bt ${first?'w':'a'}">🔑 ${S.settings.lang==='bn'?'সার্ভার পাসওয়ার্ড':'Server password'}</div>
    <label class="lb">${S.settings.lang==='bn'?'পাসওয়ার্ড':'Password'}</label>
    <input id="ogPw" type="password" style="width:100%" placeholder="••••••••" onkeydown="if(event.key==='Enter')ownerSubmit()">
    <div id="ogMsg" style="font-size:11px;color:var(--danger);min-height:16px;margin-top:7px"></div>
    <button class="btn btn-gold" style="width:100%;padding:11px;margin-top:4px" onclick="ownerSubmit()">🔓 ${S.settings.lang==='bn'?'আনলক':'Unlock'}</button>
    <div class="hint-t" style="margin-top:9px">${S.settings.lang==='bn'
      ?'পাসওয়ার্ড যাচাই হয় আপনার লাইসেন্স সার্ভারে, এই ফাইলে এর কোনো চিহ্নও নেই। ফাইল কপি করে কেউ কনসোলে ঢুকতে পারবে না। আনলক ১২ ঘণ্টা থাকে।'
      :'The password is checked on your license server — this file holds no trace of it, so copying the file never opens the console. Unlock lasts 12 hours.'}</div>
  </div>`;
  setTimeout(()=>{const e=document.getElementById('ogPw');if(e&&e.focus)e.focus();},60);
}
function ownerSubmit(){
  const pw=document.getElementById('ogPw').value, msg=document.getElementById('ogMsg');
  if(!pw||pw.length<4){ msg.textContent=(S.settings.lang==='bn'?'কমপক্ষে ৪ অক্ষরের পাসওয়ার্ড দিন':'Password must be at least 4 characters'); return; }
  if(!licConfigured()){ msg.textContent=(S.settings.lang==='bn'?'এই কপিতে লাইসেন্স সার্ভার সেট নেই':'This copy has no license server configured'); return; }
  msg.style.color='var(--muted)'; msg.textContent='⏳ checking…';
  ownerLogin(pw).then(r=>{
    if(!r.ok){ msg.style.color='var(--danger)'; msg.textContent='❌ '+(r.err||'Wrong password'); return; }
    closeModal('ownerGateModal'); openModal('ownerModal'); renderOwner();
    toast('👑 '+(S.settings.lang==='bn'?'স্বাগতম':'Welcome')+(own('name')?', '+own('name').split(' ')[0]:''));
  });
}
function ownerLock(){ ownerLogout(); closeModal('ownerModal'); toast('🔒 '+(S.settings.lang==='bn'?'কনসোল লক':'Console locked')); }
