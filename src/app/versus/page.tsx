"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { useYourTurns, type InboxChallenge } from "@/hooks/useYourTurns";
import { useVersusStats, type Rivalry } from "@/hooks/useVersusStats";
import { BottomNav } from "@/components/ui/BottomNav";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { PitchArt, QuizArt, VersusHeroArt } from "@/components/versus/GameTileArt";
import { VersusDiscovery } from "@/components/versus/VersusDiscovery";
import { VersusActionCards } from "@/components/versus/VersusActionCard";
import { LiveActivityStrip } from "@/components/versus/LiveActivityStrip";
import { CommunityHighlights } from "@/components/versus/CommunityHighlights";
import { PublicLeaguesRail } from "@/components/leagues/PublicLeagueCard";
import { FriendsPanel } from "@/components/friends/FriendsPanel";
import { LeaguesPanel } from "@/components/leagues/LeaguesPanel";

// The Versus tab: a head-to-head hub built around matches and rivalries (not a
// launcher that bounces to other tabs). Play = challenge someone → resume your
// turn → active matches → recent results → your record → your rivalries, wired
// to real data across both versus games (Quiz Battle = h2h, 38-0 = live match).
// Friends / Leagues are in-place sub-tabs (embedded, chrome stripped).

type View = "play" | "friends" | "leagues";

const TEAL = "#00d8c0"; // Quiz
const LIME = "#aeea00"; // 38-0
const GOLD = "#ffc233"; // wins
const RED = "#ff6b78";

function Avatar({ name, avatarUrl, seed, size = 40, ring }: { name: string; avatarUrl?: string | null; seed?: string; size?: number; ring?: string }) {
  return <PlayerAvatar seed={seed} name={name} avatarUrl={avatarUrl} size={size} ring={ring} />;
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-7 mb-2.5">
      <p className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: "#586058" }}>{children}</p>
      {action}
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function GameGlyph({ game, size = 20 }: { game: "quiz" | "38-0"; size?: number }) {
  const c = game === "38-0" ? LIME : TEAL;
  return game === "38-0" ? (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><path d="M8 2.5 3 5.5 5 9.5 7.3 8.3V19a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1V8.3L17 9.5l2-4-5-3C14 4.4 12.7 5.6 11 5.6S8 4.4 8 2.5Z" stroke={c} strokeWidth="1.7" strokeLinejoin="round" fill={c} fillOpacity={0.15} /></svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><path d="M11 2 13.5 8.5H20.5L14.9 12.5 17 19 11 15 5 19 7.1 12.5 1.5 8.5H8.5L11 2Z" stroke={c} strokeWidth="1.7" strokeLinejoin="round" fill={c} fillOpacity={0.15} /></svg>
  );
}

function Flame({ color = LIME }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5s3.5 3 3.5 6.5A3.5 3.5 0 1 1 5 6c0 1.4 1 2 1 2 .3-2.5 2-6.5 2-6.5Z" fill={color} /></svg>;
}

// ── Challenge-someone sheet: pick which game to challenge on ──────────────────
function GameSheet({ target, onClose }: { target?: string | null; onClose: () => void }) {
  const router = useRouter();
  const go = (game: "quiz" | "38-0") => {
    if (game === "quiz") router.push(target ? `/versus/quiz?to=${target}` : "/versus/quiz");
    else router.push("/versus/38-0");
  };
  return (
    // z-[60]: must sit ABOVE the fixed BottomNav (z-50) or the nav covers the
    // bottom of the sheet; safe-area padding keeps the last button tappable.
    <div className="fixed inset-0 z-[60] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl p-5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)", animation: "slideUp 0.22s ease", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="w-9 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.15)" }} />
        <p className="font-display text-2xl text-white mb-1">Choose a game</p>
        <p className="font-body text-sm text-text-muted mb-5">What do you want to play?</p>
        <button onClick={() => go("38-0")} className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 mb-3 text-left active:scale-[0.99] transition-transform" style={{ background: "rgba(174,234,0,0.08)", border: `1px solid ${LIME}40` }}>
          <GameGlyph game="38-0" size={26} />
          <div className="flex-1"><p className="font-display text-lg text-white leading-none">38-0</p><p className="font-body text-xs text-text-muted mt-1">Build your XI. Beat your opponent.</p></div>
          <span className="font-display text-xs tracking-wide px-3 py-1.5 rounded-lg" style={{ background: LIME, color: "#13200a" }}>PLAY →</span>
        </button>
        <button onClick={() => go("quiz")} className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left active:scale-[0.99] transition-transform" style={{ background: "rgba(0,216,192,0.08)", border: `1px solid ${TEAL}40` }}>
          <GameGlyph game="quiz" size={26} />
          <div className="flex-1"><p className="font-display text-lg text-white leading-none">Quiz Battle</p><p className="font-body text-xs text-text-muted mt-1">Same questions. Speed and accuracy decide it.</p></div>
          <span className="font-display text-xs tracking-wide px-3 py-1.5 rounded-lg" style={{ background: TEAL, color: "#04231f" }}>PLAY →</span>
        </button>
      </div>
    </div>
  );
}

// ── Join-with-code sheet ─────────────────────────────────────────────────────
function CodeSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const join = () => { const c = code.trim().toUpperCase(); if (c) router.push(`/play?join=${encodeURIComponent(c)}`); };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl p-5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)", animation: "slideUp 0.22s ease", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="w-9 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.15)" }} />
        <p className="font-display text-2xl text-white mb-1">Join with code</p>
        <p className="font-body text-sm text-text-muted mb-4">Enter the code a friend shared.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 8KP2LD" autoFocus
          className="w-full rounded-2xl px-4 py-3.5 font-display text-lg tracking-[0.2em] text-white uppercase text-center mb-3 outline-none"
          style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.12)" }} />
        <button onClick={join} disabled={!code.trim()} className="w-full rounded-2xl py-3.5 font-display tracking-wide disabled:opacity-40" style={{ background: TEAL, color: "#04231f" }}>JOIN →</button>
      </div>
    </div>
  );
}

// ── Your turn: the one active match awaiting your play, given hero treatment ──
function YourTurnCard({ c }: { c: InboxChallenge }) {
  return (
    <Link href={`/h2h/${c.id}`} className="block rounded-3xl p-5 mb-1 active:scale-[0.99] transition-transform" style={{ background: "linear-gradient(160deg, #10201b 0%, #0c1613 100%)", border: `1px solid ${TEAL}40` }}>
      <div className="flex items-center justify-between mb-4">
        <span className="font-body text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md" style={{ background: TEAL, color: "#04231f" }}>Your turn</span>
        <span className="font-body text-xs text-text-muted">Quiz Battle</span>
      </div>
      <div className="flex items-center gap-4">
        <Avatar name="You" size={48} ring={TEAL} />
        <div className="flex-1 text-center">
          <p className="font-display text-lg text-white leading-none">vs {c.otherName}</p>
          <p className="font-body text-xs text-text-muted mt-1.5 truncate">{c.packName}</p>
        </div>
        <Avatar name={c.otherName} seed={c.invitedUserId ?? c.otherName} size={48} ring="rgba(255,255,255,0.15)" />
      </div>
      <div className="mt-4 rounded-xl py-3 text-center font-display tracking-wide" style={{ background: TEAL, color: "#04231f" }}>CONTINUE MATCH →</div>
    </Link>
  );
}

function GameTile({ game, href, title, sub }: { game: "quiz" | "38-0"; href: string; title: string; sub: string }) {
  const c = game === "38-0" ? LIME : TEAL;
  return (
    <Link href={href} className="flex-1 rounded-2xl overflow-hidden relative active:scale-[0.98] transition-transform" style={{ border: `1px solid ${c}40`, minHeight: 156 }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 50% 12%, ${c}22, #0b1310 68%)` }} />
      {game === "38-0" ? <PitchArt /> : <QuizArt />}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,13,10,0) 42%, rgba(8,13,10,0.88) 100%)" }} />
      <div className="relative p-4 h-full flex flex-col justify-end" style={{ minHeight: 156 }}>
        <GameGlyph game={game} size={26} />
        <p className="font-display text-xl text-white mt-2 leading-none">{title}</p>
        <p className="font-body text-[11px] mt-1.5 leading-snug" style={{ color: "#cdeee7" }}>{sub}</p>
      </div>
    </Link>
  );
}

function MatchRow({ c }: { c: InboxChallenge }) {
  const mine = c.iAmChallenger;
  const played = c.myScore != null;
  const waiting = mine && c.theirScore == null; // I've played, waiting on them
  const status = !played ? "Your turn" : waiting ? "Waiting for opponent" : "Ready to reveal";
  const col = !played ? TEAL : "#586058";
  return (
    <Link href={`/h2h/${c.id}`} className="flex items-center gap-3 rounded-2xl px-4 py-3 active:scale-[0.99] transition-transform" style={{ background: "#0e1611", border: `1px solid ${!played ? "rgba(0,216,192,0.25)" : "rgba(255,255,255,0.07)"}` }}>
      <GameGlyph game="quiz" size={18} />
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-semibold text-white truncate">vs {c.otherName}</p>
        <p className="font-body text-xs truncate" style={{ color: col }}>{status}</p>
      </div>
      <span className="font-body text-xs text-text-muted flex-shrink-0">{timeAgo(c.createdAt)}</span>
    </Link>
  );
}

function ResultRow({ c }: { c: InboxChallenge }) {
  const my = c.myScore ?? 0, their = c.theirScore ?? 0;
  const draw = my === their, won = my > their;
  const col = draw ? "#8a948f" : won ? GOLD : RED;
  const tag = draw ? "D" : won ? "W" : "L";
  return (
    <div className="flex items-center gap-3 rounded-2xl px-3.5 py-3" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
      <span className="font-display text-lg w-5 text-center flex-shrink-0" style={{ color: col }}>{tag}</span>
      <Avatar name={c.otherName} seed={c.invitedUserId ?? c.otherName} size={34} />
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-semibold text-white truncate">vs {c.otherName}</p>
        <p className="font-body text-xs text-text-muted truncate">{c.packName}</p>
      </div>
      <div className="text-right flex-shrink-0 mr-1">
        <p className="font-display text-sm text-white leading-none">{my.toLocaleString()}–{their.toLocaleString()}</p>
        <p className="font-body text-[11px] mt-0.5" style={{ color: col }}>{draw ? "Draw" : won ? "Won" : "Lost"}</p>
      </div>
      <Link href={c.iAmChallenger && c.invitedUserId ? `/versus/quiz?to=${c.invitedUserId}` : "/versus/quiz"} className="font-display text-[11px] tracking-wide px-3 py-2 rounded-lg flex-shrink-0" style={{ background: "rgba(0,216,192,0.12)", color: TEAL, border: `1px solid ${TEAL}33` }}>REMATCH</Link>
    </div>
  );
}

function RecordStrip({ wins, losses, winRate, streak, streakType }: { wins: number; losses: number; winRate: number; streak: number; streakType: "win" | "loss" | "draw" | null }) {
  const Stat = ({ v, label, color }: { v: React.ReactNode; label: string; color: string }) => (
    <div className="flex-1 text-center"><p className="font-display text-2xl leading-none" style={{ color }}>{v}</p><p className="font-body text-[10px] uppercase tracking-widest text-text-muted mt-1.5">{label}</p></div>
  );
  return (
    <div className="rounded-3xl p-5 flex items-center gap-2" style={{ background: "linear-gradient(150deg, #15211a, #0c1613)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <Stat v={wins} label="Wins" color={GOLD} />
      <div className="w-px h-9" style={{ background: "rgba(255,255,255,0.08)" }} />
      <Stat v={losses} label="Losses" color={RED} />
      <div className="w-px h-9" style={{ background: "rgba(255,255,255,0.08)" }} />
      <Stat v={`${winRate}%`} label="Win rate" color={TEAL} />
      <div className="w-px h-9" style={{ background: "rgba(255,255,255,0.08)" }} />
      <div className="flex-1 text-center">
        <p className="font-display text-2xl leading-none flex items-center justify-center gap-1" style={{ color: streakType === "win" ? LIME : "#8a948f" }}>
          {streak}{streakType === "win" && streak > 0 && <Flame />}
        </p>
        <p className="font-body text-[10px] uppercase tracking-widest text-text-muted mt-1.5">{streakType === "loss" ? "Loss run" : "Streak"}</p>
      </div>
    </div>
  );
}

function RivalryCard({ r, onChallenge }: { r: Rivalry; onChallenge: (id: string) => void }) {
  const leadTxt = r.lead > 0 ? `You lead ${r.wins}–${r.losses}` : r.lead < 0 ? `You trail ${r.wins}–${r.losses}` : `Level ${r.wins}–${r.losses}`;
  const leadCol = r.lead > 0 ? LIME : r.lead < 0 ? RED : GOLD;
  const total = r.total || 1;
  return (
    <div className="rounded-2xl p-3.5 flex-shrink-0" style={{ width: 190, background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
      <Link href={`/profile/${r.opponentId}`} className="flex items-center gap-2.5 mb-3">
        <Avatar name={r.name} avatarUrl={r.avatarUrl} seed={r.opponentId} size={38} ring={leadCol} />
        <div className="min-w-0">
          <p className="font-body text-sm font-semibold text-white truncate">{r.name}</p>
          <p className="font-body text-[11px]" style={{ color: leadCol }}>{leadTxt}</p>
        </div>
      </Link>
      <div className="flex gap-1 h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${(r.wins / total) * 100}%`, background: LIME }} />
        <div style={{ width: `${(r.draws / total) * 100}%`, background: "#5a655e" }} />
        <div style={{ width: `${(r.losses / total) * 100}%`, background: RED }} />
      </div>
      <button onClick={() => onChallenge(r.opponentId)} className="w-full font-display text-xs tracking-wide py-2 rounded-lg" style={{ background: "rgba(0,216,192,0.1)", color: TEAL, border: `1px solid ${TEAL}33` }}>CHALLENGE</button>
    </div>
  );
}

function VersusInner() {
  const { user, loading } = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const view = ((params.get("view") as View) ?? "play");
  const turns = useYourTurns();
  const stats = useVersusStats();
  const [sheet, setSheet] = useState<null | { kind: "game"; target?: string | null } | { kind: "code" }>(null);

  // Guests keep the nav (they arrived via the guest BottomNav — removing it
  // strands them here) and see the REAL Versus surface in preview: the actual
  // action cards render (founder 2026-07-21 — show what the tab looks like,
  // not a sign-in wall), but every tap inside the preview routes to sign-in
  // via a capture handler, so nothing behind it ever fires for a guest.
  // /auth/sign-in handles create-account too; ?next brings them straight back.
  if (!loading && !user) {
    return (
      <main className="min-h-dvh bg-bg px-5 pb-28 pt-7">
        <div className="w-full max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <GameGlyph game="38-0" size={28} />
            <p className="font-display text-3xl text-white">Versus</p>
          </div>
          <p className="font-body text-sm text-text-muted mb-5">Go head-to-head in 38-0 and Quiz Battle. Build rivalries, settle arguments, keep the score.</p>
          <div
            data-tour="versus-actions"
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push("/auth/sign-in?next=/versus");
            }}
          >
            <VersusActionCards onChallenge={() => {}} onJoinCode={() => {}} />
          </div>
          <p className="font-body text-xs text-center mt-5 mb-3" style={{ color: "#8a948f" }}>Free account, takes seconds — then challenge your friends.</p>
          <Link href="/auth/sign-in?next=/versus" className="block rounded-2xl px-6 py-3.5 font-display tracking-wide text-center mb-3" style={{ background: TEAL, color: "#04231f" }}>CREATE FREE ACCOUNT →</Link>
          <Link href="/auth/sign-in?next=/versus" className="block rounded-2xl px-6 py-3.5 font-display tracking-wide text-center" style={{ background: "rgba(255,255,255,0.06)", color: "#cdeee7", border: "1px solid rgba(255,255,255,0.12)" }}>SIGN IN</Link>
        </div>
        <BottomNav />
      </main>
    );
  }

  const only1v1 = (list: InboxChallenge[]) => list.filter((c) => c.kind !== "group");
  const yourTurn = only1v1(turns.yourTurn), waiting = only1v1(turns.waiting), results = only1v1(turns.results);
  const activeMatches = [...yourTurn, ...waiting];
  const hasHistory = stats.record.wins + stats.record.losses + stats.record.draws > 0;

  const PILLS: { key: View; label: string }[] = [
    { key: "play", label: "Play" }, { key: "friends", label: "Friends" }, { key: "leagues", label: "Leagues" },
  ];

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="sticky top-0 z-20 pt-safe" style={{ background: "rgba(8,13,10,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="max-w-lg mx-auto px-5 py-4 flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M3 3l8.5 8.5M3 3v3l7.5 7.5M3 3h3l7.5 7.5" stroke={TEAL} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M19 3l-8.5 8.5M19 3v3l-7.5 7.5M19 3h-3L8.5 11.5" stroke={TEAL} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="font-display text-2xl text-white" style={{ letterSpacing: "-0.01em" }}>Versus</h1>
        </div>
        {/* Full-width segmented tabs (founder call: the three tabs span the screen) */}
        <div className="flex max-w-lg mx-auto px-5 pb-3 gap-2">
          {PILLS.map((p) => {
            const active = p.key === view;
            return (
              <button key={p.key} onClick={() => router.push(`/versus?view=${p.key}`)} className="flex-1 font-body text-sm font-semibold py-2 rounded-lg transition-all text-center"
                style={{ background: active ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)", color: active ? TEAL : "#8a948f", border: `1px solid ${active ? "rgba(0,216,192,0.3)" : "transparent"}` }}>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === "friends" && <FriendsPanel embedded />}
      {view === "leagues" && <LeaguesPanel embedded />}

      {view === "play" && (
        <div className="max-w-lg mx-auto px-5">
          {/* Priority: an action waiting on you always outranks discovery. */}
          {yourTurn.length > 0 && (
            <div className="pt-4"><YourTurnCard c={yourTurn[0]} /></div>
          )}

          {/* Hero — full-size welcome when nothing is urgent; suppressed to keep
              the waiting match on top otherwise. Action cards always render. */}
          {yourTurn.length === 0 && (
            <div className="pt-4">
              <div className="relative rounded-3xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #101d16 0%, #0b1511 100%)" }} />
                <VersusHeroArt />
                <div className="absolute inset-0" style={{ background: "linear-gradient(110deg, rgba(8,13,10,0.78) 38%, rgba(8,13,10,0.28) 82%, rgba(8,13,10,0.05) 100%)" }} />
                <div className="relative p-5 pt-7 pb-6">
                  <p className="font-body text-[11px] font-bold uppercase tracking-[0.32em] mb-2.5" style={{ color: LIME }}>Welcome to Versus</p>
                  <p className="font-display text-white leading-[0.85]" style={{ fontSize: 46 }}>TIME TO PLAY.<br /><span style={{ color: LIME }}>LET&rsquo;S FIND YOU</span><br />A RIVAL.</p>
                  <p className="font-body text-xs mt-3" style={{ color: "#cdeee7" }}>Play someone now, challenge a friend or join a match.</p>
                </div>
              </div>
            </div>
          )}
          <div className="mt-2.5" data-tour="versus-actions">
            <VersusActionCards onChallenge={() => setSheet({ kind: "game" })} onJoinCode={() => setSheet({ kind: "code" })} />
          </div>

          {/* Choose your game */}
          <SectionLabel>Choose your game</SectionLabel>
          <div className="flex gap-2.5">
            <GameTile game="38-0" href="/versus/38-0" title="38-0" sub="Build your XI team from scratch." />
            <GameTile game="quiz" href="/versus/quiz" title="Quiz Battle" sub="Score questions. Beat your rival." />
          </div>

          {/* Active matches (beyond the pinned your-turn) */}
          {activeMatches.length > (yourTurn.length > 0 ? 1 : 0) && (
            <>
              <SectionLabel action={<Link href="/versus?view=friends" className="font-body text-xs" style={{ color: TEAL }}>See all →</Link>}>Active matches</SectionLabel>
              <div className="space-y-2">{activeMatches.slice(yourTurn.length > 0 ? 1 : 0).map((c) => <MatchRow key={c.id} c={c} />)}</div>
            </>
          )}

          {/* Recent results */}
          {results.length > 0 && (
            <>
              <SectionLabel>Recent results</SectionLabel>
              <div className="space-y-2">{results.slice(0, 5).map((c) => <ResultRow key={c.id} c={c} />)}</div>
            </>
          )}

          {/* Your record */}
          {hasHistory && (
            <>
              <SectionLabel>Your record</SectionLabel>
              <RecordStrip wins={stats.record.wins} losses={stats.record.losses} winRate={stats.record.winRate} streak={stats.record.streak} streakType={stats.record.streakType} />
            </>
          )}

          {/* Your rivalries — or, once they've played at all, the pull toward
              the first one (an empty section teaches; a missing one doesn't). */}
          {stats.rivalries.length > 0 ? (
            <>
              <SectionLabel action={<Link href="/versus?view=friends" className="font-body text-xs" style={{ color: TEAL }}>See all →</Link>}>Your rivalries</SectionLabel>
              <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
                {stats.rivalries.slice(0, 6).map((r) => <RivalryCard key={r.opponentId} r={r} onChallenge={(id) => setSheet({ kind: "game", target: id })} />)}
              </div>
            </>
          ) : hasHistory ? (
            <>
              <SectionLabel>Your rivalries</SectionLabel>
              <div className="rounded-2xl px-4 py-4 flex items-center gap-3" style={{ background: "#0e1611", border: "1px dashed rgba(255,255,255,0.14)" }}>
                <div className="flex-1">
                  <p className="font-body text-sm font-semibold text-white">Your first rivalry is one rematch away</p>
                  <p className="font-body text-xs text-text-muted mt-1">Play the same player twice and your head-to-head record lives here.</p>
                </div>
                <button onClick={() => setSheet({ kind: "game" })} className="font-display text-xs tracking-wide px-3.5 py-2.5 rounded-lg flex-shrink-0" style={{ background: "rgba(0,216,192,0.1)", color: TEAL, border: `1px solid ${TEAL}33` }}>CHALLENGE</button>
              </div>
            </>
          ) : null}

          {/* Community: live pulse, the results feed, public leagues, friends
              promo (debate card lives on the home page now; the full argument
              is at /debate) */}
          <LiveActivityStrip />
          <CommunityHighlights />
          <PublicLeaguesRail limit={2} />
          <VersusDiscovery promoOnly />
        </div>
      )}

      {sheet?.kind === "game" && <GameSheet target={sheet.target} onClose={() => setSheet(null)} />}
      {sheet?.kind === "code" && <CodeSheet onClose={() => setSheet(null)} />}

      <BottomNav />
    </main>
  );
}

export default function VersusPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-bg" />}>
      <VersusInner />
    </Suspense>
  );
}
