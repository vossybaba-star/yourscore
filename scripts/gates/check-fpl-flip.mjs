/**
 * FPL-flip watcher — detects the moment FPL launches its 2026/27 game.
 *
 * FPL never announces the launch; the public bootstrap-static feed simply
 * flips to the new season (~22 July, historically the Wednesday after the
 * WC final). The flip re-baselines every price, resolves summer movers
 * (the Luis Díaz problem), and widens the warm-up's 26/27 intersection pool —
 * so the question pool must be rebuilt the day it happens, not when someone
 * remembers.
 *
 * Fingerprints the feed (GW1 id/name + deadline year = the season identity)
 * against scripts/data/fpl-flip-fingerprint.json. On a season change:
 *   1. Telegram alert (founder)
 *   2. auto-rebuild: build-pool.sh → validate.sh
 *   3. second Telegram with the result + play-test reminder
 *
 * Run via check-fpl-flip.sh (loads .env.local). First run seeds the
 * fingerprint. Element-count drift alone (FPL adds signings) is logged but
 * does NOT trigger — only a season-identity change does.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sendMessage } from "../tg.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FINGERPRINT = join(root, "scripts/data/fpl-flip-fingerprint.json");

const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
if (!res.ok) { console.error(`✗ bootstrap-static ${res.status}`); process.exit(2); }
const boot = await res.json();

const first = boot.events?.[0];
if (!first?.deadline_time) { console.error("✗ bootstrap has no events — feed shape changed?"); process.exit(2); }
const year = new Date(first.deadline_time).getFullYear();
const now = {
  firstEventId: first.id,
  firstEventName: first.name,
  deadlineYear: year,
  seasonLabel: `${year}/${String((year + 1) % 100).padStart(2, "0")}`,
  elementCount: boot.elements?.length ?? 0,
  teamCount: boot.teams?.length ?? 0,
  checkedAt: new Date().toISOString(),
};

if (!existsSync(FINGERPRINT)) {
  mkdirSync(dirname(FINGERPRINT), { recursive: true });
  writeFileSync(FINGERPRINT, JSON.stringify(now, null, 2));
  console.log(`seeded fingerprint: FPL is serving the ${now.seasonLabel} season (${now.elementCount} players)`);
  process.exit(0);
}

const prev = JSON.parse(readFileSync(FINGERPRINT, "utf8"));
const flipped =
  prev.firstEventId !== now.firstEventId ||
  prev.firstEventName !== now.firstEventName ||
  prev.deadlineYear !== now.deadlineYear;

if (!flipped) {
  if (prev.elementCount !== now.elementCount)
    console.log(`no flip (still ${now.seasonLabel}); element count drifted ${prev.elementCount} → ${now.elementCount}`);
  else console.log(`no flip — FPL still serving ${now.seasonLabel}`);
  writeFileSync(FINGERPRINT, JSON.stringify(now, null, 2)); // keep counts/timestamp fresh
  process.exit(0);
}

console.log(`🚨 FPL FLIPPED: ${prev.seasonLabel} → ${now.seasonLabel}`);
await sendMessage(
  `🚨 <b>FPL has launched its ${now.seasonLabel} game</b>\n` +
    `Feed flipped from ${prev.seasonLabel} (${prev.elementCount} players) to ` +
    `${now.seasonLabel} (${now.elementCount} players).\n` +
    `Rebuilding the warm-up question pool now — result to follow…`,
);

// Rebuild + validate with the fresh feed (scripts self-load .env.local).
const run = (script) => {
  const r = spawnSync("bash", [join(root, "scripts/gates", script)], {
    cwd: root, encoding: "utf8", timeout: 30 * 60 * 1000,
  });
  const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n");
  return { ok: r.status === 0, tail };
};
const build = run("build-pool.sh");
console.log(`build-pool ${build.ok ? "ok" : "FAILED"}:\n${build.tail}`);
const valid = build.ok ? run("validate.sh") : { ok: false, tail: "(skipped — build failed)" };
console.log(`validate ${valid.ok ? "ok" : "FAILED"}:\n${valid.tail}`);

writeFileSync(FINGERPRINT, JSON.stringify(now, null, 2));

const status = build.ok && valid.ok ? "✅ pool rebuilt + validated" : "❌ REBUILD NEEDS ATTENTION";
await sendMessage(
  `${status} for ${now.seasonLabel}\n\n` +
    `<b>build-pool:</b>\n<pre>${build.tail.slice(0, 1200)}</pre>\n` +
    `<b>validate:</b>\n<pre>${valid.tail.slice(0, 1200)}</pre>\n\n` +
    `Next: play one warm-up 26/27 round to sanity-check prices/clubs, then commit the new pool.json.`,
);
process.exit(build.ok && valid.ok ? 0 : 1);
