/**
 * gameday.mjs — is the Gameday Quiz pipeline actually doing its job?
 *
 * Replaces checks/halftime.mjs's QUIZ-STATE role (that file was deliberately
 * UNREGISTERED in W1/W2 — see check.mjs's LAYERS comment — because it asserts
 * the RETIRED staged/released quiz state machine, which nothing writes any
 * more post-pivot: a healthy pack today is 'published', not 'released', and
 * the old checks would misreport every matchday rather than help). This file
 * asserts the NEW machine: scheduled -> base_ready -> approved -> published,
 * gated on publish_at (the day before kickoff), not on kickoff itself.
 *
 * "Liveness ≠ correctness" (LOOP-STANDARD): every assertion below reads the
 * CONTENT of halftime_releases and compares it to the clock — never a file
 * mtime, never "did a process run". A cron that ran and did nothing wrong is
 * indistinguishable from a cron that silently stopped firing unless you check
 * what the rows actually say.
 *
 * What it asserts, in order:
 *   1. Off-days (no fixture kicks off tomorrow and none published today):
 *      the publish cron reports {idle:true} — zero SportMonks/DB writes for
 *      nothing to do, and this is the signal that the route itself is still
 *      reachable and authenticating correctly even when there's no football.
 *   2. By 10:00 Europe/London on the day before kickoff, every one of
 *      tomorrow's fixtures (kind='fixture') is approved or published (or a
 *      legitimate terminal cancelled/failed) — never still scheduled/
 *      base_ready with nobody having noticed.
 *   3. No fixture OR recap row is sitting in base_ready past its own
 *      publish_at (the gate deadline) — gate.mjs's deadline sweep (AC7)
 *      should have cancelled it by now. A stuck base_ready row here means
 *      the gate process died mid-window.
 *   4. Every published pack really is playable — the quiz_packs row exists,
 *      status='published', question_count=10. A 'published' halftime_releases
 *      row with no matching pack is the worst failure this feature has: the
 *      app says the quiz is live and the link 404s.
 *   5. The Halftime Prediction poll's whistle detection (unrelated to the
 *      quiz pivot, but the brief that replaces checks/halftime.mjs's role
 *      also owns this assertion now): the poller heartbeat is fresh, but
 *      ONLY inside the window where it should be beating. This is the one
 *      check ported forward from the old file — its own header confirmed it
 *      is still accurate after the pivot, since the poller still runs for
 *      whistle detection, just no longer releases quiz packs.
 *
 * Registration: added to the LAYERS array in scripts/health/check.mjs —
 *   { key: "gameday", module: "./checks/gameday.mjs", budgetMs: 30_000 },
 */

import { supa, todayUK, hourUK } from "../lib/db.mjs";
import { BASE } from "../lib/http.mjs";

const MIN = 60_000;
const WINDOW_LEAD = 80 * MIN; // poller expected up from 80 min before first KO…
const WINDOW_TAIL = 165 * MIN; // …until a couple of hours after the last one.
const HEARTBEAT_STALE = 10 * MIN;
const GATE_HOUR_UK = 10; // AC1/§7: approved/published by 10:00 the day before

/** Europe/London calendar date, `daysAhead` days from today. */
function londonDate(daysAhead = 0) {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

async function fixturesForDay(day) {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 26 * 60 * MIN); // generous; London ≠ UTC
  const { data, error } = await supa
    .from("halftime_releases")
    .select("fixture_id, kind, home, away, kickoff_at, state, publish_at, pack_id")
    .eq("kind", "fixture")
    .gte("kickoff_at", new Date(start.getTime() - 2 * 60 * MIN).toISOString())
    .lt("kickoff_at", end.toISOString())
    .order("kickoff_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function run(report, ctx) {
  const today = todayUK();
  const tomorrow = londonDate(1);
  const hour = hourUK();

  // ── slate readability (mirrors halftime.mjs's own not-applied-yet guard) ──
  let todayRows, tomorrowRows;
  try {
    [todayRows, tomorrowRows] = await Promise.all([fixturesForDay(today), fixturesForDay(tomorrow)]);
  } catch (e) {
    const notBuilt = /does not exist|schema cache/i.test(e.message);
    report.add("gameday", "slate readable", notBuilt, {
      warn: notBuilt,
      detail: notBuilt ? "halftime_releases gameday columns not in prod yet (migration 110 unapplied)" : e.message,
      hint: "apply supabase/migrations/110_gameday.sql",
    });
    return;
  }

  const publishedToday = todayRows.filter((r) => r.state === "published");

  // ── 1. off-days: the publish cron must report idle, zero cost ─────────────
  const isOffDay = tomorrowRows.length === 0 && publishedToday.length === 0;
  if (isOffDay) {
    if (!process.env.CRON_SECRET) {
      report.add("gameday", "publish cron idle on an off-day", true, {
        warn: true, detail: "CRON_SECRET not set locally — skipped, not a prod signal",
      });
    } else {
      try {
        const res = await fetch(`${BASE}/api/cron/gameday-publish`, {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        });
        const body = await res.json().catch(() => null);
        report.add("gameday", "publish cron idle on an off-day", body?.idle === true, {
          detail: body?.idle === true ? "idle:true, zero SportMonks calls" : JSON.stringify(body ?? { status: res.status }),
          hint: "check /api/cron/gameday-publish — it should short-circuit to {idle:true} when nothing is due",
        });
      } catch (e) {
        report.add("gameday", "publish cron idle on an off-day", false, { detail: e.message });
      }
    }
  } else {
    report.add("gameday", "matchday activity today/tomorrow", true, {
      detail: `${tomorrowRows.length} fixture(s) tomorrow, ${publishedToday.length} published today`,
    });
  }

  // ── 2. tomorrow's fixtures must be gated by 10:00 today ────────────────────
  const RESOLVED = new Set(["approved", "published", "cancelled", "failed"]);
  if (tomorrowRows.length && hour >= GATE_HOUR_UK) {
    const ungated = tomorrowRows.filter((r) => !RESOLVED.has(r.state));
    report.add("gameday", "tomorrow's slate gated by 10:00", ungated.length === 0, {
      detail: ungated.length
        ? ungated.map((r) => `${r.home} v ${r.away}: still '${r.state}'`).join(" · ")
        : `${tomorrowRows.length} fixture(s), all approved/published/cancelled/failed`,
      hint: "check gate.mjs on the VPS — is it running, and did the base slate reach the founder on Telegram?",
    });
  } else if (tomorrowRows.length) {
    report.add("gameday", "tomorrow's slate gated by 10:00", true, {
      detail: `before ${GATE_HOUR_UK}:00 UK — not due yet`,
    });
  }

  // ── 3. nothing stuck in base_ready past its own gate deadline ─────────────
  // Season-wide, not day-scoped: a stuck row's publish_at could be for a
  // fixture well outside today/tomorrow's window if gate.mjs died days ago.
  const { data: stuckRows, error: stuckErr } = await supa
    .from("halftime_releases")
    .select("fixture_id, kind, home, away, publish_at, state")
    .eq("state", "base_ready")
    .not("publish_at", "is", null)
    .lt("publish_at", new Date().toISOString())
    .limit(20);
  if (stuckErr) {
    report.add("gameday", "no packs stuck past their gate deadline", false, { detail: stuckErr.message });
  } else {
    const stuck = stuckRows ?? [];
    report.add("gameday", "no packs stuck past their gate deadline", stuck.length === 0, {
      detail: stuck.length
        ? stuck.map((r) => `${r.kind === "recap" ? `recap ${r.fixture_id}` : `${r.home} v ${r.away}`}: base_ready since publish_at ${r.publish_at}`).join(" · ")
        : "none",
      hint: "gate.mjs's deadline sweep should have cancelled these — check the gate process is alive on the VPS",
    });
  }

  // ── 4. every published pack really is playable ─────────────────────────────
  const publishedWithPack = publishedToday.filter((r) => r.pack_id);
  if (publishedWithPack.length) {
    const ids = publishedWithPack.map((r) => r.pack_id);
    const { data: packs } = await supa
      .from("quiz_packs")
      .select("id, status, question_count")
      .in("id", ids);
    const byId = new Map((packs ?? []).map((p) => [p.id, p]));
    const broken = publishedWithPack
      .filter((r) => {
        const p = byId.get(r.pack_id);
        return !p || p.status !== "published" || p.question_count !== 10;
      })
      .map((r) => `${r.home} v ${r.away}`);
    report.add("gameday", "published packs are playable", broken.length === 0, {
      detail: broken.length
        ? `${broken.join(", ")} — the app says the quiz is live and the link is broken`
        : `${publishedWithPack.length} pack(s) live, 10 questions each`,
      hint: "re-run GET /api/cron/gameday-publish — it is idempotent and repairs a missing/short pack row",
    });
  }
  const publishedNoPack = publishedToday.filter((r) => !r.pack_id);
  if (publishedNoPack.length) {
    report.add("gameday", "published rows have a pack_id", false, {
      detail: publishedNoPack.map((r) => `${r.home} v ${r.away}`).join(", "),
      hint: "a 'published' row with no pack_id violates the halftime_published_needs_pack constraint — should be impossible",
    });
  }

  // ── 5. the Halftime Prediction poll's whistle detection (ported forward) ──
  // Unrelated to the quiz pivot — the poller still runs for prediction
  // settlement — but checks/halftime.mjs owned this assertion and is now
  // unregistered, so it lives here instead of being silently dropped.
  const kickoffs = [...todayRows, ...tomorrowRows].map((r) => new Date(r.kickoff_at).getTime());
  const inWindow = kickoffs.length > 0 && (() => {
    const now = Date.now();
    const first = Math.min(...kickoffs);
    const last = Math.max(...kickoffs);
    return now >= first - WINDOW_LEAD && now <= last + WINDOW_TAIL;
  })();
  if (!inWindow) {
    report.add("gameday", "prediction poller heartbeat", true, { detail: "outside any match window — silence is correct" });
  } else {
    try {
      const res = await fetch(`${BASE}/api/halftime/heartbeat`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      });
      const hb = await res.json();
      const age = hb?.ageSeconds;
      const alive = hb?.beating === true && age != null && age * 1000 < HEARTBEAT_STALE;
      report.add("gameday", "prediction poller heartbeat", alive, {
        detail: alive ? `beating, ${age}s ago` : `stale or absent (${age ?? "never"}s) DURING a match window`,
        hint: "ssh the VPS: is poller.mjs running? It now serves the Halftime Prediction poll only.",
      });
    } catch (e) {
      report.add("gameday", "prediction poller heartbeat", false, { detail: e.message });
    }
  }

  ctx.gameday = { today: todayRows.length, tomorrow: tomorrowRows.length, publishedToday: publishedToday.length };
}
