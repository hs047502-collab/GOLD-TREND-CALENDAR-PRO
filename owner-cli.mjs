#!/usr/bin/env node
/* =====================================================================
   owner-cli.mjs — issue / extend / revoke keys from your own laptop
   ---------------------------------------------------------------------
   Works against your deployed Worker (or the local dev server).

   1) once per shell:
        export GTC_API=https://gtc-license.YOURNAME.workers.dev
        export GTC_PW='your owner password'

   2) then:
        node owner-cli.mjs key buyer@gmail.com pro 90          # 1 key
        node owner-cli.mjs key buyer@gmail.com life 0 3        # 3 lifetime keys
        node owner-cli.mjs extend buyer@gmail.com 30
        node owner-cli.mjs revoke buyer@gmail.com
        node owner-cli.mjs revoke --key GTC5-XXXXX-XXXXX-XXXXX
        node owner-cli.mjs list
   ===================================================================== */
const API = (process.env.GTC_API || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const PW = process.env.GTC_PW || '';
const [cmd, ...rest] = process.argv.slice(2);

const j = async (path, body, auth) => {
  const r = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let out = null;
  try { out = await r.json(); } catch (e) { out = { ok: false, err: 'HTTP ' + r.status }; }
  return out;
};
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

if (!cmd || cmd === 'help') {
  console.log(`GTC5 license CLI → ${API}
  key <gmail> <starter|pro|life> <days|0=lifetime> [count]
  extend <gmail> <days>
  revoke <gmail>            |   revoke --key GTC5-…
  list`);
  process.exit(0);
}

const login = await j('/v1/owner/login', { password: PW });
if (!login.ok) die(login.err || 'login failed (set GTC_PW)');
const S = login.session;

if (cmd === 'key') {
  const [gmail, plan, days, count] = rest;
  if (!gmail || !plan) die('usage: key <gmail> <plan> <days> [count]');
  const r = await j('/v1/owner/issue', { gmail, plan, days: Number(days || 0), count: Number(count || 1) }, S);
  if (!r.ok) die(r.err || 'failed');
  console.log(`\n${r.keys.length} key(s) for ${r.mail} — ${r.plan}, ${r.days ? r.days + ' days' : 'lifetime'}, expires ${r.expiry || 'never'}\n`);
  r.keys.forEach(k => console.log('  ' + k + '\n    activation line →  ' + r.mail + ' ' + k + '\n'));
}

else if (cmd === 'extend') {
  const [gmail, days] = rest;
  if (!gmail || !days) die('usage: extend <gmail> <days>');
  const r = await j('/v1/owner/extend', { gmail, days: Number(days) }, S);
  if (!r.ok) die(r.err || 'failed');
  console.log('✓ extended → ' + r.keys.join(', '));
}

else if (cmd === 'revoke') {
  const body = rest[0] === '--key' ? { key: rest[1] } : { gmail: rest[0] };
  const r = await j('/v1/owner/revoke', body, S);
  if (!r.ok) die(r.err || 'failed');
  console.log('✓ revoked ' + (body.key || body.gmail));
}

else if (cmd === 'list') {
  const r = await j('/v1/owner/list', undefined, S);
  if (!r.ok) die(r.err || 'failed');
  const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
  console.log('\n' + pad('KEY', 24) + pad('GMAIL', 26) + pad('PLAN', 9) + pad('EXPIRY', 12) + 'STATE');
  console.log('-'.repeat(78));
  r.rows.forEach(x => console.log(
    pad(x.key, 24) + pad(x.mail, 26) + pad(x.plan, 9) + pad(x.expiry || 'lifetime', 12) +
    (x.revoked ? 'revoked' : (x.expiry && x.expiry < new Date().toISOString().slice(0, 10) ? 'expired' : 'active'))));
  console.log('\n' + r.rows.length + ' licenses on the server\n');
}

else die('unknown command: ' + cmd);
