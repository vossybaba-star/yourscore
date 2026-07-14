#!/usr/bin/env node
/**
 * veto.mjs — the Telegram gate on the fresh slice.
 *
 * ── This is a NEGATIVE-CONSENT gate, and that is deliberate ──────────────────
 * Everywhere else in YourScore, nothing ships until the founder taps Approve.
 * Here he chose the opposite: the fresh questions are sent as a batch, he can
 * VETO, and if he says nothing they go live anyway. He made that call knowing
 * exactly what it means, because the alternative is a feature that only works on
 * the Saturdays he happens to be holding his phone at 14:05.
 *
 * So this file implements "no response = ship" faithfully. It does not hedge it,
 * it does not add a blocking wait, and it does not quietly require a tap. What it
 * DOES do is make the silence auditable: every auto-release is written to the
 * decision log with `actor: "TIMEOUT"` and the deadline it passed, so that if
 * anyone ever asks "who approved this question?", the honest answer — "nobody;
 * the window closed at 14:50 and it shipped under the standing policy" — is on
 * the record rather than reconstructed.
 *
 * The human veto is the SECOND layer, never the only one. Before a question ever
 * reaches Telegram it has already survived the hard structured-data validator
 * (validate.mjs): every player resolved against the confirmed XI, every number
 * recomputed from SportMonks, every first-half reference and every unanchored
 * running total dropped. The founder is vetoing on taste. The machine has already
 * vetoed on truth.
 *
 * Fail-safe direction: if the batch cannot be CONFIRMED sent (Telegram down, no
 * message id back), the slice is DROPPED, not auto-released. A gate that was
 * never offered is treated as a veto, not as consent.
 *
 * Modes:
 *   send  --fixture <id>          arm the gate for one fixture
 *   watch --date <YYYY-MM-DD>     the daemon: one consumer of the update stream,
 *                                 servicing every open gate on the matchday,
 *                                 auto-releasing at each deadline
 *   slate --date <YYYY-MM-DD>     the DAY-BEFORE base gate — normal approve-to-ship
 *   --preview                     print/send the message, arm nothing
 *
 * Exit codes follow tg-gates.mjs conventions: 0 = go, 1 = stopped, 3 = regenerate.
 *
 * Config:
 *   HALFTIME_VETO_WINDOW_MIN   minutes from send to deadline (default 15)
 *   HALFTIME_VETO_FLOOR_MIN    hard cap: never later than KO minus this (default 5)
 *   HALFTIME_VETO_TARGET_MIN   preferred deadline: KO minus this (default 10)
 */

import * as api from "./lib/api.mjs";
import * as tg from "./lib/tg-halftime.mjs";
import { audit } from "./lib/audit.mjs";
import { loadEnvFile, flag, has } from "./lib/env.mjs";

const WINDOW_MIN = Number(process.env.HALFTIME_VETO_WINDOW_MIN ?? 15);
const TARGET_MIN = Number(process.env.HALFTIME_VETO_TARGET_MIN ?? 10);
const FLOOR_MIN = Number(process.env.HALFTIME_VETO_FLOOR_MIN ?? 5);
const MIN = 60_000;

const londonTime = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const londonDay = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/**
 * The deadline. Give the founder a real window (WINDOW_MIN from the moment the
 * message lands), aim to close it by T-10 so assembly has room, and NEVER let it
 * run past T-5 — a gate still open at kick-off is a pack that misses its own
 * whistle. Late team sheets shrink the window; the floor is what stops them
 * shrinking it to nothing.
 */
export function computeDeadline(now, kickoffAt) {
  const ko = new Date(kickoffAt).getTime();
  const soft = now + WINDOW_MIN * MIN;
  const target = ko - TARGET_MIN * MIN;
  const floor = ko - FLOOR_MIN * MIN;
  return new Date(Math.min(Math.max(soft, target), floor)).toISOString();
}

// ── Message rendering ────────────────────────────────────────────────────────

export function vetoText(row, deadline, { preview = false } = {}) {
  const qs = row.fresh_questions ?? [];
  const body = qs
    .map((q, i) => {
      const correct = q.options?.[q.answer] ?? "?";
      return [
        `<b>${i + 1}.</b> ${tg.esc(q.question)}`,
        `   ✅ <b>${tg.esc(correct)}</b>`,
        q.fact ? `   📎 <i>${tg.esc(String(q.fact).slice(0, 220))}</i>` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    `${preview ? "🧪 <b>PREVIEW</b> · " : ""}⚽ <b>FRESH SLICE — ${tg.esc(row.home)} v ${tg.esc(row.away)}</b>`,
    `Kick-off ${londonTime(row.kickoff_at)} · written from the confirmed team sheets`,
    ``,
    body || "(no questions)",
    ``,
    `<b>These go live in the halftime quiz pack automatically at ${londonTime(deadline)}</b> unless you veto.`,
    `You do not need to reply. Tap only if something is wrong.`,
  ].join("\n");
}

function vetoKeyboard(row) {
  const n = (row.fresh_questions ?? []).length;
  const rows = [];
  if (n) {
    rows.push(
      Array.from({ length: n }, (_, i) => ({
        text: `Veto ${i + 1}`,
        data: `v:${row.fixture_id}:${i}`,
      })),
    );
    rows.push([{ text: "Veto all", data: `va:${row.fixture_id}` }]);
  }
  rows.push([{ text: "🛑 KILL TODAY'S FRESH", data: `kill:${londonDay(row.kickoff_at)}` }]);
  return rows;
}

// ── send ─────────────────────────────────────────────────────────────────────

async function modeSend(fixtureId, { preview }) {
  const today = londonDay(new Date().toISOString());
  const sched = await api.schedule(today);
  let row = (sched.fixtures ?? []).find((f) => Number(f.fixture_id) === Number(fixtureId));

  // A gate can legitimately be armed for a fixture on another matchday (replay).
  if (!row) {
    console.error(`✗ fixture ${fixtureId} not on today's schedule`);
    process.exit(2);
  }
  const matchday = londonDay(row.kickoff_at);

  if (sched.freshKill) {
    console.error("· kill switch is on for this matchday — no gate sent, base-only");
    process.exit(0);
  }
  if (!(row.fresh_questions ?? []).length) {
    console.error("· no fresh questions to gate — base-only pack, nothing to send");
    process.exit(0);
  }

  const deadline = computeDeadline(Date.now(), row.kickoff_at);
  const text = vetoText(row, deadline, { preview });

  if (preview) {
    await tg.send(text, { rows: vetoKeyboard(row) });
    console.error("· preview sent (gate NOT armed)");
    process.exit(0);
  }

  let msg;
  try {
    msg = await tg.send(text, { rows: vetoKeyboard(row) });
  } catch (err) {
    // FAIL-SAFE: a gate that could not be offered is a gate that was refused.
    // Dropping the slice costs us three questions. Auto-releasing an unoffered
    // slice would mean the founder's veto right silently evaporated because
    // Telegram had a bad minute.
    console.error(`✗ could not confirm the veto message was sent: ${err.message}`);
    console.error("  → dropping the fresh slice (an ungated slice never ships). Base-only pack.");
    audit(matchday, "gate.send_failed", { fixtureId, error: err.message, action: "fresh slice dropped" });
    await api.putFresh(fixtureId, [], "vetoed");
    process.exit(2);
  }

  await api.putFresh(fixtureId, row.fresh_questions, "pending_veto", {
    vetoDeadlineAt: deadline,
    telegramMessageId: msg.message_id,
  });

  audit(matchday, "gate.sent", {
    fixtureId,
    fixture: `${row.home} v ${row.away}`,
    questions: (row.fresh_questions ?? []).length,
    deadline,
    telegram_message_id: msg.message_id,
    policy: "negative consent — no response means these ship",
  });

  console.error(
    `✓ gate armed for ${row.home} v ${row.away}: ${(row.fresh_questions ?? []).length} question(s), ` +
      `auto-release at ${londonTime(deadline)}`,
  );
  if (!tg.usingDedicatedBot) {
    console.error(
      "  ! TELEGRAM_HALFTIME_BOT_TOKEN is unset — sharing the launch bot's update stream. " +
        "getUpdates is single-consumer per bot; two pollers WILL eat each other's taps.",
    );
  }
  process.exit(0);
}

// ── watch (the daemon) ───────────────────────────────────────────────────────

/**
 * ONE consumer of the Telegram update stream, servicing every open gate on the
 * matchday. This has to be one process, not one per fixture: getUpdates is
 * single-consumer per bot, so five parallel watchers on a 15:00 slate would steal
 * each other's taps and the founder's veto would land wherever it landed.
 *
 * Every tap is persisted to the DB the instant it arrives (POST /api/halftime/
 * fresh op=veto) — never held in memory. A watcher that dies and restarts re-reads
 * the veto state from the row, and a veto tapped before the crash is still a veto.
 */
async function modeWatch(matchday) {
  const deadlines = new Map(); // fixture_id -> ISO
  let offset = await tg.initOffset();
  console.error(`· watching ${matchday} (bot=${tg.usingDedicatedBot ? "halftime" : "launch (shared!)"})`);

  for (;;) {
    const sched = await api.schedule(matchday);
    const open = (sched.fixtures ?? []).filter(
      (f) => f.fresh_state === "pending_veto" && f.veto_deadline_at,
    );

    for (const f of open) deadlines.set(Number(f.fixture_id), f.veto_deadline_at);

    // 1. AUTO-RELEASE. The deadline passed and nobody said no.
    for (const f of open) {
      if (Date.now() < new Date(f.veto_deadline_at).getTime()) continue;

      const qs = f.fresh_questions ?? [];
      const pending = qs.map((q, i) => [q, i]).filter(([q]) => q.status === "pending");
      for (const [, i] of pending) await api.putVeto(f.fixture_id, i, "approved");

      const vetoed = qs.filter((q) => q.status === "vetoed").length;
      const shipped = qs.length - vetoed;
      await api.putFresh(
        f.fixture_id,
        (await refresh(matchday, f.fixture_id)) ?? qs,
        shipped ? "approved" : "vetoed",
      );

      audit(matchday, "gate.auto_release", {
        fixtureId: f.fixture_id,
        fixture: `${f.home} v ${f.away}`,
        actor: "TIMEOUT",
        deadline: f.veto_deadline_at,
        auto_released: pending.length,
        vetoed_by_founder: vetoed,
        shipping: shipped,
        note: "no founder response within the window — released under the standing negative-consent policy",
      });

      await tg.stripButtons(tg.chatId(), f.telegram_message_id).catch(() => {});
      await tg
        .send(
          `⏱ <b>${tg.esc(f.home)} v ${tg.esc(f.away)}</b> — window closed at ${londonTime(f.veto_deadline_at)}.\n` +
            `${shipped} fresh question${shipped === 1 ? "" : "s"} auto-released` +
            (vetoed ? ` · ${vetoed} vetoed by you` : " · no vetoes") +
            `.`,
        )
        .catch(() => {});

      console.error(`· AUTO-RELEASE ${f.home} v ${f.away}: ${shipped} shipped, ${vetoed} vetoed`);
      deadlines.delete(Number(f.fixture_id));
    }

    // Nothing left to wait for.
    const stillOpen = (await api.schedule(matchday)).fixtures.filter(
      (f) => f.fresh_state === "pending_veto",
    );
    if (!stillOpen.length && !open.length) {
      console.error("· no open gates — watcher exiting");
      return 0;
    }

    // 2. Service taps and typed commands.
    const { offset: next, taps, texts } = await tg.poll(offset, 15);
    offset = next;

    for (const tap of taps) {
      const [kind, a, b] = tap.data.split(":");

      if (kind === "kill") {
        await doKill(a || matchday, tap);
        continue;
      }
      if (kind === "v" || kind === "va") {
        const fixtureId = Number(a);
        const all = kind === "va";
        const index = all ? 0 : Number(b);
        const res = await api.putVeto(fixtureId, index, "vetoed", all);
        await tg.ack(tap.id, res.tooLate ? "Too late — already released" : all ? "Vetoed all" : `Vetoed ${index + 1}`);

        if (res.tooLate) {
          await tg.send("⏱ Too late — that pack is already live. The question stays in.").catch(() => {});
          audit(matchday, "gate.veto_too_late", { fixtureId, index, actor: "founder", from: tap.from });
        } else {
          audit(matchday, "gate.veto", {
            fixtureId,
            index: all ? "all" : index,
            actor: "founder",
            from: tap.from,
            after_staging: Boolean(res.afterStaging),
          });
          console.error(`· VETO ${fixtureId} q${all ? "*" : index + 1} (${tap.from ?? "founder"})`);
        }
      }
    }

    for (const t of texts) {
      const cmd = t.text.toUpperCase();
      if (cmd === "KILL" || cmd === "KILL FRESH") await doKill(matchday, null);
      else if (cmd === "UNKILL") {
        await api.unkill(matchday);
        audit(matchday, "gate.unkill", { actor: "founder", from: t.from });
        await tg.send(`✅ Fresh slices re-enabled for ${matchday} (fixtures already assembled stay base-only).`);
      }
    }
  }
}

/** Re-read one fixture's fresh questions from the DB (never trust memory). */
async function refresh(matchday, fixtureId) {
  const sched = await api.schedule(matchday);
  return (sched.fixtures ?? []).find((f) => Number(f.fixture_id) === Number(fixtureId))
    ?.fresh_questions;
}

/**
 * THE KILL SWITCH. One message, one tap, the whole matchday goes base-only —
 * including packs already assembled with fresh questions in them, which get
 * re-assembled base-only. This is the overload valve: if the founder does not
 * like what he is seeing on a Saturday, he does not have to veto nine messages.
 */
async function doKill(matchday, tap) {
  const res = await api.kill(matchday);
  if (tap) await tg.ack(tap.id, "Killed today's fresh slices");
  const list = (res.affected ?? []).map((f) => `· ${f.home} v ${f.away} (${f.state})`).join("\n");
  audit(matchday, "gate.kill", {
    actor: "founder",
    from: tap?.from,
    affected: (res.affected ?? []).map((f) => f.fixture_id),
  });
  await tg
    .send(
      `🛑 <b>Fresh slices KILLED for ${matchday}.</b>\n` +
        `Every pack today ships base-only (ten day-before questions, already approved by you).\n` +
        (list ? `\nAffected:\n${tg.esc(list)}` : "\nNo fixtures still pending.") +
        `\n\nAlready-released packs are untouched. Send <b>UNKILL</b> to re-enable for fixtures not yet assembled.`,
    )
    .catch(() => {});
  console.error(`· KILL ${matchday}: ${(res.affected ?? []).length} fixture(s) → base-only`);
}

// ── slate (the day-before base gate — normal approve-to-ship) ─────────────────

async function modeSlate(matchday, { preview }) {
  const sched = await api.schedule(matchday);
  const rows = sched.fixtures ?? [];
  if (!rows.length) {
    console.error(`· no fixtures on ${matchday}`);
    process.exit(0);
  }

  const summary = rows
    .map((f) => {
      const n = (f.base_questions ?? []).length;
      const icon = n === 10 ? "✅" : n ? "⚠️" : "❌";
      return `${icon} <b>${tg.esc(f.home)} v ${tg.esc(f.away)}</b> ${londonTime(f.kickoff_at)} — ${n}/10`;
    })
    .join("\n");

  const text = [
    `${preview ? "🧪 <b>PREVIEW</b> · " : ""}📋 <b>HALFTIME BASE SLATE — ${matchday}</b>`,
    ``,
    summary,
    ``,
    `These are the day-before questions: pure history, nothing that can go stale.`,
    `They are the pack every fixture falls back to if the fresh slice does not land.`,
    `Anything short of 10/10 has no pack unless you say otherwise.`,
  ].join("\n");

  const kb = [
    [
      { text: "Approve slate", data: `slate:ok:${matchday}` },
      { text: "Regenerate", data: `slate:regen:${matchday}` },
    ],
  ];

  if (preview) {
    await tg.send(text, { rows: kb });
    console.error("· preview sent");
    process.exit(0);
  }

  const msg = await tg.send(text, { rows: kb });
  audit(matchday, "slate.sent", { fixtures: rows.length, telegram_message_id: msg.message_id });

  let offset = await tg.initOffset();
  const deadline = Date.now() + 6 * 3600 * 1000;
  while (Date.now() < deadline) {
    const { offset: next, taps } = await tg.poll(offset, 30);
    offset = next;
    for (const tap of taps) {
      if (!tap.data.startsWith("slate:")) continue;
      const [, verb] = tap.data.split(":");
      await tg.ack(tap.id, verb === "ok" ? "Approved" : "Regenerating");
      await tg.stripButtons(tap.chatId, tap.messageId);
      audit(matchday, `slate.${verb}`, { actor: "founder", from: tap.from });
      process.exit(verb === "ok" ? 0 : 3);
    }
  }
  audit(matchday, "slate.timeout", { note: "no response — slate NOT approved (approve-to-ship)" });
  console.error("✗ slate gate timed out with no response — NOT approved");
  process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Guarded, so computeDeadline() can be imported by the unit tests without the
// daemon starting itself.

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const preview = has(argv, "--preview");

  try {
    if (mode === "send") {
      const id = Number(flag(argv, "--fixture"));
      if (!id) throw new Error("send needs --fixture <id>");
      await modeSend(id, { preview });
    } else if (mode === "watch") {
      const day = flag(argv, "--date") || londonDay(new Date().toISOString());
      process.exit(await modeWatch(day));
    } else if (mode === "slate") {
      const day = flag(argv, "--date");
      if (!day) throw new Error("slate needs --date YYYY-MM-DD");
      await modeSlate(day, { preview });
    } else {
      console.error("usage: veto.mjs send --fixture <id> | watch --date <d> | slate --date <d> [--preview]");
      process.exit(2);
    }
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
}
