/* end-to-end proof: real Chromium + the real dist/index.html + the real worker.
   node e2e.mjs      (needs the license API on 127.0.0.1:8787) */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeKey } from './LICENSE-SERVER/lib/licensing.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const API = process.env.API || 'http://127.0.0.1:8787';
const OWNER_PW = process.env.OWNER_PASSWORD || 'devowner123';
/* serve dist over http — exactly how buyers load it from GitHub Pages / Cloudflare */
const PORT = 8099;
const server = http.createServer(async (req, res) => {
  const f = path.join(HERE, 'dist', '_dev', 'index.html');
  try { const b = await fs.readFile(f); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(b); }
  catch (e) { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const APP = 'http://127.0.0.1:' + PORT + '/';
/* every run uses fresh Gmail addresses so a previous run's revoke cannot poison the test */
const TAG = Date.now().toString(36);
const GM = { buyer: `buyer.${TAG}@gmail.com`, device: `device.${TAG}@gmail.com`, other: `thief.${TAG}@gmail.com` };
let n = 0;
const ok = (name, cond, extra = '') => {
  n++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '   ← ' + extra));
  if (!cond) process.exitCode = 1;
};
const post = async (url, body, auth) => {
  const r = await fetch(API + url, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body || {}) });
  return r.json();
};

console.log('\nAPI');
const login = await post('/v1/owner/login', { password: OWNER_PW });
ok('owner login works', login.ok, JSON.stringify(login));
ok('wrong password is refused', !(await post('/v1/owner/login', { password: 'nope' })).ok);
const S = login.session;
const issued = await post('/v1/owner/issue', { gmail: GM.buyer, plan: 'pro', days: 90, name: 'Test Buyer' }, S);
ok('owner can issue a key', issued.ok && /^GTC5-/.test(issued.keys[0]), JSON.stringify(issued));
const KEY = issued.keys[0];
ok('an unauthorised client cannot issue', !(await post('/v1/owner/issue', { gmail: 'x@y.com', plan: 'life' })).ok);
const forged = await makeKey('attacker-secret', GM.buyer, 'life', new Date(), 0);
const rForge = await post('/v1/activate', { gmail: GM.buyer, key: forged, fp: 'whatever' });
ok('a self-minted key is rejected by the server', !rForge.ok, JSON.stringify(rForge));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
await page.goto(APP);
await page.waitForTimeout(900);

console.log('\nAPP — before activation');
ok('app boots with no JS errors', errs.length === 0, errs[0]);
const st0 = await page.evaluate(() => { const l = licenseState(); return { ok: l.ok, trial: !!l.trial, plan: l.plan }; });
ok('starts on the 7-day trial', st0.ok && st0.trial, JSON.stringify(st0));
ok('paywall is closed while on trial', !(await page.evaluate(() => document.getElementById('paywall').classList.contains('open'))));

console.log('\nAPP — wrong key cannot activate');
await page.evaluate(() => lockUI(true));      /* buyers see this screen after the trial */
await page.waitForTimeout(300);
await page.evaluate(g => { document.getElementById('licMail').value = g; document.getElementById('licKey').value = 'GTC5-AAAAA-BBBBB-CCCCC'; doActivate(); }, GM.buyer);
await page.waitForTimeout(800);
const badMsg = await page.evaluate(() => document.getElementById('licMsg').textContent);
ok('server error is shown, app stays on trial', /❌|not issued|Invalid|must look/i.test(badMsg), badMsg);
ok('still no license token stored', !(await page.evaluate(() => !!localStorage.getItem('goldcal_v5_tok'))));

console.log('\nAPP — real key activates');
await page.evaluate(([g, k]) => { document.getElementById('licMail').value = g; document.getElementById('licKey').value = k; }, [GM.buyer, KEY]);
await page.evaluate(() => doActivate());
await page.waitForFunction(() => !!localStorage.getItem('goldcal_v5_tok'), { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(900);   /* the UI unlock is deferred ~450 ms on purpose */
console.log('   (activation msg:', (await page.evaluate(() => document.getElementById('licMsg').textContent)) + ')');
const st1 = await page.evaluate(() => { const l = licenseState(); return { ok: l.ok, plan: l.plan, gmail: l.gmail, badge: document.getElementById('licBadge').textContent.trim(), open: document.getElementById('paywall').classList.contains('open') }; });
ok('activation succeeds', st1.ok && st1.plan === 'pro', JSON.stringify(st1));
ok('paywall gone', !st1.open);
ok('badge shows the plan', /Pro/.test(st1.badge), st1.badge);
ok('offline grace token saved', await page.evaluate(() => !!localStorage.getItem('goldcal_v5_tok')));

console.log('\nAPP — offline grace works, tampering does not');
/* simulate "no internet" by cutting only the license-API calls */
await page.route('**/v1/**', r => r.abort());
await page.reload();
await page.waitForTimeout(1200);
const offline = await page.evaluate(() => { const l = licenseState(); return { ok: l.ok, plan: l.plan, offline: !!l.offline }; });
ok('app still licensed with no internet', offline.ok && offline.plan === 'pro', JSON.stringify(offline));
await page.unroute('**/v1/**');

await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('goldcal_v5_tok'));
  const [b64, sig] = s.token.split('.');
  s.token = b64 + '.' + (sig[0] === 'A' ? 'BBBBBBBBBB' : 'AAAAAAAAAA');
  localStorage.setItem('goldcal_v5_tok', JSON.stringify(s));
});
await page.reload();
await page.waitForTimeout(1000);
const tampered = await page.evaluate(() => {
  const l = licenseState();
  return { ok: l.ok, trial: !!l.trial, open: document.getElementById('paywall').classList.contains('open') };
});
ok('a forged offline token is refused (locked)', !tampered.ok && tampered.open, JSON.stringify(tampered));

console.log('\nAPP — key bound to the buyer Gmail + one device');
const rMail = await post('/v1/activate', { gmail: GM.other, key: KEY, fp: 'PC2' });
ok('another Gmail cannot use this key', !rMail.ok, JSON.stringify(rMail));
const fresh = await post('/v1/owner/issue', { gmail: GM.device, plan: 'pro', days: 30 }, S);
const rDev1 = await post('/v1/activate', { gmail: GM.device, key: fresh.keys[0], fp: 'PC-1' });
const rDev2 = await post('/v1/activate', { gmail: GM.device, key: fresh.keys[0], fp: 'PC-2' });
ok('second device is refused, first is allowed', rDev1.ok && !rDev2.ok && rDev2.device === true, JSON.stringify(rDev1) + ' | ' + JSON.stringify(rDev2));

console.log('\nAPP — owner console (server password, no local hash)');
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.waitForTimeout(900);
ok('no owner password hash is stored in the file/browser before login',
  !(await page.evaluate(() => Object.keys(localStorage).some(k => /ownerpw/.test(k)))));
await page.evaluate(() => tapLogo());
await page.waitForTimeout(100);
for (let i = 0; i < 4; i++) { await page.evaluate(() => tapLogo()); }
await page.waitForTimeout(400);
ok('5 taps open the owner gate', await page.evaluate(() => document.querySelector('#ownerGateModal')?.classList.contains('open') === true));
await page.evaluate(() => { document.getElementById('ogPw').value = 'wrong-pass'; ownerSubmit(); });
await page.waitForTimeout(2500);
ok('wrong owner password refused', /❌/.test(await page.evaluate(() => document.getElementById('ogMsg').textContent)));
await page.evaluate(() => { document.getElementById('ogPw').value = 'devowner123'; ownerSubmit(); });
await page.waitForTimeout(1200);
const adm = await page.evaluate(() => ({ adm: ADM, tab: OWNER_TAB, hasKeys: typeof renderOwnerKeys === 'function' }));
ok('correct password unlocks the console', adm.adm === true, JSON.stringify(adm));
await page.evaluate(() => ownerTab('keys'));
await page.waitForTimeout(1500);
const reg = await page.evaluate(() => document.getElementById('kgList').textContent);
ok('server register shows the issued key', reg.includes(GM.buyer), reg.slice(0, 120));

console.log('\nAPP — revoke kills it server-side');
await page.evaluate(() => { ADM = true; });
await post('/v1/owner/revoke', { gmail: GM.buyer }, S);
const rRev = await post('/v1/activate', { gmail: GM.buyer, key: KEY, fp: 'PC-1' });
ok('revoked key refuses activation', !rRev.ok && /revoked/i.test(rRev.err || ''), JSON.stringify(rRev));

console.log('\nAPP — source no longer contains the secret');
const src = await fs.readFile(path.join(HERE, 'dist', 'index.html'), 'utf8');
ok('no default salt', !/GTC5-HS-2026-MICROSTOCK-DNA/.test(src));
ok('no client-side key minting', !/sig\(gmailN,p\.payload\)/.test(src));
ok('no owner password hash function', !/ownerHash\s*=/.test(src));

await browser.close();
server.close();
console.log('\n' + n + ' end-to-end checks run' + (process.exitCode ? ' — SOME FAILED' : ' — all passed ✔'));
