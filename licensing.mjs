/* =====================================================================
   GOLD Trend Calendar Pro v5 — SERVER-SIDE LICENSING CORE
   ---------------------------------------------------------------------
   This module is the ONLY place where license keys can be created and
   checked. It never ships to a buyer: it runs inside the Cloudflare
   Worker (and inside the owner's local CLI / tests).

   Two different secrets are used, on purpose:

     LICENSE_SECRET  (private, server only)
        creates the 7-char checksum inside every key. Without it a key
        cannot be minted. Never put this in index.html.

     TOKEN_SECRET    (public-ish, also compiled into the app)
        signs the short-lived OFFLINE GRACE TOKEN that the server hands
        back after a successful activation, so the app keeps working for
        N days without internet. If a buyer reads it from the file they
        can forge a *local grace token* — but only for a plan/expiry the
        server once accepted, and it never mints a new KEY. That is the
        whole point of the split.
   ===================================================================== */

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I O 0 1
const B32 = KEY_ALPHABET;
export const PLANS = ['starter', 'pro', 'life'];
const PLAN_CODE = { starter: 'S', pro: 'P', life: 'L' };
const CODE_PLAN = { S: 'starter', P: 'pro', L: 'life' };
const EPOCH = Date.UTC(2024, 0, 1);
const DAY = 86400000;

/* ---------------- tiny helpers ---------------- */
export function normMail(g) {
  return String(g || '').trim().toLowerCase().replace(/\s+/g, '');
}
export function validMail(g) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normMail(g));
}
const enc = new TextEncoder();
export async function sha256Hex(str) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(String(str)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b32(n) {
  let s = '';
  n = Math.max(0, Math.floor(n));
  for (let i = 0; i < 5; i++) { s = B32[n % 32] + s; n = Math.floor(n / 32); }
  return s;
}
function unb32(s) {
  let n = 0;
  for (const ch of s) { const i = B32.indexOf(ch); if (i < 0) return -1; n = n * 32 + i; }
  return n;
}
const dayNo = d => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH) / DAY);
const fromDayNo = n => new Date(EPOCH + n * DAY);
export const isoDate = d => new Date(d).toISOString().slice(0, 10);

/* ---------------- key format (identical payload to v5.0, so the
   existing owner UI / CSV / register views keep working) ------------- */
export function checksum(secret, gmail, payload) {
  return sha256Hex(secret + '|' + normMail(gmail) + '|' + payload)
    .then(h => h.slice(0, 7).toUpperCase());
}

export async function makeKey(secret, gmail, planId, issueDate = new Date(), days = 0) {
  const code = PLAN_CODE[planId] || 'S';
  const issue = dayNo(new Date(issueDate));
  const val = Math.max(0, Math.floor(Number(days) || 0));
  const p1 = b32(issue).slice(1);   // 4 chars
  const p2 = b32(val).slice(2);     // 3 chars
  const payload = code + p1 + p2;   // 8 chars
  const chk = (await checksum(secret, gmail, payload));   // 7 chars
  const raw = payload + chk;        // 15 chars
  return 'GTC5-' + raw.slice(0, 5) + '-' + raw.slice(5, 10) + '-' + raw.slice(10, 15);
}

export function parseKey(key) {
  const clean = String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 19 || !clean.startsWith('GTC5')) return { ok: false, err: 'Key must look like GTC5-XXXXX-XXXXX-XXXXX.' };
  const raw = clean.slice(4);
  const payload = raw.slice(0, 8), chk = raw.slice(8);
  const plan = CODE_PLAN[payload[0]];
  if (!plan) return { ok: false, err: 'Unknown plan code.' };
  const issue = unb32('A' + payload.slice(1, 5));
  const days = unb32('AA' + payload.slice(5, 8));
  if (issue < 0 || days < 0) return { ok: false, err: 'Corrupted key.' };
  return { ok: true, key: 'GTC5-' + raw.slice(0, 5) + '-' + raw.slice(5, 10) + '-' + raw.slice(10, 15), payload, chk, plan, issue, days };
}

/* ---------------- offline grace token ----------------
   wire format:  <base64url(json)>.<10-char SIG>
   json: {v:1,g:gmail,p:plan,r:'YYYY-MM-DD',e:'YYYY-MM-DD',f:deviceFP}
     r = refresh-after  (app should re-check with the server once passed)
     e = hard stop      (app must stop working offline after this date)
   SIG = base32( sha256(TOKEN_SECRET + '|tok|' + b64) ).slice(0,10)
   ---------------------------------------------------- */
export const TOKEN_PREFIX = 'tok';

function b64url(str) {
  const bytes = enc.encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function tokenSig(tokenSecret, payloadB64) {
  const h = await sha256Hex(tokenSecret + '|' + TOKEN_PREFIX + '|' + payloadB64);
  // map hex -> base32 chars (10 chars = 50 bits)
  const bytes = h.match(/.{2}/g).map(x => parseInt(x, 16));
  let out = '', acc = 0, bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(acc >> bits) & 31]; if (out.length >= 10) break; }
    if (out.length >= 10) break;
  }
  return out.slice(0, 10);
}
export async function makeToken(tokenSecret, payload) {
  const b64 = b64url(JSON.stringify(payload));
  return b64 + '.' + await tokenSig(tokenSecret, b64);
}
export async function checkToken(tokenSecret, token, today) {
  const [b64, sig] = String(token || '').split('.');
  if (!b64 || !sig) return { ok: false, err: 'Malformed token' };
  const expect = await tokenSig(tokenSecret, b64);
  if (sig !== expect) return { ok: false, err: 'Token signature mismatch' };
  let p;
  try { p = JSON.parse(unb64url(b64)); } catch (e) { return { ok: false, err: 'Token payload unreadable' }; }
  const t = today || new Date();
  const d = isoDate(t);
  if (p.e && d > p.e) return { ok: false, err: 'Offline grace period ended', payload: p };
  return { ok: true, payload: p, stale: !!(p.r && d > p.r) };
}

/* ---------------- the decision function ----------------
   Store contract (Cloudflare KV or a local JSON file):
     get(key) -> object|null      put(key, obj) -> void
   ------------------------------------------------------ */
export const K = {
  lic: k => 'lic:' + String(k).toUpperCase(),
  mail: m => 'mail:' + normMail(m),
  revoked: () => 'revoked',
  owner: () => 'owner',
};

export async function findLicense(store, key) {
  const p = parseKey(key);
  if (!p.ok) return { ok: false, err: p.err };
  const rec = await store.get(K.lic(p.key));
  if (!rec) return { ok: false, err: 'This key was not issued by the owner.' };
  return { ok: true, rec, parsed: p };
}

/**
 * Verify a (gmail, key, deviceFP) triple and mint an offline grace token.
 * opts: { licenseSecret, tokenSecret, graceDays=30, extraOfflineDays=7,
 *         deviceLock=true, now=new Date() }
 */
export async function verifyActivation(store, input, opts) {
  const o = Object.assign({ graceDays: 30, extraOfflineDays: 7, deviceLock: true, now: new Date() }, opts || {});
  const gmail = normMail(input.gmail), key = input.key, fp = String(input.fp || '').slice(0, 32);
  if (!validMail(gmail)) return { ok: false, err: 'Enter the Gmail you bought with.' };
  const f = await findLicense(store, key);
  if (!f.ok) return { ok: false, err: f.err };
  const rec = f.rec;
  if (normMail(rec.mail) !== gmail) return { ok: false, err: 'This key belongs to a different Gmail.' };
  const revoked = await store.get(K.revoked());
  if (rec.revoked || (revoked && (revoked.gmails || []).includes(gmail)) || (revoked && (revoked.keys || []).includes(f.parsed.key))) {
    return { ok: false, err: 'This license was revoked by the owner.' };
  }
  const now = o.now, today = isoDate(now);
  if (rec.expiry && today > rec.expiry) {
    return { ok: false, err: 'License expired on ' + rec.expiry + '.', expired: true, plan: rec.plan };
  }
  /* one license = one device */
  if (o.deviceLock && fp) {
    if (!rec.fp) { rec.fp = fp; rec.fpSetAt = new Date(now).toISOString(); await store.put(K.lic(f.parsed.key), rec); }
    else if (rec.fp !== fp) {
      return { ok: false, err: 'This license was already activated on another device.', device: true, plan: rec.plan };
    }
  }
  /* token window: refresh after graceDays, hard stop graceDays + extra */
  const plus = n => isoDate(new Date(now.getTime() + n * DAY));
  const cap = v => (rec.expiry && v > rec.expiry) ? rec.expiry : v;
  const payload = {
    v: 1, g: gmail, p: rec.plan, f: fp || '',
    r: cap(plus(o.graceDays)),
    e: cap(plus(o.graceDays + o.extraOfflineDays)),
  };
  const token = await makeToken(o.tokenSecret, payload);
  rec.lastSeen = new Date(now).toISOString();
  rec.activations = (rec.activations || 0) + 1;
  await store.put(K.lic(f.parsed.key), rec);
  return {
    ok: true, plan: rec.plan, gmail, expiry: rec.expiry || null, token,
    refreshAfter: payload.r, offlineUntil: payload.e, days: f.parsed.days,
  };
}

/* ---------------- owner-side: issue / revoke / extend ---------------- */
export async function issueKeys(store, secret, req, now = new Date()) {
  const mail = normMail(req.gmail);
  if (!validMail(mail)) return { ok: false, err: 'Enter a valid Gmail.' };
  const plan = PLANS.includes(req.plan) ? req.plan : 'starter';
  const days = Math.max(0, Math.min(3650, Math.floor(Number(req.days) || 0)));
  const count = Math.max(1, Math.min(50, Math.floor(Number(req.count) || 1)));
  const name = String(req.name || '').trim().slice(0, 60);
  const out = [];
  for (let i = 0; i < count; i++) {
    const issue = new Date(now.getTime() + i * DAY);
    const key = await makeKey(secret, mail, plan, issue, days);
    const expiry = days > 0 ? isoDate(new Date(Date.UTC(issue.getUTCFullYear(), issue.getUTCMonth(), issue.getUTCDate()) + days * DAY)) : null;
    const rec = {
      key, mail, name, plan, days, issued: isoDate(issue), expiry, revoked: false,
      createdAt: new Date(now).toISOString(), fp: '', price: Math.max(0, Number(req.price) || 0),
    };
    await store.put(K.lic(key), rec);
    const m = (await store.get(K.mail(mail))) || { mail, name, keys: [] };
    if (!m.keys.includes(key)) m.keys.push(key);
    if (name) m.name = name;
    await store.put(K.mail(mail), m);
    out.push(key);
  }
  return { ok: true, keys: out, mail, plan, days, expiry: out.length ? (await store.get(K.lic(out[0]))).expiry : null };
}

export async function listLicenses(store) {
  const rows = [];
  const all = await store.list(K.lic(''));   // prefix 'lic:'
  for (const rec of all) rows.push(Object.assign({}, rec));
  rows.sort((a, b) => String(b.issued).localeCompare(String(a.issued)) || String(b.key).localeCompare(String(a.key)));
  return rows;
}

export async function revoke(store, { gmail, key }, on = true) {
  const rev = (await store.get(K.revoked())) || { gmails: [], keys: [] };
  if (key) {
    const f = await findLicense(store, key);
    if (f.ok) { f.rec.revoked = !!on; await store.put(K.lic(f.parsed.key), f.rec); }
    const arr = key.toUpperCase();
    rev.keys = on ? [...new Set([...rev.keys, arr])] : rev.keys.filter(k => k !== arr);
  }
  if (gmail) {
    const m = normMail(gmail);
    rev.gmails = on ? [...new Set([...rev.gmails, m])] : rev.gmails.filter(g => g !== m);
    const rec = await store.get(K.mail(m));
    for (const k of (rec && rec.keys) || []) {
      const f = await store.get(K.lic(k));
      if (f) { f.revoked = !!on; await store.put(K.lic(k), f); }
    }
  }
  await store.put(K.revoked(), rev);
  return { ok: true };
}

export async function extend(store, secret, { gmail, days, plan, key }, now = new Date()) {
  const add = Math.max(0, Math.min(3650, Math.floor(Number(days) || 0)));
  const m = await store.get(K.mail(gmail));
  if (!m) return { ok: false, err: 'No license for that Gmail.' };
  /* base = later of today and the current furthest expiry */
  let base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const k of m.keys) {
    const r = await store.get(K.lic(k));
    if (r && r.expiry) { const e = new Date(r.expiry + 'T00:00:00Z'); if (e > base) base = e; }
  }
  const usePlan = PLANS.includes(plan) ? plan : (m.keys.length ? (await store.get(K.lic(m.keys[0]))).plan : 'starter');
  const out = await issueKeys(store, secret, { gmail, plan: usePlan, days: add, count: 1, name: m.name }, base);
  return out;
}

/* ---------------- owner password: real PBKDF2-SHA256, server side -------- */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b) { return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
export async function hashPassword(password, salt, iterations = 150000) {
  const s = salt || bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(s), iterations, hash: 'SHA-256' }, key, 256);
  return { salt: s, hash: bytesToHex(bits), iterations, algo: 'PBKDF2-SHA256' };
}
export async function verifyPassword(password, rec) {
  if (!rec || !rec.salt) return false;
  const { hash } = await hashPassword(password, rec.salt, rec.iterations || 150000);
  return hash === rec.hash;
}

/* stateless owner session token: <expEpoch>.<sig> */
export async function ownerToken(tokenSecret, hours = 12) {
  const exp = Date.now() + hours * 3600e3;
  const sig = (await sha256Hex(tokenSecret + '|owner-session|' + exp)).slice(0, 24);
  return exp + '.' + sig;
}
export async function checkOwnerToken(tokenSecret, token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const want = (await sha256Hex(tokenSecret + '|owner-session|' + exp)).slice(0, 24);
  return want === sig;
}
