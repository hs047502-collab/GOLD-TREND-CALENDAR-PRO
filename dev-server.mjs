/* Local dry-run of the Worker:  node dev-server.mjs   → http://127.0.0.1:8787
   Uses a JSON file as the store so you can test keys before deploying. */
import http from 'node:http';
import worker from './src/worker.mjs';
import { fileStore } from './src/store.mjs';

const PORT = Number(process.env.PORT || 8787);
const env = {
  LICENSE_SECRET: process.env.LICENSE_SECRET || 'dev-license-secret-CHANGE-ME',
  TOKEN_SECRET: process.env.TOKEN_SECRET || 'dev-token-secret-CHANGE-ME',
  OWNER_PASSWORD: process.env.OWNER_PASSWORD || 'devowner123',
  GRACE_DAYS: '30', EXTRA_OFFLINE_DAYS: '7', DEVICE_LOCK: '1', RATE_MAX: '100000', LOGIN_RATE_MAX: '100000',
};

/* the local store is injected through the same KV-ish interface */
const file = await fileStore(process.env.DB || './dev-db.json');
env.LIC_KV = undefined;   // kvStore(env) throws → we patch it below
const shim = {
  async get(k, t) { const v = await file.get(k); return t === 'json' ? v : (v == null ? null : JSON.stringify(v)); },
  async put(k, v) { await file.put(k, JSON.parse(v)); },
  async delete(k) { await file.delete(k); },
  async list(o = {}) {
    const rows = await file.list(o.prefix || '');
    const keys = await (await file.list(o.prefix || '')).map(r => ({ name: 'lic:' + r.key }));
    return { keys, list_complete: true };
  },
};
Object.defineProperty(env, 'LIC_KV', { get: () => shim, configurable: true });

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  const request = new Request('http://127.0.0.1' + req.url, {
    method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body,
  });
  request.headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
  const out = await worker.fetch(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
}).listen(PORT, '0.0.0.0', () => {
  console.log('license API on http://127.0.0.1:' + PORT);
  console.log('owner password: ' + env.OWNER_PASSWORD + '  (dev only)');
});
