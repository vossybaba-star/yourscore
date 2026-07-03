"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { BackPill } from "@/components/ui/BackPill";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// The revenge library: one player's shadowable runs — pick a quiz they've
// played and take on their recorded run (same questions, their real answers at
// their real speed). Reached from the shadow-result notification and the
// post-match reveal.

const TEAL = "#00d8c0";

interface PlayerHead { id: string; name: string; avatarUrl: string | null; totalScore: number }
interface Run { packId: string; packName: string; cover: string | null; score: number; playedAt: string | null; questionCount: number }

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function ShadowLibraryPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading } = useUser();
  const userId = params.userId as string;

  const [player, setPlayer] = useState<PlayerHead | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !userId) return;
    fetch(`/api/versus/shadow?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.player) { setPlayer(d.player); setRuns(d.runs ?? []); }
        else { setErr(d.error ?? "Could not load their runs"); setRuns([]); }
      })
      .catch(() => { setErr("Could not load their runs"); setRuns([]); });
  }, [user, userId]);

  async function play(run: Run) {
    if (busy) return;
    setBusy(run.packId); setErr(null);
    try {
      const r = await fetch("/api/versus/queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "shadowOf", userId, packId: run.packId }),
      }).then((x) => x.json());
      if (r.roomId) { router.push(`/play/${r.roomId}`); return; }
      setErr(r.error ?? "Could not start the match"); setBusy(null);
    } catch { setErr("Network error"); setBusy(null); }
  }

  if (!loading && !user) {
    return (
      <main className="min-h-dvh bg-bg grid place-items-center px-6">
        <div className="text-center">
          <p className="font-display text-2xl text-white mb-2">Shadow matches</p>
          <p className="font-body text-sm text-text-muted mb-5">Sign in to take on their runs.</p>
          <Link href={`/auth/sign-in?next=/versus/shadow/${userId}`} className="inline-block rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: TEAL, color: "#04231f" }}>Sign in →</Link>
        </div>
      </main>
    );
  }

  const isSelf = user?.id === userId;

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-4"><BackPill href="/versus" label="Versus" tone="play" /></div>

        {/* Player header */}
        {player && (
          <div className="mt-5 flex items-center gap-4">
            <PlayerAvatar seed={player.id} name={player.name} avatarUrl={player.avatarUrl} size={60} ring={TEAL} />
            <div className="min-w-0">
              <p className="font-body text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: TEAL }}>Shadow matches</p>
              <p className="font-display text-3xl text-white leading-none mt-1 truncate">{player.name}</p>
              <p className="font-body text-xs text-text-muted mt-1">{player.totalScore.toLocaleString()} career pts</p>
            </div>
          </div>
        )}
        <p className="font-body text-sm text-text-muted mt-3">
          {isSelf ? "These are your runs other players can take on." : "Pick one of their runs and beat it — same questions, their real answers at their real speed."}
        </p>

        {err && <p className="font-body text-sm mt-4" style={{ color: "#ff6b78" }}>{err}</p>}

        {/* Runs */}
        <div className="mt-5 space-y-2.5">
          {runs === null ? (
            <p className="font-body text-sm text-text-muted">Loading their runs…</p>
          ) : runs.length === 0 ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="font-body text-sm text-white">No runs to play yet</p>
              <p className="font-body text-xs text-text-muted mt-1 mb-3">They haven&rsquo;t finished a Quiz Battle — challenge them live instead.</p>
              <Link href={`/versus/quiz?to=${userId}`} className="inline-block rounded-xl px-4 py-2.5 font-display text-sm tracking-wide" style={{ background: TEAL, color: "#04231f" }}>CHALLENGE THEM →</Link>
            </div>
          ) : runs.map((run) => (
            <div key={run.packId} className="rounded-2xl overflow-hidden" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-3 p-3.5">
                <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 grid place-items-center" style={{ background: "rgba(0,216,192,0.08)", border: "1px solid rgba(0,216,192,0.2)" }}>
                  {run.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={run.cover} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <span className="font-display text-xl" style={{ color: TEAL }}>{(run.packName[0] ?? "?").toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold text-white leading-snug line-clamp-2">{run.packName}</p>
                  <p className="font-body text-[11px] text-text-muted mt-0.5">
                    Their run: <span style={{ color: TEAL }}>{run.score.toLocaleString()}</span> · {run.questionCount}Q{run.playedAt ? ` · ${dateLabel(run.playedAt)}` : ""}
                  </p>
                </div>
                {!isSelf && (
                  <button onClick={() => play(run)} disabled={!!busy} className="font-display text-[11px] tracking-wide px-3.5 py-2.5 rounded-lg flex-shrink-0 active:scale-[0.97] transition-transform disabled:opacity-50" style={{ background: TEAL, color: "#04231f" }}>
                    {busy === run.packId ? "STARTING…" : "PLAY THEIR RUN →"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
