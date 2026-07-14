#!/usr/bin/env node
/**
 * replay-test.mjs — the halftime end-to-end suite.
 *
 * This is the only way to know whether any of this works before 21 August. It
 * boots the REAL Next.js app, points it at an in-memory database, points the
 * REAL poller and the REAL Vercel watchdog route at a fake SportMonks replaying
 * a recorded matchday, and then asserts on what actually happened.
 *
 * Nothing under src/ is modified to make this run. The poller has no test mode.
 * The seams are two environment variables the production code already reads:
 *   SPORTMONKS_BASE_URL     → the replay server
 *   NEXT_PUBLIC_SUPABASE_URL → the stub database
 *
 * Run:
 *   node --env-file=.env.local scripts/halftime/replay-test.mjs
 *   node --env-file=.env.local scripts/halftime/replay-test.mjs --only long-first-half
 *   node --env-file=.env.local scripts/halftime/replay-test.mjs --scale 120
 *
 * It leaves nothing behind: the stub is in-memory, the app is a throwaway dev
 * server on port 3399, and the poller's run-state goes to a temp dir.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ONLY = opt("only", null)?.split(",").map((s) => s.trim());
const SCALE = Number(opt("scale", "60"));
const KEEP_APP = argv.includes("--keep-app");

const APP_PORT = 3399;
const STUB_PORT = 8788;
const SM_PORT = 8787;

const APP = `http://127.0.0.1:${APP_PORT}`;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const SM = `http://127.0.0.1:${SM_PORT}`;
const SECRET = "replay-cron-secret";

const STATE_DIR = mkdtempSync(join(tmpdir(), "halftime-poller-"));

const SCENARIOS = [
  "normal-match",
  "long-first-half",
  "delayed-kickoff",
  "late-lineups",
  "fresh-gate",
  "gate-unsendable",
  "kill-switch",
  "postponement",
  "abandoned",
  "poller-crash",
  "poller-crash-early",
  "saturday-slate",
  "recorded-matchday",
];

// ── tiny test harness ────────────────────────────────────────────────────────

const results = [];
let current = null;

function check(name, pass, detail = "") {
  current.checks.push({ name, pass, detail });
  console.log(`   ${pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Never throw. A dead dev server used to blow up the whole run with an
// ECONNREFUSED stack trace halfway through, taking eight passing scenarios with
// it. A failed request is a datum, not a catastrophe.
async function j(url, init) {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    try { return { status: res.status, body: text ? JSON.parse(text) : null }; }
    catch { return { status: res.status, body: text }; }
  } catch (e) {
    return { status: 0, body: null, error: e.message };
  }
}

const authed = (extra = {}) => ({ authorization: `Bearer ${SECRET}`, "content-type": "application/json", ...extra });

// ── processes ────────────────────────────────────────────────────────────────

const children = new Set();

function start(cmd, args, opts = {}) {
  // detached ⇒ own process GROUP, so killAll can take out grandchildren too.
  // `npm exec next dev` is a wrapper: SIGKILLing the wrapper alone orphans the
  // actual next-server, which then squats on :3399 and makes the next run's
  // safety probe abort with EADDRINUSE (observed 2026-07-14).
  const child = spawn(cmd, args, {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    ...opts,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function pipe(child, tag, sink) {
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (d) => {
      sink.push(d);
      if (process.env.VERBOSE) process.stdout.write(`[${tag}] ${d}`);
    });
  }
}

function killAll() {
  for (const c of children) {
    // Negative pid = the whole process group (see start()). Fall back to the
    // single pid if the group is already gone.
    try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* gone */ } }
  }
}
process.on("exit", killAll);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { killAll(); process.exit(130); });

async function waitFor(fn, { timeoutMs = 90_000, everyMs = 300, what = "condition" } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

// ── content fixtures ─────────────────────────────────────────────────────────
// Authors write the correct answer as option A; the deterministic shuffle at
// assembly moves it. Base questions are historic-only by rule — nothing here
// could go stale, and nothing here could possibly reference a first-half event.

const baseQuestions = (home, away) =>
  Array.from({ length: 10 }, (_, i) => ({
    question: `BASE ${i + 1}: In what year did ${home} first meet ${away} in the league?`,
    options: {
      A: `19${20 + i}`,
      B: `19${30 + i}`,
      C: `19${40 + i}`,
      D: `19${50 + i}`,
    },
    answer: "A",
    difficulty: i < 3 ? "easy" : i < 7 ? "medium" : "hard",
  }));

const freshQuestions = (home) =>
  Array.from({ length: 3 }, (_, i) => ({
    question: `FRESH ${i + 1}: Which ${home} starter is making his debut today?`,
    options: { A: `Player ${i + 1}`, B: "Player X", C: "Player Y", D: "Player Z" },
    answer: "A",
    difficulty: "medium",
    status: "pending",
    fact: `Dossier line ${i + 1}: starter with zero prior appearances for ${home}.`,
    claims: [{ type: "player_in_lineup", player_id: 1000 + i }],
  }));

const TEST_USERS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

// ── boot ─────────────────────────────────────────────────────────────────────

const stubLog = [];
const appLog = [];

let appChild = null;

async function startApp() {
  appChild = start("npx", ["next", "dev", "-p", String(APP_PORT)], {
    env: {
      ...process.env,
      // These override .env.local: Next never overwrites a variable that is
      // already in the process environment.
      NEXT_PUBLIC_SUPABASE_URL: STUB,
      SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
      SPORTMONKS_BASE_URL: SM,
      SPORTMONKS_API_KEY: "replay-key",
      CRON_SECRET: SECRET,
      HALFTIME_PUSH_ENABLED: "true", // pushes land in the stub, never on a phone
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  pipe(appChild, "next", appLog);
  await waitFor(async () => (await j(`${APP}/api/halftime/today`)).status === 200, {
    timeoutMs: 180_000,
    what: "next dev (first compile is slow)",
  });
}

/**
 * THE SAFETY PROBE. Before a single write, prove the app is talking to the stub
 * and not to production. If the env override silently failed, this heartbeat
 * would land in Supabase — so we write one and then look for it in the stub. No
 * row in the stub means we do not run. Re-run after every app restart, because
 * an app that came back up wrong is worse than one that stayed down.
 */
async function safetyProbe() {
  await j(`${APP}/api/halftime/heartbeat`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ detail: { probe: true } }),
  });
  const probe = await j(`${STUB}/_stub/dump?table=halftime_heartbeat`);
  const sawIt = (probe.body?.halftime_heartbeat ?? []).some((r) => r.detail?.probe === true);
  if (!sawIt) {
    console.error("\n\x1b[31m✗ ABORT — the app is not talking to the stub database.\x1b[0m");
    console.error("  A write went somewhere else. Refusing to run the suite.");
    console.error(appLog.join("").split("\n").slice(-25).join("\n"));
    killAll();
    process.exit(1);
  }
}

/**
 * `next dev` is not a production server and does not pretend to be one — over a
 * long suite it can simply fall over, and when it did it took eight passing
 * scenarios down with it. Bring it back rather than lose the run; the scenario
 * that was interrupted is re-run from a clean database anyway.
 */
async function ensureApp() {
  if ((await j(`${APP}/api/halftime/today`)).status === 200) return;
  console.log("   \x1b[33m…\x1b[0m the dev server died — restarting it");
  try { appChild?.kill("SIGKILL"); } catch { /* already gone */ }
  await sleep(500);
  await startApp();
  await safetyProbe();
  console.log("   \x1b[32m✓\x1b[0m dev server back, safety probe re-passed");
}

async function boot() {
  console.log("\n\x1b[1mBooting\x1b[0m");

  const stub = start(process.execPath, [join(HERE, "stub-supabase.mjs"), "--port", String(STUB_PORT)]);
  pipe(stub, "stub", stubLog);
  await waitFor(async () => (await j(`${STUB}/_stub/dump`)).status === 200, { what: "stub database" });
  console.log(`   stub database  ${STUB}`);

  await startApp();
  console.log(`   next dev       ${APP}`);

  await safetyProbe();
  console.log("   \x1b[32m✓\x1b[0m safety probe: writes land in the stub, not in Supabase\n");
}

// ── per-scenario plumbing ────────────────────────────────────────────────────

const reset = () => j(`${STUB}/_stub/reset`, { method: "POST" });
const dump = async (t) => (await j(`${STUB}/_stub/dump?table=${t}`)).body?.[t] ?? [];
const pushes = async () => (await j(`${STUB}/_stub/pushes`)).body?.pushes ?? [];
const clock = async () => (await j(`${SM}/_replay/clock`)).body;
const smStats = async () => (await j(`${SM}/_replay/stats`)).body?.calls ?? {};

async function seed(manifest, { seedFresh }) {
  await j(`${STUB}/_stub/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      table: "profiles",
      rows: TEST_USERS.map((id) => ({ id, notifications_opt_in: true })),
    }),
  });

  // What the weekly sync (W3) would have written: a scheduled row per fixture.
  await j(`${STUB}/_stub/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      table: "halftime_releases",
      rows: manifest.fixtures.map((f, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        fixture_id: f.fixture_id,
        season_id: f.season_id,
        round_name: f.round_name,
        pack_id: null,
        home: f.home,
        away: f.away,
        kickoff_at: f.kickoff_at,
        state: "scheduled",
        base_questions: null,
        fresh_questions: null,
        pack_questions: null,
        fresh_state: "none",
        veto_deadline_at: null,
        telegram_message_id: null,
        released_at: null,
        created_at: new Date().toISOString(),
      })),
    }),
  });

  // What gen-base + the day-before approve gate (W3) would have written. Goes
  // through the real route, so the scheduled → base_ready transition is real.
  for (const f of manifest.fixtures) {
    const r = await j(`${APP}/api/halftime/fresh`, {
      method: "POST",
      headers: authed(),
      body: JSON.stringify({ op: "base", fixtureId: f.fixture_id, questions: baseQuestions(f.home, f.away) }),
    });
    if (r.status !== 200) throw new Error(`base slate write failed: ${r.status} ${JSON.stringify(r.body)}`);
  }

  // What gen-fresh + veto.mjs send (W3) would have written, when a scenario
  // needs a fresh slice to exist without W3 being built yet.
  if (seedFresh) {
    for (const f of manifest.fixtures) {
      const r = await j(`${APP}/api/halftime/fresh`, {
        method: "POST",
        headers: authed(),
        body: JSON.stringify({
          op: "fresh",
          fixtureId: f.fixture_id,
          questions: freshQuestions(f.home).map((q) => ({ ...q, status: seedFresh.status })),
          state: seedFresh.state,
          telegramMessageId: 4242,
        }),
      });
      if (r.status !== 200) throw new Error(`fresh slice write failed: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
}

/**
 * Wait until the replay clock reaches a nominal minute. The budget is derived
 * from the target: minute N arrives at ~N*60/SCALE real seconds after t0, so a
 * fixed default silently caps how long a scenario may run — the Saturday slate
 * (last FT ≈ minute 642 at 60x = 642 real seconds) sailed past the old 600s
 * ceiling and timed out with the product code never at fault. Budget = the
 * worst-case wall-clock for the whole journey to that minute, plus 3 minutes
 * of slack for boot/HMR stalls.
 */
async function atMin(min, { timeoutMs } = {}) {
  const budget = timeoutMs ?? Math.ceil((min * 60_000) / SCALE) + 180_000;
  await waitFor(async () => (await clock()).nominal_min >= min, {
    timeoutMs: budget,
    everyMs: 100,
    what: `replay minute ${min}`,
  });
}

const runWatchdog = () => j(`${APP}/api/cron/halftime-watchdog`, { headers: authed() });

// ── the run ──────────────────────────────────────────────────────────────────

async function runScenario(name) {
  const file = join(HERE, "scenarios", `${name}.json`);
  const scenario = JSON.parse(readFileSync(file, "utf8"));
  const harness = scenario.harness ?? {};

  current = { name, checks: [], notes: scenario.notes };
  results.push(current);

  console.log(`\n\x1b[1m▸ ${name}\x1b[0m \x1b[2m(scale ${SCALE}x)\x1b[0m`);

  await ensureApp();
  await reset();

  const smLog = [];
  const smSrv = start(process.execPath, [
    join(HERE, "replay-server.mjs"),
    "--scenario", file, "--scale", String(SCALE), "--port", String(SM_PORT),
  ]);
  pipe(smSrv, "sm", smLog);
  await waitFor(async () => (await j(`${SM}/_replay/manifest`)).status === 200, { what: "replay server" });

  const manifest = (await j(`${SM}/_replay/manifest`)).body;

  // A scenario that crosses London midnight would land its fixtures on a
  // different matchday from the one the app calls "today", and every assertion
  // would be meaningless. Refuse rather than produce a confusing red.
  const lastMin = Math.max(...scenario.fixtures.flatMap((f) => f.timeline.map((t) => t.at_min)));
  const endsAt = new Date(Date.now() + (lastMin * 60_000) / SCALE);
  const londonDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
  if (londonDay(new Date()) !== londonDay(endsAt)) {
    check("scenario does not cross London midnight", false, "run it at another time of day");
    smSrv.kill("SIGKILL");
    return;
  }

  await seed(manifest, {
    seedFresh: harness.seed_fresh
      ? { status: harness.seed_fresh_status ?? "pending", state: harness.seed_fresh_state ?? "pending_veto" }
      : null,
  });

  // Before the whistle the pack must not exist in any form.
  const early = await j(`${APP}/api/halftime/today`);
  const earlyRows = early.body?.fixtures ?? [];
  check(
    "pre-release: pack is invisible (no pack_id, no slug, no quiz_packs row)",
    earlyRows.length === manifest.fixtures.length &&
      earlyRows.every((r) => r.pack_id === null && r.slug === null) &&
      (await dump("quiz_packs")).length === 0,
    `${earlyRows.length} fixture(s) listed, none playable`,
  );

  // Off-matchday cost: with nothing actionable the watchdog must not spend a
  // single SportMonks call. (Everything is 'scheduled' at this instant.)
  await j(`${SM}/_replay/stats/reset`, { method: "POST" });

  const pollerLog = [];
  const poller = start(process.execPath, [join(HERE, "poller.mjs"), "--no-telegram"], {
    env: {
      ...process.env,
      CRON_SECRET: SECRET,
      HALFTIME_API_BASE: APP,
      SPORTMONKS_BASE_URL: SM,
      SPORTMONKS_API_KEY: "replay-key",
      HALFTIME_SCALE: String(SCALE),
      HALFTIME_STATE_DIR: STATE_DIR,
      // Deterministic stand-ins for gen-fresh / veto. Without this the poller
      // would shell out to the real generators — which call Anthropic and the
      // live API, cost money on every run, and would make a red mean something
      // different each time.
      HALFTIME_GEN_DIR: join(HERE, "replay-generators"),
      ...(harness.veto_send_fails ? { HALFTIME_REPLAY_VETO_FAIL: "1" } : {}),
    },
  });
  pipe(poller, "poller", pollerLog);

  let pollerKilled = false;
  const killAt = harness.kill_poller_at_min;

  // Drive the scenario's scripted interventions on the replay clock.
  const script = [];

  if (killAt != null) {
    script.push(
      atMin(killAt).then(() => {
        poller.kill("SIGKILL");
        pollerKilled = true;
        console.log(`   \x1b[2m… poller SIGKILLed at minute ${killAt}\x1b[0m`);
      }),
    );
  }

  for (const w of harness.watchdog_at_min ?? []) {
    script.push(
      atMin(w).then(async () => {
        const out = await runWatchdog();
        console.log(`   \x1b[2m… watchdog at minute ${w}: ${JSON.stringify(out.body).slice(0, 160)}\x1b[0m`);
        current.watchdog ??= [];
        current.watchdog.push({ min: w, out: out.body });
      }),
    );
  }

  for (const v of harness.veto_at_min ?? []) {
    script.push(
      atMin(v.at_min).then(async () => {
        const f = manifest.fixtures[v.fixture_index];
        const out = await j(`${APP}/api/halftime/fresh`, {
          method: "POST",
          headers: authed(),
          body: JSON.stringify({ op: "veto", fixtureId: f.fixture_id, index: v.question_index, status: "vetoed" }),
        });
        console.log(`   \x1b[2m… founder vetoes q${v.question_index + 1} of ${f.home} at minute ${v.at_min}: ${JSON.stringify(out.body)}\x1b[0m`);
      }),
    );
  }

  if (harness.kill_at_min != null) {
    script.push(
      atMin(harness.kill_at_min).then(async () => {
        const matchday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
        const out = await j(`${APP}/api/halftime/fresh`, {
          method: "POST",
          headers: authed(),
          body: JSON.stringify({ op: "kill", matchday }),
        });
        console.log(`   \x1b[2m… KILL at minute ${harness.kill_at_min}: ${(out.body?.affected ?? []).length} fixture(s)\x1b[0m`);
        current.killAffected = out.body?.affected ?? [];
      }),
    );
  }

  // ── when to assert ────────────────────────────────────────────────────────
  // ALWAYS wait for the whole timeline to play out, even if the poller has
  // already exited. The `abandoned` scenario is why: its second fixture is
  // abandoned 38 minutes AFTER its pack goes live, and the poller quite
  // correctly exits before that. Asserting on poller exit would have "proven"
  // that an abandonment leaves the pack up — by checking before the
  // abandonment happened. That is a green tick for nothing.
  const lastKickoffMin = Math.max(...scenario.fixtures.map((f) => f.kickoff_min));
  const endMin = Math.max(lastMin, lastKickoffMin) + 5;
  const finished = new Promise((r) => poller.on("exit", (code) => r(code)));

  await Promise.all(script);
  await atMin(endMin);

  // Then give the poller a bounded moment to finish its own business.
  if (!pollerKilled) await Promise.race([finished, sleep(20_000)]);
  await sleep(1500);

  const ctx = {
    manifest,
    scenario,
    rows: await dump("halftime_releases"),
    packs: await dump("quiz_packs"),
    notifications: await dump("notification_log"),
    pushes: await pushes(),
    today: (await j(`${APP}/api/halftime/today`)).body,
    pollerLog: pollerLog.join(""),
    smCalls: await smStats(),
    pollerKilled,
    pollerExit: poller.exitCode,
  };

  try {
    await assertions(name, ctx);
  } catch (e) {
    check("assertions ran", false, e.message);
  }

  poller.kill("SIGKILL");
  smSrv.kill("SIGKILL");
  await sleep(200);
}

// ── assertions ───────────────────────────────────────────────────────────────

const row = (ctx, id) => ctx.rows.find((r) => Number(r.fixture_id) === Number(id));
const packOf = (ctx, r) => ctx.packs.find((p) => p.id === r.pack_id);
const freshInPack = (pack) => (pack?.questions ?? []).filter((q) => q.question.startsWith("FRESH")).length;
const baseInPack = (pack) => (pack?.questions ?? []).filter((q) => q.question.startsWith("BASE")).length;

/** Every released pack, every scenario: ten questions, and not one of them can
 *  possibly reference something that happened after the kickoff whistle. */
function assertPackIntegrity(ctx) {
  const released = ctx.rows.filter((r) => r.state === "released" || r.state === "released_late");
  if (!released.length) return;

  const bad = [];
  for (const r of released) {
    const pack = packOf(ctx, r);
    if (!pack) { bad.push(`${r.fixture_id}: no quiz_packs row`); continue; }
    if (pack.questions.length !== 10) bad.push(`${r.fixture_id}: ${pack.questions.length} questions`);
    if (pack.status !== "published") bad.push(`${r.fixture_id}: status=${pack.status}`);
    if (!["club", "national", "records"].includes(pack.type)) bad.push(`${r.fixture_id}: type=${pack.type}`);
    for (const q of pack.questions) {
      if (!["A", "B", "C", "D"].includes(q.answer)) bad.push(`${r.fixture_id}: bad answer ${q.answer}`);
      if (Object.keys(q.options ?? {}).length !== 4) bad.push(`${r.fixture_id}: not 4 options`);
    }
    // AC3b, structurally: the released questions are the snapshot frozen at
    // T-10, not something regenerated at the whistle.
    const frozen = JSON.stringify(r.pack_questions);
    const shipped = JSON.stringify(pack.questions);
    const killedOrVetoed =
      r.fresh_state === "killed" ||
      (r.fresh_questions ?? []).some((q) => q.status === "vetoed");
    if (!killedOrVetoed && frozen !== shipped) {
      bad.push(`${r.fixture_id}: released pack differs from the T-10 snapshot`);
    }
  }

  check(
    `every released pack: 10 questions, published, A–D, byte-identical to the T-10 freeze`,
    bad.length === 0,
    bad.length ? bad.join("; ") : `${released.length} pack(s)`,
  );

  // The answer key must not sit in slot A for all ten — that is what the
  // deterministic shuffle is for.
  const anyPack = packOf(ctx, released[0]);
  const allA = (anyPack?.questions ?? []).every((q) => q.answer === "A");
  check("deterministic shuffle moved the answer off slot A", !allA,
    (anyPack?.questions ?? []).map((q) => q.answer).join(""));
}

async function assertions(name, ctx) {
  assertPackIntegrity(ctx);

  const f = (i) => ctx.manifest.fixtures[i];

  switch (name) {
    case "normal-match": {
      const r = row(ctx, f(0).fixture_id);
      const pack = packOf(ctx, r);
      check("released", r.state === "released", `state=${r.state}`);
      check("quiz_packs row exists and is published", !!pack);
      check("release fired on the state flip, not on a timer",
        /HALF TIME .* → releasing/.test(ctx.pollerLog));

      // The whole pre-match pipeline, driven by the poller and nothing else:
      // sheets land → questions written → gate armed → deadline → auto-approve.
      check("full fresh pipeline ran: confirmed XIs → generate → arm the gate → auto-approve",
        /confirmed XIs/.test(ctx.pollerLog) &&
        /at the veto gate/.test(ctx.pollerLog) &&
        /veto deadline passed/.test(ctx.pollerLog) &&
        freshInPack(pack) === 3 && baseInPack(pack) === 7,
        `${freshInPack(pack)} fresh + ${baseInPack(pack)} base`);
      check("push delivered to opted-in users, exactly once each",
        ctx.pushes.length === 1 && ctx.pushes[0].userIds.length === TEST_USERS.length &&
        ctx.notifications.filter((n) => n.key === `halftime:${f(0).fixture_id}`).length === TEST_USERS.length,
        `${ctx.pushes.length} push batch, ${ctx.notifications.length} log rows`);
      check("push copy carries no score and no first-half event",
        !/\d\s*[-–]\s*\d|goal|scored|leading|winning/i.test(`${ctx.pushes[0]?.title} ${ctx.pushes[0]?.body}`),
        `"${ctx.pushes[0]?.title} / ${ctx.pushes[0]?.body}"`);
      check("push copy never mentions how the game is delivered",
        !/browser|download|app store|no download/i.test(`${ctx.pushes[0]?.title} ${ctx.pushes[0]?.body}`));
      check("deep link points at the pack", /^\/challenges\/.+\?pid=/.test(ctx.pushes[0]?.url ?? ""),
        ctx.pushes[0]?.url);
      check("pack is now playable from /api/halftime/today",
        (ctx.today.fixtures ?? []).some((x) => x.state === "released" && x.pack_id && x.slug));

      // AC18 — three concurrent re-releases must change nothing.
      const before = { packs: ctx.packs.length, pushes: ctx.pushes.length };
      const again = await Promise.all([1, 2, 3].map(() =>
        j(`${APP}/api/halftime/release`, {
          method: "POST", headers: authed(),
          body: JSON.stringify({ fixtureId: f(0).fixture_id }),
        })));
      const after = { packs: (await dump("quiz_packs")).length, pushes: (await pushes()).length };
      check("re-releasing 3× concurrently is a no-op: no second pack, no second push",
        after.packs === before.packs && after.pushes === before.pushes &&
        again.every((x) => x.body?.already === true),
        `already=${again.map((x) => x.body?.already).join(",")}`);
      break;
    }

    case "long-first-half": {
      const r = row(ctx, f(0).fixture_id);
      const koMin = ctx.scenario.fixtures[0].kickoff_min;
      const htMin = ctx.scenario.fixtures[0].timeline.find((t) => t.state === "HT").at_min;
      const releasedMin =
        ((new Date(r.released_at).getTime() - new Date(ctx.manifest.t0).getTime()) * SCALE) / 60_000;

      check("released", r.state === "released", `state=${r.state}`);
      check(`half time was at KO+${htMin - koMin}' — a kickoff+45 timer would have fired 10' early`,
        releasedMin >= htMin - 1,
        `released at replay minute ${releasedMin.toFixed(1)} (HT ${htMin}, KO+45 would be ${koMin + 45})`);
      check("released within 2 minutes of the whistle",
        releasedMin - htMin <= 2, `${(releasedMin - htMin).toFixed(2)} min after HT`);
      break;
    }

    case "delayed-kickoff": {
      const r = row(ctx, f(0).fixture_id);
      const shifted = ctx.scenario.fixtures[0].kickoff_shift.to_min;
      const htMin = ctx.scenario.fixtures[0].timeline.find((t) => t.state === "HT").at_min;
      const asMin = (iso) => ((new Date(iso).getTime() - new Date(ctx.manifest.t0).getTime()) * SCALE) / 60_000;
      const releasedMin = asMin(r.released_at);

      check("poller noticed the kickoff move", /kickoff moved/.test(ctx.pollerLog),
        (ctx.pollerLog.match(/kickoff moved[^\n]*/) ?? [""])[0].slice(0, 90));
      check("released", r.state === "released", `state=${r.state}`);
      check("release still keyed off the state flip, not the clock it computed an hour earlier",
        Math.abs(releasedMin - htMin) <= 2, `released at replay minute ${releasedMin.toFixed(1)}, HT at ${htMin}`);

      // ── a real gap, asserted so it cannot be forgotten ─────────────────────
      // The poller follows the new kickoff in its own head, but there is no API
      // route that writes kickoff_at back to halftime_releases. The watchdog
      // reads the row. So if the poller dies during a delayed kickoff, the
      // watchdog still believes the old time — and a `base_ready` fixture past
      // its stale kickoff is one it stages BASE-ONLY, discarding a fresh slice
      // that was still inside its veto window.
      // This check FAILS on purpose while the gap is open. It goes green the day
      // someone adds the route.
      check("GAP: kickoff_at is persisted, so the watchdog sees the move too",
        Math.abs(asMin(r.kickoff_at) - shifted) < 2,
        `row still says replay minute ${asMin(r.kickoff_at).toFixed(0)}, real kickoff was ${shifted} — ` +
          `needs a kickoff op on /api/halftime/fresh (or a sync route)`);
      break;
    }

    case "late-lineups": {
      const a = row(ctx, f(0).fixture_id); // sheets at T-30
      const b = row(ctx, f(1).fixture_id); // no sheets at all
      check("late sheets: fixture still released", a.state === "released", `state=${a.state}`);
      check("no sheets at all: fresh skipped, base-only pack still released",
        b.state === "released" && b.fresh_state === "skipped" && baseInPack(packOf(ctx, b)) === 10,
        `state=${b.state} fresh_state=${b.fresh_state} base=${baseInPack(packOf(ctx, b))}/10`);
      check("the poller said so, rather than silently doing nothing",
        /no confirmed XIs by T-25/.test(ctx.pollerLog));
      check("a missing fresh slice is a normal outcome, not a failure",
        b.state !== "failed" && a.state !== "failed");
      break;
    }

    case "fresh-gate": {
      const auto = row(ctx, f(0).fixture_id);
      const vetoed = row(ctx, f(1).fixture_id);
      const autoPack = packOf(ctx, auto);
      const vetoPack = packOf(ctx, vetoed);

      check("no founder response → unvetoed fresh questions auto-released at the deadline",
        auto.state === "released" && freshInPack(autoPack) === 3 && baseInPack(autoPack) === 7,
        `${freshInPack(autoPack)} fresh + ${baseInPack(autoPack)} base`);
      check("the timeout needed no human at all",
        /veto deadline passed .*→ approved/.test(ctx.pollerLog),
        (ctx.pollerLog.match(/veto deadline passed[^\n]*/) ?? [""])[0]);

      check("Veto 2 removed exactly question 2 from the pack",
        vetoed.state === "released" && freshInPack(vetoPack) === 2 && baseInPack(vetoPack) === 8,
        `${freshInPack(vetoPack)} fresh + ${baseInPack(vetoPack)} base`);
      const vetoedText = (vetoed.fresh_questions ?? []).find((q) => q.status === "vetoed")?.question;
      check("the vetoed question appears nowhere in the released pack",
        !!vetoedText && !(vetoPack?.questions ?? []).some((q) => q.question === vetoedText),
        vetoedText?.slice(0, 40));
      break;
    }

    case "gate-unsendable": {
      const r = row(ctx, f(0).fixture_id);
      const pack = packOf(ctx, r);
      check("questions were generated, then the gate could not be offered",
        /fresh slice DROPPED|gate-unsendable/.test(ctx.pollerLog) || r.fresh_state === "skipped",
        `fresh_state=${r.fresh_state}`);
      check("the fresh slice was DROPPED, not auto-released",
        freshInPack(pack) === 0 && baseInPack(pack) === 10,
        `${freshInPack(pack)} fresh + ${baseInPack(pack)} base`);
      check("the fixture still got its pack", r.state === "released", `state=${r.state}`);
      break;
    }

    case "kill-switch": {
      const staged = row(ctx, f(0).fixture_id);   // already frozen when KILL landed
      const later = row(ctx, f(1).fixture_id);    // not yet assembled
      check("KILL flipped every unreleased fixture of the matchday",
        (current.killAffected ?? []).length === 2, `${(current.killAffected ?? []).length} affected`);
      check("an already-STAGED pack is re-assembled base-only at the whistle",
        staged.state === "released" && freshInPack(packOf(ctx, staged)) === 0 &&
          baseInPack(packOf(ctx, staged)) === 10,
        `fresh_state=${staged.fresh_state}, fresh in pack=${freshInPack(packOf(ctx, staged))}`);
      check("a not-yet-assembled fixture ships base-only",
        later.state === "released" && freshInPack(packOf(ctx, later)) === 0,
        `fresh_state=${later.fresh_state}`);
      break;
    }

    case "postponement": {
      const r = row(ctx, f(0).fixture_id);
      check("postponed → cancelled", r.state === "cancelled", `state=${r.state}`);
      check("no quiz_packs row was ever inserted", ctx.packs.length === 0);
      check("no push ever fired", ctx.pushes.length === 0 && ctx.notifications.length === 0);
      check("cancelled fixture is not surfaced to players",
        !(ctx.today.fixtures ?? []).some((x) => x.fixture_id === f(0).fixture_id));
      break;
    }

    case "abandoned": {
      const first = row(ctx, f(0).fixture_id);  // abandoned in the 1st half
      const second = row(ctx, f(1).fixture_id); // abandoned after release
      check("abandoned BEFORE half time → cancelled, no pack, no push",
        first.state === "cancelled" && !packOf(ctx, first),
        `state=${first.state}`);
      check("abandoned AFTER release → the pack stays up",
        second.state === "released" && !!packOf(ctx, second),
        `state=${second.state}`);
      check("…and a watchdog run AFTER the abandonment does not reach back and cancel it",
        (current.watchdog ?? []).every((w) => !(w.out?.cancelled ?? []).includes(second.fixture_id)),
        JSON.stringify((current.watchdog ?? []).map((w) => w.out?.idle ?? w.out?.cancelled)));
      check("only the released fixture pushed",
        ctx.pushes.length === 1 && ctx.pushes[0].userIds.length === TEST_USERS.length);
      break;
    }

    case "poller-crash": {
      const onTime = row(ctx, f(0).fixture_id);  // HT 130, watchdog 132
      const late = row(ctx, f(1).fixture_id);    // HT 150, watchdog 170 (2nd half)
      const relMin = (r) =>
        ((new Date(r.released_at).getTime() - new Date(ctx.manifest.t0).getTime()) * SCALE) / 60_000;

      check("the poller really was killed", ctx.pollerKilled);
      check("watchdog released the pack after the poller died",
        onTime.state === "released", `state=${onTime.state}`);
      check("watchdog released within its 6-minute bound",
        relMin(onTime) - 130 <= 6, `${(relMin(onTime) - 130).toFixed(1)} min after HT`);
      check("that release still pushed", ctx.pushes.some((p) => p.url?.includes(onTime.pack_id)));

      check("half time missed entirely → released_late",
        late.state === "released_late", `state=${late.state}`);
      check("released_late pack is still playable", !!packOf(ctx, late));
      check("released_late fires NO push (useless after the restart, and a spoiler)",
        !ctx.pushes.some((p) => p.url?.includes(late.pack_id)) &&
        !ctx.notifications.some((n) => n.key === `halftime:${late.fixture_id}`));
      break;
    }

    case "poller-crash-early": {
      const r = row(ctx, f(0).fixture_id);
      const pack = packOf(ctx, r);
      check("the poller was killed before it could assemble anything",
        ctx.pollerKilled && !/staged \d+/.test(ctx.pollerLog),
        ctx.pollerKilled ? "killed at minute 60, nothing staged" : "poller was not killed");
      check("watchdog noticed kickoff had passed with nothing staged, and staged it",
        (current.watchdog ?? []).some((w) => (w.out?.stagedBaseOnly ?? []).includes(r.fixture_id)),
        JSON.stringify((current.watchdog ?? []).map((w) => w.out?.stagedBaseOnly)));
      check("watchdog released it at the whistle", r.state === "released", `state=${r.state}`);
      check("the watchdog shipped BASE ONLY — it never ships fresh questions",
        freshInPack(pack) === 0 && baseInPack(pack) === 10,
        `${freshInPack(pack)} fresh + ${baseInPack(pack)} base`);
      check("…even though three APPROVED fresh questions were sitting in the row",
        (r.fresh_questions ?? []).filter((q) => q.status === "approved").length === 3,
        `${(r.fresh_questions ?? []).length} fresh questions left unused`);
      break;
    }

    case "saturday-slate": {
      const released = ctx.rows.filter((x) => x.state === "released");
      check("all 10 fixtures released", released.length === 10, `${released.length}/10`);
      check("10 distinct packs inserted", new Set(ctx.packs.map((p) => p.id)).size === 10,
        `${ctx.packs.length} packs`);

      const simultaneous = ctx.rows.filter((r) =>
        [19427502, 19427503, 19427504, 19427505, 19427506].includes(Number(r.fixture_id)));
      const spread = simultaneous.map((r) => new Date(r.released_at).getTime());
      check("the five 15:00 kickoffs all released, each on its own whistle",
        simultaneous.every((r) => r.state === "released") &&
        new Set(spread).size === 5,
        `${((Math.max(...spread) - Math.min(...spread)) * SCALE / 60000).toFixed(1)} replay-min apart`);

      // AC17: a Saturday must not mean six notifications.
      const perUser = {};
      for (const n of ctx.notifications) perUser[n.user_id] = (perUser[n.user_id] ?? 0) + 1;
      check("per-user daily cap: exactly ONE halftime push each, despite 10 fixtures",
        TEST_USERS.every((u) => perUser[u] === 1),
        JSON.stringify(perUser));
      check("the first whistle of the day is the one that pushed",
        ctx.pushes.length === 1 && ctx.pushes[0].url.includes(row(ctx, 19427501).pack_id),
        `${ctx.pushes.length} push batch(es)`);

      const calls = ctx.smCalls["livescores/latest"] ?? 0;
      check("one live call covers the whole slate (well inside 2000/hr)",
        calls > 0 && calls < 4000, `${calls} livescores calls for 10 fixtures`);
      break;
    }

    // ── the one that is not a simulation ──────────────────────────────────
    // A real Premier League matchday, pulled out of SportMonks' historical
    // data: real kickoff drift, real added time, real half-time whistles. All
    // ten matches kicked off at once (final day). Not one of them reached half
    // time at kickoff+45.
    case "recorded-matchday": {
      const relMin = (r) =>
        ((new Date(r.released_at).getTime() - new Date(ctx.manifest.t0).getTime()) * SCALE) / 60_000;

      const released = ctx.rows.filter((x) => x.state === "released");
      check("all 10 real fixtures released", released.length === 10, `${released.length}/10`);

      const late = [];
      const timerWouldHaveBeenEarly = [];
      for (const sf of ctx.scenario.fixtures) {
        const r = row(ctx, sf.id);
        if (r?.state !== "released") continue;
        const htMin = sf.timeline.find((t) => t.state === "HT").at_min;
        const koMin = sf.timeline.find((t) => t.state === "INPLAY_1ST_HALF").at_min;
        const drift = relMin(r) - htMin;
        if (drift > 2 || drift < -0.5) late.push(`${sf.home}: ${drift.toFixed(1)}min`);
        if (htMin > koMin + 45) timerWouldHaveBeenEarly.push(`${sf.home} +${(htMin - koMin - 45).toFixed(0)}'`);
      }

      check("every one released within 2 minutes of its REAL half-time whistle",
        late.length === 0, late.length ? late.join(", ") : "all 10 within 2 min");

      check("a kickoff+45 timer would have published EVERY ONE of them early, mid-first-half",
        timerWouldHaveBeenEarly.length === 10,
        timerWouldHaveBeenEarly.join(", "));

      const perUser = {};
      for (const n of ctx.notifications) perUser[n.user_id] = (perUser[n.user_id] ?? 0) + 1;
      check("ten simultaneous whistles, one push per user",
        TEST_USERS.every((u) => perUser[u] === 1), JSON.stringify(perUser));
      break;
    }
  }
}

// ── watchdog idle path (AC31) — its own tiny test, no scenario needed ────────

async function watchdogIdleTest() {
  current = { name: "watchdog-idle", checks: [] };
  results.push(current);
  console.log(`\n\x1b[1m▸ watchdog-idle\x1b[0m \x1b[2m(off-matchday cost)\x1b[0m`);

  await reset();
  const smSrv = start(process.execPath, [
    join(HERE, "replay-server.mjs"),
    "--scenario", join(HERE, "scenarios", "normal-match.json"),
    "--scale", String(SCALE), "--port", String(SM_PORT),
  ]);
  await waitFor(async () => (await j(`${SM}/_replay/manifest`)).status === 200, { what: "replay server" });
  await j(`${SM}/_replay/stats/reset`, { method: "POST" });

  const out = await runWatchdog();
  const calls = await smStats();
  check("no fixtures today → {idle:true}", out.body?.idle === true, JSON.stringify(out.body));
  check("idle run makes ZERO SportMonks calls", Object.keys(calls).length === 0, JSON.stringify(calls));

  // And the poller on a blank day.
  const pollerLog = [];
  const poller = start(process.execPath, [join(HERE, "poller.mjs"), "--no-telegram"], {
    env: {
      ...process.env, CRON_SECRET: SECRET, HALFTIME_API_BASE: APP,
      SPORTMONKS_BASE_URL: SM, SPORTMONKS_API_KEY: "replay-key",
      HALFTIME_SCALE: String(SCALE), HALFTIME_STATE_DIR: STATE_DIR,
    },
  });
  pipe(poller, "poller", pollerLog);
  const code = await new Promise((r) => poller.on("exit", r));
  const after = await smStats();
  check("poller on a blank day exits 0 immediately", code === 0, `exit ${code}`);
  check("…and makes ZERO SportMonks calls", Object.keys(after).length === 0, JSON.stringify(after));
  check("…and says so", /no PL fixtures/.test(pollerLog.join("")));

  smSrv.kill("SIGKILL");
}

// ── safety interlock test ────────────────────────────────────────────────────

async function interlockTest() {
  current = { name: "safety-interlock", checks: [] };
  results.push(current);
  console.log(`\n\x1b[1m▸ safety-interlock\x1b[0m \x1b[2m(a replay feed must never drive production)\x1b[0m`);

  const p = start(process.execPath, [join(HERE, "poller.mjs"), "--no-telegram"], {
    env: {
      ...process.env, CRON_SECRET: SECRET,
      HALFTIME_API_BASE: "https://yourscore.app",   // production
      SPORTMONKS_BASE_URL: SM,                      // fake football
      SPORTMONKS_API_KEY: "replay-key", HALFTIME_STATE_DIR: STATE_DIR,
    },
  });
  const out = [];
  pipe(p, "interlock", out);
  const code = await new Promise((r) => p.on("exit", r));
  check("poller refuses to point a replay feed at the production app",
    code !== 0 && /refusing to start/.test(out.join("")), `exit ${code}`);
}

// ── go ───────────────────────────────────────────────────────────────────────

const t0 = Date.now();
await boot();

if (!existsSync(join(HERE, "scenarios", "states.json"))) {
  console.error("✗ scenarios/states.json missing — run: node --env-file=.env.local scripts/halftime/record-states.mjs");
  process.exit(1);
}

for (const s of SCENARIOS) {
  if (ONLY && !ONLY.includes(s)) continue;
  await runScenario(s);
}
if (!ONLY || ONLY.includes("meta")) {
  await watchdogIdleTest();
  await interlockTest();
}

// ── report ───────────────────────────────────────────────────────────────────

const all = results.flatMap((r) => r.checks);
const failed = all.filter((c) => !c.pass);

console.log(`\n${"─".repeat(72)}`);
for (const r of results) {
  const bad = r.checks.filter((c) => !c.pass).length;
  console.log(
    `${bad ? "\x1b[31mFAIL\x1b[0m" : "\x1b[32mPASS\x1b[0m"}  ${r.name.padEnd(22)} ` +
      `${r.checks.length - bad}/${r.checks.length}`,
  );
}
console.log(`${"─".repeat(72)}`);
console.log(
  `${failed.length ? "\x1b[31m" : "\x1b[32m"}${all.length - failed.length}/${all.length} checks passed\x1b[0m ` +
    `in ${((Date.now() - t0) / 1000).toFixed(0)}s (scale ${SCALE}x)`,
);
if (failed.length) {
  console.log("\nFailures:");
  for (const c of failed) console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}

if (!KEEP_APP) killAll();
process.exit(failed.length ? 1 : 0);
