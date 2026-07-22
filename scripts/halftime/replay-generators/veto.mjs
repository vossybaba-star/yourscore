#!/usr/bin/env node
/**
 * REPLAY STUB — stands in for the Telegram veto gate.
 *
 * The real one messages the founder and long-polls for his taps. A test must
 * not do that: it would put eleven messages on his phone every time the suite
 * runs, and the result would depend on whether he happened to be looking.
 *
 * So this stub does the one thing the POLLER's behaviour actually turns on:
 * whether the gate was successfully OFFERED. It reports success (exit 0) or,
 * with HALFTIME_REPLAY_VETO_FAIL=1, failure (exit 3) — and the poller's rule is
 * that a gate which could not be offered counts as a veto, so the fresh slice is
 * dropped rather than auto-released. That rule is the reason this stub can fail
 * on purpose.
 *
 * The founder's actual taps are driven separately, by the harness, straight at
 * POST /api/halftime/fresh op=veto — the same route the real watcher writes to.
 *
 * Contract (spec §5): `veto.mjs send --fixture <id>` · exit 0 ok, non-zero = not sent.
 * Reached only via HALFTIME_GEN_DIR, which production never sets.
 */

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

if (mode !== "send") {
  console.log(`stub veto: mode "${mode}" is a no-op in replay`);
  process.exit(0);
}

const fixtureId = Number(opt("--fixture"));
if (!Number.isInteger(fixtureId)) {
  console.error("usage: veto.mjs send --fixture <id>");
  process.exit(1);
}

// Telegram is down / the message id never came back.
if (process.env.HALFTIME_REPLAY_VETO_FAIL === "1") {
  console.error("stub veto: could not confirm the message was sent");
  process.exit(3);
}

const API = (process.env.HALFTIME_API_BASE || "").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;

// Read the slice back and re-persist it with a message id, which is what "the
// gate is armed" means in the database.
const sched = await fetch(`${API}/api/halftime/schedule`, {
  headers: { authorization: `Bearer ${SECRET}` },
});
const row = (await sched.json()).fixtures.find((f) => Number(f.fixture_id) === fixtureId);
if (!row || !(row.fresh_questions ?? []).length) {
  console.log("stub veto: nothing to gate");
  process.exit(0);
}

const res = await fetch(`${API}/api/halftime/fresh`, {
  method: "POST",
  headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
  body: JSON.stringify({
    op: "fresh",
    fixtureId,
    questions: row.fresh_questions,
    state: "pending_veto",
    telegramMessageId: 900000 + (fixtureId % 100000),
  }),
});

if (!res.ok) {
  console.error(`stub veto: persist failed ${res.status}`);
  process.exit(3);
}

console.log(`stub veto: gate armed for ${fixtureId} (${row.fresh_questions.length} question(s))`);
process.exit(0);
