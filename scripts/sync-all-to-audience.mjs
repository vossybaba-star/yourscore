/**
 * sync-all-to-audience.mjs
 *
 * One-time (and ongoing) script to populate the main Resend Audience with all
 * YourScore users from Supabase. Safe to re-run — Resend upserts by email.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-all-to-audience.mjs           # dry run
 *   node --env-file=.env.local scripts/sync-all-to-audience.mjs --sync    # SYNC
 */

import { createClient } from "@supabase/supabase-js";
import { loadSuppressions } from "./load-suppressions.mjs";
import { upsertContacts } from "./lib/broadcast.mjs";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--sync");

const CAMPAIGNS_KEY = process.env.RESEND_CAMPAIGNS_API_KEY;
const AUDIENCE_ID   = process.env.RESEND_AUDIENCE_ID;
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CAMPAIGNS_KEY) throw new Error("Missing RESEND_CAMPAIGNS_API_KEY");
if (!AUDIENCE_ID)   throw new Error("Missing RESEND_AUDIENCE_ID");
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED  = new Set(["yourscore.fake", "example.com", "test.com"]);

function isReal(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return false;
  return !BLOCKED.has(e.split("@")[1]);
}

async function fetchAllUsers() {
  const PAGE = 1000;
  let page = 1, all = [];
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`listUsers p${page}: ${error.message}`);
    all.push(...(data.users ?? []));
    if (!data.nextPage) break;
    page++;
  }
  return all;
}

async function main() {
  console.log(`\n📋 YourScore → Resend Audience sync`);
  console.log(`   Audience: ${AUDIENCE_ID}`);
  console.log(`   Mode: ${DRY_RUN ? "DRY RUN" : "⚡ LIVE"}\n`);

  const suppressed = await loadSuppressions();
  console.log(`   ${suppressed.size} suppressed addresses loaded`);

  console.log(`   Fetching all users from Supabase...`);
  const users = await fetchAllUsers();
  console.log(`   ${users.length} users found`);

  const emails = users
    .map(u => u.email?.trim().toLowerCase())
    .filter(e => e && isReal(e) && !suppressed.has(e));

  const skipped = users.length - emails.length;
  if (skipped > 0) console.log(`   ⚠️  Skipped ${skipped} (suppressed / invalid)`);
  console.log(`   Syncing ${emails.length} contacts to audience\n`);

  if (DRY_RUN) {
    console.log(`   First 5: ${emails.slice(0, 5).join(", ")}`);
    console.log(`\n🛑 DRY RUN — pass --sync to run.\n`);
    return;
  }

  const start = Date.now();
  let last = 0;
  process.stdout.write(`   Progress: `);
  await upsertContacts(CAMPAIGNS_KEY, AUDIENCE_ID, emails, {
    concurrency: 4,
    onProgress: (done, total) => {
      const pct = Math.floor((done / total) * 20);
      while (last < pct) { process.stdout.write("█"); last++; }
    },
  });
  console.log(` (${emails.length})`);
  console.log(`\n✅ Sync done in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
