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
import { BackPill } from "@/components/ui/BackPill";
import { Button } from "@/components/ui/Button";
import {
  loadTeam, saveTeam, isComplete, recordWin, recordLoss, saveLastMatch,
  loadLastMatch, settleLocalPens,
  compatibleFormations, reslot, seasonSeed, loadLastSeason, type LocalTeam,
} from "@/lib/draft/local";
import { asLeague } from "@/lib/draft/types";
import type { Formation } from "@/lib/draft/types";
import { makeOpponent } from "@/lib/draft/opponent";
import { tierFor } from "@/lib/draft/score";
import { resolveMatch } from "@/lib/draft/live-score";
import { tierColor, TIER_TAGLINE, strengthPct } from "@/lib/draft/ui";
import { preSeasonOdds } from "@/lib/draft/season";
import { leagueOpponents, ensurePool, isPoolReady } from "@/lib/draft/pool";
import { useUser } from "@/hooks/useUser";
import { trackGamePlay } from "@/lib/analytics/trackGame";

export default function TeamScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useUser();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  // Player pool (~2.6MB) loads on demand; the odds/sim below need it.
  const [poolReady, setPoolReady] = useState(isPoolReady());
  useEffect(() => { let off = false; ensurePool().then(() => { if (!off) setPoolReady(true); }).catch(() => {}); return () => { off = true; }; }, []);
  const [matching, setMatching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [naming, setNaming] = useState(false);
  const [teamName, setTeamName] = useState("");

  // Wait for auth to resolve so we always show the right team for the right account.
  //
  // Logic:
  //   Anonymous → localStorage only (as always).
  //   Signed in, localStorage is stamped to a DIFFERENT user → load from server.
  //     This is the cross-account stale-data case: User A played (userId stamped),
  //     User B signs in — we fetch User B's server team instead of showing User A's.
  //   Signed in, no explicit mismatch → trust localStorage.
  //     Covers: fresh draft just built (no userId), same user's saved team, legacy data.
  //     We never overwrite a freshly-drafted XI with an older server copy.
  //   Signed in, localStorage empty → load from server (new device / cleared storage).
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Anonymous flow — localStorage only.
      const t = loadTeam();
      if (!t) { router.replace("/38-0"); return; }
      if (!isComplete(t)) { router.replace("/38-0/play"); return; }
      setTeam(t);
      return;
    }

    const localTeam = loadTeam();

    // Explicit cross-account mismatch: localStorage belongs to a different user.
    // Load the correct team from the server.
    if (localTeam && localTeam.userId && localTeam.userId !== user.id) {
      fetchServerTeam(user.id);
      return;
    }

    // No mismatch — trust localStorage if it's a complete team.
    if (localTeam && isComplete(localTeam)) {
      setTeam(localTeam);
      return;
    }

    // No local team (clean browser / new device) — load from server.
    fetchServerTeam(user.id);

    function fetchServerTeam(uid: string) {
      fetch("/api/draft/team")
        .then((r) => r.json())
        .then((data: { team: { formation: string; squad: unknown; strength_rating: number; projected: unknown; competition: string; status: string; win_streak: number | null } | null }) => {
          if (!data.team) { router.replace("/38-0"); return; }
          const hydrated: LocalTeam = {
            league: asLeague(data.team.competition),
            formation: data.team.formation as LocalTeam["formation"],
            mode: "classic",
            squad: data.team.squad as LocalTeam["squad"],
            status: (data.team.status as LocalTeam["status"]) ?? "active",
            winStreak: data.team.win_streak ?? 0,
            swapAvailable: false,
            strength: data.team.strength_rating,
            projected: data.team.projected as LocalTeam["projected"],
            updatedAt: Date.now(),
            userId: uid, // stamp so future visits recognise this as their team
          };
          saveTeam(hydrated);
          setTeam(hydrated);
        })
        .catch(() => {
          // Network failure — if there's any local team use it as a fallback rather
          // than losing the user's work. If nothing, redirect to draft.
          const t = loadTeam();
          if (t && isComplete(t)) { setTeam(t); return; }
          router.replace("/38-0");
        });
    }
  }, [user, authLoading, router]);

  function quickMatch() {
    if (!team || matching) return;
    setMatching(true);
    trackGamePlay("38-0", { mode: "quick_match" });
    // An abandoned shootout settles (seeded) before a new match can start, so
    // quitting mid-pens never preserves a streak a loss would have ended.
    let cur = team;
    const prev = loadLastMatch();
    if (prev?.pensPending?.mode === "local") {
      const settled = settleLocalPens(prev);
      saveLastMatch(settled);
      cur = settled.outcome === "you" ? recordWin(cur) : recordLoss(cur);
    }
    let matchId = `local-${cur.updatedAt}-${Math.floor(Math.random() * 1e6)}`;
    const opp = makeOpponent(cur.formation, cur.strength, Math.random, cur.league);
    // Real scoreline via the shared, seeded engine (your attack vs their defence).
    let res = resolveMatch(cur.squad, opp.team.squad, matchId, { allowDraw: true });
    // Dev-only: force a drawn 90' (to reach the shootout) by searching seeds —
    // results are seeded by matchId, so the engine itself is never hooked.
    if (process.env.NODE_ENV === "development" && localStorage.getItem("draftxi:forcedraw") === "1") {
      for (let i = 0; i < 400 && res.outcome !== "draw"; i++) {
        matchId = `local-${cur.updatedAt}-f${i}`;
        res = resolveMatch(cur.squad, opp.team.squad, matchId, { allowDraw: true });
      }
    }

    saveLastMatch({
      id: matchId,
      you: { name: "You", formation: cur.formation, squad: cur.squad, strength: cur.strength, projected: cur.projected },
      opp: { name: opp.name, formation: opp.team.formation, squad: opp.team.squad, strength: opp.team.strength, projected: opp.team.projected },
      outcome: res.outcome === "A" ? "you" : res.outcome === "B" ? "opp" : "draw",
      goals: { you: res.goals.a, opp: res.goals.b },
      pens: res.pens ? { you: res.pens.a, opp: res.pens.b } : null,
      report: res.report,
      sim: res.sim,
      playedAt: Date.now(),
      // A level 90' now goes to a shootout the user takes themselves — the streak
      // and outcome are settled on the pens screen, not here.
      pensPending: res.outcome === "draw" ? { mode: "local", seed: `${matchId}:pens`, shots: [], powers: [], dives: [] } : undefined,
    });

    if (res.outcome !== "draw") {
      saveTeam(res.outcome === "A" ? recordWin(cur) : recordLoss(cur));
    } else {
      saveTeam(cur); // streak settles on the pens screen
    }
    // Watch the match play out, then hand off to pens (if drawn) or the result screen.
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
        body: JSON.stringify({ formation: team.formation, squad, competition: team.league }),
      });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save team"); setMatching(false); return; }
      // Stamp userId so this device knows the localStorage team belongs to this
      // account — prevents it from showing to a different user who signs in later.
      saveTeam({ ...team, userId: user.id });
      router.push(`/38-0/live?competition=${team.league}`);
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
      const r = await fetch("/api/draft/teams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, formation: team.formation, squad, competition: team.league }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not save"); setSaving(false); return; }
      // …and set it as the active team so it's immediately playable.
      await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad, competition: team.league }) }).catch(() => {});
      // Stamp userId so future visits to the team page recognise this as their team.
      if (user) saveTeam({ ...team, userId: user.id });
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

  if (!team || !team.projected || !poolReady) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8a948f" }}>Loading…</div>;
  }

  // One FIFA-league-relative projection drives the banner, the odds card and the
  // simulation (they used to disagree).
  const odds = preSeasonOdds(team.squad, team.strength, leagueOpponents(team.league));
  const tier = tierFor(odds.expectedPoints);
  const tc = tierColor(tier);
  // The last simulated season for THIS exact XI (so returning shows the result).
  const lastSeason = loadLastSeason();
  const hasLastSeason = !!lastSeason && lastSeason.seed === seasonSeed(team);

  // Bookies' pre-season odds card. Sits above the pitch pre-sim; once a season has
  // been simulated the actual result owns the top, so the projection drops to the bottom.
  const oddsBands: [string, number, string][] = [
    ["Win the league", odds.winLeague, "#ffb800"],
    ["Top 4", odds.top4, "#aeea00"],
    ["Top 6", odds.top6, "#aeea00"],
    ["Top 10", odds.top10, "#aeea00"],
    ["Relegation", odds.relegation, "#ff4757"],
  ];
  const oddsCard = (
    <div className="rounded-3xl p-5" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>PRE-SEASON ODDS</span>
        <span className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>What the bookies make of your XI</span>
      </div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>PROJECTED FINISH</div>
          <div className="font-display tracking-wide" style={{ fontSize: 40, color: "#fff", lineHeight: 1 }}>{ordinal(odds.projectedFinish)}</div>
        </div>
        <div className="text-right">
          <div className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>EXPECTED POINTS</div>
          <div className="font-display" style={{ fontSize: 40, color: "#aeea00", lineHeight: 1 }}>{odds.expectedPoints}</div>
        </div>
      </div>
      <div className="space-y-2">
        {oddsBands.map(([label, val, color]) => (
          <div key={label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-body" style={{ fontSize: 12, color: "#c4ccc6" }}>{label}</span>
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
          <BackPill href="/38-0" label="Draft XI" tone="draft" />
          <div className="flex items-center gap-2">
            {team.mode === "expert" && (
              <span className="font-body text-xs px-2.5 py-1 rounded-full" style={{ color: "#ffb800", background: "rgba(255,184,0,0.12)" }}>
                🔒 EXPERT
              </span>
            )}
            <span
              className="font-body text-xs px-2.5 py-1 rounded-full"
              style={{ color: "#aeea00", background: "rgba(174,234,0,0.12)" }}
            >
              ● AVAILABLE
            </span>
          </div>
        </div>

        {/* primary actions:
              auth loading  → nothing (prevents anon gate flashing for signed-in users)
              signed in     → full action grid
              confirmed anon → sign-up gate  */}
        {authLoading ? null : user ? (
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <button onClick={goLive} disabled={matching}
              className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform disabled:opacity-60"
              style={{ background: "#aeea00", color: "#062013", fontSize: 16 }}>
              ⚡ Go Head-to-Head
            </button>
            <button onClick={() => router.push("/38-0/leagues")}
              className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform"
              style={{ background: "rgba(174,234,0,0.12)", color: "#aeea00", fontSize: 16, border: "1px solid rgba(174,234,0,0.4)" }}>
              🏆 Build a League
            </button>
            <Link href="/38-0/leaderboard"
              className="rounded-2xl py-3.5 px-3 text-center font-display tracking-wide active:scale-[0.97] transition-transform"
              style={{ background: "rgba(174,234,0,0.1)", color: "#aeea00", fontSize: 16, border: "1px solid rgba(174,234,0,0.3)" }}>
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
        ) : (
          /* Confirmed anonymous (auth resolved, no session) — sign-up gate */
          <Link
            href="/auth/sign-in"
            className="flex items-center justify-between w-full mb-4 rounded-2xl p-4 active:scale-[0.98] transition-transform"
            style={{ background: "rgba(0,201,255,0.06)", border: "1px solid rgba(0,201,255,0.25)" }}
          >
            <div>
              <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#fff" }}>WANT TO KEEP PLAYING?</div>
              <div className="font-body mt-0.5" style={{ fontSize: 13, color: "#8a948f" }}>Sign up to go H2H, save this team &amp; climb the board</div>
            </div>
            <div className="font-display" style={{ fontSize: 26, color: "#00c9ff" }}>→</div>
          </Link>
        )}

        {/* name-this-team panel — revealed by Save Team */}
        {naming && (
          <div className="rounded-2xl p-3 mb-4" style={{ background: "#0e1611", border: "1px solid rgba(255,184,0,0.35)" }}>
            <div className="font-body mb-2" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>NAME THIS TEAM</div>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={40} autoFocus
              placeholder="e.g. My dream XI"
              className="w-full rounded-xl px-3 py-3 font-body mb-2" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" tone="lime" size="md" fullWidth onClick={saveToLibrary} disabled={saving}>
                {saving ? "SAVING…" : "SAVE TO MY TEAMS"}
              </Button>
              <Button variant="ghost" size="md" fullWidth onClick={() => setNaming(false)} disabled={saving}>
                Cancel
              </Button>
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
            ? sr.verdict === "OVERPERFORMED" ? "#aeea00" : sr.verdict === "UNDERPERFORMED" ? "#ff4757" : "#8a948f"
            : "#8a948f";
          return (
            <div className="rounded-3xl p-5 mb-4" style={{ background: `linear-gradient(135deg, ${tc}22, #0e1611)`, border: `1px solid ${tc}55` }}>
              <div className="flex items-center justify-between">
                <div className="font-display tracking-wide leading-none" style={{ fontSize: 40, color: tc }}>{tier}</div>
                {sr && <span className="font-body px-2.5 py-1 rounded-full" style={{ fontSize: 11, color: verdictColor, background: `${verdictColor}1f`, letterSpacing: 1 }}>SEASON DONE · {sr.verdict}</span>}
              </div>
              <div className="font-body mt-1" style={{ fontSize: 13, color: "#c4ccc6" }}>{TIER_TAGLINE[tier]}</div>

              <div className="flex items-end justify-between mt-4">
                <div>
                  <div className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>{sr ? "FINISHED" : "PROJECTED FINISH"}</div>
                  <div className="font-display tracking-wide" style={{ fontSize: 30, color: "#fff" }}>
                    {ordinal(sr ? sr.position : odds.projectedFinish)}
                  </div>
                  <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>
                    {sr ? `${sr.points} pts · ${sr.wins}W ${sr.draws}D ${sr.losses}L` : `${odds.expectedPoints} pts expected`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>STRENGTH</div>
                  <div className="font-display" style={{ fontSize: 48, color: tc, lineHeight: 1 }}>{team.strength}</div>
                </div>
              </div>

              {sr ? (
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {([["PTS", sr.points, "#fff"], ["W", sr.wins, "#aeea00"], ["GF", sr.gf, "#aeea00"], ["GA", sr.ga, "#ff4757"]] as [string, number, string][]).map(([k, v, c]) => (
                    <div key={k} className="rounded-xl py-2 text-center" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="font-display" style={{ fontSize: 22, color: c }}>{v}</div>
                      <div className="font-body" style={{ fontSize: 10, color: "#8a948f" }}>{k}</div>
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
              <span className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>SHAPE</span>
              {compat.map((f) => {
                const on = f === team.formation;
                return (
                  <button key={f} onClick={() => switchFormation(f)}
                    className="rounded-lg px-3 py-1.5 font-display tracking-wide active:scale-95 transition-all"
                    style={{ fontSize: 15, color: on ? "#062013" : "#c4ccc6", background: on ? "#aeea00" : "#0e1611", border: `1px solid ${on ? "#aeea00" : "rgba(255,255,255,0.1)"}` }}>
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

        {hasLastSeason ? (
          <Button variant="ghost" size="lg" fullWidth className="mt-4" onClick={() => router.push("/38-0/season")}>
            📊 VIEW SEASON RESULT →
          </Button>
        ) : (
          <Button variant="primary" tone="lime" size="lg" fullWidth className="mt-4" onClick={() => router.push("/38-0/season")}>
            ⚽ SIMULATE SEASON →
          </Button>
        )}

        {/* secondary — library, swap, the live-H2H explainer, practice/fresh */}
        <div className="mt-3 space-y-3">
          {/* My Teams library entry */}
          {user && (
            <Link href="/38-0/teams"
              className="flex items-center justify-between w-full rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform"
              style={{ background: "rgba(174,234,0,0.08)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.25)" }}>
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
            <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>
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
              <div key={title} className="rounded-2xl p-3" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="font-display tracking-wide" style={{ fontSize: 16, color: "#aeea00" }}>{i + 1}</span>
                <div className="font-display tracking-wide mt-1.5" style={{ fontSize: 16, color: "#fff", lineHeight: 1.1 }}>{title}</div>
                <div className="font-body mt-1" style={{ fontSize: 12.5, color: "#8a948f", lineHeight: 1.3 }}>{desc}</div>
              </div>
            ))}
          </div>

        </div>

        {/* Projected finish drops to the bottom once a season has been simulated */}
        {hasLastSeason && <div className="mt-5">{oddsCard}</div>}

        <p className="font-body text-center mt-5" style={{ color: "#8a948f", fontSize: 12 }}>
          {user
            ? "Live H2H wins climb the global leaderboard. Tweak your XI, then go again."
            : "Sign in to play live head-to-head & climb the global leaderboard."}
        </p>

        {/* Practice vs CPU / fresh team — sits right at the bottom of the page */}
        {user ? (
          <Button variant="ghost" size="md" fullWidth className="mt-4" onClick={quickMatch} disabled={matching}>
            Practice vs CPU
          </Button>
        ) : (
          <Button variant="ghost" size="md" fullWidth className="mt-4" onClick={() => router.push("/38-0")}>
            Fresh team
          </Button>
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
