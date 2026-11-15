# DEPLOY — GitHub + Cloudflare Pages (বাংলা, ধাপে ধাপে)

সময় ~২০ মিনিট। খরচ ৳০। দুইটা আলাদা কাজ:
**(ক)** লাইসেন্স সার্ভার কোথাও হোস্ট করা (একবার) — **(খ)** অ্যাপের `index.html` GitHub-এ দিয়ে লিংক বানানো।

---

## A. লাইসেন্স সার্ভার (একবারই)

```bash
cd GTC/LICENSE-SERVER
npx wrangler login
npx wrangler kv namespace create LIC_KV         # আউটপুটের id → wrangler.toml-এ বসান

node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # → LICENSE_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # → TOKEN_SECRET (লিখে রাখুন)

npx wrangler secret put LICENSE_SECRET          # উপরে পাওয়া ১ম মান
npx wrangler secret put TOKEN_SECRET            # উপরে পাওয়া ২য় মান
npx wrangler secret put OWNER_PASSWORD          # ওনার কনসোলের পাসওয়ার্ড (৮+ অক্ষর)
npx wrangler deploy                             # → https://gtc-license.xxx.workers.dev
```

যাচাই: ব্রাউজারে `https://gtc-license.xxx.workers.dev/health` → `{"ok":true,...}`

---

## B. বিল্ড (GitHub-এ দেওয়ার ফাইল)

```bash
cd GTC
cp license-endpoint.txt.example license-endpoint.txt
# license-endpoint.txt-এ দুই লাইন লিখুন: ১) Worker URL  ২) TOKEN_SECRET
node build.mjs --obfuscate --out github-upload/index.html
```

আউটপুট `✓ audit: no shipped secret` দেখলে ঠিক আছে।
**এখন থেকেই** `github-upload/` ফোল্ডারটাই GitHub-এ যাবে — আর কিছু না।

যাচাই (নিজের চোখে): `github-upload/index.html` খুলে `Ctrl+U` → `GTC5-HS-2026…` নেই, `makeKey` নেই, শুধু আপনার Worker URL আছে।

---

## C. GitHub-এ আপলোড

1. GitHub → **New repository** → নাম `gold-trend-calendar` → **Private** → Create
2. **Add file → Upload files** → `github-upload/` ফোল্ডারের ভেতরের ৫টা ফাইল টেনে দিন:
   `index.html`, `404.html`, `robots.txt`, `README.md`, `.gitignore` → Commit
3. রিপো → **Settings → Pages**
   - Free প্ল্যানে `index.html` ঠিকভাবে সার্ভ করতে রিপো **Public** করতে হবে (তাহলে শুধু *এই ৫টা ফাইল* পাবলিক — সোর্স কোড, সার্ভার কোড, সিক্রেট কিছুই থাকবে না)
   - Pro থাকলে **Private** রেখেই Pages চালাতে পারবেন (Pages সাইট তবু পাবলিক — এটাই স্বাভাবিক, বায়ারকে তো লিংক দিতেই হবে)
4. Pages → Source = *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save
5. ১–২ মিনিটে লিংক: `https://আপনারইউজারনেম.github.io/gold-trend-calendar/`

> 💡 চাইলে একই ফোল্ডার Cloudflare Pages-এও আপলোড করতে পারেন (রিপো প্রাইভেট রেখেই) — লিংক হবে `xxx.pages.dev`। GitHub Pages-এর চেয়ে কিছুটা ভালো, কারণ রিপো পাবলিক করতে হয় না।

---

## D. প্রথম কি ইস্যু

1. আপনার লিংক খুলুন → HS লোগোয় দ্রুত **৫ ট্যাপ**
2. `OWNER_PASSWORD` দিন
3. **🔑 Keys** ট্যাব → বায়ারের Gmail, প্ল্যান, মেয়াদ → **Issue on server**
4. **📋 activation line** কপি → বায়ারকে পাঠান (`buyer@gmail.com GTC5-XXXXX-XXXXX-XXXXX`)

বায়ার: লিংক খুলবে → পেওয়াল → লাইনটা পেস্ট → **Activate** → আনলক।

---

## E. পরে অ্যাপ আপডেট করলে

```bash
node build.mjs --obfuscate --out github-upload/index.html
```
তারপর GitHub-এ শুধু `index.html` আবার আপলোড করুন (Commit) → Pages নিজেই নতুন ফাইল সার্ভ করবে। বায়ারদের কিছু করতে হবে না, কি-ও বদলাবে না।

---

## F. কী কোথায় যাবে (গুরুত্বপূর্ণ)

| ফাইল/ফোল্ডার | GitHub-এ? | কেন |
|---|---|---|
| `github-upload/index.html` | ✅ হ্যাঁ | এটাই অ্যাপ (obfuscated, কোনো সিক্রেট নেই) |
| `github-upload/404.html`, `robots.txt`, `README.md`, `.gitignore` | ✅ হ্যাঁ | Pages-এর ছোটখাটো ফাইল |
| `src/index.html`, `patches/`, `build.mjs`, `e2e.mjs` | ❌ না | আপনার সোর্স — রিপোতে দিলে সুরক্ষার অর্থ শেষ |
| `LICENSE-SERVER/` | ❌ **কখনো না** | এখানেই কি বানানোর সিক্রেট |
| `license-endpoint.txt` | ❌ না | এতে TOKEN_SECRET আছে |
| `dist/`, `node_modules/` | ❌ না | বিল্ড আউটপুট |

**নিয়ম:** GitHub রিপোতে শুধু `github-upload/` ফোল্ডারের ভেতরের জিনিস। বাকি সব আপনার পিসিতে।

---

## ট্রাবলশুটিং

| সমস্যা | সমাধান |
|---|---|
| পেওয়ালে "This copy has no license server configured" | বিল্ড placeholder endpoint দিয়ে হয়েছে → ধাপ B আবার (license-endpoint.txt ভরে) |
| "Cannot reach the license server" | Worker ডিপ্লয় হয়নি / URL ভুল / বায়ারের নেট নেই (গ্রেস টোকেন থাকলে তবু চলবে) |
| "Unknown plan code" / "not issued by the owner" | কি-টা এই সার্ভারের নয় — সার্ভার থেকে নতুন কি ইস্যু করুন |
| "Owner session expired" | ১২ ঘণ্টা পার — আবার পাসওয়ার্ড দিন |
| পাসওয়ার্ড ভুলে গেছেন | `cd LICENSE-SERVER && npx wrangler kv key delete --namespace-id=<id> "owner"` → পরের লগইনে `OWNER_PASSWORD` আবার সেট হবে |
| Pages ৪০৪ দেখাচ্ছে | ফাইলের নাম হুবহু `index.html`, branch `main`, folder `/ (root)` |
