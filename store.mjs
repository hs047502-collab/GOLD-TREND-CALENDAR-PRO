/* Storage adapters — the licensing core only needs get / put / list / delete.
   · kvStore()    → Cloudflare KV binding (production)
   · fileStore()  → a local JSON file (unit tests, dry runs)
   · memStore()   → in-memory (tests) */

export function kvStore(env) {
  const kv = env.LIC_KV;
  if (!kv) throw new Error('Missing KV binding LIC_KV');
  return {
    async get(k) {
      const v = await kv.get(k, 'json');
      return v || null;
    },
    async put(k, obj) { await kv.put(k, JSON.stringify(obj)); },
    async delete(k) { await kv.delete(k); },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const page = await kv.list({ prefix, cursor });
        for (const k of page.keys) {
          const v = await kv.get(k.name, 'json');
          if (v) out.push(v);
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return out;
    },
  };
}

export function memStore() {
  const m = new Map();
  return {
    get: async k => JSON.parse(JSON.stringify(m.get(k) ?? null)),
    put: async (k, o) => { m.set(k, JSON.parse(JSON.stringify(o))); },
    delete: async k => { m.delete(k); },
    list: async p => [...m.entries()].filter(([k]) => k.startsWith(p)).map(([, v]) => JSON.parse(JSON.stringify(v))),
  };
}

export async function fileStore(path) {
  const fs = await import('node:fs/promises');
  let db = {};
  try { db = JSON.parse(await fs.readFile(path, 'utf8')); } catch (e) { db = {}; }
  const flush = () => fs.writeFile(path, JSON.stringify(db, null, 1));
  return {
    get: async k => (db[k] === undefined ? null : JSON.parse(JSON.stringify(db[k]))),
    put: async (k, o) => { db[k] = JSON.parse(JSON.stringify(o)); await flush(); },
    delete: async k => { delete db[k]; await flush(); },
    list: async p => Object.entries(db).filter(([k]) => k.startsWith(p)).map(([, v]) => v),
  };
}
