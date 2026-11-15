/* node --test test/   (or: node test/licensing.test.mjs) */
import assert from 'node:assert';
import { memStore } from '../src/store.mjs';
import {
  makeKey, parseKey, verifyActivation, issueKeys, revoke, extend, listLicenses,
  hashPassword, verifyPassword, checkToken, makeToken, normMail,
} from '../lib/licensing.mjs';

const LSEC = 'test-license-secret-AAAA';
const TSEC = 'test-token-secret-BBBB';
const DAY = 86400000;
let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ✓', name); };

console.log('licensing core');

await t('key round-trips through parseKey', async () => {
  const k = await makeKey(LSEC, 'buyer@gmail.com', 'pro', new Date('2026-01-10T00:00:00Z'), 90);
  assert.match(k, /^GTC5-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  const p = parseKey(k);
  assert.ok(p.ok, p.err);
  assert.equal(p.plan, 'pro');
  assert.equal(p.days, 90);
  assert.equal(new Date(p.issue * DAY + Date.UTC(2024, 0, 1)).toISOString().slice(0, 10), '2026-01-10');
});

await t('a tampered / invented key is rejected', async () => {
  const k = await makeKey(LSEC, 'buyer@gmail.com', 'pro', new Date(), 30);
  const store = memStore();
  await issueKeys(store, LSEC, { gmail: 'buyer@gmail.com', plan: 'pro', days: 30 });
  const bad = k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A');
  const r = await verifyActivation(store, { gmail: 'buyer@gmail.com', key: bad, fp: 'dev1' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.equal(r.ok, false);
});

await t('a key minted with a DIFFERENT secret is rejected (the whole point)', async () => {
  const store = memStore();
  await issueKeys(store, LSEC, { gmail: 'buyer@gmail.com', plan: 'pro', days: 30 });
  const forged = await makeKey('some-other-secret', 'buyer@gmail.com', 'life', new Date(), 0);
  const r = await verifyActivation(store, { gmail: 'buyer@gmail.com', key: forged, fp: 'dev1' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.equal(r.ok, false);
});

await t('key works only for the Gmail it was issued to', async () => {
  const store = memStore();
  const out = await issueKeys(store, LSEC, { gmail: 'buyer@gmail.com', plan: 'pro', days: 30 });
  const r = await verifyActivation(store, { gmail: 'thief@gmail.com', key: out.keys[0], fp: 'dev1' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.equal(r.ok, false);
  assert.match(r.err, /different Gmail/i);
});

await t('activation returns a valid offline token', async () => {
  const store = memStore();
  const out = await issueKeys(store, LSEC, { gmail: 'a@b.com', plan: 'pro', days: 90 });
  const r = await verifyActivation(store, { gmail: 'a@b.com', key: out.keys[0], fp: 'devA' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.ok(r.ok);
  const chk = await checkToken(TSEC, r.token, new Date());
  assert.ok(chk.ok, chk.err);
  assert.equal(chk.payload.p, 'pro');
  assert.equal(chk.payload.g, 'a@b.com');
});

await t('forged token fails the signature check', async () => {
  const store = memStore();
  const out = await issueKeys(store, LSEC, { gmail: 'a@b.com', plan: 'pro', days: 90 });
  const r = await verifyActivation(store, { gmail: 'a@b.com', key: out.keys[0], fp: 'devA' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  const [p] = r.token.split('.');
  const fake = p + '.' + 'AAAAAAAAAA';
  const chk = await checkToken(TSEC, fake, new Date());
  assert.equal(chk.ok, false);
});

await t('token hard-stops after the offline window', async () => {
  const store = memStore();
  const out = await issueKeys(store, LSEC, { gmail: 'a@b.com', plan: 'pro', days: 0 });
  const now = new Date('2026-03-01T10:00:00Z');
  const r = await verifyActivation(store, { gmail: 'a@b.com', key: out.keys[0], fp: 'devA' }, { licenseSecret: LSEC, tokenSecret: TSEC, now, graceDays: 30, extraOfflineDays: 7 });
  const after = new Date(now.getTime() + 40 * DAY);
  const chk = await checkToken(TSEC, r.token, after);
  assert.equal(chk.ok, false);
  const stale = new Date(now.getTime() + 32 * DAY);
  assert.ok((await checkToken(TSEC, r.token, stale)).stale, 'should be flagged stale for a refresh');
});

await t('device lock: second device is refused, first one keeps working', async () => {
  const store = memStore();
  const out = await issueKeys(store, LSEC, { gmail: 'a@b.com', plan: 'pro', days: 30 });
  const a = await verifyActivation(store, { gmail: 'a@b.com', key: out.keys[0], fp: 'PC-ONE' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.ok(a.ok);
  const b = await verifyActivation(store, { gmail: 'a@b.com', key: out.keys[0], fp: 'PC-TWO' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.equal(b.ok, false);
  assert.ok(b.device);
  const again = await verifyActivation(store, { gmail: 'a@b.com', key: out.keys[0], fp: 'PC-ONE' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.ok(again.ok);
});

await t('expiry blocks activation and is capped in the token', async () => {
  const store = memStore();
  const past = new Date(Date.now() - 40 * DAY);
  const out = await issueKeys(store, LSEC, { gmail: 'a@b.com', plan: 'starter', days: 30 }, past);
  const r = await verifyActivation(store, { gmail: 'a@b.com', key: out.keys[0], fp: 'dev' }, { licenseSecret: LSEC, tokenSecret: TSEC });
  assert.equal(r.ok, false);
  assert.ok(r.expired);
});

await t('revoke by key and by gmail both bite', async () => {
  const store = memStore();
  const a = await issueKeys(store, LSEC, { gmail: 'a@b.com', plan: 'pro', days: 30 });
  const b = await issueKeys(store, LSEC, { gmail: 'c@d.com', plan: 'pro', days: 30 });
  await revoke(store, { key: a.keys[0] }, true);
  await revoke(store, { gmail: 'c@d.com' }, true);
  assert.equal((await verifyActivation(store, { gmail: 'a@b.com', key: a.keys[0], fp: 'x' }, { licenseSecret: LSEC, tokenSecret: TSEC })).ok, false);
  assert.equal((await verifyActivation(store, { gmail: 'c@d.com', key: b.keys[0], fp: 'x' }, { licenseSecret: LSEC, tokenSecret: TSEC })).ok, false);
});

await t('extend never shortens a buyer', async () => {
  const store = memStore();
  await issueKeys(store, LSEC, { gmail: 'a@b.com', plan: 'pro', days: 90 });
  const ext = await extend(store, LSEC, { gmail: 'a@b.com', days: 30 });
  assert.ok(ext.ok);
  const rows = await listLicenses(store);
  const dates = rows.filter(r => r.mail === 'a@b.com').map(r => r.expiry).sort();
  assert.ok(dates[dates.length - 1] > dates[0], 'new expiry later than old');
});

await t('owner password hash round-trips, wrong password fails', async () => {
  const rec = await hashPassword('hridoy-secret', null, 500);
  assert.ok(await verifyPassword('hridoy-secret', rec));
  assert.equal(await verifyPassword('wrong', rec), false);
  assert.notEqual(rec.hash, rec.salt);
});

await t('50 keys per batch, all unique', async () => {
  const store = memStore();
  const out = await issueKeys(store, LSEC, { gmail: 'bulk@x.com', plan: 'starter', days: 30, count: 50 });
  assert.equal(out.keys.length, 50);
  assert.equal(new Set(out.keys).size, 50);
});

await t('normalises Gmail case/space', async () => {
  assert.equal(normMail('  A.B@Gmail.COM '), 'a.b@gmail.com');
});

console.log('\n' + pass + ' checks passed ✔');
