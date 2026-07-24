"use client";

/**
 * /38-0/play — the draft loop (slicker, 38-0-inspired).
 *
 * Spin a CLUB × SEASON, see the whole squad as a list, pick any player, then choose
 * which OPEN slot to put them in (Available vs Unavailable, with reasons). A live
 * OVERALL + Attack/Mid/Def/GK breakdown builds as you draft. Repeat x11.
 *
 * Two modes, Premier League only. `team.gated` is the flag; **PRO** is the name the player
 * sees (the code says "gated" because that's the mechanic):
 *   Just Draft — spin straight away, every squad dealt at full quality.
 *   Pro        — every spin is unlocked by a Premier League question. A correct answer
 *                (and a correct STREAK) raises the quality band the squad is dealt from;
 *                a wrong one caps it below elite. The more football you know, the stronger
 *                your XI. Same band maths as WC Mastermind (lib/draft/draft-quiz.ts).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { QuizGate } from "@/components/draft/QuizGate";
import { SlateSkeleton } from "@/components/draft/SlateSkeleton";
import { BackPill } from "@/components/ui/BackPill";
import { Button } from "@/components/ui/Button";
import { gradeAnswer, type DraftBand } from "@/lib/draft/draft-quiz";
import { loadGuestClub } from "@/lib/clubs/guestClub";
import type { ServedQuestion } from "@/lib/draft/wc-quiz-public";
import { spin, allBuckets, ensurePool, isPoolReady, type Spin } from "@/lib/draft/pool";
import {
  loadTeam, saveTeam, openSlots, isComplete, usedPlayerIds, usedPlayerNames, placePlayer,
  type LocalTeam,
} from "@/lib/draft/local";
import { trackTeamDrafted } from "@/lib/analytics/trackGame";
import { slotsFor } from "@/lib/draft/formations";
import { canPlay, fitMultiplier, lineRatings, posCategory, CATEGORY_COLOR } from "@/lib/draft/score";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { PlayerSeason, Position, Slot } from "@/lib/draft/types";

// Distinct slot-positions in this formation a player can legally fill, best fit first.
function eligiblePositions(player: PlayerSeason, formation: LocalTeam["formation"]): Position[] {
  const seen = new Set<Position>();
  return slotsFor(formation)
    .filter((s) => canPlay(player.position, s.pos))
    .sort((a, b) => fitMultiplier(player.position, b.pos) - fitMultiplier(player.position, a.pos))
    .map((s) => s.pos)
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

const QUESTION_SECONDS = 25; // per-question clock in Pro mode (timeout = wrong answer)

export default function DraftPlay() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [current, setCurrent] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<{ club: string; season: string } | null>(null);
  const [selected, setSelected] = useState<PlayerSeason | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // True from the SPIN tap until the pick is placed. Gates the tray's reserved
  // round box: set SYNCHRONOUSLY in the tap handler so the box (and its full
  // height) mounts inside the 500ms input-exclusion window — the late reveal
  // then lands inside already-reserved space instead of shifting the layout.
  // That reveal shift was the #1 mobile CLS source on this screen (0.37/spin).
  const [roundOpen, setRoundOpen] = useState(false);
  // Club-seasons already offered this draft ("club|season") — fed to spin() so the
  // same squad's options don't keep reappearing for position after position.
  const seenBuckets = useRef<Set<string>>(new Set());

  // ── Pro mode: the question that unlocks each spin ────────────────────────
  const [quiz, setQuiz] = useState<ServedQuestion | null>(null);
  const [answered, setAnswered] = useState<number | null>(null); // locked option index (-1 = timeout)
  const [timeLeft, setTimeLeft] = useState(QUESTION_SECONDS);
  const [streak, setStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [askedCount, setAskedCount] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; streak: number } | null>(null);
  // Questions already asked this draft — sent to the server so it doesn't re-deal them.
  const askedIds = useRef<Set<string>>(new Set());
  // What the server needs back to re-derive (and grade) the current question: the seed, the
  // club whose pool it was drawn from, and the server's signature over that pair. We hand
  // all three back untouched — the signature is what stops a client re-grading against a
  // different club's question until one marks their answer correct.
  const gateSeed = useRef<string | null>(null);
  const gateSig = useRef<string | null>(null);
  const gateClub = useRef<string | null>(null);

  useEffect(() => {
    void ensurePool(); // preload the on-demand player pool for the spin
    const t = loadTeam();
    if (!t) { router.replace("/38-0"); return; }
    setTeam(t);
    // Seed the offered-squads memory from the XI so far (resuming a draft keeps it).
    seenBuckets.current = new Set(t.squad.map((p) => `${p.club}|${p.season}`));
    if (isComplete(t)) router.replace("/38-0/team");
  }, [router]);

  useEffect(() => () => { if (reelTimer.current) clearInterval(reelTimer.current); }, []);

  // Per-question 25s clock. Hitting zero locks in a timeout as a wrong answer (idx -1),
  // so you can't sit on a question looking the answer up.
  useEffect(() => {
    if (!quiz || answered !== null) return;
    if (timeLeft <= 0) { answerQuiz(-1); return; }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, answered, timeLeft]);

  function doSpin() {
    if (!team || spinning || quiz) return;
    setRoundOpen(true); // before the pool gate — the tray box must mount at the tap, not when the pool lands
    if (!isPoolReady()) { void ensurePool().then(() => doSpin()); return; }
    // Just Draft (and every La Liga draft) spins immediately at full quality. Pro asks
    // first, and the answer decides the band the squad is dealt from.
    if (!team.gated) { runSpin({}); return; }
    void drawGateQuestion();
  }

  // A gate we couldn't serve must never be BETTER than answering one. The first version
  // fell back to an unbanded spin (0–99) so a draft couldn't dead-end on a network blip —
  // but that made failure the best move in the game: trip the endpoint's rate limit and
  // every remaining pick came through ungated at full quality. So a failed gate is graded
  // as a MISS instead: the draft still never dead-ends, the streak resets, and the pick is
  // capped exactly as a wrong answer would be. Costly enough not to farm, mild enough that
  // a genuine blip only costs you one pick.
  function spinAsMiss() {
    const { streak: newStreak, band } = gradeAnswer(streak, false);
    setStreak(newStreak);
    runSpin(band);
  }

  // Pull the next gate question from the server ANSWER-FREE (the pool + answers are
  // server-only).
  async function drawGateQuestion() {
    try {
      const res = await fetch("/api/draft/pl/gate-quiz", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draw",
          exclude: Array.from(askedIds.current),
          // A guest's club lives only on this device, so the server can't look it up —
          // it's sent here and honoured only while signed out. A signed-in player's club
          // comes from club_supporters and this field is ignored.
          club: loadGuestClub(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.question) { spinAsMiss(); return; }
      gateSeed.current = data.seed as string;
      gateSig.current = data.sig as string;
      gateClub.current = (data.club ?? null) as string | null;
      setQuiz({ ...data.question, correctIndex: -1 });
      setAnswered(null);
      setFeedback(null);
      setTimeLeft(QUESTION_SECONDS);
    } catch {
      spinAsMiss();
    }
  }

  // Lock the answer, let the server grade it (it alone knows the answer), reveal the
  // correct option, then spin the band that answer earned.
  function answerQuiz(idx: number) {
    if (!quiz || answered !== null) return;
    setAnswered(idx);
    void (async () => {
      const qid = quiz.id;
      try {
        const res = await fetch("/api/draft/pl/gate-quiz", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "answer",
            seed: gateSeed.current,
            sig: gateSig.current,
            club: gateClub.current,
            choice: idx,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setAnswered(null); return; }
        const correct = !!data.correct;
        const { streak: newStreak, band } = gradeAnswer(streak, correct);
        askedIds.current.add(qid);
        setQuiz((q) => (q ? { ...q, correctIndex: data.correctIndex } : q)); // reveal now (post-answer)
        setStreak(newStreak);
        setAskedCount((n) => n + 1);
        if (correct) setCorrectCount((n) => n + 1);
        setFeedback({ correct, streak: newStreak });
        setTimeout(() => { setQuiz(null); setAnswered(null); runSpin(band); }, 900);
      } catch {
        setAnswered(null);
      }
    })();
  }

  // The reel + deal. `band` is the quality window the answer earned — empty in Just
  // Draft, where every squad is dealt whole.
  function runSpin(band: DraftBand | Record<string, never>) {
    if (!team) return;
    setSpinning(true);
    setCurrent(null);
    setSelected(null);
    const buckets = allBuckets(team.league);
    let ticks = 0;
    // Never leave a reel running. Each interval clears ITS OWN id (captured in `mine`),
    // not whatever `reelTimer.current` happens to point at — the old code cleared the ref,
    // so if a second spin ever started, the first tick-out clobbered the NEW timer's id and
    // orphaned itself, leaving the reel ticking forever with the tray stuck on SPINNING.
    if (reelTimer.current) clearInterval(reelTimer.current);
    const mine = setInterval(() => {
      const b = buckets[Math.floor(Math.random() * buckets.length)];
      setReel({ club: b.club, season: b.season });
      if (++ticks > 13) {
        clearInterval(mine);
        if (reelTimer.current === mine) reelTimer.current = null;
        try {
          const open = openSlots(team).map((s) => s.pos);
          const result = spin(open, usedPlayerIds(team), usedPlayerNames(team), Math.random, seenBuckets.current, team.league, band);
          seenBuckets.current.add(`${result.club}|${result.season}`);
          setReel({ club: result.club, season: result.season });
          setCurrent(result);
        } catch (err) {
          // A throw here used to leave the tray stuck on SPINNING forever (the interval is
          // already cleared, so nothing ever retries). Always release the button.
          console.error("[38-0] spin failed", err);
        } finally {
          setSpinning(false);
        }
      }
    }, 65);
    reelTimer.current = mine;
  }

  function placeAt(slot: Slot) {
    if (!team || !selected) return;
    const next = placePlayer(team, selected, slot);
    saveTeam(next);
    setTeam(next);
    setCurrent(null);
    setReel(null);
    setSelected(null);
    setRoundOpen(false); // tap-synchronous — collapsing the round box here is input-excluded
    if (isComplete(next)) {
      // The IKEA moment: a full XI exists. Sits between Play380 (draft started)
      // and Complete380 (match result) — the audience for "your XI is waiting"
      // retargeting and the stage the guest signup gate hangs off.
      trackTeamDrafted({ board: next.league });
      setTimeout(() => router.push("/38-0/team"), 400);
    }
  }

  if (!team) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8a948f" }}>Loading…</div>;
  }

  const remaining = 11 - team.squad.length;
  const lines = lineRatings(team.squad);
  const filledBySlot = new Map(team.squad.map((p) => [p.slot, p]));
  const badge = reel ? getTeamBadgeUrlSync(reel.club) : null;

  // Placement split for the selected player.
  const slots = slotsFor(team.formation);
  const available = selected ? slots.filter((s) => !filledBySlot.has(s.id) && canPlay(selected.position, s.pos)) : [];
  const unavailable = selected ? slots.filter((s) => !available.includes(s)) : [];

  return (
    <div className="min-h-[100dvh] pb-44" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4">
          <BackPill href="/38-0" label="Back" tone="draft" />
        </div>
        {/* header: formation + overall */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <div className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>FORMATION</div>
            <div className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>{team.formation}</div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>OVERALL</div>
            <div className="font-display" style={{ fontSize: 38, lineHeight: 1, color: "#aeea00" }}>
              {team.squad.length ? team.strength : "0"}
            </div>
          </div>
        </div>

        {/* progress */}
        <div className="flex items-center gap-2 mt-3 mb-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(team.squad.length / 11) * 100}%`, background: "#aeea00" }} />
          </div>
          <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>{team.squad.length}/11</span>
        </div>

        {/* Pro: the reward loop, made visible — how many you've earned and the live streak. */}
        {team.gated && askedCount > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className="rounded-full px-2.5 py-1 font-body" style={{ fontSize: 11, color: "#aeea00", background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.3)" }}>
              {correctCount}/{askedCount} correct
            </span>
            {streak >= 2 && (
              <span className="rounded-full px-2.5 py-1 font-body" style={{ fontSize: 11, color: "#ffb800", background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.3)" }}>
                🔥 Streak ×{streak}
              </span>
            )}
          </div>
        )}

        <Pitch formation={team.formation} squad={team.squad} compact />

        {/* live line ratings */}
        {team.squad.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {([["ATT", lines.attack, "att"], ["MID", lines.midfield, "mid"], ["DEF", lines.defence, "def"], ["GK", lines.gk, "gk"]] as const).map(([label, val, cat]) => (
              <div key={label} className="rounded-xl px-2 py-2 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-display" style={{ fontSize: 20, color: val ? CATEGORY_COLOR[cat] : "#444" }}>{val || "0"}</div>
                <div className="font-body" style={{ fontSize: 9, color: "#8a948f", letterSpacing: 1 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* spin / squad tray */}
      <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
        <div className="max-w-lg mx-auto px-4 pt-3">
          {/* Round box — mounts at the SPIN tap (input-excluded) at its FINAL height and
              holds it until the pick is placed. Reel, skeleton, slate and placement panel
              swap INSIDE it, so the ~1s-late reveal (after the reel animation) can't move
              the page. That reveal was the #1 mobile CLS source on this screen. */}
          {roundOpen && (
            <div className="mb-3 flex flex-col" style={{ height: 424 }}>
            {/* CLUB × SEASON reel — constant height, ticks in place */}
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3 flex-shrink-0" style={{ height: 72, background: "#0e1611", border: `1px solid ${spinning ? "rgba(255,184,0,0.4)" : "rgba(174,234,0,0.35)"}` }}>
              {badge ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={badge} alt={reel?.club ?? ""} width={46} height={46}
                  style={{ width: 46, height: 46, objectFit: "contain", filter: spinning ? "grayscale(0.3) opacity(0.85)" : "drop-shadow(0 0 10px rgba(174,234,0,0.45))" }} />
              ) : <div style={{ width: 46, height: 46 }} />}
              <div className="flex-1 min-w-0">
                <div className="font-body" style={{ fontSize: 9, color: "#8a948f", letterSpacing: 1 }}>CLUB × SEASON</div>
                <div className="font-display tracking-wide leading-none truncate" style={{ fontSize: 24, color: spinning ? "#ffb800" : "#fff" }}>
                  {reel?.club ?? "Spinning"} {reel?.season && <span style={{ color: "#8a948f", fontSize: 18 }}>{reel.season}</span>}
                </div>
              </div>
            </div>

            {/* slate area — fills the rest of the box; contents swap in place */}
            <div className="flex-1 min-h-0 mt-3">
            {/* placement panel */}
            {selected ? (
            <div className="h-full flex flex-col justify-end">
            <div className="rounded-2xl p-3 overflow-y-auto" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.3)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-body" style={{ fontSize: 14, color: "#fff" }}>Place <b style={{ color: "#aeea00" }}>{selected.name}</b></span>
                <button onClick={() => setSelected(null)} className="font-body" style={{ fontSize: 13, color: "#8a948f" }}>Cancel</button>
              </div>
              <div className="font-body mb-1" style={{ fontSize: 10, color: "#8a948f", letterSpacing: 1 }}>AVAILABLE ({available.length})</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {available.map((s) => {
                  const c = CATEGORY_COLOR[posCategory(s.pos)];
                  return (
                    <button key={s.id} onClick={() => placeAt(s)} className="rounded-lg px-3 py-2 font-display tracking-wide active:scale-95 transition-transform"
                      style={{ fontSize: 14, color: "#0a0a0f", background: c }}>
                      {s.label}
                    </button>
                  );
                })}
                {available.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No open slot fits — pick another player.</span>}
              </div>
              <div className="font-body mb-1" style={{ fontSize: 10, color: "#8a948f", letterSpacing: 1 }}>UNAVAILABLE</div>
              <div className="flex flex-wrap gap-1.5">
                {unavailable.map((s) => {
                  const taken = filledBySlot.get(s.id);
                  return (
                    <span key={s.id} className="rounded-lg px-2 py-1.5 font-body" style={{ fontSize: 11, color: "#666", background: "rgba(255,255,255,0.04)" }}>
                      {s.label} · {taken ? taken.name.split(" ").slice(-1)[0] : "N/A"}
                    </span>
                  );
                })}
              </div>
            </div>
            </div>
            ) : current && !spinning ? (
            <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.07)", height: "100%", overflowY: "auto" }}>
              <div className="px-3 py-2 font-body sticky top-0" style={{ fontSize: 11, color: "#8a948f", background: "#080d0a" }}>
                Pick a player → choose their slot
              </div>
              {current.players.map((p) => {
                const c = CATEGORY_COLOR[posCategory(p.position)];
                const elig = eligiblePositions(p, team.formation);
                const playable = elig.length > 0;
                return (
                  <button key={p.id} onClick={() => playable && setSelected(p)} disabled={!playable}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)", opacity: playable ? 1 : 0.4 }}>
                    <div className="flex items-center justify-center rounded-lg font-display flex-shrink-0"
                      style={{ width: 38, height: 38, fontSize: 18, color: "#0a0a0f", background: c }}>
                      {p.overall}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>
                        {p.name} <span style={{ color: "#8a948f", fontSize: 12 }}>{p.club} {p.season}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {elig.slice(0, 3).map((pos) => (
                        <span key={pos} className="rounded px-1.5 py-0.5 font-body" style={{ fontSize: 9, color: CATEGORY_COLOR[posCategory(pos)], background: "rgba(255,255,255,0.06)" }}>{pos}</span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            ) : (
              <SlateSkeleton />
            )}
            </div>
            </div>
          )}

          {/* spin button — once you've spun you must draft from that squad (no re-spin).
              min-height matches the lg Button so the button↔hint swap at reveal time
              (outside the input-exclusion window) doesn't nudge the tray (CLS). */}
          <div className="flex flex-col justify-center" style={{ minHeight: 62 }}>
          {remaining > 0 ? (
            !current || spinning ? (
              <Button variant="primary" tone="lime" size="lg" fullWidth onClick={doSpin} disabled={spinning || !!quiz}>
                {spinning ? "SPINNING…" : team.gated ? "⚽ ANSWER TO SPIN" : "🎰 SPIN THE WHEEL"}
              </Button>
            ) : (
              <div className="text-center font-body py-2" style={{ fontSize: 13, color: "#8a948f" }}>
                Draft a player from this squad to continue
              </div>
            )
          ) : (
            <Button variant="primary" tone="lime" size="lg" fullWidth onClick={() => router.push("/38-0/team")}>
              SEE YOUR RECORD →
            </Button>
          )}
          </div>
        </div>
      </div>

      {quiz && (
        <QuizGate
          question={quiz}
          answered={answered}
          timeLeft={timeLeft}
          totalSeconds={QUESTION_SECONDS}
          streak={streak}
          feedback={feedback}
          onAnswer={answerQuiz}
          accent="#aeea00"
          verb="SPIN"
        />
      )}
    </div>
  );
}
