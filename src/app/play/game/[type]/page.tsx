"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { haptic } from "@/lib/haptics";
import { BottomNav } from "@/components/ui/BottomNav";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/hooks/useUser";
import { useHideGamesNav } from "@/lib/gamesNav";
import { useGameLoop } from "@/lib/useGameLoop";
import { trackGamePlay, trackGameComplete } from "@/lib/analytics/trackGame";
import {
  scoreAnswer,
  calculatePerfectRoundBonus,
  getSpeedLabel,
  maxPointsForDifficulty,
} from "@/lib/scoring";
import { DIFFICULTY_COLOR as DIFF_COLOR, DIFFICULTY_BG as DIFF_BG } from "@/lib/theme";
import { GameEntry } from "@/components/games/GameEntry";
import { GameHeader, timerDisplay } from "@/components/games/GameHeader";
import { ResultShell } from "@/components/games/ResultShell";

// ── Game type config ────────────────────────────────────────────────────────

type GameType = "higher-lower" | "guess-the-player";

const GAME_CONFIG: Record<GameType, {
  title: string;
  tagline: string;
  accent: string;
  how: string;
}> = {
  // Accents are each game's OWN section colour (founder ruling 2026-07-18:
  // separate games next to Quiz and 38-0) — they match the GameSwitcher tabs,
  // not Quiz teal / 38-0 lime as before.
  "higher-lower": {
    title: "Higher or Lower",
    tagline: "Two same-position players, one stat. Pick the bigger number.",
    accent: "#ff7800",
    how: "Each question shows two Premier League players in the same position. Tap the one with more. Faster answers score more.",
  },
  "guess-the-player": {
    title: "Guess the Player",
    tagline: "Clues drip in. Name the mystery footballer.",
    accent: "#4fc3f7",
    how: "Each question gives you clues (or a career path) and four players. Pick who it is. The quicker, the better.",
  },
};

// ── Types ─────────────────────────────────────────────────────────────────

interface ServedQuestion {
  idx: number;
  format: string;
  prompt: string;
  difficulty: string;
  options: { id: number; label: string }[];
  clue?: { nationality?: string; flagUrl?: string; jersey?: number };
  topic?: string;
  position?: string;
}

// Higher-or-Lower topics (mirrors HL_TOPICS in serve.ts) + the Mixed default.
const HL_TOPICS = [
  { key: "mixed", label: "Mixed" },
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "appearances", label: "Appearances" },
  { key: "age", label: "Age" },
  // Pickable, but held back in Mixed rounds (RARE_IN_MIXED in serve.ts): it's a
  // fantasy-manager question, not a football-knowledge one.
  { key: "points", label: "FPL points" },
] as const;

/** Small SVG glyph per topic — no emojis (founder Jul 11). */
function TopicGlyph({ topic, size = 15 }: { topic?: string; size?: number }) {
  const c = { width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor" as const, strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (topic) {
    case "goals":
      return (
        <svg {...c} strokeWidth={1.3}><circle cx="8" cy="8" r="6" /><path d="M8 4.4 l2.7 2 -1 3.2 -3.4 0 -1 -3.2 z" fill="currentColor" stroke="none" /></svg>
      );
    case "assists":
      return (
        <svg {...c}><path d="M2 11 C 5 5.5, 9 4.5, 13.2 5.4" /><path d="M10.2 3.6 L13.4 5.4 L11.9 8.4" /></svg>
      );
    case "appearances":
      return (
        <svg {...c} strokeWidth={1.2}><path d="M6 2.6 L3 4 L2 7 L4 7.6 L4 13.4 L12 13.4 L12 7.6 L14 7 L13 4 L10 2.6 L9 3.6 Q8 4.7 7 3.6 Z" /></svg>
      );
    case "age":
      return (
        <svg {...c} strokeWidth={1.35}><circle cx="8" cy="9.2" r="4.8" /><path d="M8 9.2 V6.3" /><path d="M6.4 2.6 h3.2" /><path d="M8 2.6 V4.4" /></svg>
      );
    case "points": // a rising form line
      return (
        <svg {...c} strokeWidth={1.4}><path d="M2 12 L6 8 L9 10 L14 4" /><path d="M10.6 4 H14 V7.4" /></svg>
      );
    default: // mixed / shuffle
      return (
        <svg {...c} strokeWidth={1.4}><path d="M2 5 h7 l-2 -2 M9 5 l-2 2" /><path d="M14 11 h-7 l2 -2 M7 11 l2 2" /></svg>
      );
  }
}

interface AnswerRecord {
  idx: number;
  // The option actually tapped. Kept so the finished run can be re-graded
  // server-side from its seed; -1 is a timeout (nothing picked).
  optionId: number;
  correct: boolean;
  points: number;
  elapsedMs: number;
}

// ── Guest run, held for the sign-up round trip ────────────────────────────
// A finished guest run parked locally so SIGN UP & SAVE SCORE actually saves
// something: when they come back signed in, the seed and answers are posted to
// /api/games/<type> for server-side re-grading. The local copy is evidence of
// what was tapped, never a score — the server derives that itself.
// Mirrors the Quiz's GUEST_RESULT pattern in challenges/[slug].
const GUEST_RUN_KEY = "games:guest-run:v1";
const GUEST_RUN_TTL_MS = 48 * 60 * 60 * 1000;
type GuestRun = { game: string; seed: string; answers: { idx: number; optionId: number; elapsedMs: number }[]; ts: number };

function saveGuestRun(r: GuestRun) {
  try { localStorage.setItem(GUEST_RUN_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}
function loadGuestRun(): GuestRun | null {
  try {
    const raw = localStorage.getItem(GUEST_RUN_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as GuestRun;
    if (!r?.seed || !Array.isArray(r.answers) || Date.now() - (r.ts ?? 0) > GUEST_RUN_TTL_MS) { clearGuestRun(); return null; }
    return r;
  } catch { return null; }
}
function clearGuestRun() {
  try { localStorage.removeItem(GUEST_RUN_KEY); } catch { /* ignore */ }
}

type Phase = "intro" | "loading" | "playing" | "results" | "countdown";

// A 3-2-1-GO countdown runs before these fast, timed reaction games so the
// player isn't dropped straight into a live timer (founder 7 Aug). Games with
// their own appropriate pre-game flow are deliberately NOT in this set.
const COUNTDOWN_GAMES = new Set(["higher-lower", "guess-the-player"]);
// Guess the Player has no categories or settings to configure, so its intro /
// how-to-play screen is a forced step with nothing to do — skip straight to the
// countdown (founder 7 Aug). Its flow becomes: Quick Play → countdown → game.
const SKIP_INTRO_GAMES = new Set(["guess-the-player"]);

// A clean 3 → 2 → 1 → GO gate. Self-contained: runs its sequence once on mount
// and calls onDone when GO clears; the game's timer stays paused until then
// because it only ticks in the "playing" phase.
function GameCountdown({ accent, onDone }: { accent: string; onDone: () => void }) {
  const [n, setN] = useState(3); // 0 renders as GO
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const step = 650;
    const timers = [
      setTimeout(() => setN(2), step),
      setTimeout(() => setN(1), step * 2),
      setTimeout(() => setN(0), step * 3),
      setTimeout(() => doneRef.current(), step * 4),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  const go = n === 0;
  return (
    <main style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "#080d0a", color: "#eef2f0" }}>
      <style>{`@keyframes gdPop { 0% { opacity: 0; transform: scale(0.6); } 40% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .gd-pop { animation: none !important; } }`}</style>
      <div key={n} className="gd-pop font-display" aria-live="assertive"
        style={{ fontSize: go ? 76 : 128, lineHeight: 1, letterSpacing: "0.01em", color: go ? accent : "#eef2f0", animation: "gdPop 0.55s ease-out both" }}>
        {go ? "GO" : n}
      </div>
    </main>
  );
}

function scoreData(pct: number) {
  if (pct >= 0.9) return { emoji: "🏆", label: "Elite Knowledge", color: "#00d8c0" };
  if (pct >= 0.75) return { emoji: "⚡", label: "Sharp.", color: "#aeea00" };
  if (pct >= 0.55) return { emoji: "⚽", label: "Decent.", color: "#4fc3f7" };
  if (pct >= 0.35) return { emoji: "📚", label: "Keep watching.", color: "#aeea00" };
  return { emoji: "😬", label: "Back to basics.", color: "#ff4757" };
}

// ── Option button (generic — 2 for Higher/Lower, 4 for Guess the Player) ─────

function OptionButton({
  label,
  optionId,
  selectedId,
  revealed,
  answerId,
  accent,
  onPick,
}: {
  label: string;
  optionId: number;
  selectedId: number | null;
  revealed: boolean;
  answerId: number | null;
  accent: string;
  onPick: (id: number) => void;
}) {
  const isSelected = selectedId === optionId;
  const isCorrect = revealed && answerId === optionId;
  const isWrong = revealed && isSelected && !isCorrect;
  const isDimmed = revealed && !isCorrect && !isSelected;

  let bg = "rgba(255,255,255,0.03)";
  let border = "rgba(255,255,255,0.09)";
  let color = "#eef2f0";
  let chip = "";

  if (isCorrect) {
    bg = "rgba(174,234,0,0.1)"; border = "#aeea00"; color = "#aeea00"; chip = "✓";
  } else if (isWrong) {
    bg = "rgba(255,71,87,0.08)"; border = "rgba(255,71,87,0.5)"; color = "#ff4757"; chip = "✗";
  } else if (isDimmed) {
    bg = "transparent"; border = "rgba(255,255,255,0.04)"; color = "#3a423d";
  } else if (isSelected && !revealed) {
    bg = `${accent}10`; border = `${accent}50`; color = accent;
  }

  return (
    <button
      onClick={() => onPick(optionId)}
      disabled={selectedId !== null}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.98]"
      style={{ background: bg, border: `1.5px solid ${border}`, color, minHeight: 60 }}
    >
      {chip && (
        <span className="w-8 h-8 rounded-xl flex items-center justify-center font-display text-sm flex-shrink-0"
          style={{ background: isCorrect ? "#aeea00" : "rgba(255,71,87,0.2)", color: isCorrect ? "#0a0a0f" : "#ff4757" }}>
          {chip}
        </span>
      )}
      <span className="font-body text-base font-semibold leading-snug">{label}</span>
    </button>
  );
}

// ── Who-am-I visual clues ────────────────────────────────────────────────

/** Nationality flag + country name. */
function FlagClue({ nationality, flagUrl }: { nationality?: string; flagUrl?: string }) {
  if (!nationality && !flagUrl) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
      {flagUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={flagUrl} alt={nationality ?? "flag"} width={30} height={20}
          style={{ width: 30, height: 20, objectFit: "cover", borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.5)" }} />
      ) : null}
      <div className="leading-tight">
        <div className="font-body text-xs" style={{ color: "#586058" }}>Nationality</div>
        <div className="font-body text-sm font-semibold text-white">{nationality ?? "—"}</div>
      </div>
    </div>
  );
}

/** Shirt-back graphic with the squad number. */
function ShirtNumber({ n, accent }: { n: number; accent: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
      <svg width="34" height="34" viewBox="0 0 64 64" fill="none" style={{ flexShrink: 0 }}>
        <path d="M23 6 L10 13 L5 27 L15 31 L15 59 L49 59 L49 31 L59 27 L54 13 L41 6 L38 9 Q32 14 26 9 Z"
          fill={`${accent}1f`} stroke={accent} strokeWidth="2.5" strokeLinejoin="round" />
        <text x="32" y="44" textAnchor="middle" fontSize="26" fontWeight="800" fill="#ffffff"
          fontFamily="ui-sans-serif, system-ui, sans-serif">{n}</text>
      </svg>
      <div className="leading-tight">
        <div className="font-body text-xs" style={{ color: "#586058" }}>Shirt number</div>
        <div className="font-body text-sm font-semibold text-white">No. {n}</div>
      </div>
    </div>
  );
}

/** The revealed player headshot (post-answer). */
function RevealPhoto({ url, name }: { url: string; name?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name ?? "player"} width={52} height={52}
      style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover",
        border: "2px solid rgba(255,255,255,0.15)", background: "#0b1310", flexShrink: 0 }} />
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

// ── The board ─────────────────────────────────────────────────────────────
// Lives on the game's own intro screen rather than a route of its own. These
// games already had a page nobody could reach; a /leaderboard URL would have
// been a second one. Here it sits where a player already lands, and it doubles
// as the "beat this" that a game with no board was missing.
interface BoardEntry { userId: string; username: string | null; avatarUrl: string | null; best: number; plays: number }
interface MyStanding { best: number; plays: number; rank: number | null }

function BoardRow({ entry, rank, isYou, accent }: { entry: BoardEntry; rank: number; isYou: boolean; accent: string }) {
  const name = entry.username ?? "Player";
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <div className="flex items-center gap-3 px-5 py-2.5"
      style={isYou ? { background: `${accent}10` } : undefined}>
      <span className="font-display text-sm w-7 flex-shrink-0 text-center"
        style={{ color: rank <= 3 ? accent : "#586058" }}>
        {medal ?? `#${rank}`}
      </span>
      {entry.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.avatarUrl} alt="" className="w-7 h-7 rounded-full flex-shrink-0 object-cover" />
      ) : (
        <span className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center font-display text-xs"
          style={{ background: "rgba(255,255,255,0.07)", color: "#9aa39d" }}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-body text-sm text-white truncate">{name}{isYou ? " (you)" : ""}</p>
        <p className="font-body text-xs" style={{ color: "#586058" }}>
          {entry.plays} {entry.plays === 1 ? "round" : "rounds"}
        </p>
      </div>
      <span className="font-display text-lg flex-shrink-0" style={{ color: isYou ? accent : "#fff" }}>
        {entry.best.toLocaleString()}
      </span>
    </div>
  );
}

function GameBoard({ type, accent, userId, refreshKey }: { type: GameType; accent: string; userId: string | null; refreshKey: number }) {
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [you, setYou] = useState<MyStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/games/${type}?limit=25`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setEntries(Array.isArray(d.entries) ? d.entries : []);
        setYou(d.you ?? null);
      })
      .catch(() => { /* a board that won't load must not break the game */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, refreshKey]);

  const TOP = 10;
  const visible = showAll ? entries : entries.slice(0, TOP);
  // Their row is already on screen if it's in the slice — only pin a second
  // copy when it isn't.
  const youInVisible = you !== null && you.rank !== null && you.rank <= visible.length;

  return (
    <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <p className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>LEADERBOARD</p>
        {you?.rank != null && (
          <span className="font-display text-xs px-2 py-0.5 rounded-full"
            style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}>
            YOU #{you.rank}
          </span>
        )}
      </div>

      {loading ? (
        <div className="px-5 pb-5"><p className="font-body text-xs" style={{ color: "#586058" }}>Loading…</p></div>
      ) : entries.length === 0 ? (
        <div className="px-5 pb-5">
          <p className="font-body text-sm text-white mb-1">No scores yet</p>
          <p className="font-body text-xs" style={{ color: "#586058" }}>
            {userId ? "Play a round and the top spot is yours." : "Play a round and sign up to take the top spot."}
          </p>
        </div>
      ) : (
        <div className="pb-2">
          {visible.map((e, i) => (
            <BoardRow key={e.userId} entry={e} rank={i + 1} isYou={e.userId === userId} accent={accent} />
          ))}
          {you !== null && you.rank !== null && !youInVisible && (
            <>
              <div className="px-5 py-1 text-center">
                <span className="font-body text-xs" style={{ color: "#586058" }}>···</span>
              </div>
              <BoardRow
                entry={{ userId: userId ?? "you", username: null, avatarUrl: null, best: you.best, plays: you.plays }}
                rank={you.rank}
                isYou
                accent={accent}
              />
            </>
          )}
          {!showAll && entries.length > TOP && (
            <button onClick={() => setShowAll(true)}
              className="w-full py-3 font-body text-xs text-center transition-colors"
              style={{ color: accent, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              View full leaderboard ({entries.length} players) ↓
            </button>
          )}
          {showAll && entries.length > TOP && (
            <button onClick={() => setShowAll(false)}
              className="w-full py-3 font-body text-xs text-center"
              style={{ color: "#586058", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              Show less ↑
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function GameTypeGame() {
  const params = useParams<{ type: string }>();
  const router = useRouter();
  const type = params.type as GameType;
  const config = GAME_CONFIG[type];

  // Guest vs signed-in only changes the results screen (the run itself never
  // gates). `loading` matters: treating a resolving session as a guest would
  // flash the sign-up block at someone who already has an account.
  const { user, loading: userLoading } = useUser();
  const isGuest = !user && !userLoading;

  // A guest run waiting to be claimed: they played signed out, tapped SIGN UP &
  // SAVE SCORE, and have landed back here with an account. Post it before they
  // do anything else so the score is genuinely on the board, which is what the
  // sign-up ask promised. The server re-grades from the seed, so a tampered
  // local copy buys nothing.
  useEffect(() => {
    if (!user) return;
    const pending = loadGuestRun();
    if (!pending || pending.game !== type) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/games/${type}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", seed: pending.seed, answers: pending.answers }),
        });
        if (res.ok) {
          const d = await res.json();
          clearGuestRun();
          if (!cancelled && d.saved) {
            setClaimed(typeof d.score === "number" ? d.score : 0);
            setBoardKey((k) => k + 1);
          }
        } else if (res.status !== 429) {
          clearGuestRun(); // unrecoverable — don't retry this forever
        }
      } catch {
        /* offline: the run keeps its TTL and the next visit tries again */
      }
    })();
    return () => { cancelled = true; };
  }, [user, type]);

  const [phase, setPhase] = useState<Phase>("intro");
  // "loading" here is the post-START deal — already part of the run, so the
  // persistent GamesNav steps away for it too, not just for "playing".
  useHideGamesNav(phase === "playing" || phase === "loading" || phase === "countdown");
  const [topic, setTopic] = useState<string>("mixed"); // Higher-or-Lower topic
  const [copied, setCopied] = useState(false); // results share confirmation
  // Set from the server's own re-grade of the finished run. `rank` is the
  // position this score takes (signed in) or would take (guest); `saved` is
  // true once the row is actually on the board.
  const [rank, setRank] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [claimed, setClaimed] = useState<number | null>(null); // guest run banked on return
  // Bumped whenever a score lands, so the board on the intro screen refetches
  // instead of showing the standings from before the round just played.
  const [boardKey, setBoardKey] = useState(0);

  // Today's Game hero links here with `?daily=1` — the ONE pinned round for
  // today's London date, identical for every player (comparable scores).
  // Read from the URL after mount (not useSearchParams) so server/client
  // markup match on first paint; the effect runs before a user could click
  // START, so there's no race.
  const [isDailyMode, setIsDailyMode] = useState(false);
  // Mirrors isDailyMode but updates synchronously (refs aren't batched the way
  // state is), so the ?start=1 autostart effect below — which can fire in the
  // same passive-effect flush as this one, before the isDailyMode state update
  // has actually applied — still sees the daily flag when it calls startRound().
  const dailyModeRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("daily") === "1") {
      dailyModeRef.current = true;
      setIsDailyMode(true);
    }
  }, []);

  // Today's Game / a push notification deep link can ask the round to start
  // itself (`?start=1`) instead of waiting for a tap on the intro screen. Same
  // "read window.location.search after mount" pattern as ?daily=1 above (kept
  // out of useSearchParams so server/client markup still match on first
  // paint), and guarded with a ref so it only ever fires once per mount.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (autoStartedRef.current) return;
    if (phase !== "intro") return;
    // Start on ?start=1 (autostart from Quick Play), OR always for games whose
    // intro is a forced empty step (Guess the Player) — skip straight to the game.
    const wants = new URLSearchParams(window.location.search).get("start") === "1";
    if (!wants && !SKIP_INTRO_GAMES.has(type)) return;
    autoStartedRef.current = true;
    void startRound();
    // startRound/type are stable for this effect's purpose; autoStartedRef guards
    // against a double fire, so we intentionally key only off phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  // Whether the pinned round has been drawn yet in THIS session — consumed
  // on the first draw, so "Play Again" (and any later visit to the intro
  // screen via Quit) falls back to normal random rounds. Pinning is for the
  // ONE daily play, not every replay.
  const dailyConsumedRef = useRef(false);
  // The pinned round is always "mixed" (server-enforced too) — a chosen
  // topic would make two players' daily rounds diverge — so the topic
  // picker is hidden until the pinned round has been consumed.
  const showTopicPicker = type === "higher-lower" && (!isDailyMode || dailyConsumedRef.current);
  const [seed, setSeed] = useState<string>("");
  const [windowMs, setWindowMs] = useState(25_000);
  const [questions, setQuestions] = useState<ServedQuestion[]>([]);
  const [loadError, setLoadError] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revealAnswerId, setRevealAnswerId] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const [score, setScore] = useState(0);
  const [answerLog, setAnswerLog] = useState<AnswerRecord[]>([]);
  const [correctStreak, setCorrectStreak] = useState(0);
  const [wrongStreak, setWrongStreak] = useState(0);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [lastSpeedLabel, setLastSpeedLabel] = useState<string | null>(null);
  const [lastStreakBonus, setLastStreakBonus] = useState(0);
  const [revealPhoto, setRevealPhoto] = useState<string | null>(null);
  const [revealName, setRevealName] = useState<string | null>(null);

  // Ad/analytics play + complete signals, fired on phase TRANSITIONS so replaying in the
  // same session counts as a new play. `complete` fires only on playing → results, never
  // on any other route into the results screen. `type` is the GameId, so Higher or Lower
  // and Guess the Player report as distinct games (plus the cross-game PlayAny twin).
  const prevPhaseRef = useRef<Phase | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === prev) return;
    if (phase === "playing") trackGamePlay(type, { topic });
    else if (phase === "results" && prev === "playing") trackGameComplete(type, { score });
  }, [phase, type, topic, score]);

  const advanceRef = useRef(false);

  const { timerMs, setTimerMs, questionStartRef, stopTimer } = useGameLoop(
    phase === "playing",
    currentIdx,
  );

  // Unknown type → bounce back to the picker.
  if (!config) {
    if (typeof window !== "undefined") router.replace("/play");
    return null;
  }

  const currentQ = questions[currentIdx];
  // Max = every question at Lightning speed for its difficulty band.
  const maxScore = questions.reduce((s, q) => s + maxPointsForDifficulty(q.difficulty), 0);

  function resetRoundState() {
    setCurrentIdx(0);
    setSelectedId(null);
    setRevealed(false);
    setRevealAnswerId(null);
    setAdvancing(false);
    setScore(0);
    setRank(null);
    setSaved(false);
    setAnswerLog([]);
    setCorrectStreak(0);
    setWrongStreak(0);
    setLastPoints(null);
    setLastSpeedLabel(null);
    setLastStreakBonus(0);
    setRevealPhoto(null);
    setRevealName(null);
    setTimerMs(0);
  }

  // Bank the finished run. The server rebuilds the round from the seed and
  // re-grades every answer, so what goes on the board is its number, not ours.
  // A guest's run is parked locally FIRST: the request still goes out (it comes
  // back with the rank the score would take, which is what the sign-up ask
  // shows), but nothing is saved until there is an account to save it against.
  async function bankRun(log: AnswerRecord[]) {
    if (!seed) return;
    const answers = log.map((r) => ({ idx: r.idx, optionId: r.optionId, elapsedMs: r.elapsedMs }));
    if (isGuest) saveGuestRun({ game: type, seed, answers, ts: Date.now() });
    try {
      const res = await fetch(`/api/games/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", seed, answers }),
      });
      if (!res.ok) return;
      const d = await res.json();
      if (typeof d.rank === "number") setRank(d.rank);
      if (d.saved) { setSaved(true); clearGuestRun(); setBoardKey((k) => k + 1); }
    } catch {
      /* offline — the guest copy is already parked, and a signed-in player can
         replay. Never block the results screen on this. */
    }
  }

  // Share the result as text plus the game link. These two games have no OG card
  // route (unlike quiz and perfect-10), so there is no image to share — keep the
  // copy plain and let the link do the work.
  async function handleShareResult() {
    const text = `I scored ${score.toLocaleString()} on ${config.title}. Beat that.`;
    const url = `${window.location.origin}/play/game/${type}`;
    const payload = `${text} ${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: config.title, text, url });
        return;
      } catch {
        /* sheet dismissed — fall through to copy rather than dead-ending */
      }
    }

    // navigator.clipboard throws NotAllowedError in a few real contexts (an
    // embedded webview, a page that lost focus mid-tap). Falling back to the
    // legacy execCommand path keeps the button from doing visibly nothing,
    // which is the exact friction this screen was rebuilt to remove.
    let ok = false;
    try {
      await navigator.clipboard.writeText(payload);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function startRound() {
    setPhase("loading");
    setLoadError(false);
    // Only the FIRST draw in a daily-mode session asks for the pinned round —
    // once consumed, "Play Again" is normal random practice. Reads the ref,
    // not the isDailyMode state, so an autostarted round sees the flag even
    // when both mount effects fire before React has applied the state update.
    const useDaily = dailyModeRef.current && !dailyConsumedRef.current;
    if (useDaily) dailyConsumedRef.current = true;
    try {
      const res = await fetch(`/api/games/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draw", topic, daily: useDaily }),
      });
      if (!res.ok) throw new Error("draw failed");
      const data = await res.json();
      if (!Array.isArray(data.questions) || data.questions.length === 0) throw new Error("empty round");
      setSeed(data.seed);
      setWindowMs(typeof data.window === "number" ? data.window : 25_000);
      setQuestions(data.questions as ServedQuestion[]);
      resetRoundState();
      // Reaction games get a 3-2-1-GO first; the rest go straight in.
      setPhase(COUNTDOWN_GAMES.has(type) ? "countdown" : "playing");
    } catch {
      setLoadError(true);
      setPhase("intro");
    }
  }

  async function handlePick(optionId: number) {
    if (selectedId !== null || revealed || advancing || !currentQ) return;
    stopTimer();
    const elapsed = Date.now() - questionStartRef.current;
    setSelectedId(optionId);

    let correct = false;
    let answerId: number | null = null;
    let basePoints = 0;
    let photoUrl: string | null = null;
    let name: string | null = null;
    try {
      const res = await fetch(`/api/games/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", seed, idx: currentIdx, optionId, elapsedMs: elapsed }),
      });
      if (res.ok) {
        const g = await res.json();
        correct = Boolean(g.correct);
        answerId = typeof g.answerId === "number" ? g.answerId : null;
        basePoints = typeof g.points === "number" ? g.points : 0;
        photoUrl = typeof g.photoUrl === "string" ? g.photoUrl : null;
        name = typeof g.name === "string" ? g.name : null;
      }
    } catch {
      /* network error — reveal without a highlight, treated as wrong */
    }

    // Streak/comeback bonuses computed client-side for display flair (v1 is
    // unranked; correctness + base points are server-authoritative).
    const { streakBonus, comebackBonus, nextCorrectStreak, nextWrongStreak } = scoreAnswer({
      isCorrect: correct,
      elapsedMs: elapsed,
      difficulty: currentQ.difficulty,
      correctStreak,
      wrongStreak,
      windowMs,
    });
    const pts = basePoints + streakBonus + comebackBonus;

    void haptic(correct ? "correct" : "wrong");
    setRevealAnswerId(answerId);
    setRevealPhoto(photoUrl);
    setRevealName(name);
    setRevealed(true);
    setCorrectStreak(nextCorrectStreak);
    setWrongStreak(nextWrongStreak);
    setLastPoints(correct ? pts : null);
    setLastSpeedLabel(correct ? getSpeedLabel(elapsed, windowMs) : null);
    setLastStreakBonus(streakBonus + comebackBonus);
    if (correct) setScore((s) => s + pts);

    const record: AnswerRecord = { idx: currentIdx, optionId, correct, points: correct ? pts : 0, elapsedMs: elapsed };
    const newLog = [...answerLog, record];
    setAnswerLog(newLog);

    setAdvancing(true);
    advanceRef.current = true;
    setTimeout(() => {
      if (currentIdx + 1 >= questions.length) {
        const correctCount = newLog.filter((r) => r.correct).length;
        if (correctCount === questions.length) void haptic("win");
        const perfectBonus = calculatePerfectRoundBonus(correctCount, questions.length);
        setScore((s) => s + perfectBonus);
        setPhase("results");
        void bankRun(newLog);
      } else {
        setCurrentIdx((i) => i + 1);
        setSelectedId(null);
        setRevealed(false);
        setRevealAnswerId(null);
        setRevealPhoto(null);
        setRevealName(null);
        setLastPoints(null);
        setLastSpeedLabel(null);
        setLastStreakBonus(0);
      }
      setAdvancing(false);
      advanceRef.current = false;
    }, 1600);
  }

  const accent = config.accent;

  // ── Countdown ────────────────────────────────────────────────────────────
  // 3-2-1-GO before a reaction game. The timer only ticks in "playing", so the
  // round is genuinely paused behind this.
  if (phase === "countdown") {
    return <GameCountdown accent={accent} onDone={() => setPhase("playing")} />;
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: accent, borderTopColor: "transparent" }} />
          <p className="font-display text-xs tracking-widest text-text-muted">DEALING QUESTIONS…</p>
        </div>
      </div>
    );
  }

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <>
        <GameEntry
          title={config.title}
          coverSrc={`/game-covers/${type}.webp`}
          accent={accent}
          tagline={config.tagline}
          meta={["Premier League", "10 questions"]}
          how={config.how}
          primaryLabel="PLAY · 10 Qs"
          primaryTone="teal"
          onPlay={startRound}
          error={loadError ? "Couldn't load questions, try again." : null}
        >
          {/* They played as a guest, signed up, and landed back here. Close the
              loop out loud: the whole ask was that this score would be kept. */}
          {claimed !== null && (
            <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
              style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.2)" }}>
              <span className="text-xl">✓</span>
              <div>
                <p className="font-display text-sm tracking-wide text-green">Score saved</p>
                <p className="font-body text-xs text-text-muted">
                  Your {claimed.toLocaleString()} is on the board.
                </p>
              </div>
            </div>
          )}

          {/* Topic picker (Higher or Lower). Mixed = a few topics across the round.
              Hidden for the pinned "Today's Game" round — no topic choice
              until the pinned round has been played. */}
          {showTopicPicker && (
            <div>
              <p className="font-display text-xs tracking-widest mb-2.5" style={{ color: "#586058" }}>CHOOSE A TOPIC</p>
              <div className="flex flex-wrap gap-2">
                {HL_TOPICS.map((t) => {
                  const on = topic === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTopic(t.key)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full font-body text-sm transition-all active:scale-[0.97]"
                      style={{
                        background: on ? `${accent}1f` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${on ? accent : "rgba(255,255,255,0.1)"}`,
                        color: on ? accent : "#9aa39d",
                      }}
                    >
                      <TopicGlyph topic={t.key} /> {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <GameBoard type={type} accent={accent} userId={user?.id ?? null} refreshKey={boardKey} />
        </GameEntry>

        <BottomNav />
      </>
    );
  }

  // ── Playing ──────────────────────────────────────────────────────────────
  if (phase === "playing" && currentQ) {
    const progressFilled = ((currentIdx + (revealed ? 1 : 0)) / questions.length) * 100;
    const diff = currentQ.difficulty.toLowerCase();
    const diffColor = DIFF_COLOR[diff] ?? accent;
    const diffBg = DIFF_BG[diff] ?? `${accent}20`;

    return (
      <div className="min-h-screen flex flex-col bg-bg">
        <GameHeader
          accent={accent}
          progressPct={progressFilled}
          onQuit={() => { stopTimer(); setPhase("intro"); resetRoundState(); }}
          timerMs={timerMs}
          timerFrozen={revealed}
          score={score}
          current={currentIdx + 1}
          total={questions.length}
          difficulty={diff}
          difficultyColor={diffColor}
          difficultyBg={diffBg}
        />

        <div className="flex-1 px-5 pb-10 pt-4 flex flex-col max-w-lg mx-auto w-full">
          {/* Who-am-I visual clues: nationality flag + shirt number */}
          {currentQ.clue && (currentQ.clue.flagUrl || currentQ.clue.nationality || typeof currentQ.clue.jersey === "number") && (
            <div className="flex gap-2.5 mb-3 flex-wrap">
              <FlagClue nationality={currentQ.clue.nationality} flagUrl={currentQ.clue.flagUrl} />
              {typeof currentQ.clue.jersey === "number" && <ShirtNumber n={currentQ.clue.jersey} accent={accent} />}
            </div>
          )}

          {/* Higher-or-Lower position chip — both players share this position */}
          {currentQ.position && (
            <div className="mb-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-xs font-semibold"
                style={{ background: `${accent}14`, border: `1px solid ${accent}30`, color: accent }}>
                <TopicGlyph topic={currentQ.topic} size={13} /> {currentQ.position}
              </span>
            </div>
          )}

          <div className="rounded-2xl p-5 mb-5"
            style={{ background: "linear-gradient(145deg, #0e1611 0%, #15211a 100%)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 96 }}>
            <p className="font-body text-lg font-semibold text-white leading-relaxed whitespace-pre-line">{currentQ.prompt}</p>
          </div>

          <div className="space-y-3">
            {currentQ.options.map((o) => (
              <OptionButton
                key={o.id}
                label={o.label}
                optionId={o.id}
                selectedId={selectedId}
                revealed={revealed}
                answerId={revealAnswerId}
                accent={accent}
                onPick={handlePick}
              />
            ))}
          </div>

          {revealed && (
            <div className="mt-4 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3"
              style={{
                background: lastPoints !== null ? "rgba(174,234,0,0.08)" : "rgba(255,71,87,0.08)",
                border: `1px solid ${lastPoints !== null ? "rgba(174,234,0,0.22)" : "rgba(255,71,87,0.22)"}`,
              }}>
              <div className="flex items-center gap-3 min-w-0">
                {revealPhoto && <RevealPhoto url={revealPhoto} name={revealName ?? undefined} />}
                <div className="min-w-0">
                  <span className="font-display text-lg tracking-wider"
                    style={{ color: lastPoints !== null ? "#aeea00" : "#ff4757" }}>
                    {lastPoints !== null ? "✓ CORRECT" : "✗ WRONG"}
                  </span>
                  {revealName && (
                    <div className="font-body text-sm font-semibold text-white truncate">{revealName}</div>
                  )}
                </div>
              </div>
              {lastPoints !== null && (
                <div className="text-right flex-shrink-0">
                  <div className="font-display text-2xl" style={{ color: accent }}>+{lastPoints.toLocaleString()}</div>
                  {lastSpeedLabel && <div className="font-body text-xs mt-0.5 text-text-muted">{lastSpeedLabel}</div>}
                  {lastStreakBonus > 0 && <div className="font-body text-xs" style={{ color: "#aeea00" }}>+{lastStreakBonus} bonus</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────
  if (phase === "results") {
    const correctCount = answerLog.filter((r) => r.correct).length;
    const total = questions.length;
    const pct = maxScore > 0 ? score / maxScore : 0;
    const accPct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const fastestMs = answerLog.length ? Math.min(...answerLog.map((r) => r.elapsedMs)) : 0;
    const { label, color } = scoreData(pct);

    return (
      <>
        <ResultShell
          accent={accent}
          coverSrc={`/game-covers/${type}.webp`}
          score={score.toLocaleString()}
          scoreSub={`out of ${maxScore.toLocaleString()} pts`}
          badge={{ label, color }}
          stats={[
            { value: `${correctCount}/${total}`, label: "Correct" },
            { value: `${accPct}%`, label: "Accuracy", color: accent },
            { value: timerDisplay(fastestMs), label: "Fastest", color: "#aeea00" },
          ]}
          save={
            <>
              {/* The guest's whole reason to open an account, at the one moment they
                  have something worth keeping. Same block the Quiz result ships
                  (challenges/[slug]) — minus its "You'd be #N on the leaderboard"
                  line, because these two games have no board to project a rank
                  against yet. Everything else is the Quiz's approved wording. */}
              {isGuest && (
                <div className="rounded-2xl p-5"
                  style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.22)" }}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-2xl px-3 py-2 font-display text-xl"
                      style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>
                      {score.toLocaleString()}
                    </div>
                    <div>
                      {/* The rank comes from the server's own re-grade, so it is the
                          real position this score takes. Before it lands (or if the
                          request failed) the ask still stands on the score alone. */}
                      <p className="font-body text-sm font-semibold text-white">
                        {rank !== null ? `You'd be #${rank} on the board` : "Sign up to lock in your spot"}
                      </p>
                      <p className="font-body text-xs text-text-muted">
                        {rank !== null
                          ? "Sign up to lock in your spot. This score is saved the moment you're in."
                          : "This score is saved the moment you're in."}
                      </p>
                    </div>
                  </div>
                  <Button variant="primary" tone="teal" size="md" fullWidth href={`/auth/sign-in?next=/play/game/${type}`}>
                    SIGN UP &amp; SAVE SCORE
                  </Button>
                </div>
              )}

              {/* Signed in: say plainly that it counted, and where it put them. The
                  screen used to end on "these don't count on the leaderboard yet". */}
              {!isGuest && saved && (
                <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
                  style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.2)" }}>
                  <span className="text-xl">✓</span>
                  <div>
                    <p className="font-display text-sm tracking-wide text-green">Score saved</p>
                    <p className="font-body text-xs text-text-muted">
                      {rank !== null ? `You're #${rank} on the board` : "You're on the board"}
                    </p>
                  </div>
                </div>
              )}
            </>
          }
          primaryLabel="PLAY AGAIN"
          onPrimary={startRound}
          secondaries={
            /* No OG card exists for these two games, so this shares text plus the
               game link rather than an image. navigator.share on native, clipboard
               everywhere else. */
            <Button variant="ghost" tone="teal" size="lg" fullWidth onClick={handleShareResult}>
              {copied ? "COPIED ✓" : "SHARE YOUR RESULT"}
            </Button>
          }
          bridge={
            /* The board lives on the intro screen, so the bridge from here points
               outward instead — to challenging a friend on the same game. */
            <Link
              href="/versus/challenge"
              className="rounded-2xl px-5 py-4 flex items-center justify-between gap-3"
              style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.22)" }}
            >
              <div className="min-w-0">
                <p className="font-body text-sm font-semibold text-white">
                  Think a friend can beat {score.toLocaleString()}?
                </p>
                <p className="font-body text-xs text-text-muted mt-0.5">Challenge them to this game</p>
              </div>
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                <path d="M7 4l5 5-5 5" stroke="#aeea00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          }
        />

        <BottomNav />
      </>
    );
  }

  return null;
}
