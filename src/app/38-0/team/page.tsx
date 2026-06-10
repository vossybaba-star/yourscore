"use client";

/**
 * /38-0/team — your current XI: Strength, projected 38-game record, tier, status,
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
  loadTeam, saveTeam, isComplete, recordWin, recordLoss, recordDraw, saveLastMatch,
  compatibleFormations, reslot, seasonSeed, loadLastSeason, type LocalTeam,
} from "@/lib/draft/local";
import type { Formation } from "@/lib/draft/types";
import { makeOpponent } from "@/lib/draft/opponent";
import { tierFor } from "@/lib/draft/score";
import { resolveMatch } from "@/lib/draft/live-score";
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [naming, setNaming] = useState(false);
  const [teamName, setTeamName] = useState("");

  useEffect(() => {
    const t = loadTeam();
    if (!t) { router.replace("/38-0"); return; }
    if (!isComplete(t)) { router.replace("/38-0/play"); return; }
    setTeam(t);
  }, [router]);

  function quickMatch() {
    if (!team || matching) return;
    setMatching(true);
    const matchId = `local-${team.updatedAt}-${Math.floor(Math.random() * 1e6)}`;
    const opp = makeOpponent(team.formation, team.strength);
    // Real scoreline via the shared, seeded engine (your attack vs their defence).
    const res = resolveMatch(team.squad, opp.team.squad, matchId, { allowDraw: true });

    saveLastMatch({
      id: matchId,
      you: { name: "You", formation: team.formation, squad: team.squad, strength: team.strength, projected: team.projected },
      opp: { name: opp.name, formation: opp.team.formation, squad: opp.team.squad, strength: opp.team.strength, projected: opp.team.projected },
      outcome: res.outcome === "A" ? "you" : res.outcome === "B" ? "opp" : "draw",
      goals: { you: res.goals.a, opp: res.goals.b },
      pens: res.pens ? { you: res.pens.a, opp: res.pens.b } : null,
      report: res.report,
      sim: res.sim,
      playedAt: Date.now(),
    });

    const next = res.outcome === "A" ? recordWin(team) : res.outcome === "B" ? recordLoss(team) : recordDraw(team);
    saveTeam(next);
    // Watch the match play out, then hand off to the result screen.
    setTimeout(() => router.push("/38-0/match/watch"), 300);
  }

  // Ranked: save the XI to the cloud (server recomputes Strength), matchmake against
  // a real active opponent (bot fallback), then go to the pre-match preview where you
  // see their XI and can swap up to 3 before kick-off. Resolution happens there.
  // Go live: persist the XI to the cloud (matchmaking reads the saved draft_teams
  // row), then hand off to the live H2H entry to find/queue an opponent.
  async function goLive() {
    if (!team || matching) return;
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
      router.push("/38-0/live");
    } catch {
      setErr("Network error — try again");
      setMatching(false);
    }
  }

  // Save the XI to your library (My Teams) under a name. Guests are sent to sign up
  // first. Tapping Save reveals a name field; confirming saves to the library AND
  // sets it as your active team so it's immediately playable.
  function beginSave() {
    if (!team) return;
    if (!user) { router.push("/auth/sign-in"); return; }
    setTeamName(`${team.formation} · ${team.strength}`);
    setNaming(true);
  }

  async function saveToLibrary() {
    if (!team || saving) return;
    setSaving(true); setErr(null);
    try {
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const name = teamName.trim() || `${team.formation} · ${team.strength}`;
      // Save the named snapshot to the library…
      const r = await fetch("/api/draft/teams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, formation: team.formation, squad }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not save"); setSaving(false); return; }
      // …and set it as the active team so it's immediately playable.
      await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad }) }).catch(() => {});
      setSaved(true); setSaving(false); setNaming(false);
    } catch { setErr("Network error"); setSaving(false); }
  }

  // Re-shape the same XI into a compatible formation before playing others.
  function switchFormation(f: Formation) {
    if (!team || f === team.formation) return;
    const next = reslot(team, f);
    saveTeam(next);
    setTeam(next);
  }

  if (!team || !team.projected) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  // One FIFA-league-relative projection drives the banner, the odds card and the
  // simulation (they used to disagree).
  const odds = preSeasonOdds(team.squad, team.strength, leagueOpponents());
  const tier = tierFor(odds.expectedPoints);
  const tc = tierColor(tier);
  // The last simulated season for THIS exact XI (so returning shows the result).
  const lastSeason = loadLastSeason();
  const hasLastSeason = !!lastSeason && lastSeason.seed === seasonSeed(team);

  // Bookies' pre-season odds card. Sits above the pitch pre-sim; once a season has
  // been simulated the actual result owns the top, so the projection drops to the bottom.
  const oddsBands: [string, number, string][] = [
    ["Win the league", odds.winLeague, "#ffb800"],
    ["Top 4", odds.top4, "#00ff87"],
    ["Top 6", odds.top6, "#22d3ee"],
    ["Top 10", odds.top10, "#a78bfa"],
    ["Relegation", odds.relegation, "#ff4757"],
  ];
  const oddsCard = (
    <div className="rounded-3xl p-5" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
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
        {oddsBands.map(([label, val, color]) => (
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

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-2">
          <Link href="/38-0" className="font-body text-sm" style={{ color: "#8888aa" }}>← Draft XI</Link>
          <div className="flex items-center gap-2">
            {team.mode === "expert" && (
              <span className="font-body text-xs px-2.5 py-1 rounded-full" style={{ color: "#ffb800", background: "rgba(255,184,0,0.12)" }}>
                🔒 EXPERT
              </span>
            )}
            <span
              className="font-body text-xs px-2.5 py-1 rounded-full"
              style={{ color: "#00ff87", background: "rgba(0,255,135,0.12)" }}
            >
              ● AVAILABLE
            </span>
          </div>
        </div>

        {/* primary actions — two-wide grid, the single set of top-level actions */}
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <button onClick={user ? goLive : quickMatch} disabled={matching}
            className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform disabled:opacity-60"
            style={{ background: "#00ff87", color: "#062013", fontSize: 16 }}>
            ⚡ Go Head-to-Head
          </button>
          <button onClick={() => router.push(user ? "/38-0/leagues" : "/auth/sign-in")}
            className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform"
            style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", fontSize: 16, border: "1px solid rgba(167,139,250,0.4)" }}>
            🏆 Build a League
          </button>
          <Link href="/38-0/leaderboard"
            className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform"
            style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", fontSize: 16, border: "1px solid rgba(0,255,135,0.3)" }}>
            🥇 Leaderboard
          </Link>
          <Link href="/38-0/history"
            className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform"
            style={{ background: "rgba(255,184,0,0.1)", color: "#ffb800", fontSize: 16, border: "1px solid rgba(255,184,0,0.3)" }}>
            📋 My History
          </Link>
          <button onClick={beginSave} disabled={saving}
            className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform disabled:opacity-70"
            style={{ background: "rgba(255,184,0,0.12)", color: "#ffb800", fontSize: 16, border: "1px solid rgba(255,184,0,0.4)" }}>
            💾 {saved ? "Saved ✓" : "Save Team"}
          </button>
        </div>

        {/* name-this-team panel — revealed by Save Team */}
        {naming && (
          <div className="rounded-2xl p-3 mb-4" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.35)" }}>
            <div className="font-body mb-2" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>NAME THIS TEAM</div>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={40} autoFocus
              placeholder="e.g. My dream XI"
              className="w-full rounded-xl px-3 py-3 font-body mb-2" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }} />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={saveToLibrary} disabled={saving}
                className="rounded-xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-70"
                style={{ background: "#ffb800", color: "#241a00", fontSize: 16 }}>
                {saving ? "SAVING…" : "SAVE TO MY TEAMS"}
              </button>
              <button onClick={() => setNaming(false)} disabled={saving}
                className="rounded-xl py-3 font-body active:scale-[0.98] transition-transform" style={{ background: "transparent", color: "#8888aa", fontSize: 14, border: "1px solid rgba(255,255,255,0.1)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {err && (
          <div className="rounded-xl px-4 py-2 mb-4 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>
            {err}
          </div>
        )}

        {/* tier banner — shows the ACTUAL season result once simulated, else the projection */}
        {(() => {
          const sr = hasLastSeason && lastSeason ? lastSeason.result : null;
          const verdictColor = sr
            ? sr.verdict === "OVERPERFORMED" ? "#00ff87" : sr.verdict === "UNDERPERFORMED" ? "#ff4757" : "#8888aa"
            : "#8888aa";
          return (
            <div className="rounded-3xl p-5 mb-4" style={{ background: `linear-gradient(135deg, ${tc}22, #0f0f17)`, border: `1px solid ${tc}55` }}>
              <div className="flex items-center justify-between">
                <div className="font-display tracking-wide leading-none" style={{ fontSize: 40, color: tc }}>{tier}</div>
                {sr && <span className="font-body px-2.5 py-1 rounded-full" style={{ fontSize: 11, color: verdictColor, background: `${verdictColor}1f`, letterSpacing: 1 }}>SEASON DONE · {sr.verdict}</span>}
              </div>
              <div className="font-body mt-1" style={{ fontSize: 13, color: "#cfcfe6" }}>{TIER_TAGLINE[tier]}</div>

              <div className="flex items-end justify-between mt-4">
                <div>
                  <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>{sr ? "FINISHED" : "PROJECTED FINISH"}</div>
                  <div className="font-display tracking-wide" style={{ fontSize: 30, color: "#fff" }}>
                    {ordinal(sr ? sr.position : odds.projectedFinish)}
                  </div>
                  <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>
                    {sr ? `${sr.points} pts · ${sr.wins}W ${sr.draws}D ${sr.losses}L` : `${odds.expectedPoints} pts expected`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>STRENGTH</div>
                  <div className="font-display" style={{ fontSize: 48, color: tc, lineHeight: 1 }}>{team.strength}</div>
                </div>
              </div>

              {sr ? (
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {([["PTS", sr.points, "#fff"], ["W", sr.wins, "#00ff87"], ["GF", sr.gf, "#22d3ee"], ["GA", sr.ga, "#ff4757"]] as [string, number, string][]).map(([k, v, c]) => (
                    <div key={k} className="rounded-xl py-2 text-center" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="font-display" style={{ fontSize: 22, color: c }}>{v}</div>
                      <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>{k}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div className="h-full rounded-full" style={{ width: `${strengthPct(team.strength)}%`, background: tc }} />
                </div>
              )}
            </div>
          );
        })()}

        {team.winStreak > 0 && (
          <div className="text-center mb-4 font-display tracking-wide" style={{ fontSize: 18, color: "#ffb800" }}>
            🔥 {team.winStreak} WIN STREAK
          </div>
        )}

        {/* Formation switcher — reshape your XI before facing others (same lines) */}
        {(() => {
          const compat = compatibleFormations(team.formation);
          if (compat.length < 2) return null;
          return (
            <div className="flex items-center gap-2 mb-3">
              <span className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>SHAPE</span>
              {compat.map((f) => {
                const on = f === team.formation;
                return (
                  <button key={f} onClick={() => switchFormation(f)}
                    className="rounded-lg px-3 py-1.5 font-display tracking-wide active:scale-95 transition-all"
                    style={{ fontSize: 15, color: on ? "#062013" : "#cfcfe6", background: on ? "#00ff87" : "#12121e", border: `1px solid ${on ? "#00ff87" : "rgba(255,255,255,0.1)"}` }}>
                    {f}
                  </button>
                );
              })}
            </div>
          );
        })()}

        <Pitch formation={team.formation} squad={team.squad} compact />

        {/* Pre-season odds — sits here until a season is simulated, then moves to the bottom */}
        {!hasLastSeason && <div className="mt-5">{oddsCard}</div>}

        <button onClick={() => router.push("/38-0/season")}
          className="w-full mt-4 rounded-2xl py-5 font-display tracking-wide active:scale-[0.98] transition-transform"
          style={{ background: hasLastSeason ? "rgba(0,255,135,0.12)" : "#00ff87", color: hasLastSeason ? "#00ff87" : "#062013", fontSize: hasLastSeason ? 22 : 28, border: hasLastSeason ? "1px solid rgba(0,255,135,0.4)" : "none" }}>
          {hasLastSeason ? "📊 VIEW SEASON RESULT →" : "⚽ SIMULATE SEASON →"}
        </button>

        {/* secondary — library, swap, the live-H2H explainer, practice/fresh */}
        <div className="mt-3 space-y-3">
          {/* My Teams library entry */}
          {user && (
            <Link href="/38-0/teams"
              className="flex items-center justify-between w-full rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform"
              style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" }}>
              <span className="font-display tracking-wide" style={{ fontSize: 16 }}>{saved ? "📁 MY TEAMS ✓ saved" : "📁 MY TEAMS"}</span>
              <span className="font-display" style={{ fontSize: 18 }}>→</span>
            </Link>
          )}

          {team.swapAvailable && (
            <Link href="/38-0/swap"
              className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "rgba(255,184,0,0.12)", color: "#ffb800", fontSize: 22, border: "1px solid rgba(255,184,0,0.4)" }}>
              ⬆ SWAP ONE PLAYER (you earned it)
            </Link>
          )}

          {/* How live head-to-head works — context for the Go Head-to-Head action above */}
          <div className="pt-2">
            <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
              HOW LIVE H2H WORKS
            </div>
            <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>
              Your XI is built — now take it online and beat other managers.
            </div>
          </div>

          {/* 3 steps, left to right (live two-half H2H) */}
          <div className="grid grid-cols-3 gap-2">
            {([
              ["KICK OFF LIVE", "Matched with a live manager — see their XI"],
              ["TWO HALVES", "Swap before kick-off & at the break to outscore them"],
              ["AGGREGATE WINS", "Goals over 90 decide it · climb the board"],
            ] as [string, string][]).map(([title, desc], i) => (
              <div key={title} className="rounded-2xl p-3" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="font-display tracking-wide" style={{ fontSize: 16, color: "#00ff87" }}>{i + 1}</span>
                <div className="font-display tracking-wide mt-1.5" style={{ fontSize: 16, color: "#fff", lineHeight: 1.1 }}>{title}</div>
                <div className="font-body mt-1" style={{ fontSize: 12.5, color: "#8888aa", lineHeight: 1.3 }}>{desc}</div>
              </div>
            ))}
          </div>

        </div>

        {/* Projected finish drops to the bottom once a season has been simulated */}
        {hasLastSeason && <div className="mt-5">{oddsCard}</div>}

        <p className="font-body text-center mt-5" style={{ color: "#8888aa", fontSize: 12 }}>
          {user
            ? "Live H2H wins climb the global leaderboard. Tweak your XI, then go again."
            : "Sign in to play live head-to-head & climb the global leaderboard."}
        </p>

        {/* Practice vs CPU / fresh team — sits right at the bottom of the page */}
        {user ? (
          <button onClick={quickMatch} disabled={matching}
            className="w-full mt-4 rounded-2xl py-3 font-body active:scale-[0.98] transition-transform disabled:opacity-60"
            style={{ background: "#12121e", color: "#8888aa", fontSize: 14, border: "1px solid rgba(255,255,255,0.08)" }}>
            Practice vs CPU
          </button>
        ) : (
          <button onClick={() => router.push("/38-0")}
            className="w-full mt-4 rounded-2xl py-3 font-body active:scale-[0.98] transition-transform"
            style={{ background: "#12121e", color: "#8888aa", fontSize: 14, border: "1px solid rgba(255,255,255,0.08)" }}>
            Fresh team
          </button>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
