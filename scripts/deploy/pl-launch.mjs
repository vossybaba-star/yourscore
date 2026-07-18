#!/usr/bin/env node
/**
 * pl-launch.mjs — the PL-tab go-live runbook as ONE command per phase.
 *
 *   node --env-file=.env.local scripts/deploy/pl-launch.mjs --pre
 *       BEFORE the deploy. Applies migrations 86-92 to prod (additive only:
 *       new tables, own-table RLS/triggers — verified by grep before writing),
 *       seeds the first pl_news_feed doc directly via PostgREST, then asserts
 *       every table exists. Safe while old code is live: nothing deployed
 *       reads these tables yet.
 *
 *   node --env-file=.env.local scripts/deploy/pl-launch.mjs --post
 *       AFTER the deploy (merge -> push main -> Vercel green). Syncs real
 *       fixtures through the LIVE app's own API (sync-fixtures.mjs, window 45
 *       days — pre-season GW1 is ~36 days out), then smoke-checks the public
 *       endpoints: standings has 20 clubs, fixtures returns GW1, news has
 *       items. Fixtures must wait for the deploy because the sync script
 *       writes through /api/halftime/fresh, which doesn't exist on prod yet.
 *
 * Every step asserts its result (LOOP rule 1) and the script stops on the
 * first failure — a half-applied launch should look failed, not shipped.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const REF = "mznvuswzgkaupvaqznkm";

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const SUPA_URL = need("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = need("SUPABASE_SERVICE_ROLE_KEY");

const MIGRATIONS = [
  "86_halftime.sql",
  "87_club_fans.sql",
  "88_halftime_predictions.sql",
  "89_pl_news.sql",
  "90_quiz_highlights.sql",
  "91_halftime_reminders.sql",
  "92_waitlist_emails.sql",
];
const TABLES = [
  "halftime_releases", "halftime_control", "halftime_heartbeat",
  "club_supporters", "halftime_predictions", "halftime_prediction_results",
  "pl_news_feed", "quiz_highlights", "halftime_reminders", "waitlist_emails",
];

const rest = (path, init = {}) =>
  fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json", ...(init.headers ?? {}),
    },
  });

async function ddl(sql) {
  const tok = need("SUPABASE_ACCESS_TOKEN");
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (r.status >= 300) throw new Error(`DDL ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function pre() {
  console.log("── phase: PRE (migrations + news seed) ──");
  for (const f of MIGRATIONS) {
    const sql = readFileSync(join(REPO, "supabase", "migrations", f), "utf8");
    await ddl(sql);
    console.log(`  applied ${f}`);
  }
  for (const t of TABLES) {
    const r = await rest(`${t}?select=count&limit=1`, { headers: { Prefer: "count=exact" } });
    if (r.status !== 200 && r.status !== 206) throw new Error(`assert failed: ${t} → ${r.status}`);
    console.log(`  ✓ ${t} exists`);
  }

  // First news doc, so the tab has content the second the deploy lands (the
  // 30-min cron takes over from there). Direct PostgREST — no app needed.
  const ingest = spawnSync(process.execPath, [join(REPO, "scripts", "pl-news-ingest.mjs")], {
    stdio: "inherit",
    env: { ...process.env, PL_NEWS_TARGET: SUPA_URL },
  });
  if (ingest.status !== 0) throw new Error("news ingest failed");
  const news = await (await rest("pl_news_feed?id=eq.1&select=doc")).json();
  const n = news?.[0]?.doc?.items?.length ?? 0;
  if (n === 0) throw new Error("news doc empty after ingest");
  console.log(`  ✓ pl_news_feed seeded (${n} items)`);
  console.log("PRE complete. Next: merge to main, push, wait for Vercel, then --post.");
}

async function post() {
  console.log("── phase: POST (fixtures via live app + smoke) ──");
  const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://yourscore.app").replace(/\/$/, "");

  const sync = spawnSync(process.execPath, [join(REPO, "scripts", "halftime", "sync-fixtures.mjs"), "--window", "45"], {
    stdio: "inherit",
    env: { ...process.env, HALFTIME_API_BASE: APP },
  });
  if (sync.status !== 0) throw new Error("fixture sync failed");

  const fixtures = await (await fetch(`${APP}/api/pl/fixtures`)).json();
  if ((fixtures.fixtures?.length ?? 0) === 0) throw new Error("live /api/pl/fixtures is empty");
  console.log(`  ✓ fixtures live: GW${fixtures.round}, ${fixtures.fixtures.length} matches`);

  const standings = await (await fetch(`${APP}/api/pl/standings`)).json();
  if ((standings.standings?.length ?? 0) !== 20) throw new Error(`standings: ${standings.standings?.length ?? 0} clubs (want 20)`);
  console.log("  ✓ standings live: 20 clubs");

  const news = await (await fetch(`${APP}/api/pl/news`)).json();
  if ((news.doc?.items?.length ?? 0) === 0) throw new Error("live news feed empty");
  console.log(`  ✓ news live: ${news.doc.items.length} items`);
  console.log("POST complete — the PL tab is live.");
}

const phase = process.argv.includes("--post") ? post : process.argv.includes("--pre") ? pre : null;
if (!phase) {
  console.log("usage: pl-launch.mjs --pre | --post");
  process.exit(1);
}
phase().catch((e) => { console.error("\nLAUNCH STEP FAILED:", e.message); process.exit(1); });
