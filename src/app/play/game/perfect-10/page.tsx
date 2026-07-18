"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { smartBackTarget } from "@/lib/nav";
import { haptic } from "@/lib/haptics";
import { BottomNav } from "@/components/ui/BottomNav";
import { GameSwitcher } from "@/components/ui/GameSwitcher";
import { Button } from "@/components/ui/Button";

// "Perfect 10" — name everyone in a ranked top-10 football list. Third Quiz
// game-type. This is the literal /play/game/perfect-10 folder, which Next.js
// resolves BEFORE the [type] dynamic route — so this page owns the route,
// not src/app/play/game/[type]/page.tsx.
//
// Server-only answers: this page only ever sees clientList() (word-length
// arrays) pre-solve — see src/lib/games/perfect10.ts and
// src/app/api/games/perfect-10/route.ts.

const ACCENT = "#ffc400";
const STORAGE_PREFIX = "p10:attempt:v1:";
const TOTAL_RUNGS = 10;
const MAX_STRIKES = 3;

// ── Client-side types (mirrors the server's answer-free / delta shapes) ────

interface ClientRung {
  rank: number;
  wordLens: number[];
}
interface ClientListData {
  listId: string;
  title: string;
  rungs: ClientRung[];
  day: string | null;
  isToday: boolean;
}
interface LibraryItem {
  id: string;
  title: string;
  day: string;
}
interface LibraryMine {
  score: number;
  found: number;
  done: boolean;
}
interface FoundEntry {
  rank: number;
  display: string;
  surname: string;
  points: number;
  hintsUsed: number;
}
interface HintRecord {
  rank: number;
  tier: 1 | 2;
  text: string;
}
interface RevealEntry {
  rank: number;
  display: string;
  surname: string;
}
interface ChallengeSummary {
  name: string;
  score: number;
  foundRanks: number[];
}
interface GameState {
  found: FoundEntry[];
  hints: HintRecord[];
  strikes: number;
  tokensLeft: number;
  score: number;
  done: boolean;
  reveal: RevealEntry[];
}

const FRESH_GAME: GameState = { found: [], hints: [], strikes: 0, tokensLeft: 3, score: 0, done: false, reveal: [] };

type Phase = "loading" | "intro" | "playing" | "results";

// ── Name normalization — KEEP IN SYNC with src/lib/games/perfect10.ts and
// scripts/perfect10/*.mjs. Used only for the client-side typeahead filter;
// grading itself always happens server-side. ──────────────────────────────
function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rungWidthPct(rank: number): number {
  return 62 + ((rank - 1) * 38) / 9;
}

function formatDay(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function loadGuestState(listId: string): GameState {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + listId);
    if (!raw) return { ...FRESH_GAME };
    const parsed = JSON.parse(raw);
    return {
      found: Array.isArray(parsed.found) ? parsed.found : [],
      hints: Array.isArray(parsed.hints) ? parsed.hints : [],
      strikes: Number.isInteger(parsed.strikes) ? parsed.strikes : 0,
      tokensLeft: Number.isInteger(parsed.tokensLeft) ? parsed.tokensLeft : 3,
      score: Number.isInteger(parsed.score) ? parsed.score : 0,
      done: Boolean(parsed.done),
      reveal: Array.isArray(parsed.reveal) ? parsed.reveal : [],
    };
  } catch {
    return { ...FRESH_GAME };
  }
}

function saveGuestState(listId: string, game: GameState) {
  try {
    localStorage.setItem(STORAGE_PREFIX + listId, JSON.stringify(game));
  } catch {
    /* storage unavailable — guest just loses persistence, still playable */
  }
}

async function callApi(body: Record<string, unknown>) {
  const res = await fetch("/api/games/perfect-10", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// ── Dots (word-length rendering) ────────────────────────────────────────

function WordDots({ wordLens, filled }: { wordLens: number[]; filled: boolean }) {
  return (
    <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
      {wordLens.map((len, wi) => (
        <div key={wi} className="flex items-center" style={{ gap: 3 }}>
          {Array.from({ length: len }).map((_, li) => (
            <span
              key={li}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: filled ? ACCENT : "rgba(255,196,0,0.16)",
                border: filled ? "none" : "1px solid rgba(255,196,0,0.3)",
                display: "inline-block",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Bulb icon ────────────────────────────────────────────────────────────

function BulbIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.5a4.5 4.5 0 0 0-2.4 8.3c.4.25.65.7.65 1.2v.5a.5.5 0 0 0 .5.5h2.5a.5.5 0 0 0 .5-.5v-.5c0-.5.25-.95.65-1.2A4.5 4.5 0 0 0 8 1.5Z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M6.4 14h3.2" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6.7 12.3h2.6" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── One rung of the tower ───────────────────────────────────────────────

function Rung({
  rung,
  solved,
  hints,
  tokensLeft,
  popped,
  busy,
  onHint,
}: {
  rung: ClientRung;
  solved: FoundEntry | undefined;
  hints: HintRecord[];
  tokensLeft: number;
  popped: boolean;
  busy: boolean;
  onHint: (tier: 1 | 2) => void;
}) {
  const tier1 = hints.find((h) => h.tier === 1);
  const tier2 = hints.find((h) => h.tier === 2);
  const width = rungWidthPct(rung.rank);
  const hintsUsed = solved?.hintsUsed ?? (tier1 ? (tier2 ? 2 : 1) : 0);

  return (
    <div
      // flex 1 1 auto (basis = content, NOT 0): a rung carrying hint chips is
      // taller than a bare one, so equal shares would clip it. This way each
      // rung keeps the height it needs and only the LEFTOVER space is shared —
      // filling tall screens without dead air, and never forcing a scroll.
      className="mx-auto transition-transform min-h-0 flex flex-col"
      style={{
        width: `${width}%`,
        flex: "1 1 auto",
        transform: popped ? "scale(1.04)" : "scale(1)",
        transition: "transform 0.25s ease-out",
      }}
    >
      {/* The PILL takes the spare height, not the space around it. Stretching
          the wrapper instead left every tile padded by a gap as big as itself. */}
      <div
        className="rounded-lg px-2.5 flex-1 min-h-0 flex items-center gap-2"
        style={{
          background: solved ? "#2a2410" : "rgba(255,196,0,0.05)",
          border: `1px solid ${solved ? ACCENT : "rgba(255,196,0,0.16)"}`,
        }}
      >
        <span
          className="font-display text-[11px] flex-shrink-0 flex items-center justify-center rounded-full"
          style={{ width: 18, height: 18, background: "rgba(255,196,0,0.14)", color: ACCENT }}
        >
          {rung.rank}
        </span>

        <div className="flex-1 min-w-0">
          {solved ? (
            <span className="font-display text-sm tracking-wide" style={{ color: "#ffe082" }}>
              {solved.surname.toUpperCase()}
            </span>
          ) : (
            <WordDots wordLens={rung.wordLens} filled={false} />
          )}
        </div>

        {solved ? (
          <span
            className="font-display text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0 flex items-center gap-1"
            style={{
              background: hintsUsed === 0 ? "rgba(174,234,0,0.14)" : "rgba(139,148,159,0.16)",
              color: hintsUsed === 0 ? "#aeea00" : "#8b949e",
            }}
          >
            {hintsUsed > 0 && <BulbIcon color="#8b949e" size={10} />}+{solved.points}
          </span>
        ) : (
          <button
            type="button"
            disabled={busy || tokensLeft <= 0 || Boolean(tier1)}
            onClick={() => onHint(1)}
            className="flex-shrink-0 flex items-center justify-center rounded-full disabled:opacity-40"
            style={{ width: 22, height: 22, background: "rgba(138,109,26,0.25)" }}
            aria-label="Use hint"
          >
            <BulbIcon color="#8a6d1a" size={12} />
          </button>
        )}
      </div>

      {/* Hint clue chips — stay visible until the rung is solved. Kept to ONE
          line: a wrapped chip row doubles a hinted rung's height, which is what
          pushed short screens into a scroll. */}
      {!solved && tier1 && (
        <div
          className="flex flex-nowrap items-center gap-1 mt-0.5 px-1 min-w-0 mx-auto"
          // The rung tapers toward #1, but a clue the player PAID for shouldn't
          // get squeezed with it — scale the chip row back up to full tower width.
          style={{ width: `${(100 / width) * 100}%` }}
        >
          <span
            className="font-body text-[10px] px-2 py-0.5 rounded-full truncate min-w-0"
            style={{ background: "#241f0e", color: "#d4af37", border: "1px solid rgba(212,175,55,0.3)" }}
          >
            {tier1.text}
          </span>
          {tier2 ? (
            <span
              className="font-body text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: "#241f0e", color: "#d4af37", border: "1px solid rgba(212,175,55,0.3)" }}
            >
              {tier2.text}
            </span>
          ) : (
            <button
              type="button"
              disabled={busy || tokensLeft <= 0}
              onClick={() => onHint(2)}
              className="font-body text-[10px] px-2 py-0.5 rounded-full disabled:opacity-40 shrink-0 whitespace-nowrap"
              style={{ background: "transparent", color: "#8a6d1a", border: "1px dashed rgba(138,109,26,0.6)" }}
            >
              + Letter
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compare-tower dot row (challenge results) ───────────────────────────

function CompareDots({ foundRanks }: { foundRanks: number[] }) {
  const set = new Set(foundRanks);
  return (
    <div className="flex items-center gap-1.5 justify-center flex-wrap">
      {Array.from({ length: TOTAL_RUNGS }, (_, i) => i + 1).map((rank) => (
        <span
          key={rank}
          className="flex items-center justify-center rounded-full font-display text-[10px]"
          style={{
            width: 20,
            height: 20,
            background: set.has(rank) ? ACCENT : "rgba(255,255,255,0.06)",
            color: set.has(rank) ? "#241f0e" : "#586058",
            border: `1px solid ${set.has(rank) ? ACCENT : "rgba(255,255,255,0.1)"}`,
          }}
        >
          {rank}
        </span>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function Perfect10Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const challengeToken = searchParams?.get("c") ?? null;
  const listParam = searchParams?.get("list") ?? null;

  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState(false);
  const [list, setList] = useState<ClientListData | null>(null);
  const [isGuest, setIsGuest] = useState(true);
  const [game, setGame] = useState<GameState>({ ...FRESH_GAME });
  const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);

  const [guessInput, setGuessInput] = useState("");
  const [playersIndex, setPlayersIndex] = useState<[number, string, string][]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryMine, setLibraryMine] = useState<Record<string, LibraryMine>>({});
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [poppedRank, setPoppedRank] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The on-screen keyboard does NOT shrink 100dvh on iOS Safari — the layout
  // viewport stays put and the page scrolls under the keyboard instead. Only
  // visualViewport reports the space actually left, so the board is sized to it.
  const [viewportH, setViewportH] = useState<number | null>(null);
  const maxViewportRef = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    // Read visualViewport when present (iOS reports the keyboard there and
    // nowhere else), but listen on BOTH sources: some browsers fire only
    // window.resize when the keyboard opens, and one listener alone left the
    // board sized to the pre-keyboard height.
    const apply = () => {
      const h = vv?.height ?? window.innerHeight;
      maxViewportRef.current = Math.max(maxViewportRef.current, h);
      setViewportH(h);
      // iOS scrolls the LAYOUT viewport to reveal the focused input, which drags
      // the board off-screen and exposes empty page beneath it. The board is
      // position:fixed, so pinning the scroll back to 0 keeps it put — but ONLY
      // while playing: intro/results are normal scrolling pages, and mobile
      // URL-bar collapse fires resize MID-SCROLL, so pinning there snapped the
      // page back to the top every time the player tried to scroll.
      if (phase === "playing" && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const onOrientation = () => {
      // The tallest-height-ever baseline is orientation-specific: portrait's max
      // read against landscape's height looks like a permanent "keyboard up".
      maxViewportRef.current = 0;
      apply();
    };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [phase]);

  const listIdRef = useRef<string | null>(null);
  useEffect(() => {
    listIdRef.current = list?.listId ?? null;
  }, [list]);

  // Persist guest progress on every state change.
  useEffect(() => {
    if (!list || !isGuest) return;
    saveGuestState(list.listId, game);
  }, [game, list, isGuest]);

  useEffect(() => {
    let cancelled = false;

    // Fresh load for the targeted list (initial, library replay, or challenge).
    setPhase("loading");
    setGame({ ...FRESH_GAME });
    setChallenge(null);
    setShareToken(null);
    setLoadError(false);

    fetch("/perfect10/players.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setPlayersIndex(rows);
      })
      .catch(() => {});

    callApi({ action: "library" })
      .then(({ ok, data }) => {
        if (cancelled || !ok) return;
        setLibrary(Array.isArray(data.items) ? data.items : []);
        setLibraryMine(data.mine && typeof data.mine === "object" ? data.mine : {});
      })
      .catch(() => {});

    (async () => {
      try {
        const { ok, data } = await callApi({
          action: "state",
          challenge: challengeToken ?? undefined,
          listId: listParam ?? undefined,
        });
        if (cancelled) return;
        if (!ok || !data?.listId) throw new Error("no list");

        const cl: ClientListData = {
          listId: data.listId,
          title: data.title,
          rungs: data.rungs ?? [],
          day: data.day ?? null,
          isToday: Boolean(data.isToday),
        };
        setList(cl);
        if (data.challenge) setChallenge(data.challenge);

        let doneNow = false;
        if (data.attempt) {
          setIsGuest(false);
          const a = data.attempt;
          setGame({
            found: a.found ?? [],
            hints: a.hints ?? [],
            strikes: a.strikes ?? 0,
            tokensLeft: a.tokensLeft ?? 3,
            score: a.score ?? 0,
            done: Boolean(a.done),
            reveal: a.reveal ?? [],
          });
          setShareToken(a.shareToken ?? null);
          doneNow = Boolean(a.done);
        } else {
          setIsGuest(true);
          const g = loadGuestState(cl.listId);
          setGame(g);
          doneNow = g.done;
        }

        setPhase(doneNow ? "results" : "intro");
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setPhase("intro");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-runs when the URL targets a different list (library replay / challenge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeToken, listParam]);

  useEffect(() => {
    if (phase === "playing") setTimeout(() => inputRef.current?.focus(), 200);
  }, [phase]);

  // Belt and braces with the fixed board: stop the document itself scrolling
  // while a game is in progress, so nothing can drag the tower out of view.
  useEffect(() => {
    if (phase !== "playing") return;
    const html = document.documentElement;
    const prevBody = document.body.style.overflow;
    const prevHtml = html.style.overflow;
    const prevOverscroll = html.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = prevBody;
      html.style.overflow = prevHtml;
      html.style.overscrollBehavior = prevOverscroll;
    };
  }, [phase]);

  // A big drop from the tallest viewport we've seen = the keyboard is up.
  const keyboardUp = viewportH !== null && maxViewportRef.current - viewportH > 100;

  const solvedByRank = useMemo(() => {
    const m = new Map<number, FoundEntry>();
    for (const f of game.found) m.set(f.rank, f);
    return m;
  }, [game.found]);

  const query = normalizeName(guessInput);
  const suggestions = useMemo(() => {
    if (query.length < 2 || playersIndex.length === 0) return [] as [number, string, string][];
    // Solved names stay suggestible — double winners (Messi, twice a Golden
    // Ball list answer) occupy two rungs; the server answers alreadyFound
    // (no strike) when every rung for a name is done.
    // Rank: whole-name match > word (surname) match > prefix > substring —
    // typing "salah" must offer Mohamed Salah before Salah Oulad M'Hand, or
    // Enter hands out an unfair strike.
    const tierOf = (norm: string): number => {
      if (norm === query) return 0;
      if (norm.split(" ").includes(query)) return 1;
      if (norm.startsWith(query)) return 2;
      return 3;
    };
    return playersIndex
      .filter(([, , norm]) => norm.includes(query))
      .sort((a, b) => {
        const at = tierOf(a[2]);
        const bt = tierOf(b[2]);
        if (at !== bt) return at - bt;
        return a[1].length - b[1].length;
      })
      .slice(0, 3);
  }, [query, playersIndex, game.found]);

  function guestPayload() {
    return {
      foundRanks: game.found.map((f) => f.rank),
      hints: game.hints.map((h) => ({ rank: h.rank, tier: h.tier })),
      strikes: game.strikes,
      tokensLeft: game.tokensLeft,
      score: game.score,
      done: game.done,
    };
  }

  async function submitGuess(name: string) {
    if (!list || busy || game.done) return;
    setBusy(true);
    try {
      const { ok, data } = await callApi({
        action: "guess",
        listId: list.listId,
        guess: name,
        guestState: isGuest ? guestPayload() : undefined,
      });
      if (!ok) return;

      if (data.hit) {
        const hintsUsed = game.hints.filter((h) => h.rank === data.rank).length;
        const entry: FoundEntry = { rank: data.rank, display: data.display, surname: data.surname, points: data.points, hintsUsed };
        void haptic(data.done ? "win" : "correct");
        setPoppedRank(data.rank);
        setTimeout(() => setPoppedRank(null), 600);
        setGame((g) => ({
          ...g,
          found: [...g.found, entry],
          score: data.score,
          strikes: data.strikes ?? g.strikes,
          done: Boolean(data.done),
          reveal: data.reveal ?? g.reveal,
        }));
      } else if (data.alreadyFound) {
        void haptic("select");
      } else {
        void haptic("wrong");
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
        setGame((g) => ({ ...g, strikes: data.strikes ?? g.strikes, done: Boolean(data.done), reveal: data.reveal ?? g.reveal }));
      }

      if (data.done) {
        setTimeout(() => setPhase("results"), 1300);
      }
    } finally {
      setGuessInput("");
      setBusy(false);
    }
  }

  async function requestHint(rank: number, tier: 1 | 2) {
    if (!list || busy || game.done || game.tokensLeft <= 0) return;
    if (game.hints.some((h) => h.rank === rank && h.tier === tier)) return;
    if (tier === 2 && !game.hints.some((h) => h.rank === rank && h.tier === 1)) return;
    setBusy(true);
    try {
      const { ok, data } = await callApi({
        action: "hint",
        listId: list.listId,
        rank,
        tier,
        guestState: isGuest ? guestPayload() : undefined,
      });
      if (!ok) return;
      void haptic("select");
      setGame((g) => ({ ...g, hints: [...g.hints, { rank, tier, text: data.text }], tokensLeft: data.tokensLeft ?? g.tokensLeft }));
    } finally {
      setBusy(false);
    }
  }

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && suggestions.length > 0) {
      void submitGuess(suggestions[0][1]);
    }
  }

  const shareUrl =
    !isGuest && shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/play/game/perfect-10?c=${shareToken}`
      : null;

  async function handleShare() {
    if (!shareUrl) return;
    const text = `Perfect 10 on YourScore — ${game.found.length}/10, ${game.score} pts`;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ text, url: shareUrl });
        return;
      }
    } catch {
      /* fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(`${text} ${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — nothing more we can do */
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 animate-spin" style={{ borderColor: ACCENT, borderTopColor: "transparent" }} />
          <p className="font-display text-xs tracking-widest text-text-muted">BUILDING THE TOWER…</p>
        </div>
      </div>
    );
  }

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
        {/* Perfect 10 is its own game section (founder ruling 2026-07-18) — the
            switcher is its section header, same as /play and /38-0. */}
        <div
          className="sticky top-0 z-20 pt-safe"
          style={{ background: "rgba(10,10,15,0.97)", backdropFilter: "blur(20px)" }}
        >
          <div className="max-w-lg mx-auto px-5 pt-3">
            <GameSwitcher active="perfect10" />
          </div>
        </div>

        <div
          className="relative flex flex-col items-center pt-14 pb-8 px-6"
          style={{ background: `linear-gradient(175deg, ${ACCENT}14 0%, #16130a 55%, #0a0a0f 100%)` }}
        >
          <button
            type="button"
            onClick={() => router.push(smartBackTarget("/play"))}
            className="absolute top-3 left-5 flex items-center gap-1.5 font-body text-xs z-10"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>

          <div
            className="w-full mb-5"
            style={{ maxWidth: 340, borderRadius: 18, overflow: "hidden", border: `1.5px solid ${ACCENT}40`, boxShadow: `0 12px 40px ${ACCENT}22` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/game-covers/perfect-10.webp" alt="Perfect 10" className="block w-full h-auto" />
          </div>
          <h1 className="font-display text-3xl text-white text-center leading-tight mb-2">Perfect 10</h1>

          {challenge && (
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-full mt-1"
              style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}40` }}
            >
              <span className="font-body text-xs" style={{ color: ACCENT }}>
                {challenge.name} scored {challenge.score} pts — beat it
              </span>
            </div>
          )}

          <div
            className="rounded-2xl px-4 py-3 mt-4 text-center"
            style={{ background: "rgba(255,196,0,0.06)", border: `1px solid ${ACCENT}30`, maxWidth: 320 }}
          >
            <p className="font-body text-xs mb-1" style={{ color: "#9aa39d" }}>
              {listParam && list?.day
                ? formatDay(list.day).toUpperCase()
                : list?.isToday
                  ? "TODAY'S LIST"
                  : list?.day
                    ? `LATEST — ${formatDay(list.day).toUpperCase()}`
                    : "LATEST LIST"}
            </p>
            <p className="font-display text-base" style={{ color: ACCENT }}>
              {list?.title ?? "…"}
            </p>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-5 py-6 flex flex-col gap-4">
          <div className="rounded-2xl px-4 py-4 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-sm text-white tracking-wide mb-1.5">How it works</p>
            <p className="font-body text-sm" style={{ color: "#9aa39d", lineHeight: 1.8 }}>
              Fill the tower — name all 10, top to bottom.
              <br />
              3 strikes and the tower falls.
              <br />
              3 hints — clubs first, then a starting letter.
            </p>
          </div>

          {loadError && (
            <p className="font-body text-sm text-center" style={{ color: "#ff6b78" }}>
              Couldn&apos;t load today&apos;s list — try again.
            </p>
          )}

          <Button variant="primary" tone="gold" size="lg" fullWidth onClick={() => setPhase("playing")} disabled={!list}>
            START
          </Button>

          {library.filter((i) => i.id !== list?.listId).length > 0 && (
            <div className="rounded-2xl px-4 py-4 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-display text-sm text-white tracking-wide mb-2">Previous days</p>
              <div className="flex flex-col gap-1.5">
                {library
                  .filter((i) => i.id !== list?.listId)
                  .map((item) => {
                    const mine: LibraryMine = !isGuest
                      ? libraryMine[item.id] ?? { score: 0, found: 0, done: false }
                      : (() => {
                          const g = loadGuestState(item.id);
                          return { score: g.score, found: g.found.length, done: g.done };
                        })();
                    const untouched = !mine.done && mine.found === 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => router.push(`/play/game/perfect-10?list=${item.id}`)}
                        className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <span className="font-body text-xs flex-shrink-0 w-12" style={{ color: "#8a948f" }}>
                          {formatDay(item.day)}
                        </span>
                        <span className="font-body text-sm text-white flex-1 min-w-0 truncate">{item.title}</span>
                        <span
                          className="font-display text-xs px-2 py-1 rounded-lg flex-shrink-0"
                          style={{
                            background: untouched ? `${ACCENT}18` : "rgba(255,255,255,0.06)",
                            color: untouched ? ACCENT : mine.done ? "#ffe082" : "#9aa39d",
                          }}
                        >
                          {untouched ? "PLAY" : mine.done ? `${mine.score} PTS` : `${mine.found}/10`}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  // ── Playing ──────────────────────────────────────────────────────────────
  if (phase === "playing" && list) {
    const foundCount = game.found.length;

    return (
      // Sized from visualViewport (not 100vh/min-h-screen — those ignore both the
      // browser chrome AND the keyboard), and position:fixed so it's pinned to the
      // visible area: in normal flow a parent's min-h-screen keeps the DOCUMENT
      // tall, so tapping the input let iOS scroll the page down — tower off the
      // top, dead space below.
      <div
        className="flex flex-col bg-bg overflow-hidden fixed inset-x-0 top-0"
        style={{ height: viewportH ? `${viewportH}px` : "100dvh" }}
      >
        <div
          className="shrink-0 z-10 pt-safe"
          style={{ background: "rgba(10,10,15,0.98)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className={`px-5 flex items-center justify-between gap-3 ${keyboardUp ? "pt-1 pb-0.5" : "pt-2.5 pb-1.5"}`}>
            <button
              type="button"
              onClick={() => router.push(smartBackTarget("/play"))}
              className="flex items-center gap-1.5 font-body text-xs flex-shrink-0"
              style={{ color: "#586058" }}
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>

            <div className="flex items-center gap-1.5">
              {Array.from({ length: MAX_STRIKES }, (_, i) => (
                <span
                  key={i}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: i < game.strikes ? "#ff4757" : "rgba(255,71,87,0.15)",
                    display: "inline-block",
                  }}
                />
              ))}
            </div>

            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl flex-shrink-0"
              style={{ background: "rgba(255,196,0,0.1)", border: `1px solid ${ACCENT}30` }}
            >
              <BulbIcon color={ACCENT} size={13} />
              <span className="font-display text-xs" style={{ color: ACCENT }}>
                {game.tokensLeft}
              </span>
            </div>
          </div>

          {/* The topic IS the game — it gets real estate, not a caption. While
              the keyboard is up it steps back to one compact line so the tower
              keeps the room (the player has already read it by then). */}
          <div className={keyboardUp ? "px-5 pb-1.5" : "px-5 pb-3"}>
            <p
              className={
                keyboardUp
                  ? "font-display text-[13px] leading-tight truncate"
                  : "font-display text-xl leading-[1.15]"
              }
              style={{ color: ACCENT }}
            >
              {list.title}
            </p>
            {challenge && (
              <span className="font-body text-[11px]" style={{ color: "#8a948f" }}>
                Beat <span style={{ color: ACCENT }}>{challenge.name}</span>&apos;s {challenge.score} pts
              </span>
            )}
          </div>
        </div>

        <div className={`flex-1 min-h-0 flex flex-col px-5 pb-2 pt-2 max-w-lg mx-auto w-full ${shaking ? "animate-p10-shake" : ""}`}>
          <div className="flex-1 min-h-0 flex flex-col gap-1">
            {list.rungs.map((rung) => (
              <Rung
                key={rung.rank}
                rung={rung}
                solved={solvedByRank.get(rung.rank)}
                hints={game.hints.filter((h) => h.rank === rung.rank)}
                tokensLeft={game.tokensLeft}
                popped={poppedRank === rung.rank}
                busy={busy}
                onHint={(tier) => requestHint(rung.rank, tier)}
              />
            ))}
          </div>

          {/* Hidden while typing — the tiles need that height more than the
              running total does, and the solved rungs already show progress. */}
          <div className={`items-center justify-center gap-4 mt-2 ${keyboardUp ? "hidden" : "flex"}`}>
            <span className="font-body text-xs" style={{ color: "#9aa39d" }}>
              <span className="font-display" style={{ color: ACCENT }}>
                {foundCount}
              </span>{" "}
              of 10 found
            </span>
            <span className="font-body text-xs" style={{ color: "#9aa39d" }}>
              <span className="font-display" style={{ color: ACCENT }}>
                {game.score}
              </span>{" "}
              pts
            </span>
          </div>
        </div>

        {/* Bottom input bar — no submit button; Enter or a chip tap submits. */}
        <div
          className="shrink-0 px-4 pt-2 max-w-lg mx-auto w-full"
          style={{
            background: "rgba(10,10,15,0.98)",
            backdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {suggestions.length > 0 && (
            <div className="flex gap-1.5 mb-2 overflow-x-auto">
              {suggestions.map(([id, name], i) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void submitGuess(name)}
                  className="font-body text-sm px-3 py-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: i === 0 ? `${ACCENT}22` : "rgba(255,255,255,0.05)",
                    color: i === 0 ? ACCENT : "#9aa39d",
                    border: `1px solid ${i === 0 ? ACCENT : "rgba(255,255,255,0.1)"}`,
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={guessInput}
            onChange={(e) => setGuessInput(e.target.value)}
            onKeyDown={handleInputKey}
            disabled={busy || !list}
            placeholder="Name a player…"
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            className="w-full rounded-xl px-4 font-body text-base text-white outline-none disabled:opacity-50"
            style={{ height: 46, background: "rgba(255,196,0,0.06)", border: `1px solid ${ACCENT}30`, caretColor: ACCENT }}
          />
        </div>

        <style jsx global>{`
          @keyframes p10-shake {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-8px); }
            40% { transform: translateX(7px); }
            60% { transform: translateX(-5px); }
            80% { transform: translateX(4px); }
          }
          .animate-p10-shake { animation: p10-shake 0.4s ease-in-out; }
        `}</style>
      </div>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────
  if (phase === "results" && list) {
    const won = game.found.length >= TOTAL_RUNGS;
    const allEntries: Array<{ rank: number; label: string; solved: boolean; missed: boolean }> = list.rungs.map((r) => {
      const s = solvedByRank.get(r.rank);
      const missed = game.reveal.find((x) => x.rank === r.rank);
      return { rank: r.rank, label: s ? s.surname.toUpperCase() : missed ? missed.surname.toUpperCase() : "?", solved: Boolean(s), missed: Boolean(missed) };
    });

    return (
      <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
        <div
          className="relative flex flex-col items-center pt-16 pb-8 px-6"
          style={{ background: `linear-gradient(175deg, ${won ? ACCENT : "#ff4757"}14 0%, #16130a 60%, #0a0a0f 100%)` }}
        >
          <div
            className="flex items-center gap-2 px-5 py-2.5 rounded-full mb-4"
            style={{
              background: won ? `${ACCENT}18` : "rgba(255,71,87,0.12)",
              border: `1px solid ${won ? ACCENT : "#ff4757"}50`,
            }}
          >
            <span className="font-display text-base tracking-wide" style={{ color: won ? ACCENT : "#ff4757" }}>
              {won ? `PERFECT 10 — ${game.score} PTS` : "TOWER FALLS"}
            </span>
          </div>
          {!won && <p className="font-body text-sm mb-2" style={{ color: "#9aa39d" }}>{game.score.toLocaleString()} pts</p>}

          <div className="w-full max-w-sm flex flex-col gap-1.5 mt-2">
            {allEntries.map((e) => (
              <div
                key={e.rank}
                className={`mx-auto w-full rounded-xl px-3.5 py-2.5 flex items-center gap-3 ${won ? "animate-p10-ignite" : ""}`}
                style={{
                  width: `${rungWidthPct(e.rank)}%`,
                  background: e.solved ? "#2a2410" : e.missed ? "rgba(141,90,90,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${e.solved ? ACCENT : e.missed ? "rgba(141,90,90,0.4)" : "rgba(255,255,255,0.06)"}`,
                  // Win ignition: the tower relights top to bottom, one rung at a time.
                  animationDelay: won ? `${(e.rank - 1) * 90}ms` : undefined,
                }}
              >
                <span className="font-display text-xs w-6 text-center flex-shrink-0" style={{ color: e.solved ? ACCENT : "#586058" }}>
                  {e.rank}
                </span>
                <span
                  className="font-display text-sm tracking-wide"
                  style={{ color: e.solved ? "#ffe082" : e.missed ? "#8d5a5a" : "#3a423d" }}
                >
                  {e.label}
                </span>
              </div>
            ))}
          </div>

          {challenge && (
            <div className="w-full max-w-sm mt-6 rounded-2xl px-4 py-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="font-body text-xs text-center mb-2" style={{ color: "#8a948f" }}>
                {challenge.name} — {challenge.score} pts
              </p>
              <CompareDots foundRanks={challenge.foundRanks} />
            </div>
          )}
        </div>

        <div className="max-w-lg mx-auto px-5 flex flex-col gap-3 mt-5">
          {!isGuest && shareUrl && (
            <>
              <Button variant="primary" tone="gold" size="lg" fullWidth onClick={handleShare}>
                {copied ? "COPIED ✓" : "SHARE"}
              </Button>
              <Button
                variant="ghost"
                tone="gold"
                size="lg"
                fullWidth
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                CHALLENGE A FRIEND
              </Button>
            </>
          )}

          {isGuest && (
            <div className="rounded-2xl px-4 py-4 bg-surface" style={{ border: `1px solid ${ACCENT}30` }}>
              <p className="font-body text-sm font-semibold text-white mb-1">Sign up to save your streak and challenge friends</p>
              <p className="font-body text-xs mb-3" style={{ color: "#9aa39d" }}>
                Guest progress only lives on this device.
              </p>
              <Button variant="primary" tone="gold" size="md" fullWidth href="/auth/sign-in?next=/play/game/perfect-10">
                SIGN UP &amp; SAVE
              </Button>
            </div>
          )}

          <Button variant="ghost" tone="gold" size="lg" fullWidth onClick={() => router.push("/play")}>
            BACK TO QUIZ
          </Button>
        </div>

        <BottomNav />

        <style jsx global>{`
          @keyframes p10-ignite {
            0% { transform: scale(1); filter: brightness(1); }
            45% { transform: scale(1.05); filter: brightness(1.6); }
            100% { transform: scale(1); filter: brightness(1); }
          }
          .animate-p10-ignite { animation: p10-ignite 0.5s ease-out both; }
        `}</style>
      </div>
    );
  }

  return null;
}
