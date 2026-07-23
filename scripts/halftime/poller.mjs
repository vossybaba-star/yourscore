#!/usr/bin/env node
/**
 * poller.mjs — the halftime daemon. One Node process, one matchday.
 *
 * REWORKED for the Gameday pivot (§0.1/§0.5): this file no longer stages,
 * assembles or releases any quiz pack — that entire pipeline moved off the
 * whistle path onto the daily /api/cron/gameday-publish cron, which runs the
 * day before kickoff against already-approved content. The pack no longer
 * depends on this process at all.
 *
 * What is left is the Halftime Prediction poll's own machinery: this process
 * is the fast, primary way the app learns the real second-half whistle has
 * blown (SportMonks state flip to HT, state_id 3), which is what opens the
 * halftime (second-half) prediction phase (§0.6). The watchdog
 * (/api/cron/halftime-watchdog) is the 5-minute backstop for a poller that
 * missed it or wasn't running.
 *
 * THE DAY
 *   07:00  launched by cron. No PL fixtures today → log, exit 0. Zero API calls.
 *   KO     6s poll of /livescores/latest begins.
 *   HT     state_id == 3 → POST /api/halftime/whistle → second_half_started_at set.
 *   FT     all fixtures terminal → day summary → exit 0.
 *
 * TWO LANES, and it needs both:
 *   fast (6s)  /livescores/latest        — catches the HT flip within seconds.
 *   slow (60s) /fixtures/multi/{ids}     — catches what the live feed cannot.
 *              A postponed match is not "live", so it never appears in
 *              /livescores at all; an abandoned one drops off it within
 *              seconds.
 *
 * LOOP-STANDARD (the four rules every automated loop here must satisfy)
 *   1 assert success, not existence — after every whistle POST it re-reads
 *     /api/gameday/today (kickoff drift) or the poll route itself for
 *     confirmation the flag actually landed, not just that the POST 200'd.
 *   2 gate every outward action — the whistle only ever fires on a real
 *     SportMonks state flip, never on a timer.
 *   3 bound the retry path — 3 attempts with backoff on every call; poll
 *     cadence degrades 6s→12s→30s on 429; hard wall-clock exit.
 *   4 one persistent dedup key per side effect — the whistle write is a CAS
 *     on second_half_started_at IS NULL (server-side, not a flag in this
 *     process's memory); Telegram alerts dedup through the on-disk run-state
 *     file, so a restart does not re-alert.
 *
 * The poller NEVER touches the database. Every write goes through an API
 * route, so there is exactly one code path per side effect and the watchdog
 * cannot disagree with it.
 *
 * ENV
 *   CRON_SECRET            required — bearer for the halftime routes
 *   HALFTIME_API_BASE      the app (default NEXT_PUBLIC_APP_URL)
 *   SPORTMONKS_API_KEY     required
 *   SPORTMONKS_BASE_URL    default https://api.sportmonks.com — THE REPLAY SEAM
 *   HALFTIME_SCALE         replay only: divides every duration (default 1)
 *   HALFTIME_STATE_DIR     run-state dir (default scripts/data)
 *
 * CLI
 *   node --env-file=.env.local scripts/halftime/poller.mjs
 *   --date YYYY-MM-DD   override the matchday
 *   --no-telegram       never message the founder (replay / dry runs)
 *   --dry-run           do everything except POST whistle
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

// ── args + env ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const NO_TELEGRAM = flag("no-telegram");
const DRY_RUN = flag("dry-run");
const DATE_OVERRIDE = opt("date", null);

const CRON_SECRET = process.env.CRON_SECRET;
const API_BASE = (process.env.HALFTIME_API_BASE || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const SM_BASE = (process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com").replace(/\/$/, "");
const SM_KEY = process.env.SPORTMONKS_API_KEY;
const SCALE = Number(process.env.HALFTIME_SCALE || "1");
const STATE_DIR = process.env.HALFTIME_STATE_DIR || join(REPO, "scripts", "data");

const log = (...a) => console.log(`[poller ${new Date().toISOString().slice(11, 23)}]`, ...a);
const warn = (...a) => console.warn(`[poller ${new Date().toISOString().slice(11, 23)}] WARN`, ...a);
const err = (...a) => console.error(`[poller ${new Date().toISOString().slice(11, 23)}] ERROR`, ...a);

function die(msg, code = 1) {
  err(msg);
  process.exit(code);
}

/**
 * Env + the SAFETY INTERLOCK. A replay SportMonks feeding a production app
 * would mean fabricated half-times firing on real fixtures. It is the one
 * combination that must be impossible, so it is checked before anything else
 * runs.
 *
 * (Inside a function, not at module scope, so the unit test can import this
 * file's classifier without the module trying to run a matchday.)
 */
function assertEnv() {
  if (!CRON_SECRET) die("CRON_SECRET is not set");
  if (!API_BASE) die("HALFTIME_API_BASE / NEXT_PUBLIC_APP_URL is not set");
  if (!SM_KEY) die("SPORTMONKS_API_KEY is not set");
  if (!Number.isFinite(SCALE) || SCALE <= 0) die(`HALFTIME_SCALE must be > 0 (got ${SCALE})`);

  const smIsLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(SM_BASE);
  const apiIsLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(API_BASE);
  if (smIsLocal !== apiIsLocal) {
    die(
      `refusing to start: SPORTMONKS_BASE_URL (${SM_BASE}) and HALFTIME_API_BASE (${API_BASE}) ` +
        `must both be local (replay) or both be remote (production). Never one of each.`,
    );
  }
}

// ── the clock ────────────────────────────────────────────────────────────────
// Every duration below is written in real-world units and divided by SCALE.
// SCALE is 1 in production, so what ships is exactly what is written here; the
// replay harness sets it to 60 or 120 to compress a matchday. The floors stop
// an aggressive scale from turning a 6-second poll into a busy-wait.

const scaled = (ms, floorMs = 25) => Math.max(floorMs, Math.round(ms / SCALE));

const POLL_MS = () => scaled(6_000 * pollBackoff, 40);       // fast lane
const SLOW_MS = scaled(60_000, 250);                          // by-id sweep, in play
const IDLE_SWEEP_MS = scaled(5 * 60_000, 500);                // by-id sweep, pre-match
const HEARTBEAT_MS = scaled(60_000, 500);
const SCHEDULE_MS = scaled(30_000, 250);
const HARD_EXIT_MS = scaled(165 * 60_000);                    // last KO + 2h45
const SINGLE_INSTANCE_S = 90;                                 // real seconds, not scaled

let pollBackoff = 1; // 1 → 6s, 2 → 12s, 5 → 30s (429 degradation)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── run state (persistent: survives a restart, so alerts don't repeat) ────────

const matchdayKey = () =>
  DATE_OVERRIDE ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const STATE_FILE = join(STATE_DIR, `halftime-poller-${matchdayKey()}.json`);

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    /* a corrupt state file must not stop a matchday */
  }
  return { matchday: matchdayKey(), startedAt: new Date().toISOString(), alerts: {}, fixtures: {} };
}

const state = loadState();

function saveState() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    state.updatedAt = new Date().toISOString();
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  } catch (e) {
    warn("could not persist run state:", e.message);
  }
}

/** Per-fixture scratch that must survive a restart (what we already attempted). */
function fx(id) {
  state.fixtures[id] ??= {};
  return state.fixtures[id];
}

// ── telegram (bounded, deduped through the run-state file) ───────────────────

let tg = null;
async function telegram(text) {
  if (NO_TELEGRAM) {
    log(`[telegram suppressed] ${text}`);
    return;
  }
  try {
    tg ??= await import(join(REPO, "scripts", "tg.mjs"));
    await tg.sendMessage(text);
  } catch (e) {
    warn("telegram send failed:", e.message);
  }
}

/** Alert once per key per matchday, even across restarts (LOOP rule 4). */
async function alertOnce(key, text) {
  if (state.alerts[key]) return;
  state.alerts[key] = new Date().toISOString();
  saveState();
  err(text);
  await telegram(`⚠️ Halftime poller — ${text}`);
}

// ── http, with bounded retries (LOOP rule 3) ─────────────────────────────────

class HttpError extends Error {
  constructor(status, body, url) {
    super(`${status} ${url} ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

async function request(url, { method = "GET", headers = {}, body, attempts = 3, label = "" } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      const parsed = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

      if (res.status === 429) {
        pollBackoff = pollBackoff === 1 ? 2 : 5;
        last = new HttpError(429, parsed, url);
      } else if (res.status >= 500) {
        last = new HttpError(res.status, parsed, url);
      } else if (!res.ok) {
        // 4xx (other than 429) is a bug on our side, not a blip. Fail fast.
        throw new HttpError(res.status, parsed, url);
      } else {
        if (pollBackoff !== 1 && /livescores/.test(url)) pollBackoff = 1; // recovered
        return parsed;
      }
    } catch (e) {
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      last = e;
    }
    if (i < attempts) await sleep(scaled(400 * 2 ** (i - 1), 100));
  }
  throw last ?? new Error(`request failed: ${label || url}`);
}

const api = (path, init = {}) =>
  request(`${API_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${CRON_SECRET}`, ...(init.headers ?? {}) },
  });

const sm = (path) =>
  request(`${SM_BASE}${path}`, { headers: { authorization: SM_KEY } }).then((b) => b?.data ?? []);

// ── SportMonks phase classification ──────────────────────────────────────────
//
// This MUST agree with classifyPhase() in src/lib/halftime/shared.ts: the
// watchdog decides with that one and this process decides with this one, and if
// they disagree the two halves of the system disagree about what half time is.
// poller.test.mjs imports BOTH and compares them across all 25 states in the
// live catalogue, so drift fails a test instead of a Saturday.
//
// Names come from the real GET /v3/football/states (scenarios/states.json).

export const HALFTIME_STATE_ID = 3; // verified first-hand against the live API

export const PAST_HALFTIME_NAMES = new Set([
  "INPLAY_2ND_HALF", "BREAK", "EXTRA_TIME_BREAK", "INPLAY_ET",
  "INPLAY_ET_SECOND_HALF",
  "PEN_BREAK", "INPLAY_PENALTIES", "FT", "AET", "FT_PEN",
]);
export const ABNORMAL_NAMES = new Set([
  "POSTPONED", "CANCELLED", "ABANDONED", "WO", "AWARDED", "DELETED",
]);
export const PRE_NAMES = new Set(["NS", "TBA", "PENDING"]);

export function classifyPhase(stateId, developerName) {
  if (Number(stateId) === HALFTIME_STATE_ID) return "halftime";
  const name = String(developerName ?? "").trim().toUpperCase();
  if (!name) return "unknown";
  if (name === "HT") return "halftime";
  if (PRE_NAMES.has(name)) return "pre";
  if (name === "INPLAY_1ST_HALF") return "first_half";
  if (ABNORMAL_NAMES.has(name)) return "abnormal";
  if (PAST_HALFTIME_NAMES.has(name)) return "past_halftime";
  return "unknown";
}

let STATES = new Map();
async function loadStates() {
  const rows = await sm("/v3/football/states");
  STATES = new Map(rows.map((s) => [Number(s.id), s]));
  const ht = STATES.get(HALFTIME_STATE_ID);
  if (!ht || ht.developer_name !== "HT") {
    throw new Error(
      `state_id ${HALFTIME_STATE_ID} is "${ht?.developer_name ?? "missing"}", not HT — ` +
        `SportMonks renumbered its states and the whistle trigger is no longer trustworthy`,
    );
  }
  log(`states catalogue loaded (${STATES.size}); HT = ${HALFTIME_STATE_ID} ✓`);
}

const phaseOf = (stateId) => classifyPhase(stateId, STATES.get(Number(stateId))?.developer_name);

// ── entitlements ─────────────────────────────────────────────────────────────

async function assertEntitlements() {
  const raw = await sm("/v3/my/resources");
  const blob = JSON.stringify(raw ?? []).toLowerCase();
  // 'lineups' dropped — only needed by the retired fresh-slice pipeline.
  const missing = ["livescores", "states", "fixtures"].filter((r) => !blob.includes(r));
  if (missing.length) {
    await alertOnce(
      "entitlements",
      `SportMonks plan is missing ${missing.join(", ")} — whistle detection cannot run. ` +
        `(The trial expired 2026-07-22; check the paid subscription.)`,
    );
    die(`missing SportMonks entitlements: ${missing.join(", ")}`, 2);
  }
  log("entitlements ✓ livescores, states, fixtures");
}

// ── the schedule (our DB, through the API) ───────────────────────────────────
//
// The poller only needs fixture identity + kickoff time now — it has no
// interest in the Gameday quiz's own state, which /api/gameday/schedule also
// carries but this file never reads.

let slate = { matchday: matchdayKey(), fixtures: [] };

async function refreshSchedule() {
  const q = DATE_OVERRIDE ? `?date=${DATE_OVERRIDE}` : "";
  slate = await api(`/api/gameday/schedule${q}`);

  // Kickoff drift overlay, held locally only (no route writes it back to the
  // row — a known limitation, unchanged from before this pivot).
  for (const f of slate.fixtures) {
    const ov = state.fixtures[f.fixture_id]?.kickoffOverride;
    if (ov && ov !== f.kickoff_at) f.kickoff_at = ov;
  }
  return slate;
}

/** Fixtures still worth watching for a whistle today. */
const tracked = () =>
  slate.fixtures.filter((f) => !fx(f.fixture_id).whistled && !fx(f.fixture_id).cancelNudged);
const ko = (f) => new Date(f.kickoff_at).getTime();

// ── heartbeat (LOOP: staleness must be observable from outside) ──────────────

let lastBeat = 0;
async function beat(detail) {
  if (Date.now() - lastBeat < HEARTBEAT_MS) return;
  lastBeat = Date.now();
  try {
    await api("/api/halftime/heartbeat", { method: "POST", body: { detail }, attempts: 2 });
  } catch (e) {
    warn("heartbeat failed:", e.message);
  }
}

/** A second poller on the same matchday would double every side effect that is
 *  not already CAS-protected. A fresh heartbeat means someone else is on duty. */
async function assertSoleInstance() {
  try {
    const hb = await api("/api/halftime/heartbeat");
    if (hb?.beating && hb.ageSeconds != null && hb.ageSeconds < SINGLE_INSTANCE_S) {
      log(`another poller is beating (${hb.ageSeconds}s ago) — standing down`);
      process.exit(0);
    }
  } catch (e) {
    warn("could not read heartbeat; continuing:", e.message);
  }
}

// ── the whistle (the whole point now) ─────────────────────────────────────────

async function whistle(f, { late = false } = {}) {
  const s = fx(f.fixture_id);
  if (s.whistled) return;

  const label = `${f.home} v ${f.away}`;
  log(`${late ? "LATE " : ""}HALF TIME ${f.fixture_id} ${label} → whistle`);

  if (DRY_RUN) { log(`[dry-run] whistle ${f.fixture_id}`); return; }

  let out;
  try {
    out = await api("/api/halftime/whistle", { method: "POST", body: { fixtureId: f.fixture_id } });
  } catch (e) {
    await alertOnce(`whistle-${f.fixture_id}`, `whistle call failed for ${label}: ${e.message}. Watchdog will retry.`);
    return;
  }

  // LOOP rule 1: the 200 is not the evidence. Believe the route's own
  // confirmation of the timestamp it actually wrote (or found already set).
  if (!out?.secondHalfStartedAt) {
    await alertOnce(
      `whistle-unconfirmed-${f.fixture_id}`,
      `whistled ${label} but the route reported no second_half_started_at. Watchdog will retry.`,
    );
    return;
  }

  s.whistled = true;
  s.whistledAt = out.secondHalfStartedAt;
  saveState();

  log(`WHISTLE ${label} · second_half_started_at=${out.secondHalfStartedAt}${out.set ? "" : " (already set)"}`);
}

/**
 * Postponed / abandoned. Nudge the watchdog, whose own row selection is
 * time-based now (no quiz-state coupling) — it settles predictions and, in a
 * future workstream, could cancel the fixture's own Gameday pack. Bounded to
 * one nudge per fixture.
 */
async function cancelViaWatchdog(f, phaseName) {
  const s = fx(f.fixture_id);
  if (s.cancelNudged) return;
  s.cancelNudged = true;
  saveState();

  warn(`${f.fixture_id} ${f.home} v ${f.away} is ${phaseName}`);
  if (DRY_RUN) return;

  try {
    await api("/api/cron/halftime-watchdog");
  } catch (e) {
    warn(`cancel nudge failed for ${f.fixture_id}: ${e.message}`);
  }
  await telegram(`ℹ️ Halftime — ${f.home} v ${f.away} is ${phaseName}.`);
}

// ── the two lanes ────────────────────────────────────────────────────────────

/** fast: one call covers every in-play fixture, whatever the slate size. */
async function fastLane() {
  const live = await sm("/v3/football/livescores/latest");
  const byId = new Map(live.map((f) => [Number(f.id), f]));
  for (const f of tracked()) {
    const hit = byId.get(Number(f.fixture_id));
    if (!hit) continue;
    await onPhase(f, phaseOf(hit.state_id), "live");
  }
}

/**
 * slow: the live feed cannot tell us about a match that is not live. A
 * postponement never appears there at all. Neither does a kickoff that moved.
 * This lane is how those are seen.
 */
async function slowLane() {
  const ids = tracked().map((f) => f.fixture_id);
  if (!ids.length) return;
  const rows = await sm(`/v3/football/fixtures/multi/${ids.join(",")}`);
  const byId = new Map(rows.map((f) => [Number(f.id), f]));

  for (const f of tracked()) {
    const hit = byId.get(Number(f.fixture_id));
    if (!hit) continue;

    // Kickoff drift, held locally only (no route writes it back to the row —
    // that gap is a known limitation, unchanged from before this pivot). NOTE
    // the threshold is scaled: it is "a minute of match time", not "a minute
    // of wall clock".
    const smKo = hit.starting_at_timestamp ? hit.starting_at_timestamp * 1000 : null;
    if (smKo && Math.abs(smKo - ko(f)) > scaled(60_000, 200)) {
      log(
        `kickoff moved for ${f.fixture_id} ${f.home} v ${f.away}: ` +
          `${new Date(ko(f)).toISOString()} → ${new Date(smKo).toISOString()}`,
      );
      f.kickoff_at = new Date(smKo).toISOString();
      const s = fx(f.fixture_id);
      s.kickoffOverride = f.kickoff_at; // local cache; the DB row is the truth
      saveState();

      await alertOnce(
        `kickoff-moved-${f.fixture_id}`,
        `${f.home} v ${f.away} kickoff moved to ${new Date(smKo).toISOString().slice(11, 16)}Z.`,
      );
    }

    await onPhase(f, phaseOf(hit.state_id), "by-id");
  }
}

async function onPhase(f, phase, lane) {
  const s = fx(f.fixture_id);
  if (s.lastPhase !== phase) {
    log(`${f.fixture_id} ${f.home} v ${f.away}: ${s.lastPhase ?? "?"} → ${phase} (${lane})`);
    s.lastPhase = phase;
    saveState();
  }

  if (phase === "abnormal") return cancelViaWatchdog(f, "postponed/abandoned");
  if (phase === "halftime") return whistle(f);
  if (phase === "past_halftime") {
    // We never saw the exact HT flip (feed hiccup, or we were restarted). The
    // second half has clearly started, so record it late — better late than
    // never for the prediction poll's own opening.
    return whistle(f, { late: true });
  }
}

// ── day summary ──────────────────────────────────────────────────────────────

async function summary() {
  const rows = slate.fixtures;
  const whistled = rows.filter((r) => fx(r.fixture_id).whistled).length;

  const lines = [
    `🕐 Halftime whistle detection — ${slate.matchday}`,
    `${whistled}/${rows.length} fixture(s) whistled`,
    ...rows.map((r) => `  ${fx(r.fixture_id).whistled ? "✅" : "—"} ${r.home} v ${r.away}`),
  ];

  log(lines.join("\n"));
  await telegram(lines.join("\n"));
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  assertEnv();
  log(`api=${API_BASE} sportmonks=${SM_BASE} scale=${SCALE}x${DRY_RUN ? " DRY-RUN" : ""}`);

  await refreshSchedule();
  if (!slate.fixtures.length) {
    // The common case. Most days have no Premier League football, and on those
    // days this process must cost exactly nothing: no SportMonks call has been
    // made at this point, and none will be.
    log(`no PL fixtures on ${slate.matchday} — nothing to do`);
    process.exit(0);
  }

  await assertSoleInstance();
  await loadStates();
  await assertEntitlements();

  const kickoffs = slate.fixtures.map(ko).sort((a, b) => a - b);
  const firstKo = kickoffs[0];
  const lastKo = kickoffs[kickoffs.length - 1];
  const hardExit = lastKo + HARD_EXIT_MS;

  log(
    `${slate.fixtures.length} fixture(s) · first KO ${new Date(firstKo).toISOString()} · ` +
      `last KO ${new Date(lastKo).toISOString()}`,
  );
  for (const f of slate.fixtures) log(`  ${f.fixture_id} ${f.home} v ${f.away}`);

  let lastSchedule = Date.now();
  let lastSlow = 0;

  for (;;) {
    const now = Date.now();

    if (now > hardExit) {
      await alertOnce("hard-exit", `wall-clock limit reached with fixtures unwhistled: ` +
        `${tracked().map((f) => `${f.home} v ${f.away}`).join(", ") || "none"}`);
      break;
    }

    await beat({ matchday: slate.matchday, tracked: tracked().length, scale: SCALE });

    if (now - lastSchedule >= SCHEDULE_MS) {
      lastSchedule = now;
      try {
        await refreshSchedule();
      } catch (e) {
        warn("schedule refresh failed:", e.message);
      }
    }

    if (!tracked().length) {
      log("every fixture whistled or otherwise done");
      break;
    }

    // Before anyone has kicked off there is nothing for the live feed to say.
    const inPlay = tracked().some((f) => Date.now() >= ko(f) - scaled(2 * 60_000));
    const slowEvery = inPlay ? SLOW_MS : IDLE_SWEEP_MS;

    if (Date.now() - lastSlow >= slowEvery) {
      lastSlow = Date.now();
      try {
        await slowLane();
      } catch (e) {
        warn("by-id sweep failed:", e.message);
        if (e.status === 429) await alertOnce("rate-limit", "SportMonks is rate-limiting us (429).");
      }
    }

    if (inPlay) {
      try {
        await fastLane();
      } catch (e) {
        warn("live poll failed:", e.message);
        if (e.status === 429) {
          await alertOnce("rate-limit", `SportMonks 429 — poll cadence degraded to ${6 * pollBackoff}s.`);
        } else {
          await alertOnce("sportmonks-down", `SportMonks is not responding: ${e.message}. Watchdog is the backstop.`);
        }
      }
      await sleep(POLL_MS());
    } else {
      await sleep(Math.min(SCHEDULE_MS, scaled(10_000, 100)));
    }
  }

  await summary();
  saveState();
  log("done");
  process.exit(0);
}

// Only run a matchday when invoked as a program. Imported (by poller.test.mjs),
// this file is just its classifier.
const INVOKED_DIRECTLY = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (INVOKED_DIRECTLY) {
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      log(`${sig} — saving run state and exiting`);
      saveState();
      process.exit(0);
    });
  }

  main().catch(async (e) => {
    await alertOnce("crash", `poller crashed: ${e.message}`);
    err(e.stack ?? e.message);
    saveState();
    process.exit(1);
  });
}
