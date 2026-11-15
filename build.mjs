#!/usr/bin/env node
/* =====================================================================
   build.mjs — GOLD Trend Calendar Pro v5 → v5.1 "server-verified" build
   ---------------------------------------------------------------------
   1. copies src/index.html  (your untouched v5.0 file)
   2. replaces the whole client-side key system with the server client
   3. injects YOUR license-server URL + token signer
   4. syntax-checks the result (node --check)
   5. optionally minifies + obfuscates for the public deploy

   usage:
     node build.mjs                                  # patched, readable → dist/index.html
     node build.mjs --endpoint https://x.workers.dev --token SECRET
     node build.mjs --endpoint … --token … --obfuscate   # → dist/index.min.html
   ===================================================================== */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : d; };
const OBF = args.includes('--obfuscate');
const ALLOW_LOCAL = args.includes('--allow-local');   /* dev only: permits a 127.0.0.1 license endpoint */
const SRC = arg('src', path.join(HERE, 'src', 'index.html'));
const OUT = arg('out', '');            /* optional explicit output path */
/* endpoint/token: --endpoint · --token, else license-endpoint.txt (2 lines),
   else the placeholder (build still works, activation refuses) */
let fileEndpoint = '', fileToken = '';
try {
  const lines = (await fs.readFile(path.join(HERE, 'license-endpoint.txt'), 'utf8'))
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  fileEndpoint = lines[0] || ''; fileToken = lines[1] || '';
} catch (e) { /* no file → use flags/placeholder */ }
const ENDPOINT = arg('endpoint', fileEndpoint || '__LICENSE_ENDPOINT__');
const TOKEN = arg('token', fileToken || '__TOKEN_SECRET__');

const PATCH = async f => fs.readFile(path.join(HERE, 'patches', f), 'utf8');

/* replace the text between `startAnchor` (inclusive) and `endAnchor` (exclusive) */
function replaceBlock(html, startAnchor, endAnchor, replacement, label) {
  const a = html.indexOf(startAnchor);
  if (a < 0) throw new Error(`[${label}] start anchor not found: ${startAnchor.slice(0, 60)}…`);
  const b = html.indexOf(endAnchor, a + startAnchor.length);
  if (b < 0) throw new Error(`[${label}] end anchor not found: ${endAnchor.slice(0, 60)}…`);
  return html.slice(0, a) + replacement + html.slice(b);
}
function replaceOnce(html, find, replacement, label) {
  const i = html.indexOf(find);
  if (i < 0) throw new Error(`[${label}] not found: ${find.slice(0, 70)}…`);
  return html.slice(0, i) + replacement + html.slice(i + find.length);
}
const betweenMarkers = (html, open, close) => {
  const a = html.indexOf(open), b = html.indexOf(close);
  return a > -1 && b > a ? html.slice(a + open.length, b) : '';
};

async function main() {
  let html = await fs.readFile(SRC, 'utf8');
  const before = html.length;

  /* ---- 0. retire the old local owner tools (they are replaced below) ---- */
  html = replaceBlock(html,
    'function testSync(){',
    '/* =====================================================================\n   6.2 · BUYER-SEARCH KEYWORD ENGINE',
    '',
    'old-owner-tools');

  /* ---- 1. the key core: makeKey / verifyKey / ADMIN_SECRET checksum ---- */
  html = replaceBlock(html,
    'function makeKey(gmail,planId,issueDate,daysOverride){',
    '/* ---------- trial (7 days, tamper-evident, machine-bound, mirrored) ---------- */',
    await PATCH('a-key-core.js'),
    'key-core');

  /* ---- 2. licenseState / activate ---- */
  html = replaceBlock(html,
    '/* ---------- license state ---------- */\nlet LIC=null;\nfunction licenseState(){',
    'function lockHeader(){',
    await PATCH('b-license-state.js'),
    'license-state');

  /* ---- 3. buyer activation + owner key screens ---- */
  const C = await PATCH('c-render-client.js');
  html = replaceBlock(html,
    'function doActivate(){',
    'function orderPlan(id){',
    C.slice(C.indexOf('function doActivate(){'), C.indexOf('function renderOwnerKeys(){')),
    'client');
  html = replaceBlock(html,
    'function renderOwnerKeys(){',
    'function drawIssuedList(filter){',
    C.slice(C.indexOf('function renderOwnerKeys(){'), C.indexOf('function drawIssuedList(filter){')),
    'owner-keys');
  html = replaceBlock(html,
    'function drawIssuedList(filter){',
    'function genKeys(){',
    C.slice(C.indexOf('function drawIssuedList(filter){'), C.indexOf('function genKeys(){')),
    'issued-list');
  html = replaceBlock(html,
    'function genKeys(){',
    'function exportKeysCSV(){',
    C.slice(C.indexOf('function genKeys(){'), C.indexOf('function exportKeysCSV(){')),
    'gen-extend-revoke');

  /* ---- 4. seat helpers ---- */
  html = replaceBlock(html,
    'const issued=()=>{',
    '/* ---------------- owner console UI (4 tabs) ---------------- */',
    await PATCH('d-seat-helpers.js'),
    'seat-helpers');

  /* ---- 5. owner gate (password on the server) ---- */
  html = replaceBlock(html,
    'const ownerHash=pw=>sha256(',
    '/* ---------------- seat / activation helpers',
    await PATCH('e-owner-gate.js') + '\n',
    'owner-gate');

  /* ---- 6. owner console shell ---- */
  html = replaceBlock(html,
    '/* ---------------- owner console UI (4 tabs) ---------------- */',
    'function renderOwnerDash(){',
    await PATCH('f-owner-shell.js'),
    'owner-shell');

  /* ---- 7. licenseWatch (single, non-duplicating) ---- */
  html = replaceBlock(html,
    'function licenseWatch(){',
    '/* =====================================================================\n   PART 9',
    await PATCH('g-license-watch.js') + '\n',
    'license-watch');

  /* ---- 8. drop the old "default salt" warning blocks ---- */
  html = html.replace(/\$\{ADMIN_SECRET==='GTC5-HS-2026-MICROSTOCK-DNA'\?`[\s\S]*?`:''\}/g, '');
  html = html.replace(/<div class="hint-t" style="color:var\(--danger\);margin-top:7px">\$\{bn\?'বিক্রির আগে index\.html-এ ADMIN_SECRET বদলান[\s\S]*?<\/div>/g, '');
  /* admin-profile e-mail in the owner modal title no longer leaks a hard-coded Gmail */
  html = html.replace('<div class="kv"><span>${bn?\'সিক্রেট\':\'Signing secret\'}</span><b style="font-size:10px;color:${ADMIN_SECRET===\'GTC5-HS-2026-MICROSTOCK-DNA\'?\'var(--danger)\':\'var(--success)\'}">${ADMIN_SECRET===\'GTC5-HS-2026-MICROSTOCK-DNA\'?\'⚠️ DEFAULT — change it!\':\'✓ custom\'}</b></div>',
    '<div class="kv"><span>${bn?\'কি ভেরিফিকেশন\':\'Key verification\'}</span><b style="font-size:10px;color:${licConfigured()?\'var(--success)\':\'var(--danger)\'}">${licConfigured()?\'🔐 server-side\':\'⚠️ not configured\'}</b></div>');
  /* ADMIN_SECRET stops being a signing salt: keep the name (trial/device hashing
     still uses it) but make it a random per-build value, not the shipped constant */
  html = replaceOnce(html,
    "const ADMIN_SECRET='GTC5-HS-2026-MICROSTOCK-DNA';   // signing salt (edit before redistributing)",
    "/* no signing secret lives in this file any more — see LICENSE SERVER below.\n   ADMIN_SECRET is now only a local salt for the trial / device hash; it grants nothing. */\nconst ADMIN_SECRET='__LOCAL_SALT__';",
    'admin-secret');

  /* a paid app has no business in Google's index */
  html = replaceOnce(html, '<head>', '<head>\n<meta name="robots" content="noindex,nofollow">', 'noindex');

  /* ---- 9. inject the public config right after the licensing section ---- */
  const cfg = ((await PATCH('h-endpoint.js')) + (ALLOW_LOCAL ? 'const LICENSE_DEV = true;   /* local testing only */\n' : ''))
    .replace('__LICENSE_ENDPOINT__', ENDPOINT)
    .replace('__TOKEN_SECRET__', TOKEN);
  html = replaceOnce(html, '/* =====================================================================\n   PART 5', cfg + '/* =====================================================================\n   PART 5', 'endpoint-inject');

  /* random local salt per build + boot the license heartbeat */
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  html = html.replace('__LOCAL_SALT__', salt);
  html = replaceOnce(html, '  if(typeof licenseState===\'function\'){ lockUI(); maybeTour(); licenseWatch(); }',
    '  if(typeof licenseState===\'function\'){ lockUI(); maybeTour(); licenseWatch(); licServerBoot(); }', 'boot-hook');

  /* ---- 10. write + syntax check ---- */
  await fs.mkdir(path.join(HERE, 'dist'), { recursive: true });
  const outFile = OUT ? path.resolve(HERE, OUT) : path.join(HERE, 'dist', OBF ? 'index.min.html' : 'index.html');
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, html);

  const script = betweenMarkers(html, '<script>', '</script>');
  const tmp = path.join(path.dirname(outFile), '.check.js');
  await fs.writeFile(tmp, script);
  try {
    await run(process.execPath, ['--check', tmp]);
    console.log('✓ syntax OK');
  } catch (e) {
    console.error('✗ SYNTAX ERROR\n' + (e.stderr || e.message));
    process.exitCode = 1;
    return;
  }

  /* sanity assertions */
  const bad = [];
  if (/GTC5-HS-2026-MICROSTOCK-DNA/.test(html)) bad.push('old default salt still present');
  if (!/const LICENSE_ENDPOINT\s*=\s*'/.test(html)) bad.push('LICENSE_ENDPOINT missing');
  if (/ADMIN_SECRET\.\.\.|sig\(gmailN,p\.payload\)/.test(html)) bad.push('client-side checksum still present');
  if (bad.length) { console.error('✗ audit failed: ' + bad.join('; ')); process.exitCode = 1; return; }
  console.log('✓ audit: no shipped secret, no client-side key minting');

  if (OBF) {
    await obfuscate(outFile);
  }

  const after = (await fs.stat(outFile)).size;
  console.log(`✓ ${path.relative(HERE, outFile)}  ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`);
  if (ENDPOINT === '__LICENSE_ENDPOINT__') {
    console.log('\n⚠️  LICENSE_ENDPOINT is still the placeholder — activation will refuse until you build with:');
    console.log('    node build.mjs --endpoint https://gtc-license.YOURNAME.workers.dev --token YOUR_TOKEN_SECRET');
  }
}

async function obfuscate(file) {
  let terser, Obfuscator;
  try {
    ({ minify: terser } = await import('terser'));
    ({ default: Obfuscator } = await import('javascript-obfuscator'));
  } catch (e) {
    console.log('… minifier not installed (npm i terser javascript-obfuscator) — shipping readable file');
    return;
  }
  const html = await fs.readFile(file, 'utf8');
  const open = html.indexOf('<script>'), close = html.lastIndexOf('</script>');
  const code = html.slice(open + 8, close);
  const min = (await terser(code, { compress: { passes: 2 }, mangle: true, format: { comments: false } })).code;
  const obf = Obfuscator.obfuscate(min, {
    compact: true,
    controlFlowFlattening: false,          /* keeps the file fast; the licence logic is already off-file */
    deadCodeInjection: false,
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,                  /* inline onclick="…" handlers must keep working */
    selfDefending: true,
    disableConsoleOutput: true,
  }).getObfuscatedCode();
  const out = html.slice(0, open + 8) + '\n' + obf + '\n' + html.slice(close);
  await fs.writeFile(file.replace('.min.html', '.min.html'), out);
  console.log('✓ obfuscated');
}

main().catch(e => { console.error('✗ ' + e.message); process.exitCode = 1; });
