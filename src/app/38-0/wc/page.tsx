"use client";

/**
 * /38-0/wc — World Cup Run. Two modes:
 *   "nation" — pick a nation, draft a NATION-LOCKED XI, play that nation's real WC path.
 *   "world"  — open draft: build an XI from ANY WC 2026 nation's players, play a gauntlet.
 *
 * The chosen XI is POSTed to /api/draft/wc (start) which validates + plans the bracket and
 * returns a run id; we then go to the Road-to-the-Final screen. Server is authoritative.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { useUser } from "@/hooks/useUser";
import { pickableNations, spinForNation, spinWorld, type PickableNation } from "@/lib/draft/pool";
import { WORLD_TEAM_NAME, type RunMode } from "@/lib/draft/wc";
import { wcNation } from "@/data/draft/wc2026";
import {
  emptyTeam, openSlots, isComplete, usedPlayerIds, usedPlayerNames, placePlayer, hydrateSavedTeam, type LocalTeam,
} from "@/lib/draft/local";
import { slotsFor } from "@/lib/draft/formations";
import { canPlay, lineRatings, posCategory, CATEGORY_COLOR } from "@/lib/draft/score";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { Formation, PlacedPlayer, PlayerSeason, Slot } from "@/lib/draft/types";
import { trackGamePlay } from "@/lib/analytics/trackGame";

const FORMATION = "4-3-3" as Formation; // sensible default; nation pools are deepest here
const SIGN_IN_PATH = "/38-0/wc";

// Persist an in-progress pick across a sign-in round-trip, so a signed-out player who
// drafts an XI lands back on the exact same team after authenticating.
type SavedDraft = { mode: RunMode; nation: string | null; formation: Formation; squad: PlacedPlayer[]; pendingEnter: boolean };
const DRAFT_KEY = "wc:draft:v1";
function saveDraft(d: SavedDraft) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ } }
function loadDraft(): SavedDraft | null { try { const r = localStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) as SavedDraft : null; } catch { return null; } }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

export default function WorldCupEntry() {
  const router = useRouter();
  const nations = useMemo(() => pickableNations(), []);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [nation, setNation] = useState<PickableNation | null>(null);
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [slate, setSlate] = useState<PlayerSeason[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlayerSeason | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const world = mode === "world";

  function chooseMode(m: RunMode) {
    setMode(m);
    setNation(null); setSlate(null); setSelected(null); setReel(null);
    // World mode has no nation gate — go straight to the open draft.
    setTeam(m === "world" ? emptyTeam(FORMATION) : null);
  }

  function chooseNation(n: PickableNation) {
    setNation(n);
    setTeam(emptyTeam(FORMATION));
    setSlate(null); setSelected(null); setReel(null);
  }

  function doSpin() {
    if (!team || spinning || (mode === "nation" && !nation)) return;
    setSpinning(true); setSlate(null); setSelected(null);
    const open = openSlots(team).map((s) => s.pos);
    // Pure luck of the spin — any rating can come up, from the very first pick.
    const pool = world
      ? spinWorld(open, usedPlayerIds(team), usedPlayerNames(team), { count: 6 })
      : spinForNation(nation!.nation, open, usedPlayerIds(team), usedPlayerNames(team), { count: 6 });
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      setReel(pool.length ? pool[Math.floor(Math.random() * pool.length)].name : "—");
      if (++ticks > 11) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        setReel(null);
        setSlate(pool);
        setSpinning(false);
      }
    }, 70);
  }

  function placeAt(slot: Slot) {
    if (!team || !selected) return;
    const next = placePlayer(team, selected, slot);
    setTeam(next); setSlate(null); setSelected(null);
  }

  const { user, loading: authLoading } = useUser();

  // Submit a finished XI. If the player isn't signed in, save the pick and send them
  // to sign-in with a return path; we resume automatically when they come back.
  async function enter(runMode: RunMode, nationName: string, formation: Formation, squad: PlacedPlayer[]) {
    setStarting(true); setError(null);
    try {
      const res = await fetch("/api/draft/wc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", mode: runMode, nation: nationName, formation, squad }),
      });
      if (res.status === 401) {
        saveDraft({ mode: runMode, nation: runMode === "world" ? null : nationName, formation, squad, pendingEnter: true });
        router.push(`/auth/sign-in?next=${encodeURIComponent(SIGN_IN_PATH)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not start"); setStarting(false); return; }
      clearDraft();
      trackGamePlay("38-0", { mode: runMode === "world" ? "world_cup_open" : "world_cup_run" });
      router.push(`/38-0/wc/run/${data.runId}`);
    } catch {
      setError("Network error — try again."); setStarting(false);
    }
  }

  function start() {
    if (!team || !mode || !isComplete(team) || starting) return;
    if (mode === "nation" && !nation) return;
    enter(mode, mode === "world" ? WORLD_TEAM_NAME : nation!.nation, team.formation, team.squad);
  }

  // On load: (1) restore a saved draft; (2) auto-select nation from ?nation= query param;
  // (3) if the player was mid-"enter" and is now signed in, resume automatically.
  useEffect(() => {
    if (authLoading) return;
    const d = loadDraft();
    if (d) {
      if (!mode) {
        setMode(d.mode);
        if (d.mode === "world") {
          setTeam(hydrateSavedTeam(d.formation, d.squad));
        } else {
          const n = nations.find((x) => x.nation === d.nation);
          if (n) { setNation(n); setTeam(hydrateSavedTeam(d.formation, d.squad)); }
        }
      }
      if (d.pendingEnter && user) {
        saveDraft({ ...d, pendingEnter: false });
        enter(d.mode, d.mode === "world" ? WORLD_TEAM_NAME : (d.nation ?? ""), d.formation, d.squad);
      }
      return;
    }
    // No saved draft — honour deep-link params set by the main 38-0 page tab:
    //   ?mode=world → open draft (any nation); ?nation=X → nation-locked draft.
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "world" && !mode) { chooseMode("world"); return; }
    const nationParam = params.get("nation");
    if (nationParam && !mode) {
      const n = nations.find((x) => x.nation === nationParam);
      if (n) { setMode("nation"); chooseNation(n); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, nations]);

  // ── Mode picker ───────────────────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
        <div className="max-w-lg mx-auto px-4 pt-safe">
          <div className="pt-4"><Link href="/38-0" className="font-body text-sm" style={{ color: "#8888aa" }}>← Back</Link></div>
          <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 32, color: "#fff" }}>🏆 WORLD CUP RUN</h1>
          <p className="font-body mt-1 mb-4" style={{ fontSize: 14, color: "#cfcfe6" }}>
            A solo World Cup campaign. Build an XI, then play through a World Cup path — group, then knockouts — all the way to the final. Pick your mode.
          </p>

          {/* Mode cards */}
          <div className="flex flex-col gap-3 mb-5">
            <button onClick={() => chooseMode("nation")} className="text-left rounded-2xl p-4 active:scale-[0.99] transition-transform"
              style={{ background: "#12121e", border: "1px solid rgba(0,255,135,0.3)" }}>
              <div className="flex items-center gap-2.5 mb-1">
                <span style={{ fontSize: 22 }}>🏴</span>
                <span className="font-display tracking-wide" style={{ fontSize: 20, color: "#00ff87" }}>NATIONAL TEAM</span>
              </div>
              <div className="font-body" style={{ fontSize: 13, color: "#cfcfe6", lineHeight: 1.4 }}>
                Pick a nation and draft <b style={{ color: "#fff" }}>their players only</b>. Play that nation&apos;s real World Cup 2026 fixtures.
              </div>
            </button>

            <button onClick={() => chooseMode("world")} className="text-left rounded-2xl p-4 active:scale-[0.99] transition-transform"
              style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.4)" }}>
              <div className="flex items-center gap-2.5 mb-1">
                <span style={{ fontSize: 22 }}>🌍</span>
                <span className="font-display tracking-wide" style={{ fontSize: 20, color: "#ffb800" }}>WORLD CUP</span>
              </div>
              <div className="font-body" style={{ fontSize: 13, color: "#cfcfe6", lineHeight: 1.4 }}>
                Open draft — build a <b style={{ color: "#fff" }}>dream team from any nation&apos;s players</b>. Beat the best in the world to lift the trophy.
              </div>
            </button>
          </div>

          {/* How it works */}
          <div className="rounded-2xl p-4" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.3)" }}>
            <div className="font-body mb-2.5" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>HOW IT WORKS</div>
            {[
              ["①", "Build your XI", "Spin & pick — any rating can come up, luck of the draw."],
              ["②", "Play the World Cup", "A group, then the knockouts — vs real nations, tougher each round."],
              ["③", "Win to advance · free re-spins", "Survive the group, then win-or-go-home. Each round you get free re-spins."],
              ["④", "Lift the trophy 🏆", "Lose a knockout and you're out. Win the final and you're champions."],
            ].map(([n, title, desc]) => (
              <div key={n as string} className="flex gap-3 mb-2.5 last:mb-0">
                <span className="font-display flex-shrink-0" style={{ fontSize: 18, color: "#ffb800" }}>{n}</span>
                <div>
                  <div className="font-body" style={{ fontSize: 13.5, color: "#fff" }}>{title}</div>
                  <div className="font-body" style={{ fontSize: 12, color: "#8888aa", lineHeight: 1.35 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Nation picker (nation mode only) ──────────────────────────────────────
  if (mode === "nation" && (!nation || !team)) {
    return (
      <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
        <div className="max-w-lg mx-auto px-4 pt-safe">
          <div className="pt-4"><button onClick={() => setMode(null)} className="font-body text-sm" style={{ color: "#8888aa" }}>← Change mode</button></div>
          <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 28, color: "#fff" }}>PICK YOUR NATION</h1>
          <p className="font-body mt-1 mb-4" style={{ fontSize: 13, color: "#8888aa" }}>
            Build an XI from their players only and play their real World Cup 2026 path.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {nations.map((n) => (
              <button key={n.nation} onClick={() => chooseNation(n)}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left active:scale-[0.98] transition-transform"
                style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={n.crest} alt={n.nation} width={34} height={34} style={{ width: 34, height: 34, objectFit: "contain" }} />
                <div className="min-w-0">
                  <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>{n.nation}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!team) return null;

  // ── Draft (both modes) ────────────────────────────────────────────────────
  const teamName = world ? WORLD_TEAM_NAME : nation!.nation;
  const teamCrest = world ? null : nation!.crest;
  const accent = world ? "#ffb800" : "#00ff87";
  const remaining = 11 - team.squad.length;
  const lines = lineRatings(team.squad);
  const slots = slotsFor(team.formation);
  const filledBySlot = new Map(team.squad.map((p) => [p.slot, p]));
  const available = selected ? slots.filter((s) => !filledBySlot.has(s.id) && canPlay(selected.position, s.pos)) : [];
  const scoutLabel = world ? "🌍 SCOUT THE WORLD" : `🎰 SCOUT ${teamName.toUpperCase()}`;

  return (
    <div className="min-h-[100dvh] pb-44" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4">
          <button onClick={() => (world ? setMode(null) : setNation(null))} className="font-body text-sm" style={{ color: "#8888aa" }}>
            {world ? "← Change mode" : "← Change nation"}
          </button>
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2.5">
            {teamCrest ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={teamCrest} alt={teamName} width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: 36, lineHeight: 1 }}>🌍</span>
            )}
            <div>
              <div className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>YOUR {teamName.toUpperCase()}{world ? "" : " XI"}</div>
              <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>{team.formation}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>OVERALL</div>
            <div className="font-display" style={{ fontSize: 38, lineHeight: 1, color: "#00ff87" }}>{team.squad.length ? team.strength : "—"}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 mb-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(team.squad.length / 11) * 100}%`, background: "#00ff87" }} />
          </div>
          <span className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>{team.squad.length}/11</span>
        </div>

        <Pitch formation={team.formation} squad={team.squad} compact />

        {team.squad.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {([["ATT", lines.attack, "att"], ["MID", lines.midfield, "mid"], ["DEF", lines.defence, "def"], ["GK", lines.gk, "gk"]] as const).map(([label, val, cat]) => (
              <div key={label} className="rounded-xl px-2 py-2 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-display" style={{ fontSize: 20, color: val ? CATEGORY_COLOR[cat] : "#444" }}>{val || "—"}</div>
                <div className="font-body" style={{ fontSize: 9, color: "#8888aa", letterSpacing: 1 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
        <div className="max-w-lg mx-auto px-4 pt-3">
          {spinning && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.4)" }}>
              {teamCrest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={teamCrest} alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain", opacity: 0.85 }} />
              ) : (
                <span style={{ fontSize: 34 }}>🌍</span>
              )}
              <div className="font-display tracking-wide truncate" style={{ fontSize: 22, color: "#ffb800" }}>{reel ?? "Scouting…"}</div>
            </div>
          )}

          {selected && (
            <div className="mb-3 rounded-2xl p-3" style={{ background: "#161622", border: "1px solid rgba(0,255,135,0.3)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-body" style={{ fontSize: 14, color: "#fff" }}>Place <b style={{ color: "#00ff87" }}>{selected.name}</b></span>
                <button onClick={() => setSelected(null)} className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>Cancel</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {available.map((s) => (
                  <button key={s.id} onClick={() => placeAt(s)} className="rounded-lg px-3 py-2 font-display tracking-wide active:scale-95 transition-transform"
                    style={{ fontSize: 14, color: "#0a0a0f", background: CATEGORY_COLOR[posCategory(s.pos)] }}>{s.label}</button>
                ))}
                {available.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No open slot fits — pick another player.</span>}
              </div>
            </div>
          )}

          {slate && !spinning && !selected && (
            <div className="mb-3 rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.07)", maxHeight: 320, overflowY: "auto" }}>
              <div className="px-3 py-2 font-body sticky top-0" style={{ fontSize: 11, color: "#8888aa", background: "#0d0d14" }}>Pick a player → choose their slot</div>
              {slate.map((p) => {
                const c = CATEGORY_COLOR[posCategory(p.position)];
                const elig = slots.some((s) => !filledBySlot.has(s.id) && canPlay(p.position, s.pos));
                // World mode: show the player's nationality FLAG (any nation). Nation mode:
                // every player shares the chosen nation, so show the club badge instead.
                const flag = world && p.nationality ? wcNation(p.nationality)?.crest : null;
                const rightImg = world ? flag : getTeamBadgeUrlSync(p.club);
                return (
                  <button key={p.id} onClick={() => elig && setSelected(p)} disabled={!elig}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", opacity: elig ? 1 : 0.4 }}>
                    <div className="flex items-center justify-center rounded-lg font-display flex-shrink-0" style={{ width: 38, height: 38, fontSize: 18, color: "#0a0a0f", background: c }}>{p.overall}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>{p.name} <span style={{ color: "#8888aa", fontSize: 12 }}>{p.club} {p.season}</span></div>
                      {world && p.nationality && <div className="font-body truncate" style={{ fontSize: 11, color: "#ffb800" }}>{p.nationality}</div>}
                    </div>
                    {rightImg && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={rightImg} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
                    )}
                    <span className="rounded px-1.5 py-0.5 font-body flex-shrink-0" style={{ fontSize: 9, color: c, background: "rgba(255,255,255,0.06)" }}>{p.position}</span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <div className="mb-2 font-body text-center" style={{ fontSize: 13, color: "#ff8a3d" }}>{error}</div>}

          {remaining > 0 ? (
            !slate || spinning ? (
              <button onClick={doSpin} disabled={spinning}
                className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ background: spinning ? "#1a1a2e" : accent, color: spinning ? "#ffb800" : "#062013", fontSize: 24 }}>
                {spinning ? "SCOUTING…" : scoutLabel}
              </button>
            ) : (
              <div className="text-center font-body py-2" style={{ fontSize: 13, color: "#8888aa" }}>Draft a player to continue</div>
            )
          ) : (
            <button onClick={start} disabled={starting}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
              {starting ? "STARTING…" : "ENTER THE WORLD CUP →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
