"use client";

/**
 * /38-0/league/[code] — a private league board. Live-H2H-only: members ranked by
 * points (live W/D/L), each with an honest online dot. Challenge an online manager
 * → it sends a live invite; they accept and both drop into the two-half match,
 * which credits this league's table. Owner can rename/delete; members can leave.
 * Polls every few seconds so presence + incoming challenges stay fresh.
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { BottomNav } from "@/components/ui/BottomNav";
import { DraftHeader } from "@/components/draft/DraftHeader";
import { useUser } from "@/hooks/useUser";
import { loadTeam, isComplete } from "@/lib/draft/local";

type Member = {
  user_id: string;
  display_name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  strength: number | null;
  hasTeam: boolean;
  online: boolean;
  available: boolean;
  is_me: boolean;
};
type Incoming = { matchId: string; fromId: string; fromName: string; fromStrength: number };
type Board = {
  league: { id: string; name: string; code: string };
  members: Member[];
  isMember: boolean;
  isOwner: boolean;
  incoming: Incoming[];
  activeMatchId: string | null;
  ready?: boolean;
};

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
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { import("react-qr-code").then((m) => setQRCode(() => m.default)); }, []);

  const load = useCallback(() => {
    fetch(`/api/draft/league/${code}`)
      .then((r) => (r.status === 404 ? Promise.reject("404") : r.json()))
      .then((d) => setBoard(d))
      .catch(() => setNotFound(true));
  }, [code]);

  // Initial load + light polling (keeps me "online", surfaces incoming challenges).
  useEffect(() => {
    load();
    // 8s: halves board-poll volume vs 4s while keeping incoming-challenge
    // discovery well inside the 60s lobby window and the 75s online window.
    pollRef.current = setInterval(load, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  async function join() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/draft/league/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not join"); setBusy(false); return; }
      load();
    } catch { setErr("Network error"); }
    setBusy(false);
  }

  // Live challenge: requires a complete team locally + the opponent online. Sends a
  // directed invite, then drops me into the live lobby to wait for them to accept.
  async function challenge(opponentId: string) {
    if (!board || busy) return;
    if (!user) { router.push("/auth/sign-in"); return; }
    const team = loadTeam();
    if (!team || !isComplete(team)) { router.push("/38-0/team"); return; }
    setBusy(true); setErr(null);
    try {
      // Make sure the cloud has my current XI before matchmaking reads it.
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const saveRes = await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad, competition: team.league }) });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save your team"); setBusy(false); return; }

      const r = await fetch("/api/draft/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "challenge", leagueId: board.league.id, opponentId }) });
      const m = await r.json();
      if (!r.ok || !m.match) { setErr(m.error ?? "Could not send challenge"); setBusy(false); return; }
      router.push(`/38-0/live/match/${m.match.id}`);
    } catch { setErr("Network error"); setBusy(false); }
  }

  async function accept(matchId: string) {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/draft/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept", matchId }) });
      const m = await r.json();
      if (!r.ok || !m.match) { setErr(m.error ?? "Could not accept"); setBusy(false); return; }
      router.push(`/38-0/live/match/${m.match.id}`);
    } catch { setErr("Network error"); setBusy(false); }
  }

  async function decline(matchId: string) {
    setErr(null);
    await fetch("/api/draft/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "decline", matchId }) }).catch(() => {});
    load();
  }

  async function rename() {
    if (!board || !newName.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/draft/league/${code}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not rename"); setBusy(false); return; }
      setRenaming(false); setBusy(false); load();
    } catch { setErr("Network error"); setBusy(false); }
  }

  async function leaveOrDelete(mode: "leave" | "delete") {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/draft/league/${code}?mode=${mode}`, { method: "DELETE" });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Failed"); setBusy(false); return; }
      router.push("/38-0/leagues");
    } catch { setErr("Network error"); setBusy(false); }
  }

  function shareCode() {
    const url = `${window.location.origin}/38-0/league/${code}`;
    const text = `Join my Draft XI league "${board?.league.name ?? ""}" — code ${code}`;
    if (navigator.share) navigator.share({ title: "Draft XI League", text, url }).catch(() => {});
    else { navigator.clipboard.writeText(`${text} ${url}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }
  }

  if (notFound) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-display tracking-wide" style={{ fontSize: 28, color: "#fff" }}>LEAGUE NOT FOUND</div>
          <Link href="/38-0/leagues" className="inline-block mt-4 font-body" style={{ color: "#aeea00" }}>← Back to my leagues</Link>
        </div>
      </div>
    );
  }

  if (!board) return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8a948f" }}>Loading…</div>;

  if (board.ready === false) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-display tracking-wide" style={{ fontSize: 24, color: "#fff" }}>LEAGUES COMING SOON</div>
          <p className="font-body mt-2" style={{ fontSize: 13, color: "#8a948f" }}>Cloud leagues activate once the season is live.</p>
          <Link href="/38-0" className="inline-block mt-4 font-body" style={{ color: "#aeea00" }}>← Build your XI</Link>
        </div>
      </div>
    );
  }

  const onlineOpponents = board.members.filter((m) => !m.is_me && m.available);
  const alone = board.members.length <= 1;

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5">
        <DraftHeader />

        <div className="flex items-start justify-between gap-3">
          {renaming ? (
            <div className="flex-1">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} autoFocus
                className="w-full rounded-xl px-3 py-2 font-display tracking-wide" style={{ background: "#0e1611", color: "#fff", border: "1px solid rgba(174,234,0,0.4)", fontSize: 24 }} />
              <div className="flex gap-2 mt-2">
                <Button variant="primary" tone="lime" size="sm" onClick={rename} disabled={busy || !newName.trim()}>SAVE</Button>
                <button onClick={() => setRenaming(false)} className="rounded-lg px-4 py-2 font-body" style={{ color: "#8a948f", fontSize: 14 }}>Cancel</button>
              </div>
            </div>
          ) : (
            <h1 className="font-display tracking-wide leading-none flex-1" style={{ fontSize: 36, color: "#fff" }}>{board.league.name}</h1>
          )}
          {board.isOwner && !renaming && (
            <button onClick={() => { setNewName(board.league.name); setRenaming(true); }} className="font-body text-xs px-2.5 py-1 rounded-full shrink-0 mt-1" style={{ color: "#aeea00", background: "rgba(174,234,0,0.12)" }}>✏️ Rename</button>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <button onClick={shareCode} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.35)" }}>
            <span className="font-display tracking-widest" style={{ fontSize: 18, color: "#aeea00" }}>{board.league.code}</span>
            <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>{copied ? "copied ✓" : "tap to share"}</span>
          </button>
          <button onClick={() => setShowQR((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background: showQR ? "rgba(174,234,0,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${showQR ? "rgba(174,234,0,0.35)" : "rgba(255,255,255,0.08)"}` }}>
            <span className="font-body" style={{ fontSize: 12, color: showQR ? "#aeea00" : "#8a948f" }}>▦ QR</span>
          </button>
        </div>

        {showQR && QRCode && (
          <div className="mt-3 flex flex-col items-center gap-2 p-4 rounded-2xl mx-auto" style={{ background: "white", maxWidth: 220 }}>
            <QRCode value={`${typeof window !== "undefined" ? window.location.origin : ""}/38-0/league/${board.league.code}`} size={160} />
            <p className="font-body text-xs text-black/50 mt-1">Scan to join <span className="font-semibold text-black/70">{board.league.name}</span></p>
          </div>
        )}

        {err && <div className="rounded-xl px-4 py-2 mt-3 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

        {!board.isMember && user && (
          <Button variant="primary" tone="lime" size="md" fullWidth className="mt-4" onClick={join} disabled={busy}>JOIN THIS LEAGUE</Button>
        )}

        {/* Resume an in-progress match */}
        {board.activeMatchId && (
          <Button variant="primary" tone="lime" size="md" fullWidth className="mt-4" href={`/38-0/live/match/${board.activeMatchId}`}>
            ▶ RESUME YOUR MATCH
          </Button>
        )}

        {/* Incoming live challenges */}
        {board.incoming?.length > 0 && (
          <div className="mt-4 space-y-2">
            {board.incoming.map((c) => (
              <div key={c.matchId} className="rounded-2xl p-4" style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.4)" }}>
                <div className="font-display tracking-wide" style={{ fontSize: 16, color: "#fff" }}>⚔️ {c.fromName} challenged you</div>
                <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>Strength {c.fromStrength} · live two-half match</div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Button variant="primary" tone="lime" size="sm" fullWidth onClick={() => accept(c.matchId)} disabled={busy}>ACCEPT →</Button>
                  <Button variant="ghost" size="sm" fullWidth onClick={() => decline(c.matchId)} disabled={busy}>Decline</Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* First-member invite moment */}
        {board.isMember && alone && (
          <div className="mt-5 rounded-2xl p-5 text-center" style={{ background: "linear-gradient(135deg,#0e1611,#0e1611)", border: "1px solid rgba(174,234,0,0.35)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>INVITE YOUR MATES</div>
            <p className="font-body mt-1 mb-3" style={{ fontSize: 13, color: "#c4ccc6" }}>A league needs at least two managers. Share the code or QR — matches are live head-to-head.</p>
            <Button variant="primary" tone="lime" size="md" fullWidth onClick={shareCode}>SHARE INVITE →</Button>
          </div>
        )}

        {/* League table */}
        <div className="font-body mt-6 mb-2 flex items-center justify-between" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>
          <span>LEAGUE TABLE</span>
          <span>{board.members.length} {board.members.length === 1 ? "MANAGER" : "MANAGERS"}</span>
        </div>

        {board.members.length === 0 ? (
          <div className="font-body text-center py-6 rounded-2xl" style={{ color: "#8a948f", fontSize: 13, background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
            No managers yet — share the code or QR.
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center px-3 py-2 font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 0.5, background: "rgba(255,255,255,0.03)" }}>
              <span style={{ width: 24, textAlign: "center" }}>#</span>
              <span className="flex-1 pl-2">TEAM</span>
              <span style={{ width: 26, textAlign: "center" }}>P</span>
              <span style={{ width: 26, textAlign: "center" }}>W</span>
              <span style={{ width: 26, textAlign: "center" }}>D</span>
              <span style={{ width: 26, textAlign: "center" }}>L</span>
              <span style={{ width: 36, textAlign: "center", color: "#c4ccc6" }}>PTS</span>
            </div>
            {board.members.map((m, i) => (
              <div key={m.user_id} className="flex items-center px-3 py-2.5"
                style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: m.is_me ? "rgba(174,234,0,0.07)" : "transparent" }}>
                <span className="font-display tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 15, color: i === 0 ? "#ffb800" : i < 3 ? "#c4ccc6" : "#8a948f" }}>{i + 1}</span>
                <div className="flex-1 min-w-0 pl-2">
                  <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>
                    {m.display_name}{m.is_me ? " (you)" : ""}
                  </div>
                  <div className="font-body flex items-center gap-1.5" style={{ fontSize: 10, color: m.online ? "#aeea00" : "#8a948f" }}>
                    <span>{m.online ? "● Online" : "○ Offline"}</span>
                    {m.strength != null && <span style={{ color: "#8a948f" }}>· {m.strength}</span>}
                  </div>
                </div>
                <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#c4ccc6" }}>{m.played}</span>
                <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#aeea00" }}>{m.won}</span>
                <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#ffb800" }}>{m.drawn}</span>
                <span className="font-body tabular-nums" style={{ width: 26, textAlign: "center", fontSize: 14, color: "#ff4757" }}>{m.lost}</span>
                <span className="font-display tabular-nums" style={{ width: 36, textAlign: "center", fontSize: 16, color: "#fff" }}>{m.points}</span>
              </div>
            ))}
          </div>
        )}

        {/* Challenge an online manager (live H2H) */}
        {board.isMember && !board.activeMatchId && (
          <>
            <div className="font-body mt-5 mb-2" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>CHALLENGE A MANAGER · LIVE</div>
            {onlineOpponents.length === 0 ? (
              <div className="font-body text-center py-5 rounded-2xl" style={{ color: "#8a948f", fontSize: 13, background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
                {board.members.length <= 1 ? "Invite mates to play." : "Nobody else online right now. League matches are live — challenge a manager when their dot is green."}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {onlineOpponents.map((m) => (
                  <button key={m.user_id} onClick={() => challenge(m.user_id)} disabled={busy}
                    className="inline-flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 disabled:opacity-50 active:scale-95 transition-transform"
                    style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.3)" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: "#aeea00" }} />
                    <span className="font-body truncate" style={{ fontSize: 13, color: "#fff", maxWidth: 120 }}>{m.display_name}</span>
                    <span className="font-display tracking-wide rounded-full px-2" style={{ fontSize: 12, color: "#062013", background: "#aeea00" }}>⚔️ PLAY</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Manage: leave (member) / delete (owner) */}
        {board.isMember && (
          <div className="mt-8 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            {confirmDelete ? (
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.3)" }}>
                <div className="font-body" style={{ fontSize: 13, color: "#ff7a88" }}>
                  {board.isOwner ? "Delete this league for everyone? This can't be undone." : "Leave this league?"}
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="danger" size="sm" onClick={() => leaveOrDelete(board.isOwner ? "delete" : "leave")} disabled={busy}>
                    {board.isOwner ? "DELETE LEAGUE" : "LEAVE"}
                  </Button>
                  <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-4 py-2 font-body" style={{ color: "#8a948f", fontSize: 14 }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="font-body text-sm" style={{ color: "#8a948f" }}>
                {board.isOwner ? "🗑 Delete league" : "← Leave league"}
              </button>
            )}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
