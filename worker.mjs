/* =====================================================================
   GOLD Trend Calendar Pro v5 — LICENSE API (Cloudflare Worker)
   ---------------------------------------------------------------------
   POST /v1/activate     {gmail,key,fp}          → verified + grace token
   POST /v1/refresh      {gmail,key,fp}          → renewed grace token
   POST /v1/verify       {gmail,key}             → no token, just truth
   POST /v1/owner/login  {password}              → session token
   POST /v1/owner/issue  {gmail,plan,days,...}   → new key(s)
   POST /v1/owner/extend {gmail,days}            → extra days
   POST /v1/owner/revoke {gmail|key,on}          → burn a license
   GET  /v1/owner/list                           → the whole register
   GET  /health                                  → liveness
   Secrets (wrangler secret put):
     LICENSE_SECRET   private — creates the key checksum
     TOKEN_SECRET     signer of offline tokens (compiled into the app)
     OWNER_PASSWORD   first-run owner password (then stored hashed)
   ===================================================================== */
import {
  verifyActivation, issueKeys, extend, revoke, listLicenses,
  hashPassword, verifyPassword, ownerToken, checkOwnerToken, normMail, validMail, K,
} from '../lib/licensing.mjs';
import { kvStore } from './store.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});

/* naive per-isolate rate limit: 20 failed attempts / 10 min / ip+route */
const hits = new Map();
function limited(id, max = 20, windowMs = 6e5) {
  const now = Date.now();
  const rec = hits.get(id) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n++;
  hits.set(id, rec);
  return rec.n > max;
}

async function body(req) {
  try { return JSON.parse(await req.text() || '{}'); } catch (e) { return null; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (route === '/health') return json({ ok: true, service: 'gtc5-license', time: new Date().toISOString() });

    let store;
    try { store = kvStore(env); } catch (e) { return json({ ok: false, err: 'Server not configured: ' + e.message }, 500); }

    const ip = req.headers.get('cf-connecting-ip') || '0';
    const rateMax = Number(env.RATE_MAX || 20);
    const cfg = {
      licenseSecret: env.LICENSE_SECRET,
      tokenSecret: env.TOKEN_SECRET,
      graceDays: Number(env.GRACE_DAYS || 30),
      extraOfflineDays: Number(env.EXTRA_OFFLINE_DAYS || 7),
      deviceLock: String(env.DEVICE_LOCK || '1') !== '0',
    };
    if (!cfg.licenseSecret || !cfg.tokenSecret) return json({ ok: false, err: 'Server secrets missing (LICENSE_SECRET / TOKEN_SECRET).' }, 500);

    /* ---------------- buyer side ---------------- */
    if (req.method === 'POST' && (route === '/v1/activate' || route === '/v1/refresh' || route === '/v1/verify')) {
      if (limited(ip + route, rateMax)) return json({ ok: false, err: 'Too many attempts — wait 10 minutes.' }, 429);
      const b = await body(req);
      if (!b) return json({ ok: false, err: 'Bad JSON' }, 400);
      const out = await verifyActivation(store, b, cfg);
      if (route === '/v1/verify' && out.ok) {
        return json({ ok: true, plan: out.plan, gmail: out.gmail, expiry: out.expiry });
      }
      return json(out, out.ok ? 200 : 200);   // app shows the message either way
    }

    /* ---------------- owner side ---------------- */
    if (route.startsWith('/v1/owner/')) {
      /* first run: create the owner password from OWNER_PASSWORD */
      let owner = await store.get(K.owner());
      if (!owner) {
        if (!env.OWNER_PASSWORD) return json({ ok: false, err: 'Set OWNER_PASSWORD secret first.' }, 500);
        owner = { ...(await hashPassword(env.OWNER_PASSWORD)), createdAt: new Date().toISOString() };
        await store.put(K.owner(), owner);
      }

      if (route === '/v1/owner/login') {
        if (req.method !== 'POST') return json({ ok: false, err: 'POST only' }, 405);
        if (limited('login:' + ip, Number(env.LOGIN_RATE_MAX || 8), 9e5)) return json({ ok: false, err: 'Too many attempts — wait 15 minutes.' }, 429);
        const b = await body(req);
        if (!b || !(await verifyPassword(String(b.password || ''), owner))) return json({ ok: false, err: 'Wrong password.' }, 401);
        return json({ ok: true, session: await ownerToken(cfg.tokenSecret, 12) });
      }

      const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!(await checkOwnerToken(cfg.tokenSecret, auth))) return json({ ok: false, err: 'Owner session expired — log in again.' }, 401);

      if (route === '/v1/owner/issue' && req.method === 'POST') {
        const b = await body(req);
        if (!b || !validMail(b.gmail)) return json({ ok: false, err: 'Enter a valid Gmail.' }, 400);
        return json(await issueKeys(store, cfg.licenseSecret, b));
      }
      if (route === '/v1/owner/extend' && req.method === 'POST') {
        const b = await body(req);
        if (!b) return json({ ok: false, err: 'Bad JSON' }, 400);
        return json(await extend(store, cfg.licenseSecret, b));
      }
      if (route === '/v1/owner/revoke' && req.method === 'POST') {
        const b = await body(req);
        if (!b) return json({ ok: false, err: 'Bad JSON' }, 400);
        return json(await revoke(store, b, b.on !== false));
      }
      if (route === '/v1/owner/list' && req.method === 'GET') {
        return json({ ok: true, rows: await listLicenses(store) });
      }
      if (route === '/v1/owner/password' && req.method === 'POST') {
        const b = await body(req);
        if (!b || !(await verifyPassword(String(b.current || ''), owner))) return json({ ok: false, err: 'Wrong current password.' }, 401);
        if (String(b.next || '').length < 8) return json({ ok: false, err: 'New password must be 8+ characters.' }, 400);
        const rec = await hashPassword(String(b.next), null, 80000);
        rec.createdAt = owner.createdAt; rec.updatedAt = new Date().toISOString();
        await store.put(K.owner(), rec);
        return json({ ok: true });
      }
      return json({ ok: false, err: 'Unknown owner route ' + route }, 404);
    }

    return json({ ok: false, err: 'Not found' }, 404);
  },
};
