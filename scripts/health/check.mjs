/**
 * check.mjs — YourScore synthetic health check. Runs 4x/day (08:20, 12:30,
 * 17:45, 22:30 UK) via launchd now, cron on the VPS later.
 *
 * Layers (each under its own wall-clock budget; one wedged layer never blocks
 * the rest, and a Telegram scorecard goes out after EVERY run):
 *   0 cleanup   — purge any bot rows a crashed previous run left behind
 *   1 api       — anonymous surface (routes, leaderboards, draft pool JSON)
 *   2 fresh     — data invariants (today's pack, edition roll, cron effects)
 *   3 journeys  — the bot actually plays (quiz, solo, WC draft, H2H, lobby)
 *   4 browser   — headless Playwright smoke (catches stale-chunk/JS breakage)
 *   5 sentry    — new/spiking prod errors in the last 6h
 *   6 jobs      — dead-man switches for the other automations
 *   7 gamer     — experience QA (repeats, shuffle, recycling) + daily LLM review
 *
 * Usage:
 *   node --env-file=.env.local scripts/health/check.mjs                # full run
 *   node --env-file=.env.local scripts/health/check.mjs --layer=api,fresh
 *   node --env-file=.env.local scripts/health/check.mjs --no-telegram  # local/dry
 *   node --env-file=.env.local scripts/health/check.mjs --with-llm     # force 7B
 */

import { createReport, withBudget } from "./lib/report.mjs";
import { BASE } from "./lib/http.mjs";

// Route the scorecard through the health bot when configured; otherwise fall
// back to the shared launch bot. Must happen BEFORE tg.mjs is imported — its
// token is a module-level const.
if (process.env.HEALTH_TELEGRAM_BOT_TOKEN) {
  process.env.TELEGRAM_LAUNCH_BOT_TOKEN = process.env.HEALTH_TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_LAUNCH_CHAT_ID = process.env.HEALTH_TELEGRAM_CHAT_ID || process.env.TELEGRAM_LAUNCH_CHAT_ID;
}

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--layer="))?.slice(8).split(",");
const noTelegram = args.includes("--no-telegram") || args.includes("--dry");
const withLLM = args.includes("--with-llm");

// Watchdog: whatever happens, this process reports and dies inside 8 minutes.
const startedAt = new Date();
const watchdog = setTimeout(async () => {
  console.error("✗ watchdog: run exceeded 8 minutes — reporting partial results");
  await finish(true).catch(() => {});
  process.exit(1);
}, 8 * 60_000);
watchdog.unref();

const report = createReport();
const ctx = { base: BASE, withLLM }; // shared artifacts: pool, todayPack, servedQuestions, screenshots…

// Network pre-flight: if the RUNNER's own internet is down, every layer would
// red-alert "site down" (it happened: ERR_INTERNET_DISCONNECTED paged a full
// outage while yourscore.app was fine). Probe two independent reference hosts;
// if both are unreachable, record a quiet network-down run and exit 0 —
// Telegram couldn't deliver the alert anyway.
async function internetUp() {
  const probe = (url) =>
    fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8_000) }).then(() => true, () => false);
  const [a, b] = await Promise.all([probe("https://www.google.com/generate_204"), probe("https://1.1.1.1/")]);
  return a || b;
}
if (!(await internetUp()) && !(await internetUp())) { // re-check once after the first 8s window
  console.error("✗ runner has no internet — skipping this run (not a site outage)");
  report.add("cleanup", "network pre-flight", true, { warn: true, detail: "runner offline — run skipped" });
  report.persist(startedAt, Date.now() - startedAt.getTime(), { base: BASE, networkDown: true });
  process.exit(0);
}

const LAYERS = [
  { key: "cleanup", module: "./cleanup.mjs", budgetMs: 60_000, needsBot: true },
  { key: "api", module: "./checks/anon-api.mjs", budgetMs: 90_000 },
  { key: "fresh", module: "./checks/freshness.mjs", budgetMs: 60_000 },
  { key: "journeys", module: "./checks/journeys.mjs", budgetMs: 150_000, needsBot: true },
  { key: "browser", module: "./checks/browser.mjs", budgetMs: 200_000 },
  { key: "nav", module: "./checks/navigation.mjs", budgetMs: 180_000, needsBot: true },
  { key: "sentry", module: "./checks/sentry.mjs", budgetMs: 30_000 },
  { key: "jobs", module: "./checks/deadman.mjs", budgetMs: 10_000 },
  // Asserts the halftime state machine itself (liveness ≠ correctness): on a
  // matchday, that fixtures are in a sane state for the time of day and the
  // poller heartbeat is fresh; off-matchday, that the watchdog is idling at zero
  // SportMonks cost. Deliberately NOT an mtime deadman entry (LOOP-STANDARD P2).
  { key: "halftime", module: "./checks/halftime.mjs", budgetMs: 30_000 },
  { key: "gamer", module: "./checks/experience.mjs", budgetMs: 30_000 },
  { key: "gamer", module: "./checks/gamer-review.mjs", budgetMs: 120_000, llm: true },
];

for (const layer of LAYERS) {
  if (only && !only.includes(layer.key)) continue;
  if (layer.needsBot && !(process.env.HEALTH_BOT_EMAIL && process.env.HEALTH_BOT_PASSWORD)) {
    console.log(`· skipping ${layer.key} (HEALTH_BOT_* not configured yet)`);
    continue;
  }
  let mod;
  try {
    mod = await import(new URL(layer.module, import.meta.url));
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND") { console.log(`· skipping ${layer.key} (${layer.module} not built yet)`); continue; }
    report.add(layer.key, "load", false, { detail: e.message });
    continue;
  }
  console.log(`── ${layer.key} ──`);
  await withBudget(report, layer.key, layer.budgetMs, () => mod.run(report, ctx));
}

await finish(false);
clearTimeout(watchdog);
process.exit(report.failed().length ? 1 : 0);

async function finish(partial) {
  const durationMs = Date.now() - startedAt.getTime();
  // Persist BEFORE Telegram so a send failure never loses the record.
  report.persist(startedAt, durationMs, { base: BASE, partial: partial || undefined, cleanup: ctx.cleanupCounts });

  let text = report.telegramText(startedAt, durationMs);
  if (partial) text = "⏱ (partial — run hit the 8-minute watchdog)\n" + text;

  if (noTelegram) {
    console.log("\n--- telegram message (suppressed by --no-telegram) ---\n" + text.replace(/<[^>]+>/g, ""));
    return;
  }
  try {
    const tg = await import("../tg.mjs");
    await tg.sendMessage(text);
    // Attach the failing screenshot when the browser layer broke something visual.
    for (const shot of (ctx.failureShots ?? []).slice(0, 2)) {
      await tg.sendPhoto(shot.path, shot.caption).catch(() => {});
    }
  } catch (e) {
    console.error(`✗ telegram send failed: ${e.message}`);
    process.exitCode = 1;
  }
}
