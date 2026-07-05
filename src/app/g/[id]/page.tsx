"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BackPill } from "@/components/ui/BackPill";
import { Button } from "@/components/ui/Button";
import { slugify } from "@/lib/utils";
import { trackShare } from "@/lib/analytics/trackGame";

interface Challenge {
  id: string; quiz_pack_id: string; quiz_pack_name: string; creator_id: string;
  creator_name: string; status: string; expires_at: string; max_score: number;
}
interface Participant {
  user_id: string; display_name: string; score: number | null; correct: number | null; played_at: string | null;
}

function initial(n: string) { return (n[0] ?? "?").toUpperCase(); }
function daysLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ended";
  const d = Math.ceil(ms / 86400000);
  return d === 1 ? "1 day left" : `${d} days left`;
}

export default function GroupBoardPage() {
  const { id } = useParams<{ id: string }>();
  const [me, setMe] = useState<string | null>(null);
  const [ch, setCh] = useState<Challenge | null>(null);
  const [players, setPlayers] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const sb = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = sb as any;
    const { data: auth } = await sb.auth.getUser();
    setMe(auth.user?.id ?? null);

    const { data: c } = await db.from("group_challenges").select("*").eq("id", id).single();
    if (!c) { setNotFound(true); setLoading(false); return; }
    setCh(c as Challenge);

    const { data: ps } = await db
      .from("group_challenge_participants")
      .select("user_id, display_name, score, correct, played_at")
      .eq("challenge_id", id);
    setPlayers((ps ?? []) as Participant[]);
    setLoading(false);

    // Clear my inbox unread for this challenge.
    if (auth.user) fetch("/api/challenge/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: id }) }).catch(() => {});
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function joinAndPlay() {
    if (!ch || joining) return;
    setJoining(true);
    await fetch("/api/challenge/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: id }) }).catch(() => {});
    window.location.href = playHref;
  }

  function share() {
    trackShare("scorecard");
    const url = typeof window !== "undefined" ? window.location.href : "";
    const text = ch ? `Join my "${ch.quiz_pack_name}" group challenge on YourScore — see who tops the board ⚽` : "";
    if (typeof navigator !== "undefined" && navigator.share) navigator.share({ text, url }).catch(() => {});
    else if (url) navigator.clipboard?.writeText(`${text} ${url}`);
  }

  if (loading) return <Screen><div style={{ color: "#8a948f" }} className="font-body text-sm">Loading…</div></Screen>;
  if (notFound || !ch) return <Screen><div className="font-body text-sm" style={{ color: "#ff8a3d" }}>This challenge doesn&apos;t exist.</div></Screen>;

  const playHref = `/challenges/${slugify(ch.quiz_pack_name)}?group=${id}&pid=${ch.quiz_pack_id}`;
  const mine = players.find((p) => p.user_id === me);
  const iPlayed = !!mine?.played_at;
  const ended = ch.status !== "open" || new Date(ch.expires_at) < new Date();
  const ranked = players.filter((p) => p.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const pending = players.filter((p) => p.score === null);
  const MEDAL = ["#ffc233", "#c0c0c0", "#cd7f32"];

  return (
    <div className="min-h-dvh bg-bg pb-28">
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-4"><BackPill fallback="/play" label="Back" tone="play" /></div>

        {/* Header */}
        <div className="mt-3 rounded-3xl px-5 py-5 surface-grid">
          <p className="font-body text-xs uppercase tracking-widest mb-1" style={{ color: "#00d8c0" }}>Group challenge</p>
          <p className="font-display text-2xl text-white leading-tight">{ch.quiz_pack_name}</p>
          <p className="font-body text-xs text-text-muted mt-1.5">
            {ch.creator_name}&apos;s board · {players.length} player{players.length === 1 ? "" : "s"} · {ended ? "ended" : daysLeft(ch.expires_at)}
          </p>
        </div>

        {/* Your CTA */}
        {!ended && (
          <div className="mt-4">
            {!me ? (
              <Button href={`/auth/sign-in?next=/g/${id}`} variant="primary" tone="teal" size="lg" fullWidth>Sign in to play →</Button>
            ) : iPlayed ? (
              <Button onClick={share} variant="ghost" size="md" fullWidth>Share the board</Button>
            ) : mine ? (
              <Button href={playHref} variant="primary" tone="teal" size="lg" fullWidth>Play now →</Button>
            ) : (
              <Button onClick={joinAndPlay} variant="primary" tone="teal" size="lg" fullWidth disabled={joining}>
                {joining ? "Joining…" : "Join & play →"}
              </Button>
            )}
          </div>
        )}

        {/* Leaderboard */}
        <p className="font-body text-xs font-bold uppercase tracking-widest mt-6 mb-2" style={{ color: "#586058" }}>Leaderboard</p>
        {ranked.length === 0 ? (
          <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-body text-sm text-white">No scores yet</p>
            <p className="font-body text-xs text-text-muted mt-1">Be the first to set the bar.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ranked.map((p, i) => {
              const isMe = p.user_id === me;
              return (
                <div key={p.user_id} className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface"
                  style={{ border: `1px solid ${isMe ? "rgba(0,216,192,0.3)" : "rgba(255,255,255,0.07)"}` }}>
                  <span className="font-display w-7 text-center flex-shrink-0" style={{ fontSize: 18, color: i < 3 ? MEDAL[i] : "#586058" }}>
                    {i < 3 ? ["1st", "2nd", "3rd"][i] : `${i + 1}`}
                  </span>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe6", border: "1px solid rgba(255,255,255,0.1)" }}>{initial(p.display_name)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm font-semibold text-white truncate">{p.display_name}{isMe && <span style={{ color: "#00d8c0" }}> · you</span>}</p>
                  </div>
                  <span className="font-display text-base flex-shrink-0" style={{ color: i === 0 ? "#ffc233" : "#fff" }}>{(p.score ?? 0).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <>
            <p className="font-body text-xs font-bold uppercase tracking-widest mt-5 mb-2" style={{ color: "#586058" }}>Yet to play</p>
            <div className="flex flex-wrap gap-2">
              {pending.map((p) => (
                <span key={p.user_id} className="flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center font-body font-bold text-xs flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)", color: "#8a948f" }}>{initial(p.display_name)}</span>
                  <span className="font-body text-xs text-text-muted">{p.user_id === me ? "you" : p.display_name}</span>
                </span>
              ))}
            </div>
          </>
        )}

        <div className="mt-6 text-center">
          <Link href="/play" className="font-body text-xs" style={{ color: "#586058" }}>← Back to Play</Link>
        </div>
      </div>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh grid place-items-center bg-bg px-6">{children}</div>;
}
