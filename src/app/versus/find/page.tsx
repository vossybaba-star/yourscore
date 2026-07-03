"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { BackPill } from "@/components/ui/BackPill";

// Find an opponent — instant matchmaking for both games, presented as one
// game-like flow: choose your game → radar search → opponent found → enter.
//  • 38-0 rides the existing random queue (/api/draft/live) with its silent
//    2-3s disguised-bot fallback, so it always resolves fast.
//  • Quiz Battle uses the new quiz_queue (/api/versus/queue) — human-only, so
//    after a while we offer "challenge a friend instead" rather than hanging.
// ?game=quiz|38-0 skips the picker (deep-linked from quick-start pages).

const TEAL = "#00d8c0";
const LIME = "#aeea00";

type Game = "quiz" | "38-0";
type Stage = "choose" | "searching" | "found" | "quiet" | "needsTeam";

interface Found { name: string; avatarUrl: string | null; seed: string; href: string }

const POLL_MS = 2500;
const QUIZ_QUIET_MS = 45_000; // quiz has no bot — offer a graceful out
const botFallbackDelay = () => 2_000 + Math.floor(Math.random() * 1_000); // mirror 38-0 live

const SEARCH_MESSAGES = [
  "Finding someone ready to play…",
  "Checking who's online…",
  "Matching you by record…",
  "Lining up a game…",
];

function Radar({ color }: { color: string }) {
  return (
    <div className="relative mx-auto" style={{ width: 168, height: 168 }}>
      <style>{`@keyframes radarPing { 0% { transform: scale(0.35); opacity: 0.7; } 100% { transform: scale(1); opacity: 0; } }`}</style>
      {[0, 1, 2].map((i) => (
        <span key={i} className="absolute inset-0 rounded-full" style={{ border: `1.5px solid ${color}`, animation: `radarPing 2.4s ease-out ${i * 0.8}s infinite` }} />
      ))}
      <span className="absolute inset-0 rounded-full" style={{ border: `1px solid ${color}33` }} />
      <div className="absolute inset-0 grid place-items-center">
        <svg width="44" height="44" viewBox="0 0 22 22" fill="none">
          <path d="M3 3l8.5 8.5M3 3v3l7.5 7.5M3 3h3l7.5 7.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 3l-8.5 8.5M19 3v3l-7.5 7.5M19 3h-3L8.5 11.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function GameCard({ game, selected, onClick }: { game: Game; selected: boolean; onClick: () => void }) {
  const c = game === "38-0" ? LIME : TEAL;
  return (
    <button onClick={onClick} className="flex-1 rounded-2xl p-4 text-left active:scale-[0.98] transition-all" style={{ background: selected ? `${c}14` : "#0e1611", border: `1.5px solid ${selected ? c : "rgba(255,255,255,0.1)"}` }}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-display text-xl text-white leading-none">{game === "38-0" ? "38-0" : "QUIZ BATTLE"}</p>
        <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={{ border: `1.5px solid ${selected ? c : "rgba(255,255,255,0.2)"}`, background: selected ? c : "transparent" }}>
          {selected && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5 5 9l4.5-6" stroke="#0a120d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
      </div>
      <p className="font-body text-xs text-text-muted leading-snug">{game === "38-0" ? "Build your XI. Beat their team." : "Same questions. Best score wins."}</p>
    </button>
  );
}

function FindInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useUser();
  const preset = params.get("game") === "quiz" ? "quiz" : params.get("game") === "38-0" ? "38-0" : null;

  const [game, setGame] = useState<Game>(preset ?? "quiz");
  const [stage, setStage] = useState<Stage>(preset ? "searching" : "choose");
  const [msg, setMsg] = useState(0);
  const [found, setFound] = useState<Found | null>(null);
  const [me, setMe] = useState<{ name: string; avatarUrl: string | null } | null>(null);

  const searchingRef = useRef(false);
  const gameRef = useRef<Game>(game);
  gameRef.current = game;

  useEffect(() => {
    if (!user) return;
    createClient().from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle()
      .then(({ data }) => setMe({ name: data?.display_name ?? "You", avatarUrl: data?.avatar_url ?? null }));
  }, [user]);

  // Rotating search copy.
  useEffect(() => {
    if (stage !== "searching") return;
    const t = setInterval(() => setMsg((x) => (x + 1) % SEARCH_MESSAGES.length), 1300);
    return () => clearInterval(t);
  }, [stage]);

  const cancelQueue = useCallback((g: Game) => {
    const req = g === "quiz"
      ? fetch("/api/versus/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) })
      : fetch("/api/draft/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancelQueue" }) });
    req.catch(() => {});
  }, []);

  // The search loop. One effect owns the whole lifecycle for the active search;
  // leaving `searching` (or unmount) stops polling and leaves the queue.
  useEffect(() => {
    if (stage !== "searching" || !user) return;
    searchingRef.current = true;
    const g = gameRef.current;
    const started = Date.now();
    const botAfter = botFallbackDelay();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (f: Found) => {
      if (!searchingRef.current) return;
      searchingRef.current = false;
      setFound(f);
      setStage("found");
    };

    const poll = async () => {
      if (!searchingRef.current) return;
      try {
        if (g === "quiz") {
          const r = await fetch("/api/versus/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue" }) }).then((x) => x.json());
          if (r.status === "matched") {
            return finish({
              name: r.opponent?.name ?? "Your opponent", avatarUrl: r.opponent?.avatarUrl ?? null,
              seed: r.opponent?.id ?? r.roomId, href: `/play/${r.roomId}`,
            });
          }
          if (r.error) throw new Error(r.error);
          if (Date.now() - started > QUIZ_QUIET_MS) { searchingRef.current = false; cancelQueue("quiz"); setStage("quiet"); return; }
        } else {
          const elapsed = Date.now() - started;
          const action = elapsed > botAfter ? "bot" : "queue";
          const r = await fetch("/api/draft/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, competition: "PL" }) }).then((x) => x.json());
          const match = r.match ?? (r.status === "matched" ? r.match : null);
          if (match?.id) {
            const oppName = match.p1_id === user.id ? (match.p2_name ?? "Your opponent") : (match.p1_name ?? "Your opponent");
            return finish({ name: oppName, avatarUrl: null, seed: match.id, href: `/38-0/live/match/${match.id}` });
          }
          if (r.error) {
            if (`${r.error}`.toLowerCase().includes("save a team")) { searchingRef.current = false; setStage("needsTeam"); return; }
            throw new Error(r.error);
          }
        }
      } catch { /* transient — keep polling */ }
      if (searchingRef.current) timer = setTimeout(poll, POLL_MS);
    };
    poll();

    return () => {
      if (timer) clearTimeout(timer);
      if (searchingRef.current) { searchingRef.current = false; cancelQueue(g); }
    };
  }, [stage, user, cancelQueue]);

  // Found → auto-enter after a beat (the button is there for the impatient).
  useEffect(() => {
    if (stage !== "found" || !found) return;
    const t = setTimeout(() => router.push(found.href), 2200);
    return () => clearTimeout(t);
  }, [stage, found, router]);

  if (!loading && !user) {
    return (
      <main className="min-h-dvh bg-bg grid place-items-center px-6">
        <div className="text-center">
          <p className="font-display text-2xl text-white mb-2">Find an opponent</p>
          <p className="font-body text-sm text-text-muted mb-5">Sign in to get matched with a live opponent.</p>
          <Link href="/auth/sign-in?next=/versus/find" className="inline-block rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: TEAL, color: "#04231f" }}>Sign in →</Link>
        </div>
      </main>
    );
  }

  const c = game === "38-0" ? LIME : TEAL;

  return (
    <main className="min-h-dvh bg-bg pb-16">
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-4">
          <BackPill href="/versus" tone="neutral" sticky={false} />
        </div>

        {stage === "choose" && (
          <div className="pt-8">
            <p className="font-body text-[11px] font-bold uppercase tracking-[0.32em] mb-2.5" style={{ color: TEAL }}>Find an opponent</p>
            <p className="font-display text-white leading-[0.9]" style={{ fontSize: 38 }}>CHOOSE YOUR GAME.</p>
            <p className="font-body text-sm text-text-muted mt-2 mb-6">We&rsquo;ll match you with someone ready to play.</p>
            <div className="flex gap-2.5 mb-6">
              <GameCard game="38-0" selected={game === "38-0"} onClick={() => setGame("38-0")} />
              <GameCard game="quiz" selected={game === "quiz"} onClick={() => setGame("quiz")} />
            </div>
            <button onClick={() => setStage("searching")} className="w-full rounded-2xl py-4 font-display text-lg tracking-wide active:scale-[0.99] transition-transform" style={{ background: c, color: game === "38-0" ? "#13200a" : "#04231f" }}>
              FIND AN OPPONENT →
            </button>
          </div>
        )}

        {stage === "searching" && (
          <div className="pt-16 text-center">
            <Radar color={c} />
            <p className="font-display text-2xl text-white mt-8">{game === "38-0" ? "38-0" : "QUIZ BATTLE"}</p>
            <p className="font-body text-sm text-text-muted mt-2 transition-opacity" style={{ minHeight: 22 }}>{SEARCH_MESSAGES[msg]}</p>
            <button onClick={() => { searchingRef.current = false; cancelQueue(game); setStage(preset ? "choose" : "choose"); }} className="mt-10 font-body text-sm underline" style={{ color: "#8a948f" }}>Cancel</button>
          </div>
        )}

        {stage === "found" && found && (
          <div className="pt-14 text-center">
            <p className="font-body text-[11px] font-bold uppercase tracking-[0.32em] mb-8" style={{ color: c }}>Opponent found</p>
            <div className="flex items-center justify-center gap-5">
              <div className="text-center">
                <PlayerAvatar seed={user?.id} name={me?.name ?? "You"} avatarUrl={me?.avatarUrl} size={72} ring={c} />
                <p className="font-body text-sm font-semibold text-white mt-2.5 truncate" style={{ maxWidth: 110 }}>{me?.name ?? "You"}</p>
              </div>
              <p className="font-display text-3xl" style={{ color: c }}>VS</p>
              <div className="text-center">
                <PlayerAvatar seed={found.seed} name={found.name} avatarUrl={found.avatarUrl} size={72} ring="rgba(255,255,255,0.2)" />
                <p className="font-body text-sm font-semibold text-white mt-2.5 truncate" style={{ maxWidth: 110 }}>{found.name}</p>
              </div>
            </div>
            <p className="font-body text-xs text-text-muted mt-6">{game === "38-0" ? "Similar record. Two halves. Winner takes the points." : "Same questions, same time. Best score wins."}</p>
            <Link href={found.href} className="mt-8 block w-full rounded-2xl py-4 font-display text-lg tracking-wide active:scale-[0.99] transition-transform" style={{ background: c, color: game === "38-0" ? "#13200a" : "#04231f" }}>
              {game === "38-0" ? "ENTER MATCH →" : "ENTER LOBBY →"}
            </Link>
          </div>
        )}

        {stage === "quiet" && (
          <div className="pt-16 text-center">
            <p className="font-display text-2xl text-white">No one&rsquo;s free right now</p>
            <p className="font-body text-sm text-text-muted mt-2 mb-8 leading-relaxed">It&rsquo;s quiet out there. Send a challenge instead — your friend plays whenever they&rsquo;re ready.</p>
            <div className="space-y-2.5">
              <Link href="/versus/quiz" className="block w-full rounded-2xl py-3.5 font-display tracking-wide" style={{ background: TEAL, color: "#04231f" }}>CHALLENGE A FRIEND →</Link>
              <button onClick={() => setStage("searching")} className="block w-full rounded-2xl py-3.5 font-display tracking-wide" style={{ background: "rgba(255,255,255,0.05)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.12)" }}>KEEP SEARCHING</button>
            </div>
          </div>
        )}

        {stage === "needsTeam" && (
          <div className="pt-16 text-center">
            <p className="font-display text-2xl text-white">You need an XI first</p>
            <p className="font-body text-sm text-text-muted mt-2 mb-8 leading-relaxed">Build and save your team in 38-0, then come back to take on a live opponent.</p>
            <Link href="/38-0" className="block w-full rounded-2xl py-3.5 font-display tracking-wide" style={{ background: LIME, color: "#13200a" }}>BUILD YOUR XI →</Link>
          </div>
        )}
      </div>
    </main>
  );
}

export default function FindOpponentPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-bg" />}>
      <FindInner />
    </Suspense>
  );
}
