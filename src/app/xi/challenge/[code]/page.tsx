"use client";

/**
 * /xi/challenge/[code] — a friend opens a shared challenge: see the
 * challenger's snapshotted XI, then accept with your own to resolve the H2H.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { useUser } from "@/hooks/useUser";
import { loadTeam, saveTeam, isComplete, recordWin, recordLoss, saveLastMatch } from "@/lib/draft/local";
import type { Formation, PlacedPlayer, Projected } from "@/lib/draft/types";

type Info = {
  ready?: boolean;
  error?: string;
  challengerId?: string;
  challengerName?: string;
  strength?: number;
  formation?: Formation;
  squad?: PlacedPlayer[];
  projected?: Projected | null;
  status?: string;
  expired?: boolean;
};

export default function AcceptChallenge() {
  const router = useRouter();
  const { user } = useUser();
  const code = String(useParams().code ?? "").toUpperCase();
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<number>(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/draft/challenge/${code}`).then((r) => { setStatus(r.status); return r.json(); }).then(setInfo).catch(() => setInfo({ ready: false }));
  }, [code]);
  useEffect(() => { load(); }, [load]);

  async function accept() {
    if (busy) return;
    if (!user) { router.push("/auth/sign-in"); return; }
    const team = loadTeam();
    if (!team || !isComplete(team)) { router.push("/xi"); return; }
    setBusy(true); setErr(null);
    try {
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const saveRes = await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad }) });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save team"); setBusy(false); return; }

      const r = await fetch(`/api/draft/challenge/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const m = await r.json();
      if (!r.ok) { setErr(m.error ?? "Could not accept"); setBusy(false); return; }

      saveLastMatch({
        id: m.matchId,
        you: { name: "You", formation: m.you.formation, squad: m.you.squad, strength: m.you.strength, projected: m.you.projected },
        opp: { name: m.opp.name, formation: m.opp.formation, squad: m.opp.squad, strength: m.opp.strength, projected: m.opp.projected },
        winner: m.youWon ? "you" : "opp",
        margin: m.margin,
        playedAt: Date.now(),
      });
      saveTeam(m.youWon ? recordWin(team) : recordLoss(team));
      router.push("/xi/match/result");
    } catch { setErr("Network error"); setBusy(false); }
  }

  const wrap = (children: React.ReactNode) => (
    <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>{children}</div>
  );

  if (!info) return wrap(<span className="font-body" style={{ color: "#8888aa" }}>Loading…</span>);
  if (info.ready === false) return wrap(<div><div className="font-display tracking-wide" style={{ fontSize: 24, color: "#fff" }}>CHALLENGES COMING SOON</div><Link href="/xi" className="inline-block mt-4 font-body" style={{ color: "#00ff87" }}>← Build your XI</Link></div>);
  if (status === 404 || info.error === "Challenge not found") return wrap(<div><div className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>CHALLENGE NOT FOUND</div><Link href="/xi" className="inline-block mt-4 font-body" style={{ color: "#00ff87" }}>← Draft XI</Link></div>);

  const done = info.status === "accepted" || info.expired;

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-6 text-center">
          <div className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>YOU&apos;VE BEEN CHALLENGED</div>
          <h1 className="font-display tracking-wide leading-none mt-1" style={{ fontSize: 40, color: "#fff" }}>
            BEAT <span style={{ color: "#00ff87" }}>{info.challengerName}</span>
          </h1>
          <div className="font-body mt-2" style={{ fontSize: 14, color: "#cfcfe6" }}>
            Their XI · <b style={{ color: "#00ff87" }}>{info.strength}</b> strength · {info.formation}
          </div>
        </div>

        {info.squad && info.formation && (
          <div className="mt-5">
            <Pitch formation={info.formation} squad={info.squad} compact />
          </div>
        )}

        {err && <div className="rounded-xl px-4 py-2 mt-4 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

        <div className="mt-5 space-y-3">
          {done ? (
            <div className="rounded-2xl p-4 text-center font-body" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)", color: "#8888aa", fontSize: 14 }}>
              {info.expired ? "This challenge has expired." : "This challenge has already been played."}
            </div>
          ) : (
            <button onClick={accept} disabled={busy}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
              {busy ? "RESOLVING…" : user ? "ACCEPT WITH MY XI ⚔️" : "SIGN IN TO ACCEPT"}
            </button>
          )}
          <Link href="/xi" className="block w-full rounded-2xl py-3 text-center font-body active:scale-[0.98] transition-transform"
            style={{ background: "#12121e", color: "#8888aa", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)" }}>
            Build / view my XI
          </Link>
        </div>
      </div>
    </div>
  );
}
