#!/usr/bin/env node
/**
 * gen-recap-latest.mjs — cron entry point for the Gameweek Recap Quiz.
 *
 * gen-recap.mjs needs an explicit --gameweek; a gameweek number is not a date,
 * so a plain cron cannot supply it. This wrapper figures out which gameweek has
 * just FINISHED and shells out to gen-recap for it — then the normal gate
 * approves it, and the Vercel publish cron ships it.
 *
 * "Just finished" = the highest gameweek all of whose fixtures kicked off more
 * than SETTLE_HOURS ago (so every match is done, not just started). It skips a
 * gameweek that already has a recap row, so re-running is a cheap no-op and it
 * never spends a second LLM pass on the same week.
 *
 * OFF-SEASON SAFE: before the season no gameweek is complete, so it finds
 * nothing and exits 0 without any SportMonks/Anthropic cost. It is therefore
 * harmless to schedule now; its first real run is after GW1 (2026-08-24-ish),
 * which is when it must be verified end-to-end for the first time.
 *
 * Usage: gen-recap-latest.mjs [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as api from "../halftime/lib/api.mjs";
import { loadEnvFile, has } from "../halftime/lib/env.mjs";

loadEnvFile();

const SEASON = Number(process.env.GAMEDAY_SEASON_ID ?? 28083); // 2026/27
const SETTLE_HOURS = 2.5; // a fixture is "finished" this long after kickoff
const LOOKBACK_DAYS = 14; // how far back to look for the most recent gameweek

async function main() {
  const dryRun = has(process.argv.slice(2), "--dry-run");
  const now = Date.now();
  const fromUtc = new Date(now - LOOKBACK_DAYS * 864e5).toISOString();
  const toUtc = new Date(now).toISOString();

  const rows = await api.readFixtures({ fromUtc, toUtc });
  // Real fixtures only — recap sentinel rows carry a negative fixture_id and
  // must never seed a recap of themselves.
  const fixtures = rows.filter((r) => Number(r.fixture_id) > 0 && r.round_name != null);
  if (!fixtures.length) {
    console.error("[gen-recap-latest] no recent fixtures in window — nothing to recap");
    return;
  }

  // Group by gameweek (round_name is a plain integer string), and keep only
  // gameweeks where EVERY fixture has kicked off > SETTLE_HOURS ago.
  const settleBefore = now - SETTLE_HOURS * 36e5;
  const byGw = new Map();
  for (const f of fixtures) {
    const gw = Number(f.round_name);
    if (!Number.isFinite(gw)) continue;
    if (!byGw.has(gw)) byGw.set(gw, []);
    byGw.get(gw).push(new Date(f.kickoff_at).getTime());
  }
  const finishedGws = [...byGw.entries()]
    .filter(([, kos]) => kos.every((t) => t < settleBefore))
    .map(([gw]) => gw)
    .sort((a, b) => b - a);

  if (!finishedGws.length) {
    console.error("[gen-recap-latest] no fully-finished gameweek in window yet");
    return;
  }
  const gameweek = finishedGws[0];

  // Already recapped? A recap row is kind='recap' for this (season, gameweek).
  const existing = await recapExists(SEASON, gameweek);
  if (existing) {
    console.error(`[gen-recap-latest] GW${gameweek} already has a recap — skipping`);
    return;
  }

  console.error(`[gen-recap-latest] latest finished gameweek = ${gameweek}${dryRun ? " (dry-run)" : ""}`);
  const here = dirname(fileURLToPath(import.meta.url));
  const args = ["--env-file=.env.local", join(here, "gen-recap.mjs"),
    "--season", String(SEASON), "--gameweek", String(gameweek)];
  if (dryRun) args.push("--dry-run");
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

/** True if a kind='recap' row already exists for this season+gameweek. */
async function recapExists(season, gameweek) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const q = new URLSearchParams({
    select: "fixture_id",
    kind: "eq.recap",
    season_id: `eq.${season}`,
    gameweek: `eq.${gameweek}`,
    limit: "1",
  });
  const res = await fetch(`${url}/rest/v1/halftime_releases?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`recapExists read failed ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

main().catch((e) => {
  console.error("[gen-recap-latest] failed:", e.message);
  process.exit(1);
});
