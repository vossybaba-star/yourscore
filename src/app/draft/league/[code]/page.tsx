"use client";

/**
 * /draft/league/[code] — a private league board. Members ranked by in-league wins,
 * each with an "Available" badge; challenge any available member (self-organising,
 * no fixtures). Share the code to invite. Fails soft pre-migration.
 */

import { useCallback, useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { useUser } from "@/hooks/useUser";
import { loadTeam, isComplete, saveMatchup } from "@/lib/draft/local";

type Member = {
  user_id: string;
  display_name: string;
  played: number;
  won: number;
  lost: number;
  points: number;
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
  const [showQR, setShowQR] = useState(false);
  const [QRCode, setQRCode] = useState<ComponentType<{ value: string; size?: number }> | null>(null);

  useEffect(() => { import("react-qr-code").then((m) => setQRCode(() => m.default)); }, []);

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
        <div className="flex items-center gap-2 mt-2">
          <button onClick={shareCode} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.35)" }}>
            <span className="font-display tracking-widest" style={{ fontSize: 18, color: "#a78bfa" }}>{board.league.code}</span>
            <span className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>{copied ? "copied ✓" : "tap to share"}</span>
          </button>
          <button onClick={() => setShowQR((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background: showQR ? "rgba(167,139,250,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${showQR ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.08)"}` }}>
            <span className="font-body" style={{ fontSize: 12, color: showQR ? "#a78bfa" : "#8888aa" }}>▦ QR</span>
          </button>
        </div>

        {showQR && QRCode && (
          <div className="mt-3 flex flex-col items-center gap-2 p-4 rounded-2xl mx-auto" style={{ background: "white", maxWidth: 220 }}>
            <QRCode value={`${typeof window !== "undefined" ? window.location.origin : ""}/draft/league/${board.league.code}`} size={160} />
            <p className="font-body text-xs text-black/50 mt-1">Scan to join <span className="font-semibold text-black/70">{board.league.name}</span></p>
          </div>
        )}

        {err && <div className="rounded-xl px-4 py-2 mt-3 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

        {!board.isMember && user && (
          <button onClick={join} disabled={busy} className="w-full mt-4 rounded-2xl py-3 font-display tracking-wide disabled:opacity-50" style={{ background: "#00ff87", color: "#062013", fontSize: 20 }}>JOIN THIS LEAGUE</button>
        )}

        {board.isMember && (
          <button onClick={() => challenge(undefined)} disabled={busy} className="w-full mt-4 rounded-2xl py-3 font-display tracking-wide disabled:opacity-50" style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", fontSize: 18, border: "1px solid rgba(0,255,135,0.3)" }}>
            {busy ? "…" : "⚡ PLAY A RANDOM LEAGUE MATCH"}
          </button>
        )}

        {/* League table — Premier League style: Played, Won, Lost, Points */}
        <div className="font-body mt-6 mb-2 flex items-center justify-between" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>
          <span>LEAGUE TABLE</span>
          <span>{board.members.length} {board.members.length === 1 ? "MANAGER" : "MANAGERS"}</span>
        </div>

        {board.members.length === 0 ? (
          <div className="font-body text-center py-6 rounded-2xl" style={{ color: "#8888aa", fontSize: 13, background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            No managers yet — share the code or QR.
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* header */}
            <div className="flex items-center px-3 py-2 font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 0.5, background: "rgba(255,255,255,0.03)" }}>
              <span style={{ width: 24, textAlign: "center" }}>#</span>
              <span className="flex-1 pl-2">TEAM</span>
              <span style={{ width: 30, textAlign: "center" }}>P</span>
              <span style={{ width: 30, textAlign: "center" }}>W</span>
              <span style={{ width: 30, textAlign: "center" }}>L</span>
              <span style={{ width: 38, textAlign: "center", color: "#cfcfe6" }}>PTS</span>
            </div>
            {board.members.map((m, i) => (
              <div key={m.user_id} className="flex items-center px-3 py-2.5"
                style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: m.is_me ? "rgba(0,255,135,0.07)" : "transparent" }}>
                <span className="font-display tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 15, color: i === 0 ? "#ffb800" : i < 3 ? "#cfcfe6" : "#8888aa" }}>{i + 1}</span>
                <div className="flex-1 min-w-0 pl-2">
                  <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>
                    {m.display_name}{m.is_me ? " (you)" : ""}
                  </div>
                  <div className="font-body flex items-center gap-1.5" style={{ fontSize: 10, color: m.available ? "#00ff87" : "#8888aa" }}>
                    <span>{m.available ? "● Available" : "○ Away"}</span>
                    {m.strength != null && <span style={{ color: "#8888aa" }}>· {m.strength}</span>}
                  </div>
                </div>
                <span className="font-body tabular-nums" style={{ width: 30, textAlign: "center", fontSize: 14, color: "#cfcfe6" }}>{m.played}</span>
                <span className="font-body tabular-nums" style={{ width: 30, textAlign: "center", fontSize: 14, color: "#00ff87" }}>{m.won}</span>
                <span className="font-body tabular-nums" style={{ width: 30, textAlign: "center", fontSize: 14, color: "#ff4757" }}>{m.lost}</span>
                <span className="font-display tabular-nums" style={{ width: 38, textAlign: "center", fontSize: 16, color: "#fff" }}>{m.points}</span>
              </div>
            ))}
          </div>
        )}

        {/* Challenge an available manager (self-organising — no fixtures) */}
        {board.isMember && board.members.some((m) => !m.is_me && m.available) && (
          <>
            <div className="font-body mt-5 mb-2" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>CHALLENGE A MANAGER</div>
            <div className="flex flex-wrap gap-2">
              {board.members.filter((m) => !m.is_me && m.available).map((m) => (
                <button key={m.user_id} onClick={() => challenge(m.user_id)} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 disabled:opacity-50 active:scale-95 transition-transform"
                  style={{ background: "#12121e", border: "1px solid rgba(0,255,135,0.3)" }}>
                  <span className="font-body truncate" style={{ fontSize: 13, color: "#fff", maxWidth: 130 }}>{m.display_name}</span>
                  <span className="font-display tracking-wide rounded-full px-2" style={{ fontSize: 12, color: "#062013", background: "#00ff87" }}>⚔️ PLAY</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
