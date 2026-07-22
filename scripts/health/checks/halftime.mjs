/**
 * halftime.mjs — is the halftime pipeline actually doing its job?
 *
 * The trap this avoids: liveness is not correctness. "The poller process is
 * running" and "the packs are going live at the whistle" are different claims,
 * and only the second one matters. So every check below asserts the CONTENT of
 * the state machine against the time of day — never that a file got touched.
 *
 * What it asserts, in order:
 *   1. Off-matchday, the whole thing costs nothing and stays quiet.
 *   2. On a matchday, every fixture is in a state that makes sense for the
 *      hour: base slate approved by T-2h, frozen by kickoff, live after the
 *      whistle. A fixture still `scheduled` an hour before kickoff has no pack
 *      and nobody has noticed.
 *   3. The poller is beating, but ONLY inside the window where it should be.
 *      Silence at 04:00 on a Tuesday is correct, not a fault.
 *   4. Every released pack really is playable — the quiz_packs row exists and
 *      is published. A `released` row with no pack behind it is the worst
 *      failure this feature has: the app says the quiz is live and the link
 *      404s.
 *
 * Registration: add to the LAYERS array in scripts/health/check.mjs —
 *   { key: "halftime", module: "./checks/halftime.mjs", budgetMs: 30_000 },
 * (check.mjs skips a module it cannot find, so this file is inert until then.)
 */

import { supa, todayUK } from "../lib/db.mjs";
import { BASE } from "../lib/http.mjs";

const MIN = 60_000;
/** The poller is expected up from 80 min before the first kickoff… */
const WINDOW_LEAD = 80 * MIN;
/** …until a couple of hours after the last one. */
const WINDOW_TAIL = 165 * MIN;
const HEARTBEAT_STALE = 10 * MIN;

const PRE_RELEASE = ["scheduled", "base_ready", "staged"];

export async function run(report, ctx) {
  const today = todayUK();
  const now = Date.now();

  // ── today's slate ─────────────────────────────────────────────────────────
  let rows = [];
  try {
    const start = new Date(`${today}T00:00:00Z`);
    const end = new Date(start.getTime() + 26 * 60 * MIN); // generous; London ≠ UTC
    const { data, error } = await supa
      .from("halftime_releases")
      .select("fixture_id, home, away, kickoff_at, state, fresh_state, pack_id, released_at")
      .gte("kickoff_at", new Date(start.getTime() - 2 * 60 * MIN).toISOString())
      .lt("kickoff_at", end.toISOString())
      .order("kickoff_at", { ascending: true });
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch (e) {
    // The table not existing yet is not a failure — migration 93 may be unapplied.
    const notBuilt = /does not exist|schema cache/i.test(e.message);
    report.add("halftime", "slate readable", notBuilt, {
      warn: notBuilt,
      detail: notBuilt ? "halftime_releases not in prod yet (migration 93 unapplied)" : e.message,
      hint: "apply supabase/migrations/93_halftime.sql",
    });
    return;
  }

  // ── 1. no football today ──────────────────────────────────────────────────
  if (!rows.length) {
    report.add("halftime", "no fixtures today", true, { detail: `${today} — pipeline idle, zero cost` });
    ctx.halftime = { fixtures: 0 };
    return;
  }

  const kickoffs = rows.map((r) => new Date(r.kickoff_at).getTime());
  const first = Math.min(...kickoffs);
  const last = Math.max(...kickoffs);
  report.add("halftime", "fixtures today", true, {
    detail: `${rows.length} · first KO ${new Date(first).toISOString().slice(11, 16)}Z`,
  });

  // ── 2. is each fixture where it should be for the time of day? ────────────
  const wrong = [];
  const late = [];
  for (const r of rows) {
    const ko = new Date(r.kickoff_at).getTime();
    const mins = (now - ko) / MIN; // negative = before kickoff

    if (r.state === "cancelled" || r.state === "failed") continue;

    // T-2h: the day-before base slate must be approved and persisted by now.
    if (mins > -120 && r.state === "scheduled") {
      wrong.push(`${r.home} v ${r.away}: still 'scheduled' at T${Math.round(mins)}min — no approved base slate, no pack`);
    }
    // Kickoff: the pack must be frozen. If it is not, the poller missed T-10
    // and the watchdog is about to ship base-only.
    if (mins > 2 && r.state === "base_ready") {
      wrong.push(`${r.home} v ${r.away}: in play but never assembled (state=base_ready)`);
    }
    // ~KO+65: half time has certainly happened. A staged pack here is a MISS —
    // the whole feature is late.
    if (mins > 65 && r.state === "staged") {
      late.push(`${r.home} v ${r.away}: half time has been and gone and the pack is still staged`);
    }
    if (r.state === "released_late") {
      late.push(`${r.home} v ${r.away}: released LATE (no push went out)`);
    }
  }

  report.add("halftime", "state machine matches the clock", wrong.length === 0, {
    detail: wrong.length ? wrong.join(" · ") : `${rows.length} fixture(s) on schedule`,
    hint: "check the poller on the VPS: is it running, and did the base slate get approved?",
  });

  report.add("halftime", "no missed whistles", late.length === 0, {
    warn: late.every((l) => l.includes("released LATE")),
    detail: late.length ? late.join(" · ") : "every released pack landed on the whistle",
    hint: "poller was probably dead — the watchdog picked it up. Check the heartbeat.",
  });

  // ── 3. heartbeat, but only when a heartbeat is due ────────────────────────
  const inWindow = now >= first - WINDOW_LEAD && now <= last + WINDOW_TAIL;
  if (!inWindow) {
    report.add("halftime", "poller heartbeat", true, {
      detail: "outside the match window — silence is correct",
    });
  } else {
    try {
      const res = await fetch(`${BASE}/api/halftime/heartbeat`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      const hb = await res.json();
      const age = hb?.ageSeconds;
      const alive = hb?.beating === true && age != null && age * 1000 < HEARTBEAT_STALE;
      report.add("halftime", "poller heartbeat", alive, {
        detail: alive ? `beating, ${age}s ago` : `stale or absent (${age ?? "never"}s) DURING a match window`,
        hint: "ssh the VPS: is poller.mjs running? The watchdog is holding the fort at 5-minute resolution.",
      });
    } catch (e) {
      report.add("halftime", "poller heartbeat", false, { detail: e.message });
    }
  }

  // ── 4. a released pack that cannot be played is the worst outcome ─────────
  const released = rows.filter((r) => r.state === "released" || r.state === "released_late");
  if (released.length) {
    const ids = released.map((r) => r.pack_id).filter(Boolean);
    const { data: packs } = await supa
      .from("quiz_packs")
      .select("id, status, question_count")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

    const byId = new Map((packs ?? []).map((p) => [p.id, p]));
    const broken = released
      .filter((r) => {
        const p = r.pack_id ? byId.get(r.pack_id) : null;
        return !p || p.status !== "published" || p.question_count !== 10;
      })
      .map((r) => `${r.home} v ${r.away}`);

    report.add("halftime", "released packs are playable", broken.length === 0, {
      detail: broken.length
        ? `${broken.join(", ")} — the app says the quiz is live and the link is broken`
        : `${released.length} pack(s) live, 10 questions each`,
      hint: "re-POST /api/halftime/release for the fixture — it is idempotent and repairs a missing pack row",
    });
  }

  // ── 5. the fresh slice, for information ──────────────────────────────────
  const freshStates = rows.reduce((acc, r) => {
    acc[r.fresh_state] = (acc[r.fresh_state] ?? 0) + 1;
    return acc;
  }, {});
  const killed = rows.some((r) => r.fresh_state === "killed");
  report.add("halftime", "fresh slice", true, {
    warn: killed,
    detail: Object.entries(freshStates).map(([k, v]) => `${k}:${v}`).join(" ") + (killed ? " (SLATE KILLED)" : ""),
  });

  ctx.halftime = { fixtures: rows.length, released: released.length };
}
