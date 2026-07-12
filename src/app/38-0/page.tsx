"use client";

/**
 * /38-0 — Draft XI entry. Premier League / La Liga / World Cup tabs. The two
 * league tabs share one draft UI (parametrised by competition); World Cup is its
 * own nation-pick flow.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { BackPill } from "@/components/ui/BackPill";
import { Button } from "@/components/ui/Button";
import { Pitch } from "@/components/draft/Pitch";
import { WcHubHero, DraftHubHero } from "@/components/draft/WcHubHero";
import { FORMATIONS, LEAGUE_META } from "@/lib/draft/types";
import type { Formation, League } from "@/lib/draft/types";
import { FORMATION_NOTE } from "@/lib/draft/formations";
import { emptyTeam, loadTeam, saveTeam, isComplete, type LocalTeam, type DraftMode } from "@/lib/draft/local";
import { leagueCounts, ensurePool, isPoolReady } from "@/lib/draft/pool";
import { trackGamePlay } from "@/lib/analytics/trackGame";
import { useUser } from "@/hooks/useUser";

type DraftTab = "pl" | "laliga" | "wc" | "board";

// The two league draft tabs share all gameplay UI — only the competition, branding
// and accent differ.
const LEAGUE_TABS: Record<"pl" | "laliga", { league: League; emoji: string; title: string; blurb: string; accent: string; onAccent: string }> = {
  pl: {
    league: "PL", emoji: "⚽", title: "PREMIER LEAGUE",
    blurb: "Spin for legends. Draft your all-time XI. Beat the world head-to-head.",
    accent: "#aeea00", onAccent: "#062013",
  },
  laliga: {
    league: "LaLiga", emoji: "🇪🇸", title: "LA LIGA",
    blurb: "Spin for galácticos. Draft your all-time XI. Beat the world head-to-head.",
    accent: "#ff5b2e", onAccent: "#1c0702",
  },
};

export default function DraftHome() {
  const router = useRouter();
  const { user, loading: authLoading } = useUser();
  const [tab, setTab] = useState<DraftTab>("wc");
  // Player pool (~2.6MB) loads on demand; only used for the cosmetic count line below.
  const [poolReady, setPoolReady] = useState(isPoolReady());
  useEffect(() => { let off = false; ensurePool().then(() => { if (!off) setPoolReady(true); }).catch(() => {}); return () => { off = true; }; }, []);
  const [selected, setSelected] = useState<Formation>("4-3-3");
  const [mode, setMode] = useState<DraftMode>("classic");
  const [existing, setExisting] = useState<LocalTeam | null>(null);
  // Which mode the World Cup "How it works" panel is explaining.
  const [wcHow, setWcHow] = useState<"mastermind" | "run">("mastermind");
  const [wcHowOpen, setWcHowOpen] = useState(false);

  useEffect(() => {
    setExisting(loadTeam());
  }, []);

  const cfg = tab === "pl" || tab === "laliga" ? LEAGUE_TABS[tab] : null;

  function startNew() {
    if (!cfg) return;
    const team = emptyTeam(selected, mode, cfg.league);
    saveTeam(team);
    trackGamePlay("38-0", { mode: "draft", board: tab });
    router.push("/38-0/play");
  }

  // The in-progress local team belongs to whichever competition it was drafted in —
  // only surface its "continue" card under the matching tab.
  //
  // Signed-in users:   show both incomplete ("KEEP BUILDING") and complete ("CONTINUE WITH YOUR TEAM").
  // Anonymous users:   show incomplete only — let them finish the draft → team → season run.
  //                    A complete team with no sign-in shows a "Save Your Team" CTA instead.
  const teamInProgress = cfg && existing && existing.squad.length > 0 && existing.league === cfg.league ? existing : null;
  const continueTeam = teamInProgress && (user || !isComplete(teamInProgress)) ? teamInProgress : null;
  // Prompt anonymous users who have a complete team (they've drafted but not signed up).
  // Guard on !authLoading: while auth is still resolving user is null, which would
  // incorrectly flash the sign-up CTA at signed-in users before their session loads.
  const anonSavePrompt = !authLoading && !user && !!teamInProgress && isComplete(teamInProgress);
  const q = cfg ? `?competition=${cfg.league}` : "";

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        {/* header */}
        <div className="flex items-center justify-between pt-5 pb-3">
          <BackPill href="/" label="YourScore" tone="draft" />
        </div>

        <h1 className="font-display tracking-wide leading-none mb-4" style={{ fontSize: 52, color: "#fff" }}>
          38<span style={{ color: "#aeea00" }}>-0</span>
        </h1>

        {/* ── Main tab switcher (scrolls if 4 tabs overflow a narrow screen) ── */}
        <div className="flex gap-1 p-1 rounded-2xl mb-4 overflow-x-auto"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", scrollbarWidth: "none" }}>
          {([
            { key: "wc" as DraftTab, label: "🏆 World Cup", on: "#ffb800", onText: "#0a0a0f" },
            { key: "pl" as DraftTab, label: "⚽ Premier League", on: "#aeea00", onText: "#062013" },
            { key: "laliga" as DraftTab, label: "🇪🇸 La Liga", on: "#ff5b2e", onText: "#1c0702" },
            { key: "board" as DraftTab, label: "Leaderboard ✓", on: "#aeea00", onText: "#06181c" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 py-2 px-2.5 rounded-xl font-body text-xs font-semibold transition-all whitespace-nowrap"
              style={tab === t.key
                ? { background: t.on, color: t.onText }
                : { background: "transparent", color: "#8a948f" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Secondary nav pills ── */}
        {cfg && (
          <div className="flex gap-2 mb-6">
            {([
              { href: `/38-0/live${q}`,        label: "⚡ Live H2H",   color: cfg.accent },
              { href: `/38-0/teams${q}`,       label: "📁 My Teams",   color: "#aeea00" },
              { href: `/38-0/leaderboard${q}`, label: "⚔️ H2H Ladder", color: "#ffb800" },
            ]).map(({ href, label, color }) => (
              <Link key={href} href={href}
                className="flex-1 py-2.5 rounded-full text-center font-display tracking-wide transition-all active:scale-95"
                style={{ fontSize: 12, color, background: `${color}1f`, border: `1px solid ${color}40` }}>
                {label}
              </Link>
            ))}
          </div>
        )}
        {tab === "wc" && (
          <div className="flex gap-2 mb-6">
            {([
              { href: "/38-0/teams",       label: "📁 My Teams",   color: "#aeea00" },
              { href: "/38-0/wc/board",    label: "🏅 WC Season",  color: "#ffb800" },
              { href: "/38-0/leaderboard", label: "⚔️ H2H Ladder", color: "#ff5b2e" },
            ]).map(({ href, label, color }) => (
              <Link key={href} href={href}
                className="flex-1 py-2.5 rounded-full text-center font-display tracking-wide transition-all active:scale-95"
                style={{ fontSize: 12, color, background: `${color}1f`, border: `1px solid ${color}40` }}>
                {label}
              </Link>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            LEAGUE DRAFT TAB (Premier League / La Liga — shared UI)
        ══════════════════════════════════════════════════════════════════ */}
        {cfg && (
          <>
            <div className="mb-5">
              <DraftHubHero
                eyebrow="ALL-TIME XI"
                titleLines={cfg.title.split(" ")}
                sub={cfg.blurb}
                accent={cfg.accent}
                accentText={cfg.accent}
              />
              {poolReady && (
                <p className="font-body mt-2 px-1" style={{ color: "#8a948f", fontSize: 11 }}>
                  {leagueCounts()[cfg.league].players} all-time {LEAGUE_META[cfg.league].name} player-seasons · {leagueCounts()[cfg.league].buckets} legendary squads
                </p>
              )}
            </div>

            {/* continue card — signed-in: both complete + in-progress; anonymous: in-progress only */}
            {continueTeam && (
              <Link
                href={isComplete(continueTeam) ? "/38-0/team" : "/38-0/play"}
                className="block mb-6 rounded-2xl p-4 active:scale-[0.98] transition-transform"
                style={{ background: `linear-gradient(135deg,${cfg.accent}1f,${cfg.accent}0d)`, border: `1px solid ${cfg.accent}40` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
                      {isComplete(continueTeam) ? "CONTINUE WITH YOUR TEAM" : "KEEP BUILDING"}
                    </div>
                    <div className="font-body" style={{ fontSize: 13, color: "#8a948f" }}>
                      {continueTeam.formation} · {continueTeam.squad.length}/11 drafted
                    </div>
                  </div>
                  <div className="font-display" style={{ fontSize: 34, color: cfg.accent }}>
                    {isComplete(continueTeam) ? continueTeam.strength : "→"}
                  </div>
                </div>
              </Link>
            )}

            {/* Sign-up prompt for anonymous users who have a complete team — no "continue" without an account */}
            {anonSavePrompt && (
              <Link
                href="/auth/sign-in?next=/38-0/team"
                className="block mb-6 rounded-2xl p-4 active:scale-[0.98] transition-transform"
                style={{ background: "rgba(0,201,255,0.06)", border: "1px solid rgba(0,201,255,0.25)" }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
                      SAVE YOUR TEAM
                    </div>
                    <div className="font-body" style={{ fontSize: 13, color: "#8a948f" }}>
                      Sign up to keep this XI and go head-to-head
                    </div>
                  </div>
                  <div className="font-display" style={{ fontSize: 28, color: "#00c9ff" }}>→</div>
                </div>
              </Link>
            )}

            <h2 className="font-display tracking-wide mb-3" style={{ fontSize: 22, color: "#fff" }}>
              PICK YOUR SHAPE
            </h2>

            <div className="flex flex-wrap gap-2">
              {FORMATIONS.map((f) => {
                const active = selected === f;
                return (
                  <button
                    key={f}
                    onClick={() => setSelected(f)}
                    className="rounded-xl px-4 py-2.5 font-display tracking-wide transition-all active:scale-95"
                    style={{
                      background: active ? `${cfg.accent}1f` : "#0e1611",
                      border: `1px solid ${active ? `${cfg.accent}80` : "rgba(255,255,255,0.08)"}`,
                      color: active ? cfg.accent : "#fff",
                      fontSize: 18,
                    }}
                  >
                    {f}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl p-3" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="max-w-[260px] mx-auto">
                <Pitch formation={selected} squad={[]} compact />
              </div>
              <p className="font-body text-center mt-3" style={{ fontSize: 12, color: "#8a948f" }}>
                {FORMATION_NOTE[selected]}
              </p>
            </div>

            <h2 className="font-display tracking-wide mt-7 mb-3" style={{ fontSize: 22, color: "#fff" }}>
              DIFFICULTY
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "classic" as DraftMode, label: "CLASSIC", desc: "Ratings shown — draft the strongest XI", color: cfg.accent },
                { key: "expert"  as DraftMode, label: "EXPERT",  desc: "Ratings hidden — for real fans",         color: "#ffb800" },
              ]).map((m) => {
                const active = mode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className="rounded-2xl p-4 text-left transition-all active:scale-95"
                    style={{
                      background: active ? `${m.color}14` : "#0e1611",
                      border: `1px solid ${active ? `${m.color}88` : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-display tracking-wide" style={{ fontSize: 22, color: active ? m.color : "#fff" }}>{m.label}</span>
                      {m.key === "expert" && <span style={{ fontSize: 14 }}>🔒</span>}
                    </div>
                    <div className="font-body mt-1" style={{ fontSize: 11, color: "#8a948f", lineHeight: 1.3 }}>{m.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* spacer so sticky button doesn't cover the last card */}
            <div className="h-28" />
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            WORLD CUP TAB
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "wc" && (
          <>
            {/* Hero — pitch + title (the "in-game vibe"); taps into the ranked daily. */}
            <WcHubHero />

            {/* World Cup Run — the free-play alternative, one line. */}
            <Link
              href="/38-0/wc?run=1"
              className="flex items-center gap-3 rounded-2xl px-4 py-3.5 mt-3 mb-4 active:scale-[0.99] transition-transform"
              style={{ background: "#0c1409", border: "1px solid rgba(174,234,0,0.32)", textDecoration: "none" }}
            >
              <span style={{ fontSize: 22 }}>🌍</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display tracking-wide" style={{ fontSize: 16, color: "#aeea00" }}>WORLD CUP RUN</span>
                  <span className="font-body rounded-full px-2 py-0.5" style={{ fontSize: 9, color: "#062013", background: "#aeea00", letterSpacing: 0.5 }}>FREE PLAY</span>
                </div>
                <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>Spin a dream XI from any nation — no questions</div>
              </div>
              <span style={{ fontSize: 16, color: "#aeea00" }}>→</span>
            </Link>

            {/* How it works — collapsed by default (was a wall of steps). */}
            <button onClick={() => setWcHowOpen((o) => !o)} className="flex items-center gap-1.5 mb-3 font-body" style={{ fontSize: 12, color: "#9aa4ab" }}>
              <span style={{ color: "#ffb800", fontSize: 14 }}>ⓘ</span> How it works
              <span style={{ fontSize: 10 }}>{wcHowOpen ? "▲" : "▼"}</span>
            </button>
            {wcHowOpen && (
            <div className="rounded-2xl p-4 mb-6" style={{ background: "#0e1611", border: "1px solid rgba(255,184,0,0.25)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-body" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>HOW IT WORKS</div>
                <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
                  {([["mastermind", "Mastermind"], ["run", "Run"]] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setWcHow(k)}
                      className="px-2.5 py-1 rounded-md font-body font-semibold transition-all"
                      style={wcHow === k
                        ? { background: k === "mastermind" ? "#ffb800" : "#aeea00", color: k === "mastermind" ? "#1a1300" : "#062013", fontSize: 11 }
                        : { background: "transparent", color: "#8a948f", fontSize: 11 }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(wcHow === "mastermind"
                ? [
                    ["①", "Answer to draft", "Each pick is unlocked by a World Cup question on a 25s clock — right answers (and streaks) deal stronger players."],
                    ["②", "Play the World Cup", "A group, then the knockouts — vs real nations, tougher each round."],
                    ["③", "Group on the line", "4 pts go through; level on 3 → one sudden-death question to qualify; less and you're out."],
                    ["④", "Climb the season board", "One ranked run a day. Get closest to a perfect 8-0-0."],
                  ]
                : [
                    ["①", "Build your XI", "Spin & pick from any nation — pure luck of the draw, no questions."],
                    ["②", "Play the World Cup", "A group, then the knockouts, all the way to the final."],
                    ["③", "Win to advance", "Survive the group, then it's win-or-go-home — free re-spins each round."],
                    ["④", "Lift the trophy 🏆", "Reach the final and win it. Play as many runs as you like."],
                  ]
              ).map(([n, title, desc]) => (
                <div key={n as string} className="flex gap-3 mb-2.5 last:mb-0">
                  <span className="font-display flex-shrink-0" style={{ fontSize: 17, color: wcHow === "mastermind" ? "#ffb800" : "#aeea00" }}>{n}</span>
                  <div>
                    <div className="font-body" style={{ fontSize: 13, color: "#fff" }}>{title}</div>
                    <div className="font-body" style={{ fontSize: 12, color: "#8a948f", lineHeight: 1.35 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            LEADERBOARD TAB — verified season records, closest to 38-0 / 8-0
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "board" && <VerifiedBoard signedIn={!!user} />}
      </div>

      {/* ── Sticky CTA — league draft tabs only ── */}
      {cfg && (
        <div className="fixed left-0 right-0 z-40"
          style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))", background: "linear-gradient(0deg,#0a0a0f 70%,transparent)", paddingBottom: "4px" }}>
          <div className="max-w-lg mx-auto px-5 pt-3">
            <Button variant="primary" tone="lime" size="lg" fullWidth onClick={startNew}>
              DRAFT YOUR XI →
            </Button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

// ─── Leaderboard tab ───────────────────────────────────────────────────────────
// Verified season records: every row is a server re-simulation of the submitted
// XI (see /api/draft/records), never a client-claimed number — hence the ✓.

type SeasonBoardRow = {
  user_id: string; display_name: string; wins: number; draws: number; losses: number;
  points: number; league_pos: number; strength: number; invincible: boolean; created_at: string;
};
type WcBoardRow = {
  user_id: string; display_name: string; nation: string; wins: number; games: number;
  status: string; created_at: string;
};
type BoardData = { seasons: SeasonBoardRow[]; wc: WcBoardRow[]; mine: { season: SeasonBoardRow | null; wc: WcBoardRow | null } };

const medal = (i: number): string => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

function VerifiedBoard({ signedIn }: { signedIn: boolean }) {
  const [comp, setComp] = useState<League>("PL");
  const [boardWindow, setBoardWindow] = useState<"today" | "all">("all");
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/draft/records?competition=${comp}&window=${boardWindow}`)
      .then((r) => r.json())
      .then((d: BoardData) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData({ seasons: [], wc: [], mine: { season: null, wc: null } }); setLoading(false); } });
    return () => { cancelled = true; };
  }, [comp, boardWindow]);

  const seasons = data?.seasons ?? [];
  const wc = data?.wc ?? [];
  const mySeason = data?.mine.season ?? null;

  return (
    <>
      <h2 className="font-display tracking-wide leading-none" style={{ fontSize: 30, color: "#fff" }}>
        LEADERBOARD <span style={{ color: "#aeea00" }}>✓</span>
      </h2>
      <p className="font-body mt-1 mb-5" style={{ color: "#c4ccc6", fontSize: 14 }}>
        Who&apos;s got closest to the perfect season? Every record here is verified ✓ — real results only.
      </p>

      {/* Sign-in nudge — seasons only enter the board for signed-in managers */}
      {!signedIn && (
        <Link href="/auth/sign-in" className="block mb-5 rounded-2xl p-4 active:scale-[0.98] transition-transform"
          style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.3)" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#fff" }}>CLAIM YOUR SPOT</div>
              <div className="font-body" style={{ fontSize: 13, color: "#8a948f" }}>Sign in — every season you play enters the board automatically</div>
            </div>
            <div className="font-display" style={{ fontSize: 28, color: "#aeea00" }}>→</div>
          </div>
        </Link>
      )}

      {/* Your best */}
      {mySeason && (
        <div className="mb-5 rounded-2xl p-4" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.3)" }}>
          <div className="font-body" style={{ fontSize: 11, color: "#aeea00", letterSpacing: 2 }}>YOUR BEST {comp === "PL" ? "PREMIER LEAGUE" : "LA LIGA"} SEASON</div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="font-display tracking-wide" style={{ fontSize: 34, color: "#fff" }}>{mySeason.wins}-{mySeason.draws}-{mySeason.losses}</span>
            <span className="font-body" style={{ fontSize: 14, color: "#8a948f" }}>{mySeason.points} pts</span>
            {mySeason.invincible && <span className="font-display" style={{ fontSize: 13, color: "#ffd700" }}>🏆 INVINCIBLE</span>}
          </div>
          {!mySeason.invincible && (
            <div className="font-body mt-1" style={{ fontSize: 12, color: "#8a948f" }}>
              {38 - mySeason.wins} {38 - mySeason.wins === 1 ? "result" : "results"} short of 38-0 — go again.
            </div>
          )}
        </div>
      )}

      {/* ── Season board ── */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display tracking-wide" style={{ fontSize: 20, color: "#fff" }}>CLOSEST TO 38-0</h3>
        <div className="flex gap-1 p-0.5 rounded-xl" style={{ background: "rgba(255,255,255,0.05)" }}>
          {(["PL", "LaLiga"] as League[]).map((c) => (
            <button key={c} onClick={() => setComp(c)}
              className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-all"
              style={comp === c ? { background: c === "PL" ? "#aeea00" : "#ff5b2e", color: "#0a0a0f" } : { background: "transparent", color: "#8a948f" }}>
              {c === "PL" ? "⚽ PL" : "🇪🇸 La Liga"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1 mb-3 p-0.5 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.05)" }}>
        {([["today", "Today"], ["all", "All-time"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setBoardWindow(k)}
            className="px-3 py-1 rounded-lg font-body text-xs font-semibold transition-all"
            style={boardWindow === k ? { background: "#aeea00", color: "#06181c" } : { background: "transparent", color: "#8a948f" }}>
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden mb-7" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
        {loading ? (
          <div className="py-10 text-center font-body" style={{ fontSize: 13, color: "#8a948f" }}>Loading the board…</div>
        ) : seasons.length === 0 ? (
          <div className="py-10 px-6 text-center">
            <div className="font-display tracking-wide" style={{ fontSize: 18, color: "#fff" }}>
              {boardWindow === "today" ? "NO SEASONS ON TODAY'S BOARD YET" : "NO VERIFIED SEASONS YET"}
            </div>
            <div className="font-body mt-1" style={{ fontSize: 13, color: "#8a948f" }}>Draft an XI, play your season, and be the first name on the board.</div>
          </div>
        ) : (
          seasons.map((r, i) => (
            <div key={r.user_id} className="flex items-center gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none", background: r.user_id === mySeason?.user_id ? "rgba(174,234,0,0.05)" : "transparent" }}>
              <span className="font-display w-7 text-center flex-shrink-0" style={{ fontSize: i < 3 ? 18 : 14, color: "#8a948f" }}>{medal(i)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-body truncate" style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{r.display_name}</div>
                <div className="font-body" style={{ fontSize: 11, color: "#5b645e" }}>{r.points} pts · STR {Math.round(Number(r.strength))}</div>
              </div>
              {r.invincible && <span style={{ fontSize: 14 }}>🏆</span>}
              <div className="font-display tracking-wide flex-shrink-0" style={{ fontSize: 18 }}>
                <span style={{ color: "#aeea00" }}>{r.wins}</span>
                <span style={{ color: "#586058" }}>-</span>
                <span style={{ color: "#ffb800" }}>{r.draws}</span>
                <span style={{ color: "#586058" }}>-</span>
                <span style={{ color: "#ff4757" }}>{r.losses}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── World Cup board ── */}
      <h3 className="font-display tracking-wide mb-3" style={{ fontSize: 20, color: "#fff" }}>
        🏆 WORLD CUP — <span style={{ color: "#ffb800" }}>CLOSEST TO 8-0</span>
      </h3>
      <div className="rounded-2xl overflow-hidden pb-2" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
        {loading ? (
          <div className="py-10 text-center font-body" style={{ fontSize: 13, color: "#8a948f" }}>Loading the board…</div>
        ) : wc.length === 0 ? (
          <div className="py-10 px-6 text-center">
            <div className="font-display tracking-wide" style={{ fontSize: 18, color: "#fff" }}>NO RUNS ON THE BOARD YET</div>
            <div className="font-body mt-1" style={{ fontSize: 13, color: "#8a948f" }}>Win all 8 games of a World Cup Run for the perfect 8-0.</div>
          </div>
        ) : (
          wc.map((r, i) => (
            <div key={r.user_id} className="flex items-center gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none", background: r.user_id === data?.mine.wc?.user_id ? "rgba(255,184,0,0.05)" : "transparent" }}>
              <span className="font-display w-7 text-center flex-shrink-0" style={{ fontSize: i < 3 ? 18 : 14, color: "#8a948f" }}>{medal(i)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-body truncate" style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{r.display_name}</div>
                <div className="font-body truncate" style={{ fontSize: 11, color: "#5b645e" }}>{r.nation}{r.status === "champion" ? " · CHAMPION" : ""}</div>
              </div>
              {r.status === "champion" && <span style={{ fontSize: 14 }}>🏆</span>}
              <div className="font-display tracking-wide flex-shrink-0" style={{ fontSize: 18, color: r.wins >= 8 ? "#ffd700" : "#ffb800" }}>
                {r.wins}<span style={{ color: "#586058", fontSize: 13 }}>/8</span>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="font-body text-center mt-4 pb-6" style={{ fontSize: 11, color: "#586058" }}>
        ✓ Verified results only · best season per manager · World Cup board is all-time
      </p>
    </>
  );
}
