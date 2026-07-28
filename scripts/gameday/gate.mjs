#!/usr/bin/env node
/**
 * gate.mjs — the Gameday approve gate (spec §3.3). The normal approve-to-ship
 * norm; the veto-with-timeout departure died with the fresh slice (§0.1).
 *
 *   ONE Telegram batch message per matchday slate at D-2 ≈18:00, per-pack
 *   Approve / Regenerate buttons (regen bounded ≤2 rounds). Reminder at
 *   D-1 07:00. A pack unapproved by its publish_at → cancelled, Telegram FYI.
 *   THERE IS NO AUTO-RELEASE PATH — every question a player ever sees passed
 *   through a human tap on Approve.
 *
 * Built on scripts/halftime/lib/tg-halftime.mjs rather than tg.mjs/tg-gates.mjs
 * directly, for the same reason the old veto gate was: this gate needs a
 * multi-row keyboard (one Approve/Regenerate pair PER FIXTURE in one message)
 * and a non-blocking poll serviced by a single consumer across a whole slate —
 * tg.mjs's awaitApproval() is single-row, single-message, blocking. Same
 * token/chat resolution, same retry/backoff, same exit-code convention (0/1/3)
 * as tg-gates.mjs. tg.mjs and tg-gates.mjs are read-only for this workstream —
 * this file is a sibling, not a fork of either.
 *
 * WHY ONE LONG-LIVED PROCESS, NOT A CRON TICK: the gate spans D-2 18:00 (send)
 * through D-1 07:00 (reminder) to each fixture's own publish_at the next
 * morning — roughly 15 hours during which taps can land at any moment.
 * `watch` runs for that whole window as one process (matching how poller.mjs
 * already runs long-lived on matchdays), rather than trying to resume
 * mid-conversation from a 5-minute cron tick. Regeneration counts live only
 * in this process's memory for that reason — the founder's real workflow is
 * "one sitting" (spec §3.3), and a crash mid-gate just means a fresh `watch`
 * re-sends the slate and the founder taps again; worst case is one extra
 * regeneration round, not a safety property like the old veto gate's.
 *
 * CLI:
 *   gate.mjs send     --date <YYYY-MM-DD> [--preview] [--dry-run]
 *   gate.mjs reminder --date <YYYY-MM-DD> [--dry-run]
 *   gate.mjs watch    --date <YYYY-MM-DD> [--dry-run] [--minutes N]
 *
 * --dry-run composes and prints every message; it sends nothing and calls no
 * write op — safe to run against real data at any time (used to verify this
 * script without paging anyone).
 *
 * Exit: 0 = every tracked fixture reached approved (or was already
 * approved/published when watch started) · 1 = watch ended with at least one
 * fixture cancelled (deadline or otherwise) · 2 = hard failure (send
 * unconfirmed, SportMonks/API error). 3 is reserved by the tg-gates
 * convention for "regenerate" — unused by `watch` itself, since regeneration
 * here is a per-fixture in-loop action, not a whole-process outcome.
 */

import { spawn } from "node:child_process";
import * as tgh from "../halftime/lib/tg-halftime.mjs";
import * as api from "../halftime/lib/api.mjs";
import { audit } from "../halftime/lib/audit.mjs";
import { loadEnvFile, flag, has } from "../halftime/lib/env.mjs";

export const MAX_REGENS = 2;

// ── pure: rendering + decisions (unit-tested in gate.test.mjs) ──────────────

const fmtKO = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Only fixtures still awaiting a decision get buttons; already-approved or
 * cancelled fixtures are shown for context but are not actionable. */
export function gatable(fixtures) {
  return fixtures.filter((f) => f.state === "base_ready");
}

export function slateMessage(matchday, fixtures) {
  const pending = gatable(fixtures);
  const other = fixtures.filter((f) => f.state !== "base_ready");
  const lines = pending.map((f, i) => {
    const n = f.base_questions?.length ?? 0;
    return `${i + 1}. <b>${tgh.esc(f.home)} v ${tgh.esc(f.away)}</b> — ${fmtKO(f.kickoff_at)} · ${n}/11 questions`;
  });
  const otherLines = other.map(
    (f) => `• ${tgh.esc(f.home)} v ${tgh.esc(f.away)} — already ${f.state}`,
  );
  return [
    `📋 <b>GAMEDAY — Approve the ${matchday} slate</b>`,
    ``,
    pending.length
      ? `${pending.length} pack(s) ready for review. Tap Approve or Regenerate for each below.`
      : `Nothing left to gate — every fixture is already approved, published or cancelled.`,
    ``,
    lines.join("\n"),
    otherLines.length ? `\n${otherLines.join("\n")}` : ``,
    ``,
    `Unapproved packs are cancelled automatically at their own publish time (09:00 on match day) — there is no auto-release.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** One [Approve, Regenerate] row per still-pending fixture. */
export function slateRows(fixtures) {
  return gatable(fixtures).map((f) => [
    { text: `✅ Approve — ${f.home}`, data: `approve:${f.fixture_id}` },
    { text: `🔁 Regenerate — ${f.home}`, data: `regen:${f.fixture_id}` },
  ]);
}

export function reminderMessage(matchday, fixtures) {
  const pending = gatable(fixtures);
  if (!pending.length) return null;
  const lines = pending.map(
    (f) => `• <b>${tgh.esc(f.home)} v ${tgh.esc(f.away)}</b> — publishes ${fmtKO(f.publish_at)}`,
  );
  return [
    `⏰ <b>REMINDER — ${pending.length} Gameday pack(s) still unapproved for ${matchday}</b>`,
    ``,
    lines.join("\n"),
    ``,
    `Unapproved by publish time = no pack, no push. Tap a button above to decide, or reply here and I'll re-send the gate.`,
  ].join("\n");
}

/** Parse an inline-keyboard callback_data payload. Returns null if unrecognised. */
export function parseTap(data) {
  const m = /^(approve|regen):(-?\d+)$/.exec(String(data ?? ""));
  if (!m) return null;
  return { action: m[1], fixtureId: Number(m[2]) };
}

/** Regeneration is bounded at MAX_REGENS rounds per fixture (spec §3.3). */
export function regenAllowed(regenCounts, fixtureId) {
  return (regenCounts[fixtureId] ?? 0) < MAX_REGENS;
}

/** Which currently-tracked fixtures are past their publish_at and still not
 * approved/published/cancelled — the deadline-cancel sweep (AC7). */
export function dueForDeadlineCancel(fixtures, now = new Date()) {
  return fixtures.filter(
    (f) =>
      f.state !== "approved" &&
      f.state !== "published" &&
      f.state !== "cancelled" &&
      f.publish_at &&
      new Date(f.publish_at).getTime() <= now.getTime(),
  );
}

/** The whole tracked set has reached a terminal gate state — watch can stop. */
export function allResolved(fixtures) {
  return fixtures.every((f) => f.state === "approved" || f.state === "published" || f.state === "cancelled");
}

/** D-1 07:00 Europe/London for the matchday, as a Date. */
export function reminderTime(matchday) {
  const [y, m, d] = matchday.split("-").map(Number);
  const dayBefore = new Date(Date.UTC(y, m - 1, d - 1));
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(dayBefore);
  const [ry, rm, rd] = key.split("-").map(Number);
  // London-wall-clock-to-UTC via the same double-offset trick used throughout
  // this pipeline (shared.ts londonWallClockToUtc, duplicated here — gate.mjs
  // stays a standalone .mjs, not a src/lib/gameday/shared.ts consumer, so it
  // has no TS import to reuse).
  const off = (dt) => {
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/London",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(dt))
      p[type] = value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - dt.getTime();
  };
  const guess = new Date(Date.UTC(ry, rm - 1, rd, 7, 0, 0));
  return new Date(guess.getTime() - off(new Date(guess.getTime() - off(guess))));
}

// ── I/O ──────────────────────────────────────────────────────────────────────

async function fetchSchedule(matchday) {
  const back = await api.schedule(matchday);
  return back.fixtures ?? [];
}

async function sendSlate(matchday, fixtures, { dryRun, preview }) {
  const text = `${preview ? "🧪 <b>PREVIEW</b> · " : ""}${slateMessage(matchday, fixtures)}`;
  const rows = slateRows(fixtures);
  if (dryRun) {
    console.log(text);
    console.log(JSON.stringify(rows, null, 2));
    return { message_id: -1, dryRun: true };
  }
  // Fail-safe direction, same discipline as the old veto gate: an unconfirmed
  // send must not be treated as a gate that was offered. tg-halftime.mjs's
  // send() already throws if no message_id comes back.
  const msg = await tgh.send(text, { rows });
  audit(matchday, "gate.sent", { messageId: msg.message_id, fixtures: gatable(fixtures).map((f) => f.fixture_id) });
  return msg;
}

async function sendReminder(matchday, fixtures, { dryRun }) {
  const text = reminderMessage(matchday, fixtures);
  if (!text) return null;
  if (dryRun) {
    console.log(text);
    return { dryRun: true };
  }
  const msg = await tgh.send(text);
  audit(matchday, "gate.reminder", { messageId: msg.message_id, fixtures: gatable(fixtures).map((f) => f.fixture_id) });
  return msg;
}

/** Regenerate one fixture's base slate — spawns gen-base.mjs as a child
 * process (poller.mjs invokes W2/W3 scripts the same way: as CLI children,
 * never as imports, so a crashed generation run can't take the gate down). */
function regenerate(fixtureId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--env-file=.env.local", new URL("./gen-base.mjs", import.meta.url).pathname, "--fixture", String(fixtureId)],
      { stdio: "inherit" },
    );
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`gen-base.mjs --fixture ${fixtureId} exited ${code}`))));
    child.on("error", reject);
  });
}

async function handleTap(matchday, tap, regenCounts, { dryRun }) {
  const parsed = parseTap(tap.data);
  if (!parsed) return;
  const { action, fixtureId } = parsed;

  const fixtures = await fetchSchedule(matchday);
  const row = fixtures.find((f) => Number(f.fixture_id) === fixtureId);
  if (!row) {
    if (!dryRun) await tgh.ack(tap.id, "Unknown fixture");
    return;
  }

  if (row.state !== "base_ready") {
    if (!dryRun) await tgh.ack(tap.id, `Already ${row.state}`);
    return;
  }

  if (action === "approve") {
    if (!dryRun) {
      await tgh.ack(tap.id, "Approving…");
      await api.putApprove(fixtureId, row.base_questions);
      audit(matchday, "gate.approve", { fixtureId, actor: tap.from ?? "founder" });
      await tgh.send(`✅ Approved: <b>${tgh.esc(row.home)} v ${tgh.esc(row.away)}</b>`);
    } else {
      console.log(`[dry-run] would approve fixture ${fixtureId}`);
    }
    return;
  }

  if (action === "regen") {
    if (!regenAllowed(regenCounts, fixtureId)) {
      if (!dryRun) await tgh.ack(tap.id, "No more regenerations for this fixture");
      return;
    }
    regenCounts[fixtureId] = (regenCounts[fixtureId] ?? 0) + 1;
    if (dryRun) {
      console.log(`[dry-run] would regenerate fixture ${fixtureId} (round ${regenCounts[fixtureId]}/${MAX_REGENS})`);
      return;
    }
    await tgh.ack(tap.id, `Regenerating (round ${regenCounts[fixtureId]}/${MAX_REGENS})…`);
    audit(matchday, "gate.regenerate", { fixtureId, round: regenCounts[fixtureId] });
    try {
      await regenerate(fixtureId);
      const fresh = (await fetchSchedule(matchday)).find((f) => Number(f.fixture_id) === fixtureId);
      const text = `🔁 Regenerated — <b>${tgh.esc(row.home)} v ${tgh.esc(row.away)}</b> (round ${regenCounts[fixtureId]}/${MAX_REGENS})`;
      await tgh.send(text, { rows: fresh ? slateRows([fresh]) : [] });
    } catch (err) {
      await tgh.send(`✗ Regeneration failed for <b>${tgh.esc(row.home)} v ${tgh.esc(row.away)}</b>: ${tgh.esc(err.message)}`);
    }
    return;
  }
}

async function sweepDeadlines(matchday, { dryRun }) {
  const fixtures = await fetchSchedule(matchday);
  const due = dueForDeadlineCancel(fixtures);
  for (const f of due) {
    if (dryRun) {
      console.log(`[dry-run] would cancel fixture ${f.fixture_id} (unapproved past publish_at)`);
      continue;
    }
    const res = await api.putCancel(f.fixture_id, "unapproved by publish_at");
    audit(matchday, "gate.cancelled_deadline", { fixtureId: f.fixture_id, result: res });
    await tgh.send(`⛔ <b>${tgh.esc(f.home)} v ${tgh.esc(f.away)}</b> was never approved — cancelled, no pack, no push.`);
  }
  return due;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function cmdSend(argv) {
  const matchday = flag(argv, "--date");
  if (!matchday) throw new Error("--date YYYY-MM-DD required");
  const dryRun = has(argv, "--dry-run");
  const preview = has(argv, "--preview");
  const fixtures = await fetchSchedule(matchday);
  const pending = gatable(fixtures);
  if (!pending.length) {
    console.error(`· nothing to gate for ${matchday} — no fixture is base_ready (either not generated yet, or already approved/published/cancelled)`);
    process.exit(0);
  }
  const msg = await sendSlate(matchday, fixtures, { dryRun, preview });
  console.error(`✓ slate sent for ${matchday}: ${pending.length} fixture(s)${msg.dryRun ? " (dry-run)" : ""}`);
  process.exit(0);
}

async function cmdReminder(argv) {
  const matchday = flag(argv, "--date");
  if (!matchday) throw new Error("--date YYYY-MM-DD required");
  const dryRun = has(argv, "--dry-run");
  const fixtures = await fetchSchedule(matchday);
  const msg = await sendReminder(matchday, fixtures, { dryRun });
  console.error(msg ? `✓ reminder sent for ${matchday}` : `· nothing to remind for ${matchday} — all gated`);
  process.exit(0);
}

async function cmdWatch(argv) {
  const matchday = flag(argv, "--date");
  if (!matchday) throw new Error("--date YYYY-MM-DD required");
  const dryRun = has(argv, "--dry-run");
  const maxMinutes = Number(flag(argv, "--minutes") ?? 20 * 60); // ~20h safety bound

  let fixtures = await fetchSchedule(matchday);
  if (allResolved(fixtures)) {
    console.error(`· nothing to gate for ${matchday} — every fixture already resolved`);
    process.exit(0);
  }

  await sendSlate(matchday, fixtures, { dryRun, preview: false });

  const regenCounts = {};
  const remindAt = reminderTime(matchday);
  let reminded = false;
  const offset = dryRun ? 0 : await tgh.initOffset();
  const deadline = Date.now() + maxMinutes * 60_000;
  let cursor = offset;

  while (Date.now() < deadline) {
    fixtures = await fetchSchedule(matchday);
    if (allResolved(fixtures)) break;

    if (!reminded && Date.now() >= remindAt.getTime()) {
      await sendReminder(matchday, fixtures, { dryRun });
      reminded = true;
    }

    await sweepDeadlines(matchday, { dryRun });

    if (dryRun) {
      // No live Telegram in dry-run — the loop is deterministic and would spin
      // forever waiting on taps that will never come, so a dry-run exits after
      // proving the send + one reminder + one sweep pass, rather than polling.
      console.log("[dry-run] would now long-poll for Approve/Regenerate taps");
      break;
    }

    const { offset: next, taps } = await tgh.poll(cursor, 20);
    cursor = next;
    for (const tap of taps) {
      await handleTap(matchday, tap, regenCounts, { dryRun });
    }
  }

  const final = await fetchSchedule(matchday);
  const cancelled = final.filter((f) => f.state === "cancelled");
  const approved = final.filter((f) => f.state === "approved" || f.state === "published");
  console.error(`· ${matchday}: ${approved.length} approved, ${cancelled.length} cancelled, ${final.length} tracked`);
  process.exit(cancelled.length ? 1 : 0);
}

async function main() {
  loadEnvFile();
  const [cmd, ...argv] = process.argv.slice(2);
  try {
    if (cmd === "send") await cmdSend(argv);
    else if (cmd === "reminder") await cmdReminder(argv);
    else if (cmd === "watch") await cmdWatch(argv);
    else {
      console.error("usage: gate.mjs send|reminder|watch --date YYYY-MM-DD [--dry-run] [--preview] [--minutes N]");
      process.exit(2);
    }
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
