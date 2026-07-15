#!/usr/bin/env node
/**
 * demo-news.mjs — see the Matchweek → PL → News feed rendering the REAL
 * <NewsFeed>, without waiting for the fantasy cron.
 *
 * Seeds one `fantasy_news_feed` doc (the exact shape the cron writes) into the
 * stub DB, boots the app, and prints the URL. The doc content here is
 * ILLUSTRATIVE placeholder shaped like the real thing — real content flows from
 * the same table via the fantasy news pipeline (with its own fact-check gate).
 *
 * Run:  node scripts/halftime/demo-news.mjs     (app on :3403, Ctrl-C to stop)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STUB_PORT = 8792;
const APP_PORT = 3403;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;

const children = new Set();
function start(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: REPO, stdio: ["ignore", "inherit", "inherit"], detached: true, ...opts });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}
function killAll() {
  for (const c of children) { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* gone */ } } }
}
process.on("exit", killAll);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { killAll(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, ms = 180000) {
  const until = Date.now() + ms;
  for (;;) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await sleep(300);
  }
}
async function seed(table, rows) {
  const res = await fetch(`${STUB}/_stub/seed`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ table, rows }),
  });
  if (!res.ok) throw new Error(`seed ${table} → ${res.status}: ${await res.text()}`);
}

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60_000).toISOString();

// One feed doc, shape-identical to the cron's output. Illustrative content.
const doc = {
  gw: 1,
  deadline: iso(60 * 30), // ~30h out
  builtAt: iso(-40),
  fixtures: { gws: [1], runs: [], updatedAt: iso(-40) },
  teamNews: {
    predicted: [],
    doubts: [
      { smId: 1, name: "Player A", club: "Arsenal", reason: "knock in the final friendly — rated 50/50 for the opener." },
      { smId: 2, name: "Player B", club: "Liverpool", reason: "back in full training after a pre-season lay-off; likely benched." },
    ],
    items: [
      { kind: "article", payload: { title: "How the new signings could reshape the front three", url: "https://example.com/a1", source: "The Analyst" }, createdAt: iso(-95) },
      { kind: "tweet", payload: { text: "Predicted XI for the opener is doing the rounds — one surprise at full-back.", author: "Team News", handle: "@teamnews", url: "https://example.com/t1", verified: "true" }, createdAt: iso(-140) },
    ],
    updatedAt: iso(-40),
  },
  form: { rows: [], updatedAt: iso(-40) },
  insights: {
    items: [
      { kind: "form", title: "One to watch off pre-season", body: "Quietly racked up minutes and end product across the friendlies — worth a look before the price rises." },
      { kind: "fixture-swing", title: "A kind opening run", body: "Three of the first four look gettable on paper — front-load your picks accordingly." },
    ],
    updatedAt: iso(-40),
  },
  transfers: {
    items: [
      { kind: "tweet", payload: { text: "Medical booked for the week — expected to be announced before the opener.", author: "Transfer Desk", handle: "@transferdesk", url: "https://example.com/t2", verified: "true" }, createdAt: iso(-70) },
      { kind: "article", payload: { title: "Loan deal edging closer as clubs agree structure", url: "https://example.com/a2", source: "Market Watch" }, createdAt: iso(-210) },
    ],
    updatedAt: iso(-40),
  },
  tips: {
    gw: 1,
    captain: { player: "the in-form forward", why: "kind opener at home and on set pieces — the safe armband this week." },
    differential: { player: "the budget midfielder", why: "nailed on minutes at a low price; frees up cash elsewhere." },
    note: "Early days — don't take a hit in GW1. Bank the transfer.",
    draftedAt: iso(-40),
    updatedAt: iso(-40),
  },
};

console.log(`\nNEWS DEMO — stub :${STUB_PORT}, app :${APP_PORT}\n`);
start(process.execPath, [join(HERE, "stub-supabase.mjs"), "--port", String(STUB_PORT)]);
await waitFor(`${STUB}/rest/v1/fantasy_news_feed`);
await seed("fantasy_news_feed", [{ gw: 1, doc, updated_at: iso(-40) }]);
console.log("seeded 1 fantasy_news_feed doc");

start("npx", ["next", "dev", "-p", String(APP_PORT)], {
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: STUB,
    SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
    SPORTMONKS_BASE_URL: STUB,
    SPORTMONKS_API_KEY: "demo-key",
    CRON_SECRET: "demo-secret",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
await waitFor(`${APP}/api/pl/news`, 180000);
const check = await (await fetch(`${APP}/api/pl/news`)).json();
console.log(`\n/api/pl/news → doc GW${check?.doc?.gw ?? "—"}, ${check?.doc?.transfers?.items?.length ?? 0} transfer items, tips=${!!check?.doc?.tips?.captain}`);
console.log(`\nOPEN:  ${APP}/matchweek   (opens on PL → News)\n\nCtrl-C to stop.\n`);
await new Promise(() => {});
