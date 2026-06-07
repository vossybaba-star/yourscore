"use client";

/**
 * /draft/team — your current XI: Strength, projected 38-game record, tier, status,
 * and the loop actions. Quick Match runs a local single-game H2H (the same engine
 * the server uses for real matchmaking) so the win→swap / lose→rebuild loop works
 * end-to-end before cloud matchmaking is wired up.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { BottomNav } from "@/components/ui/BottomNav";
import {
  loadTeam, saveTeam, isComplete, recordWin, recordLoss, saveLastMatch,
  type LocalTeam,
} from "@/lib/draft/local";
import { makeOpponent } from "@/lib/draft/opponent";
import { resolveH2H, seededRng } from "@/lib/draft/score";
import { tierColor, TIER_TAGLINE, strengthPct } from "@/lib/draft/ui";
import { preSeasonOdds } from "@/lib/draft/season";
import { leagueOpponents } from "@/lib/draft/pool";
import { useUser } from "@/hooks/useUser";

export default function TeamScreen() {
  const router = useRouter();
  const { user } = useUser();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [matching, setMatching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [challengeCode, setChallengeCode] = useState<string | null>(null);
  const [creatingChallenge, setCreatingChallenge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const t = loadTeam();
    if (!t) { router.replace("/draft"); return; }
    if (!isComplete(t)) { router.replace("/draft/play"); return; }
    setTeam(t);
  }, [router]);

  function quickMatch() {
    if (!team || matching || team.status === "stale") return;
    setMatching(true);
    const matchId = `local-${team.updatedAt}-${Math.floor(Math.random() * 1e6)}`;
    const opp = makeOpponent(team.formation, team.strength);
    // Single-game resolution via the shared, seeded engine.
    const winner = resolveH2H(team.strength, opp.team.strength, seededRng(matchId));
    const youWon = winner === "A";
    const margin = Math.abs(Math.round((team.strength - opp.team.strength) * 10) / 10);

    saveLastMatch({
      id: matchId,
      you: { name: "You", formation: team.formation, squad: team.squad, strength: team.strength, projected: team.projected },
      opp: { name: opp.name, formation: opp.team.formation, squad: opp.team.squad, strength: opp.team.strength, projected: opp.team.projected },
      winner: youWon ? "you" : "opp",
      margin,
      playedAt: Date.now(),
    });

    const next = youWon ? recordWin(team) : recordLoss(team);
    saveTeam(next);
    setTimeout(() => router.push("/draft/match/result"), 450);
  }

  // Ranked: save the XI to the cloud (server recomputes Strength), resolve a real
  // H2H against a random active opponent (bot fallback), and feed the leaderboard.
  async function rankedMatch() {
    if (!team || matching || team.status === "stale") return;
    if (!user) { router.push("/auth/sign-in"); return; }
    setMatching(true);
    setErr(null);
    try {
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const saveRes = await fetch("/api/draft/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ formation: team.formation, squad }),
      });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save team"); setMatching(false); return; }

      const res = await fetch("/api/draft/match", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Match failed"); setMatching(false); return; }
      const m = await res.json();

      saveLastMatch({
        id: m.matchId,
        you: { name: "You", formation: m.you.formation, squad: m.you.squad, strength: m.you.strength, projected: m.you.projected },
        opp: { name: m.opp.name, formation: m.opp.formation, squad: m.opp.squad, strength: m.opp.strength, projected: m.opp.projected },
        winner: m.youWon ? "you" : "opp",
        margin: m.margin,
        playedAt: Date.now(),
      });
      const next = m.youWon ? recordWin(team) : recordLoss(team);
      saveTeam(next);
      router.push("/draft/match/result");
    } catch {
      setErr("Network error — try again");
      setMatching(false);
    }
  }

  // Save to the cloud. Guests are sent to sign up (which unlocks the full
  // signed-in app — including the Draft XI tab — and cloud-saved teams).
  async function saveToCloud() {
    if (!team || saving) return;
    if (!user) { router.push("/auth/sign-in"); return; }
    setSaving(true); setErr(null);
    try {
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const r = await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not save"); setSaving(false); return; }
      setSaved(true); setSaving(false);
    } catch { setErr("Network error"); setSaving(false); }
  }

  // Friend challenge: snapshot the XI to a share code/link for async H2H.
  async function challengeFriend() {
    if (!team || creatingChallenge) return;
    if (!user) { router.push("/auth/sign-in"); return; }
    setCreatingChallenge(true); setErr(null);
    try {
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const saveRes = await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad }) });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save team"); setCreatingChallenge(false); return; }
      const r = await fetch("/api/draft/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "Could not create challenge"); setCreatingChallenge(false); return; }
      setChallengeCode(d.code);
      const url = `${window.location.origin}/draft/challenge/${d.code}`;
      const text = `I built a Draft XI (${team.strength}) — can you beat it? `;
      if (navigator.share) navigator.share({ title: "Draft XI Challenge", text, url }).catch(() => {});
      else navigator.clipboard.writeText(`${text}${url}`).catch(() => {});
      setCreatingChallenge(false);
    } catch { setErr("Network error"); setCreatingChallenge(false); }
  }

  if (!team || !team.projected) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  const p = team.projected;
  const tc = tierColor(p.tier);
  const stale = team.status === "stale";

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-2">
          <Link href="/draft" className="font-body text-sm" style={{ color: "#8888aa" }}>← Draft XI</Link>
          <div className="flex items-center gap-2">
            {team.mode === "expert" && (
              <span className="font-body text-xs px-2.5 py-1 rounded-full" style={{ color: "#ffb800", background: "rgba(255,184,0,0.12)" }}>
                🔒 EXPERT
              </span>
            )}
            <span
              className="font-body text-xs px-2.5 py-1 rounded-full"
              style={{
                color: stale ? "#ff4757" : "#00ff87",
                background: stale ? "rgba(255,71,87,0.12)" : "rgba(0,255,135,0.12)",
              }}
            >
              {stale ? "STALE" : "● AVAILABLE"}
            </span>
          </div>
        </div>

        {/* tier banner */}
        <div className="rounded-3xl p-5 mb-4" style={{ background: `linear-gradient(135deg, ${tc}22, #0f0f17)`, border: `1px solid ${tc}55` }}>
          <div className="font-display tracking-wide leading-none" style={{ fontSize: 40, color: tc }}>{p.tier}</div>
          <div className="font-body mt-1" style={{ fontSize: 13, color: "#cfcfe6" }}>{TIER_TAGLINE[p.tier]}</div>

          <div className="flex items-end justify-between mt-4">
            <div>
              <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>PROJECTED SEASON</div>
              <div className="font-display tracking-wide" style={{ fontSize: 30, color: "#fff" }}>
                {p.wins}-{p.draws}-{p.losses}
              </div>
              <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>
                {p.points} pts · {ordinal(p.position)} place
              </div>
            </div>
            <div className="text-right">
              <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>STRENGTH</div>
              <div className="font-display" style={{ fontSize: 48, color: tc, lineHeight: 1 }}>{team.strength}</div>
            </div>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div className="h-full rounded-full" style={{ width: `${strengthPct(team.strength)}%`, background: tc }} />
          </div>
        </div>

        {team.winStreak > 0 && (
          <div className="text-center mb-4 font-display tracking-wide" style={{ fontSize: 18, color: "#ffb800" }}>
            🔥 {team.winStreak} WIN STREAK
          </div>
        )}

        <Pitch formation={team.formation} squad={team.squad} compact />

        {/* Bookies' pre-season odds — the prediction before you simulate the season */}
        {!stale && (() => {
          const odds = preSeasonOdds(team.squad, team.strength, leagueOpponents());
          const bands: [string, number, string][] = [
            ["Win the league", odds.winLeague, "#ffb800"],
            ["Top 4", odds.top4, "#00ff87"],
            ["Top 6", odds.top6, "#22d3ee"],
            ["Top 10", odds.top10, "#a78bfa"],
            ["Relegation", odds.relegation, "#ff4757"],
          ];
          return (
            <div className="mt-5 rounded-3xl p-5" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>PRE-SEASON ODDS</span>
                <span className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>What the bookies make of your XI</span>
              </div>
              <div className="flex items-end justify-between mb-4">
                <div>
                  <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>PROJECTED FINISH</div>
                  <div className="font-display tracking-wide" style={{ fontSize: 40, color: "#fff", lineHeight: 1 }}>{ordinal(odds.projectedFinish)}</div>
                </div>
                <div className="text-right">
                  <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>EXPECTED POINTS</div>
                  <div className="font-display" style={{ fontSize: 40, color: "#00ff87", lineHeight: 1 }}>{odds.expectedPoints}</div>
                </div>
              </div>
              <div className="space-y-2">
                {bands.map(([label, val, color]) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-body" style={{ fontSize: 12, color: "#cfcfe6" }}>{label}</span>
                      <span className="font-body" style={{ fontSize: 12, color: "#fff" }}>{val}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                      <div className="h-full rounded-full" style={{ width: `${val}%`, background: color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {!stale && (
          <button onClick={() => router.push("/draft/season")}
            className="w-full mt-4 rounded-2xl py-5 font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "#00ff87", color: "#062013", fontSize: 28 }}>
            ⚽ SIMULATE SEASON →
          </button>
        )}

        {/* secondary actions */}
        <div className="mt-3 space-y-3">
          {stale ? (
            <>
              <div className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.3)" }}>
                <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#ff4757" }}>TEAM IS STALE</div>
                <div className="font-body mt-1" style={{ fontSize: 13, color: "#cfcfe6" }}>
                  You lost — no swaps. Rebuild a full new XI to challenge again.
                </div>
              </div>
              <button onClick={() => { router.push("/draft"); }}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
                style={{ background: "#ff4757", color: "#fff", fontSize: 24 }}>
                REBUILD XI →
              </button>
            </>
          ) : (
            <>
              {err && (
                <div className="rounded-xl px-4 py-2 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>
                  {err}
                </div>
              )}

              {/* Save the XI — guests get sent to sign up for YourScore. */}
              <button onClick={saveToCloud} disabled={saving || saved}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-70"
                style={{ background: "#a78bfa", color: "#15082b", fontSize: 22 }}>
                {saving ? "SAVING…" : saved ? "SAVED ✓" : user ? "💾 SAVE TEAM" : "💾 SAVE TEAM — SIGN UP"}
              </button>

              {/* Signed in → ranked (feeds the leaderboard). Guest → local Quick Match. */}
              <button onClick={user ? rankedMatch : quickMatch} disabled={matching}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
                {matching ? "FINDING OPPONENT…" : user ? "RANKED MATCH ⚔️" : "QUICK MATCH ⚔️"}
              </button>

              {user && (
                <button onClick={quickMatch} disabled={matching}
                  className="w-full rounded-2xl py-3 font-body active:scale-[0.98] transition-transform disabled:opacity-60"
                  style={{ background: "#12121e", color: "#8888aa", fontSize: 14, border: "1px solid rgba(255,255,255,0.08)" }}>
                  Practice (unranked Quick Match)
                </button>
              )}

              <button onClick={challengeFriend} disabled={creatingChallenge}
                className="w-full rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", fontSize: 18, border: "1px solid rgba(34,211,238,0.35)" }}>
                {creatingChallenge ? "CREATING…" : challengeCode ? `🔗 LINK SHARED · CODE ${challengeCode}` : "🔗 CHALLENGE A FRIEND"}
              </button>

              {team.swapAvailable && (
                <Link href="/draft/swap"
                  className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
                  style={{ background: "rgba(255,184,0,0.12)", color: "#ffb800", fontSize: 22, border: "1px solid rgba(255,184,0,0.4)" }}>
                  ⬆ SWAP ONE PLAYER (you earned it)
                </Link>
              )}

              <button onClick={() => router.push("/draft")}
                className="w-full rounded-2xl py-3 font-body active:scale-[0.98] transition-transform"
                style={{ background: "#12121e", color: "#8888aa", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)" }}>
                Start a fresh team
              </button>
            </>
          )}

          {/* Leaderboard is always reachable. */}
          <Link href="/draft/leaderboard"
            className="block w-full rounded-2xl py-3 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "rgba(0,255,135,0.08)", color: "#00ff87", fontSize: 18, border: "1px solid rgba(0,255,135,0.25)" }}>
            🏆 LEADERBOARD
          </Link>
        </div>

        <p className="font-body text-center mt-5" style={{ color: "#8888aa", fontSize: 12 }}>
          {user
            ? "Ranked wins climb the global leaderboard. Lose and your team goes stale — rebuild to play on."
            : "Sign in to play ranked matchmaking & climb the global leaderboard."}
        </p>
      </div>
      <BottomNav />
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
