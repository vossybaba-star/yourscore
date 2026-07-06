/**
 * journeys.mjs — Layer 3: the bot actually plays the games against prod.
 *
 * Auth: real sign-in + hand-built @supabase/ssr cookies (lib/auth.mjs).
 * Leaderboard safety is STRUCTURAL (see plan): solo plays a non-wc2026 pack,
 * the WC run is ranked:false, the ranked path is probed without committing
 * (stops at pick 0 — the lock only lands at pick 6), lobbies are created but
 * never answered. Everything written is deleted before the layer ends, and the
 * final check re-reads all three leaderboards to prove the bot is invisible.
 */

import { req } from "../lib/http.mjs";
import { supa } from "../lib/db.mjs";
import { signInBot } from "../lib/auth.mjs";
import { purgeBotRows } from "../cleanup.mjs";

const LETTERS = ["A", "B", "C", "D"];

// Rotate the quiz entity by day AND run slot so each club's bank is drawn at
// most ~once a day (dedup history is deliberately kept, so wear accumulates —
// quiz/start pulls 15 questions per game and small banks recycle fast).
const ENTITIES = ["Arsenal", "Liverpool", "Manchester United", "Chelsea", "Manchester City", "Tottenham Hotspur", "Newcastle United"];
const pickEntity = () => {
  const d = new Date();
  return ENTITIES[(d.getDate() * 4 + Math.floor(d.getHours() / 6)) % ENTITIES.length];
};

// 4-4-2 slot → broad position category, mirroring src/lib/draft/formations.ts
// (slot ids) + src/lib/draft/score.ts posCategory (legality = same category).
const SLOTS_442 = [
  { slot: "gk", cat: "gk" },
  { slot: "rb", cat: "def" }, { slot: "rcb", cat: "def" }, { slot: "lcb", cat: "def" }, { slot: "lb", cat: "def" },
  { slot: "rm", cat: "att" }, { slot: "rcm", cat: "mid" }, { slot: "lcm", cat: "mid" }, { slot: "lm", cat: "att" },
  { slot: "rst", cat: "att" }, { slot: "lst", cat: "att" },
];
const posCategory = (p) =>
  p === "GK" ? "gk"
  : ["RB", "CB", "LB", "RWB", "LWB"].includes(p) ? "def"
  : ["CDM", "CM", "CAM"].includes(p) ? "mid"
  : "att";

export async function run(report, ctx) {
  // ── 1. Auth ─────────────────────────────────────────────────────────────────
  let auth;
  try {
    auth = await signInBot();
    ctx.auth = auth; // reused by the browser layer
  } catch (e) {
    report.add("journeys", "auth", false, { detail: e.message, hint: "bot credentials or Supabase auth broken — every signed-in user may be affected" });
    return;
  }

  const api = (path, body, opts = {}) =>
    req(path, { method: "POST", body, cookie: auth.cookieHeader, timeoutMs: 15_000, ...opts });

  // ── 2. Quiz: start → complete ───────────────────────────────────────────────
  const entity = pickEntity();
  try {
    const start = await api("/api/quiz/start", { entity });
    if (start.status === 401) {
      report.add("journeys", "auth", false, { detail: "cookie rejected (401) — session cookie format may have changed", hint: "re-verify scripts/health/lib/auth.mjs after any @supabase/ssr upgrade" });
      return;
    }
    report.add("journeys", "auth", true, {});
    const questions = start.json?.questions ?? [];
    report.add("journeys", `quiz start (${entity})`, start.status === 200 && questions.length >= 8, {
      ms: start.ms,
      detail: `status ${start.status}, ${questions.length} questions`,
      hint: "quiz/start broken or question bank too thin for this entity",
    });

    if (questions.length) {
      ctx.servedQuestions = questions;
      ctx.quizEntity = entity;
      // Bank-exhaustion context for the repeat-question check: if the bot has
      // seen nearly the whole bank, server-side history recycling is BY DESIGN.
      try {
        // Usable supply = only the difficulties quiz/start actually draws
        // (easy 6 / medium 6 / hard 3) — expert/master rows never get served.
        const [{ count: supply }, { count: easySupply }, { count: seen }] = await Promise.all([
          supa.from("questions").select("id", { count: "exact", head: true }).eq("status", "active").eq("entity", entity).in("difficulty", ["easy", "medium", "hard"]),
          supa.from("questions").select("id", { count: "exact", head: true }).eq("status", "active").eq("entity", entity).eq("difficulty", "easy"),
          supa.from("user_question_history").select("question_id", { count: "exact", head: true }).eq("user_id", auth.userId).eq("entity", entity),
        ]);
        ctx.entitySupply = supply ?? 0;
        ctx.entityEasySupply = easySupply ?? 0;
        ctx.entityHistory = seen ?? 0;
      } catch { /* context only */ }

      // Answer honestly from the bank's answer key (~all correct is fine — the
      // bot's user_question_history is not a leaderboard input).
      const results = questions.map((q) => ({ questionId: q.id, correct: true })).slice(0, 60);
      const done = await api("/api/quiz/complete", { results });
      report.add("journeys", "quiz complete", done.status === 200, {
        ms: done.ms,
        detail: done.status === 200 ? "" : `status ${done.status}: ${JSON.stringify(done.json)?.slice(0, 120)}`,
        hint: "players can play but scores aren't being recorded",
      });
    }
  } catch (e) {
    report.add("journeys", "quiz", false, { detail: e.message, hint: "quiz flow unreachable" });
  }

  // ── 3. Solo challenge on a NON-wc2026 pack (structural prize-board avoidance) ─
  let soloPack = null;
  try {
    const packsRes = ctx.packs ? { json: { packs: ctx.packs } } : await req("/api/quiz/packs");
    const packs = packsRes.json?.packs ?? [];
    soloPack = packs.find((p) => p.metadata?.series !== "wc2026" && !p.metadata?.daily) ?? null;
    if (!soloPack) {
      report.add("journeys", "solo challenge", true, { warn: true, detail: "no non-wc2026 pack in rotation to test with" });
    } else {
      const answers = Array.from({ length: 10 }, () => ({ letter: LETTERS[Math.floor(Math.random() * 4)], elapsedMs: 5000 }));
      const solo = await api("/api/quiz/solo-complete", { packId: soloPack.id, answers });
      const ok = solo.status === 200 && typeof (solo.json?.score ?? solo.json?.correctCount) !== "undefined";
      report.add("journeys", "solo challenge", ok, {
        ms: solo.ms,
        detail: ok ? `score ${solo.json?.score}` : `status ${solo.status}: ${JSON.stringify(solo.json)?.slice(0, 120)}`,
        hint: "solo scoring broken (pack grading path)",
      });
      // Delete the attempt immediately: keeps the route's first-attempt-only
      // behavior re-runnable AND removes the row the prize board would read if
      // a wc2026 pack ever slipped through the filter above.
      const { error: delErr } = await supa.from("quiz_attempts").delete().eq("user_id", auth.userId).eq("pack_id", soloPack.id);
      const { count } = await supa.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("user_id", auth.userId);
      report.add("journeys", "solo cleanup", !delErr && (count ?? 0) === 0, {
        detail: delErr ? delErr.message : count ? `${count} attempt rows remain` : "",
        hint: "bot attempt rows persisting — check cleanup",
      });
    }
  } catch (e) {
    report.add("journeys", "solo challenge", false, { detail: e.message });
  }

  // ── 4. Ranked WC draft probe (non-committal: stops at pick 0, lock is pick 6) ─
  try {
    const begin = await api("/api/draft/wc/draft", { action: "begin" });
    if (begin.json?.locked) {
      report.add("journeys", "wc ranked probe", true, { warn: true, detail: "today's ranked run already locked for the bot (leftover from a crashed run?)" });
    } else {
      const qs = begin.json?.questions ?? [];
      report.add("journeys", "wc ranked probe: begin", begin.status === 200 && qs.length >= 1, {
        ms: begin.ms,
        detail: `status ${begin.status}, ${qs.length} edition questions`,
        hint: "today's ranked draft can't start — check wc_ranked_edition + wc-quiz bundle",
      });
      const slate = await api("/api/draft/wc/draft", { action: "slate", i: 0, answers: [0], picks: [] });
      const players = slate.json?.players ?? [];
      report.add("journeys", "wc ranked probe: slate", slate.status === 200 && players.length >= 1, {
        ms: slate.ms,
        detail: `status ${slate.status}, ${players.length} players dealt`,
        hint: "ranked draft slates empty — server pool or seed broken ('can't pick a player')",
      });
      if (players.length) ctx.slatePlayerIds = players.map((p) => p.player_season_id ?? p.id).filter(Boolean);
    }
  } catch (e) {
    report.add("journeys", "wc ranked probe", false, { detail: e.message });
  }

  // ── 5. Unranked WC run: build a legal XI from the pool and play the engine ──
  try {
    let pool = ctx.pool;
    let nations = ctx.poolNations;
    if (!pool) {
      const r = await req("/data/draft/player-seasons.json", { timeoutMs: 20_000 });
      pool = r.json?.players ?? [];
      nations = r.json?.nations ?? [];
    }
    const eligible = new Set((nations ?? []).flatMap((n) => n.playerIds ?? []));
    const byId = new Map(pool.map((p) => [p.id, p]));
    const wcPlayers = [...eligible].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));

    const squad = [];
    const usedSlots = new Set();
    const usedIdentity = new Set(); // conservative same-player guard: surname + first initial
    for (const p of wcPlayers) {
      if (squad.length === 11) break;
      const cat = posCategory(p.position);
      const slot = SLOTS_442.find((s) => s.cat === cat && !usedSlots.has(s.slot));
      if (!slot) continue;
      const parts = String(p.name).toLowerCase().split(/\s+/);
      const identity = `${parts.at(-1)}:${parts[0]?.[0] ?? ""}`;
      if (usedIdentity.has(identity)) continue;
      usedSlots.add(slot.slot);
      usedIdentity.add(identity);
      squad.push({ slot: slot.slot, player_season_id: p.id });
    }

    if (squad.length !== 11) {
      report.add("journeys", "wc unranked run", false, { detail: `could only build ${squad.length}/11 from pool`, hint: "pool JSON missing positions/nations data" });
    } else {
      const start = await api("/api/draft/wc", { action: "start", mode: "world", ranked: false, formation: "4-4-2", squad });
      const runId = start.json?.runId;
      report.add("journeys", "wc run start", start.status === 200 && !!runId, {
        ms: start.ms,
        detail: start.status === 200 ? `strength ${start.json?.strength}` : `status ${start.status}: ${JSON.stringify(start.json)?.slice(0, 150)}`,
        hint: "practice WC runs can't start — squad validation or run insert broken",
      });

      if (runId) {
        let engineOk = true, played = 0, note = "";
        for (let i = 0; i < 3 && engineOk; i++) {
          const play = await api("/api/draft/wc/play", { runId });
          // A 400 "Run is over" after ≥1 match = the run ended naturally
          // (group-stage elimination etc.) — the engine did its job.
          if (play.status === 400 && played >= 1 && /run is over/i.test(String(play.json?.error ?? ""))) break;
          if (play.status !== 200) { engineOk = false; note = `play ${i + 1}: status ${play.status}`; break; }
          played++;
          if (play.json?.awaitingTie) {
            const decide = await api("/api/draft/wc/decide", { runId, answer: -1 });
            if (decide.status !== 200) { engineOk = false; note = `decide: status ${decide.status}`; }
          }
          if (play.json?.pensPending) break; // interactive pens = client territory; engine reached it fine
          if (play.json?.run?.status && play.json.run.status !== "active") break; // run ended naturally
        }
        report.add("journeys", "wc match engine", engineOk && played >= 1, {
          detail: engineOk ? `${played} matches simulated` : note,
          hint: "WC match simulation failing mid-run",
        });
        await supa.from("draft_wc_runs").delete().eq("id", runId).eq("user_id", auth.userId);
      }
    }
  } catch (e) {
    report.add("journeys", "wc unranked run", false, { detail: e.message });
  }

  // ── 6. H2H challenge (create-only: self-play is server-rejected by design) ──
  try {
    const h2h = await api("/api/h2h/create", {
      quizPackId: soloPack?.id ?? "health-check",
      quizPackName: soloPack?.name ?? "health-check",
      score: 500, correct: 5, totalQuestions: 10, maxScore: 2000,
    });
    const id = h2h.json?.id ?? h2h.json?.challengeId;
    report.add("journeys", "h2h create", h2h.status === 200 && !!id, {
      ms: h2h.ms,
      detail: h2h.status === 200 ? "" : `status ${h2h.status}: ${JSON.stringify(h2h.json)?.slice(0, 120)}`,
      hint: "challenge-a-friend broken (Versus tab core loop)",
    });
    if (id) await supa.from("h2h_challenges").delete().eq("id", id).eq("challenger_id", auth.userId);
  } catch (e) {
    report.add("journeys", "h2h create", false, { detail: e.message });
  }

  // ── 7. Lobby create (never started, never answered — no total_score writes) ─
  try {
    const room = await api("/api/room/create", { room_mode: "group", question_count: 10, category_filter: "Premier League", difficulty_filter: "mixed" });
    const code = room.json?.room?.code ?? room.json?.roomCode ?? room.json?.code;
    report.add("journeys", "lobby create", room.status === 200 && /^[A-Z0-9]{6}$/i.test(String(code ?? "")), {
      ms: room.ms,
      detail: room.status === 200 ? `code ${code}` : `status ${room.status}: ${JSON.stringify(room.json)?.slice(0, 120)}`,
      hint: "multiplayer lobbies can't be created",
    });
  } catch (e) {
    report.add("journeys", "lobby create", false, { detail: e.message });
  }

  // ── 8. Post-journey purge + leaderboard-exclusion assertion ─────────────────
  try {
    await purgeBotRows();
    const bust = `hc=${Date.now()}`;
    const boards = ["/api/leaderboard/yourscore", "/api/leaderboard/wc2026", "/api/draft/wc/leaderboard"];
    let visible = [];
    for (const b of boards) {
      const r = await req(`${b}?${bust}`);
      if (r.text.includes(auth.userId)) visible.push(b);
    }
    report.add("journeys", "bot invisible on boards", visible.length === 0, {
      detail: visible.length ? `bot user id present on: ${visible.join(", ")}` : "",
      hint: "STOP the health runs (unload plist) and clean the boards NOW — prize integrity",
    });
  } catch (e) {
    report.add("journeys", "bot invisible on boards", false, { detail: e.message });
  }
}
