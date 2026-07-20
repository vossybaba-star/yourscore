#!/usr/bin/env node
/**
 * poller.mjs — the halftime daemon. One Node process, one matchday.
 *
 * It exists for one reason: a pack must go live at the REAL half-time whistle,
 * not at kickoff+45. Those are not the same moment. A first half with a serious
 * injury and a VAR check runs 55 minutes; a timer would have published the pack
 * ten minutes into the game, while people were still watching the first half.
 * So the trigger is SportMonks' own state flip to HT (state_id 3) and nothing
 * else. There is no timer anywhere in this file that can release a pack.
 *
 * THE DAY
 *   07:00  launched by cron. No PL fixtures today → log, exit 0. Zero API calls.
 *   T-75   lineup watch opens. Confirmed XIs → fresh slice → Telegram veto gate.
 *   T-10   veto deadline. Unvetoed questions auto-approve. Pack is FROZEN.
 *   KO     6s poll of /livescores/latest begins.
 *   HT     state_id == 3 → POST /api/halftime/release → pack live + push.
 *   FT     all fixtures terminal → day summary → exit 0.
 *
 * TWO LANES, and it needs both:
 *   fast (6s)  /livescores/latest        — catches the HT flip within seconds.
 *   slow (60s) /fixtures/multi/{ids}     — catches what the live feed cannot.
 *              A postponed match is not "live", so it never appears in
 *              /livescores at all; an abandoned one drops off it within
 *              seconds. Without the by-id sweep the poller would sit waiting
 *              for a half-time whistle that is never going to be blown.
 *
 * LOOP-STANDARD (the four rules every automated loop here must satisfy)
 *   1 assert success, not existence — after every release it re-reads
 *     /api/halftime/today and confirms the fixture actually says `released`.
 *     A 200 from the release POST is not evidence that anything happened.
 *   2 gate every outward action — releases only ever fire on a real state flip;
 *     the fresh slice only ships through the veto gate, and if the gate could
 *     not be OFFERED (Telegram down, veto script absent) the fresh slice is
 *     DROPPED rather than auto-released. A gate that was never shown counts as
 *     a veto.
 *   3 bound the retry path — 3 attempts with backoff on every call; poll
 *     cadence degrades 6s→12s→30s on 429; hard wall-clock exit.
 *   4 one persistent dedup key per side effect — release is the server-side
 *     `staged→released` compare-and-set (not a flag in this process's memory);
 *     assembly is the `base_ready→staged` CAS; push dedups on notification_log;
 *     Telegram alerts dedup through the on-disk run-state file, so a restart
 *     does not re-alert.
 *
 * The poller NEVER touches the database. Every write goes through an API route,
 * so there is exactly one code path per side effect and the watchdog cannot
 * disagree with it.
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
 *   --dry-run           do everything except POST release/assemble/fresh
 */

import { spawn } from "node:child_process";
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
 * would mean fabricated half-times releasing real packs and sending real pushes
 * to real people. It is the one combination that must be impossible, so it is
 * checked before anything else runs.
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
const LINEUP_LEAD_MS = scaled(75 * 60_000);                   // T-75: watch opens
const LINEUP_GIVEUP_MS = scaled(25 * 60_000);                 // T-25: no sheets → skip
const LINEUP_POLL_MS = scaled(60_000, 250);
const ASSEMBLE_LEAD_MS = scaled(10 * 60_000);                 // T-10: freeze
const VETO_WINDOW_MS = scaled(15 * 60_000);                   // ≥15 min to respond
const VETO_FLOOR_MS = scaled(5 * 60_000);                     // never later than T-5
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
//
// This file used to carry two extra spellings — "INPLAY_ET_2ND_HALF" and
// "AWAITING_PENALTIES" — to stay bug-compatible with shared.ts, which named two
// states SportMonks does not have. shared.ts was fixed at integration (the real
// extra-time second half is INPLAY_ET_SECOND_HALF, id 23; there is no
// AWAITING_PENALTIES at all), so the compat spellings are gone and BOTH
// classifiers now name only states that exist. poller.test.mjs asserts that.

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
        `SportMonks renumbered its states and the release trigger is no longer trustworthy`,
    );
  }
  log(`states catalogue loaded (${STATES.size}); HT = ${HALFTIME_STATE_ID} ✓`);
}

const phaseOf = (stateId) => classifyPhase(stateId, STATES.get(Number(stateId))?.developer_name);

// ── entitlements ─────────────────────────────────────────────────────────────

async function assertEntitlements() {
  const raw = await sm("/v3/my/resources");
  const blob = JSON.stringify(raw ?? []).toLowerCase();
  const missing = ["livescores", "states", "lineups", "fixtures"].filter((r) => !blob.includes(r));
  if (missing.length) {
    await alertOnce(
      "entitlements",
      `SportMonks plan is missing ${missing.join(", ")} — the halftime pipeline cannot run. ` +
        `(The trial expired 2026-07-22; check the paid subscription.)`,
    );
    die(`missing SportMonks entitlements: ${missing.join(", ")}`, 2);
  }
  log("entitlements ✓ livescores, states, lineups, fixtures");
}

// ── the schedule (our DB, through the API) ───────────────────────────────────

const TERMINAL = new Set(["released", "released_late", "cancelled", "failed"]);

let slate = { matchday: matchdayKey(), freshKill: false, fixtures: [] };

async function refreshSchedule() {
  const q = DATE_OVERRIDE ? `?date=${DATE_OVERRIDE}` : "";
  slate = await api(`/api/halftime/schedule${q}`);

  // ── kickoff drift overlay ─────────────────────────────────────────────────
  // When SportMonks moves a kickoff, the poller has nowhere to write it: there
  // is no route that updates halftime_releases.kickoff_at (see README, "known
  // gaps"). So the observed kickoff is held in the run-state file and re-applied
  // over every schedule read. This keeps the POLLER's decisions — veto deadline,
  // T-10 freeze, when to start the live poll — anchored to the real kickoff, and
  // it survives a restart.
  //
  // It does NOT fix the watchdog, which reads kickoff_at straight from the
  // database. A kickoff pushed back 30 minutes leaves the watchdog believing the
  // match has started, and a `base_ready` fixture past its (stale) kickoff is one
  // it will stage BASE-ONLY — throwing away a fresh slice that was still inside
  // its veto window. That needs a route. It is written up in the report.
  for (const f of slate.fixtures) {
    const ov = state.fixtures[f.fixture_id]?.kickoffOverride;
    if (ov && ov !== f.kickoff_at) f.kickoff_at = ov;
  }
  return slate;
}

const tracked = () => slate.fixtures.filter((f) => !TERMINAL.has(f.state));
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

// ── the generation scripts, invoked as child processes (never imported) ──────
//
// HALFTIME_GEN_DIR is a seam, like SPORTMONKS_BASE_URL. In production it is
// unset and these resolve to the real gen-fresh/veto scripts sitting next to
// this file. The replay harness points it at a directory of deterministic stubs
// instead, so a test run cannot reach out to Anthropic or the real API and a
// replay's outcome does not depend on what an LLM felt like writing that day.
const GEN_DIR = process.env.HALFTIME_GEN_DIR || HERE;

/**
 * Resolve a generation script by name.
 *
 * (The veto script was briefly built as `veto-gate.mjs` while the spec's CLI
 * contract called it `veto.mjs`, and the poller tolerated both. At integration
 * the file was renamed to the contract name; the multi-name lookup is kept
 * because the replay harness supplies its own stub filenames through GEN_DIR.)
 */
function w3(...names) {
  for (const n of names) {
    const p = join(GEN_DIR, n);
    if (existsSync(p)) return p;
  }
  return null;
}

function run(scriptPath, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: REPO,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let errOut = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { errOut += d; });
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err: errOut });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, out, err: e.message });
    });
  });
}

// ── content writes (all through the single content-write route) ──────────────

async function writeFresh(fixtureId, questions, freshState, extra = {}) {
  if (DRY_RUN) return log(`[dry-run] fresh ${fixtureId} → ${freshState} (${questions.length})`);
  return api("/api/halftime/fresh", {
    method: "POST",
    body: { op: "fresh", fixtureId, questions, state: freshState, ...extra },
  });
}

/**
 * Persist a moved kickoff to the row.
 *
 * The poller used to hold a moved kickoff ONLY in its run-state file, because no
 * route could write it. The watchdog reads kickoff_at from the database, so the
 * two disagreed the moment a kickoff slipped — and if the poller then died, the
 * watchdog acted on the stale time and staged the pack base-only, discarding a
 * fresh slice still inside its veto window. The `kickoff` op closed that gap;
 * the row is now the single clock and the overlay is just a local cache of it.
 */
async function writeKickoff(fixtureId, kickoffAt, extra = {}) {
  if (DRY_RUN) return log(`[dry-run] kickoff ${fixtureId} → ${kickoffAt}`);
  return api("/api/halftime/fresh", {
    method: "POST",
    body: { op: "kickoff", fixtureId, kickoffAt, ...extra },
  });
}

// ── the fresh slice (pass 2) ─────────────────────────────────────────────────
//
// Everything here happens BEFORE kickoff, by construction. Nothing in this file
// generates or edits content after the kickoff whistle — the release step is a
// copy of an already-frozen snapshot. That, not prompt discipline, is what makes
// "no question may depend on a first-half event" a structural guarantee.

async function lineupsConfirmed(fixtureId) {
  const f = await sm(`/v3/football/fixtures/${fixtureId}?include=lineups`);
  const rows = f?.lineups ?? [];
  if (!rows.length) return false;
  const starters = rows.filter((r) => Number(r.type_id) === 11);
  const byTeam = new Map();
  for (const s of starters) byTeam.set(s.team_id, (byTeam.get(s.team_id) ?? 0) + 1);
  const sides = [...byTeam.values()];
  return sides.length >= 2 && sides.every((n) => n >= 11);
}

async function runFreshPipeline(f) {
  const s = fx(f.fixture_id);
  if (s.freshDone) return;

  const gen = w3("gen-fresh.mjs");
  const veto = w3("veto.mjs");

  // W3 not built yet (or deliberately absent). Degrade to base-only — a pack
  // with no fresh slice is a completely normal outcome, not a failure.
  if (!gen || !veto) {
    await alertOnce(
      "w3-missing",
      `gen-fresh.mjs / veto.mjs not present — every pack today ships base-only.`,
    );
    s.freshDone = true;
    s.freshOutcome = "no-generator";
    saveState();
    await writeFresh(f.fixture_id, [], "skipped");
    return;
  }

  log(`fresh: generating for ${f.fixture_id} (${f.home} v ${f.away})`);
  const g = await run(gen, ["--fixture", String(f.fixture_id)], scaled(4 * 60_000, 5_000));
  if (g.code !== 0) {
    warn(`gen-fresh exited ${g.code} for ${f.fixture_id}: ${g.err.slice(0, 300)}`);
    s.freshDone = true;
    s.freshOutcome = `gen-failed(${g.code})`;
    saveState();
    await writeFresh(f.fixture_id, [], "skipped");
    return;
  }

  const after = (await refreshSchedule()).fixtures.find((x) => x.fixture_id === f.fixture_id);
  const count = (after?.fresh_questions ?? []).length;
  if (!count) {
    log(`fresh: nothing worth asking for ${f.fixture_id} — base-only`);
    s.freshDone = true;
    s.freshOutcome = "empty";
    saveState();
    return;
  }

  // The gate. If the veto message cannot be CONFIRMED sent, the slice is
  // dropped — a gate that was never offered counts as a veto (LOOP rule 2).
  const v = await run(veto, ["send", "--fixture", String(f.fixture_id)], scaled(2 * 60_000, 5_000));
  if (v.code !== 0) {
    await alertOnce(
      `veto-send-${f.fixture_id}`,
      `could not send the veto message for ${f.home} v ${f.away} — fresh slice DROPPED, base-only pack.`,
    );
    s.freshDone = true;
    s.freshOutcome = "gate-unsendable";
    saveState();
    await writeFresh(f.fixture_id, [], "skipped");
    return;
  }

  s.freshDone = true;
  s.freshOutcome = `pending_veto(${count})`;
  saveState();
  log(`fresh: ${count} question(s) at the veto gate for ${f.fixture_id}`);
}

/** The auto-release clock: max(sent + 15min, KO − 10min), never later than KO − 5min. */
function vetoDeadline(f, sentAt = Date.now()) {
  const kickoff = ko(f);
  const target = Math.max(sentAt + VETO_WINDOW_MS, kickoff - ASSEMBLE_LEAD_MS);
  return new Date(Math.min(target, kickoff - VETO_FLOOR_MS));
}

async function ensureVetoDeadline(f) {
  if (f.fresh_state !== "pending_veto" || f.veto_deadline_at) return;
  const dl = vetoDeadline(f);
  log(`veto deadline for ${f.fixture_id}: ${dl.toISOString()} (auto-release, no response needed)`);
  await writeFresh(f.fixture_id, f.fresh_questions ?? [], "pending_veto", {
    vetoDeadlineAt: dl.toISOString(),
  });
}

/**
 * The timeout. Every question still `pending` at the deadline becomes
 * `approved` and goes live. This is the founder's explicit decision — no
 * response is required, ever, and there is deliberately no blocking wait here.
 */
async function autoApprove(f) {
  const pending = (f.fresh_questions ?? []).filter((q) => q.status === "pending");
  if (!pending.length) return;
  const questions = f.fresh_questions.map((q) => (q.status === "pending" ? { ...q, status: "approved" } : q));
  const kept = questions.filter((q) => q.status === "approved").length;
  log(`veto deadline passed for ${f.fixture_id}: ${pending.length} unvetoed → approved (${kept} fresh in pack)`);
  await writeFresh(f.fixture_id, questions, "approved");
}

// ── assembly (T-10) ──────────────────────────────────────────────────────────

function assembleAt(f) {
  if (f.fresh_state === "pending_veto" && f.veto_deadline_at) return new Date(f.veto_deadline_at).getTime();
  return ko(f) - ASSEMBLE_LEAD_MS;
}

async function assemble(f) {
  const s = fx(f.fixture_id);
  if (s.assembled) return;

  if (f.fresh_state === "pending_veto") await autoApprove(f);

  if (DRY_RUN) { log(`[dry-run] assemble ${f.fixture_id}`); return; }

  const out = await api("/api/halftime/assemble", {
    method: "POST",
    body: { fixtureId: f.fixture_id },
  });

  // LOOP rule 1: the 200 is not the evidence. The row saying `staged` is.
  const after = (await refreshSchedule()).fixtures.find((x) => x.fixture_id === f.fixture_id);
  if (after?.state !== "staged") {
    await alertOnce(
      `assemble-${f.fixture_id}`,
      `assembly did not stage ${f.home} v ${f.away} (state=${after?.state}, reason=${out?.reason ?? "?"}). ` +
        `The watchdog will assemble base-only after kickoff.`,
    );
    return;
  }

  s.assembled = true;
  s.packId = after.pack_id;
  s.freshInPack = (after.fresh_questions ?? []).filter((q) => q.status === "approved").length;
  saveState();
  log(
    `staged ${f.fixture_id} ${f.home} v ${f.away} · pack ${after.pack_id} · ` +
      `${s.freshInPack} fresh + ${10 - s.freshInPack} base · frozen until the whistle`,
  );
}

// ── release (the whole point) ────────────────────────────────────────────────

async function release(f, { late = false } = {}) {
  const s = fx(f.fixture_id);
  if (s.released) return;

  const label = `${f.home} v ${f.away}`;
  log(`${late ? "LATE " : ""}HALF TIME ${f.fixture_id} ${label} → releasing`);

  if (DRY_RUN) { log(`[dry-run] release ${f.fixture_id}`); return; }

  let out;
  try {
    out = await api("/api/halftime/release", { method: "POST", body: { fixtureId: f.fixture_id, late } });
  } catch (e) {
    await alertOnce(`release-${f.fixture_id}`, `release call failed for ${label}: ${e.message}. Watchdog will retry.`);
    return;
  }

  // ── LOOP rule 1 ───────────────────────────────────────────────────────────
  // Do not believe the response. Read the pack back from the PUBLIC projection
  // — the same endpoint a player's browser hits — and confirm it is actually
  // live. If it is not, this fixture is not released, whatever the POST said.
  let confirmed = null;
  for (let i = 0; i < 3 && !confirmed; i++) {
    if (i) await sleep(scaled(1_000, 200));
    try {
      const today = await api("/api/halftime/today");
      const row = (today.fixtures ?? []).find((x) => x.fixture_id === f.fixture_id);
      if (row && (row.state === "released" || row.state === "released_late") && row.pack_id && row.slug) {
        confirmed = row;
      }
    } catch (e) {
      warn(`release read-back failed (${i + 1}/3): ${e.message}`);
    }
  }

  if (!confirmed) {
    await alertOnce(
      `release-unconfirmed-${f.fixture_id}`,
      `released ${label} but /api/halftime/today does not show it live ` +
        `(api said state=${out?.state}, released=${out?.released}). Watchdog will retry.`,
    );
    return;
  }

  s.released = true;
  s.releasedAt = new Date().toISOString();
  s.releasedState = confirmed.state;
  s.pushTargeted = out?.pushTargeted ?? 0;
  s.slug = confirmed.slug;
  saveState();

  log(
    `LIVE ${label} · /challenges/${confirmed.slug}?pid=${confirmed.pack_id} · ` +
      `state=${confirmed.state} · push targeted ${out?.pushTargeted ?? 0}` +
      (out?.already ? " (another caller won the race — no double push)" : ""),
  );
}

/**
 * Postponed / abandoned. The poller has no cancel route of its own: cancellation
 * lives in the release engine and the watchdog is the only caller of it, so we
 * nudge the watchdog rather than growing a second code path for the same side
 * effect. Bounded to one nudge per fixture.
 */
async function cancelViaWatchdog(f, phaseName) {
  const s = fx(f.fixture_id);
  if (s.cancelNudged) return;
  s.cancelNudged = true;
  saveState();

  warn(`${f.fixture_id} ${f.home} v ${f.away} is ${phaseName} — no pack will be released`);
  if (DRY_RUN) return;

  try {
    await api("/api/cron/halftime-watchdog");
    const after = (await refreshSchedule()).fixtures.find((x) => x.fixture_id === f.fixture_id);
    if (after?.state === "cancelled") {
      log(`cancelled ${f.fixture_id} (${phaseName}) — no pack, no push`);
    } else if (after && !TERMINAL.has(after.state)) {
      warn(`${f.fixture_id} still ${after.state} after cancel nudge; watchdog will pick it up`);
    }
  } catch (e) {
    warn(`cancel nudge failed for ${f.fixture_id}: ${e.message}`);
  }
  await telegram(`ℹ️ Halftime — ${f.home} v ${f.away} is ${phaseName}. No quiz pack today.`);
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

    // Kickoff drift. SportMonks is the truth; our view follows it.
    //
    // NOTE the threshold is scaled. It is "a minute of match time", not "a
    // minute of wall clock" — an unscaled 60_000 here would be a bug that only
    // ever showed up in replay, where a 20-minute delay compresses to 10 real
    // seconds and would slip under the threshold unnoticed. (It did. That is how
    // this comment came to be here.)
    const smKo = hit.starting_at_timestamp ? hit.starting_at_timestamp * 1000 : null;
    if (smKo && Math.abs(smKo - ko(f)) > scaled(60_000, 200)) {
      log(
        `kickoff moved for ${f.fixture_id} ${f.home} v ${f.away}: ` +
          `${new Date(ko(f)).toISOString()} → ${new Date(smKo).toISOString()}`,
      );
      f.kickoff_at = new Date(smKo).toISOString();
      const s = fx(f.fixture_id);
      s.kickoffOverride = f.kickoff_at; // local cache; the DB row is the truth

      // The veto deadline was computed against the old kickoff — recompute it,
      // and push BOTH the new kickoff and the new deadline to the row in one op.
      // The watchdog reads kickoff_at from the DB: if we only kept this in our
      // own head (as we used to), a poller death here would leave the watchdog
      // acting on the old time and staging the pack base-only.
      const pendingVeto = f.fresh_state === "pending_veto" && !s.assembled;
      let dl = null;
      if (pendingVeto) {
        dl = vetoDeadline(f, Date.now());
        f.veto_deadline_at = dl.toISOString();
      }
      await writeKickoff(
        f.fixture_id,
        f.kickoff_at,
        dl ? { vetoDeadlineAt: dl.toISOString() } : {},
      );
      saveState();

      await alertOnce(
        `kickoff-moved-${f.fixture_id}`,
        `${f.home} v ${f.away} kickoff moved to ${new Date(smKo).toISOString().slice(11, 16)}Z. ` +
          `Poller and halftime_releases.kickoff_at both updated` +
          (dl ? `; veto deadline recomputed to ${dl.toISOString().slice(11, 16)}Z.` : `.`),
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

  if (f.state !== "staged") {
    // Kickoff has come and gone and nothing is staged: the pre-match pipeline
    // did not finish. Freeze the base slate NOW rather than wait for the
    // watchdog — it is the same base-only outcome, five minutes sooner.
    if (phase !== "pre" && f.state === "base_ready" && !s.assembled) {
      warn(`${f.fixture_id} is in play but not staged — assembling base-only`);
      await assemble(f);
      await refreshSchedule();
    }
    return;
  }

  if (phase === "halftime") return release(f);
  if (phase === "past_halftime") {
    // We never saw the whistle (feed hiccup, or we were restarted). The pack is
    // still true — its questions were frozen before kickoff — so it goes live.
    // But NO push: a notification after the restart is useless and a spoiler.
    await alertOnce(
      `late-${f.fixture_id}`,
      `missed the half-time flip for ${f.home} v ${f.away} — releasing late, no push.`,
    );
    return release(f, { late: true });
  }
}

// ── pre-match work ───────────────────────────────────────────────────────────

async function preMatch() {
  const now = Date.now();
  for (const f of tracked()) {
    const s = fx(f.fixture_id);
    const kickoff = ko(f);

    if (f.state === "scheduled") {
      // No approved base slate by T-60 → this fixture has no pack. That is the
      // gate doing its job: nothing reaches a player ungated.
      if (now >= kickoff - scaled(60 * 60_000) && !s.noBaseWarned) {
        s.noBaseWarned = true;
        saveState();
        await alertOnce(
          `nobase-${f.fixture_id}`,
          `${f.home} v ${f.away} has no approved base slate at T-60 — no pack for this fixture.`,
        );
      }
      continue;
    }
    if (f.state !== "base_ready") continue;

    // 1. lineup watch → fresh slice → veto gate
    const inLineupWindow = now >= kickoff - LINEUP_LEAD_MS && now < kickoff - LINEUP_GIVEUP_MS;
    if (inLineupWindow && !s.freshDone && !slate.freshKill && f.fresh_state === "none") {
      if (!s.lastLineupPoll || now - s.lastLineupPoll >= LINEUP_POLL_MS) {
        s.lastLineupPoll = now;
        try {
          if (await lineupsConfirmed(f.fixture_id)) {
            log(`confirmed XIs for ${f.fixture_id} ${f.home} v ${f.away}`);
            await runFreshPipeline(f);
            await refreshSchedule();
          }
        } catch (e) {
          warn(`lineup check failed for ${f.fixture_id}: ${e.message}`);
        }
      }
    }

    // 2. sheets never landed → skip fresh, ship base-only. Normal outcome.
    if (!s.freshDone && now >= kickoff - LINEUP_GIVEUP_MS && f.fresh_state === "none") {
      s.freshDone = true;
      s.freshOutcome = "no-lineups";
      saveState();
      log(`no confirmed XIs by T-25 for ${f.fixture_id} — base-only`);
      await writeFresh(f.fixture_id, [], "skipped");
      await refreshSchedule();
    }

    // 3. the veto clock
    if (f.fresh_state === "pending_veto" && !f.veto_deadline_at) {
      await ensureVetoDeadline(f);
      await refreshSchedule();
    }

    // 4. freeze
    if (!s.assembled && now >= assembleAt(f)) {
      await assemble(f);
      await refreshSchedule();
    }
  }
}

// ── day summary ──────────────────────────────────────────────────────────────

async function summary() {
  await refreshSchedule();
  const rows = slate.fixtures;
  const by = (st) => rows.filter((r) => r.state === st);
  const freshShipped = rows.reduce(
    (n, r) => n + (r.fresh_questions ?? []).filter((q) => q.status === "approved").length,
    0,
  );
  const vetoed = rows.reduce(
    (n, r) => n + (r.fresh_questions ?? []).filter((q) => q.status === "vetoed").length,
    0,
  );

  const lines = [
    `🕐 Halftime packs — ${slate.matchday}`,
    `released: ${by("released").length} · late: ${by("released_late").length} · ` +
      `cancelled: ${by("cancelled").length} · failed: ${by("failed").length}`,
    `fresh questions live: ${freshShipped} · vetoed: ${vetoed}` + (slate.freshKill ? " · SLATE KILLED" : ""),
    ...rows.map((r) => `  ${r.state === "released" ? "✅" : r.state === "released_late" ? "🕓" : "—"} ${r.home} v ${r.away} (${r.state})`),
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
      `last KO ${new Date(lastKo).toISOString()}` + (slate.freshKill ? " · FRESH KILLED FOR TODAY" : ""),
  );
  for (const f of slate.fixtures) log(`  ${f.fixture_id} ${f.home} v ${f.away} (${f.state})`);

  let lastSchedule = Date.now();
  let lastSlow = 0;

  for (;;) {
    const now = Date.now();

    if (now > hardExit) {
      await alertOnce("hard-exit", `wall-clock limit reached with fixtures unreleased: ` +
        `${tracked().map((f) => `${f.home} v ${f.away} (${f.state})`).join(", ") || "none"}`);
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
      log("every fixture is terminal");
      break;
    }

    try {
      await preMatch();
    } catch (e) {
      warn("pre-match pass failed:", e.message);
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
