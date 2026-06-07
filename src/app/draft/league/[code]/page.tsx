"use client";

/**
 * /draft/league/[code] — a private league board. Members ranked by in-league wins,
 * each with an "Available" badge; challenge any available member (self-organising,
 * no fixtures). Share the code to invite. Fails soft pre-migration.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { useUser } from "@/hooks/useUser";
import { loadTeam, isComplete, saveMatchup } from "@/lib/draft/local";

type Member = {
  user_id: string;
  display_name: string;
  wins_today: number;
  wins_all_time: number;
  strength: number | null;
  available: boolean;
  is_me: boolean;
};
type Board = { league: { id: string; name: string; code: string }; members: Member[]; isMember: boolean; ready?: boolean };

export default function LeagueBoard() {
  const router = useRouter();
  const { user } = useUser();
  const code = String(useParams().code ?? "").toUpperCase();
  const [board, setBoard] = useState<Board | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/draft/league/${code}`)
      .then((r) => (r.status === 404 ? Promise.reject("404") : r.json()))
      .then((d) => setBoard(d))
      .catch(() => setNotFound(true));
  }, [code]);

  useEffect(() => { load(); }, [load]);

  async function join() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/draft/league/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not join"); setBusy(false); return; }
      load();
    } catch { setErr("Network error"); }
    setBusy(false);
  }

  async function challenge(opponentId?: string) {
    if (!board || busy) return;
    if (!user) { router.push("/auth/sign-in"); return; }
    const team = loadTeam();
    if (!team || !isComplete(team)) { router.push("/draft"); return; }
    setBusy(true); setErr(null);
    try {
      // Ensure the cloud has the current XI (server reads it as the challenger).
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const saveRes = await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad }) });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save team"); setBusy(false); return; }

      // Matchmake (no resolution) → preview the opponent's XI and swap before kick-off.
      const r = await fetch("/api/draft/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "find", leagueId: board.league.id, opponentId }) });
      const m = await r.json();
      if (!r.ok) { setErr(m.error ?? "Match failed"); setBusy(false); return; }

      saveMatchup({ opponentId: m.opponentId, findId: m.findId, botFormation: m.botFormation, leagueId: board.league.id, opp: m.opp });
      router.push("/draft/match/prematch");
    } catch { setErr("Network error"); setBusy(false); }
  }

  function shareCode() {
    const url = `${window.location.origin}/draft/league/${code}`;
    const text = `Join my Draft XI league "${board?.league.name ?? ""}" — code ${code}`;
    if (navigator.share) navigator.share({ title: "Draft XI League", text, url }).catch(() => {});
    else { navigator.clipboard.writeText(`${text} ${url}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }
  }

  if (notFound) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-display tracking-wide" style={{ fontSize: 28, color: "#fff" }}>LEAGUE NOT FOUND</div>
          <Link href="/draft/leagues" className="inline-block mt-4 font-body" style={{ color: "#00ff87" }}>← Back to my leagues</Link>
        </div>
      </div>
    );
  }

  if (!board) return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;

  if (board.ready === false) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-display tracking-wide" style={{ fontSize: 24, color: "#fff" }}>LEAGUES COMING SOON</div>
          <p className="font-body mt-2" style={{ fontSize: 13, color: "#8888aa" }}>Cloud leagues activate once the season is live.</p>
          <Link href="/draft" className="inline-block mt-4 font-body" style={{ color: "#00ff87" }}>← Build your XI</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-2">
          <Link href="/draft/leagues" className="font-body text-sm" style={{ color: "#8888aa" }}>← Leagues</Link>
        </div>

        <h1 className="font-display tracking-wide leading-none" style={{ fontSize: 38, color: "#fff" }}>{board.league.name}</h1>
        <button onClick={shareCode} className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.35)" }}>
          <span className="font-display tracking-widest" style={{ fontSize: 18, color: "#a78bfa" }}>{board.league.code}</span>
          <span className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>{copied ? "copied ✓" : "tap to share"}</span>
        </button>

        {err && <div className="rounded-xl px-4 py-2 mt-3 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

        {!board.isMember && user && (
          <button onClick={join} disabled={busy} className="w-full mt-4 rounded-2xl py-3 font-display tracking-wide disabled:opacity-50" style={{ background: "#00ff87", color: "#062013", fontSize: 20 }}>JOIN THIS LEAGUE</button>
        )}

        {board.isMember && (
          <button onClick={() => challenge(undefined)} disabled={busy} className="w-full mt-4 rounded-2xl py-3 font-display tracking-wide disabled:opacity-50" style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", fontSize: 18, border: "1px solid rgba(0,255,135,0.3)" }}>
            {busy ? "…" : "⚡ PLAY A RANDOM LEAGUE MATCH"}
          </button>
        )}

        <div className="mt-5 space-y-2">
          {board.members.length === 0 && (
            <div className="font-body text-center py-6" style={{ color: "#8888aa", fontSize: 13 }}>No members yet — share the code.</div>
          )}
          {board.members.map((m, i) => (
            <div key={m.user_id} className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: m.is_me ? "rgba(0,255,135,0.08)" : "#12121e", border: `1px solid ${m.is_me ? "rgba(0,255,135,0.4)" : "rgba(255,255,255,0.07)"}` }}>
              <div className="font-display tabular-nums" style={{ fontSize: 18, color: i < 3 ? "#ffb800" : "#8888aa", width: 28 }}>{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="font-body truncate" style={{ fontSize: 15, color: "#fff" }}>{m.display_name}{m.is_me ? " (you)" : ""}</div>
                <div className="font-body" style={{ fontSize: 11, color: m.available ? "#00ff87" : "#8888aa" }}>
                  {m.available ? "● Available" : "Stale"}{m.strength != null ? ` · ${m.strength}` : ""}
                </div>
              </div>
              <div className="font-display" style={{ fontSize: 20, color: "#00ff87" }}>{m.wins_all_time}</div>
              {board.isMember && !m.is_me && m.available && (
                <button onClick={() => challenge(m.user_id)} disabled={busy}
                  className="rounded-lg px-3 py-2 font-display tracking-wide disabled:opacity-50" style={{ background: "#00ff87", color: "#062013", fontSize: 14 }}>
                  PLAY
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
