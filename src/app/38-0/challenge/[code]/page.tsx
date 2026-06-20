"use client";

/**
 * /38-0/challenge/[code] — a friend opens a shared challenge: see the
 * challenger's snapshotted XI, then accept with your own to resolve the H2H.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Pitch } from "@/components/draft/Pitch";
import { useUser } from "@/hooks/useUser";
import { AuthProviders } from "@/components/auth/AuthButton";
import { loadTeam, saveTeam, isComplete, recordWin, recordLoss, recordDraw, saveLastMatch } from "@/lib/draft/local";
import { AddFriendCard } from "@/components/social/AddFriendCard";
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
  const [accepted, setAccepted] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/draft/challenge/${code}`).then((r) => { setStatus(r.status); return r.json(); }).then(setInfo).catch(() => setInfo({ ready: false }));
  }, [code]);
  useEffect(() => { load(); }, [load]);

  async function accept() {
    if (busy || !user) return;
    const team = loadTeam();
    if (!team || !isComplete(team)) { router.push("/38-0"); return; }
    setBusy(true); setErr(null);
    try {
      const squad = team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
      const saveRes = await fetch("/api/draft/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formation: team.formation, squad, competition: team.league }) });
      if (!saveRes.ok) { setErr((await saveRes.json().catch(() => ({}))).error ?? "Could not save team"); setBusy(false); return; }

      const r = await fetch(`/api/draft/challenge/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const m = await r.json();
      if (!r.ok) { setErr(m.error ?? "Could not accept"); setBusy(false); return; }

      saveLastMatch({
        id: m.matchId,
        you: { name: "You", formation: m.you.formation, squad: m.you.squad, strength: m.you.strength, projected: m.you.projected },
        opp: { name: m.opp.name, formation: m.opp.formation, squad: m.opp.squad, strength: m.opp.strength, projected: m.opp.projected },
        outcome: m.outcome,
        goals: m.goals,
        pens: m.pens ?? null,
        report: m.report,
        playedAt: Date.now(),
        oppUserId: info?.challengerId,
        // Level after 90 → the shootout decides it; streaks settle on the pens screen.
        pensPending: m.pensPending ? { mode: "server", shots: [], powers: [], dives: [] } : undefined,
      });
      if (m.pensPending) { router.push("/38-0/match/pens"); return; }
      saveTeam(m.outcome === "you" ? recordWin(team) : m.outcome === "opp" ? recordLoss(team) : recordDraw(team));
      setAccepted(true); // show friend card before navigating to result
    } catch { setErr("Network error"); setBusy(false); }
  }

  const wrap = (children: React.ReactNode) => (
    <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>{children}</div>
  );

  if (!info) return wrap(<span className="font-body" style={{ color: "#8a948f" }}>Loading…</span>);
  if (info.ready === false) return wrap(<div><div className="font-display tracking-wide" style={{ fontSize: 24, color: "#fff" }}>CHALLENGES COMING SOON</div><Link href="/38-0" className="inline-block mt-4 font-body" style={{ color: "#aeea00" }}>← Build your XI</Link></div>);
  if (status === 404 || info.error === "Challenge not found") return wrap(<div><div className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>CHALLENGE NOT FOUND</div><Link href="/38-0" className="inline-block mt-4 font-body" style={{ color: "#aeea00" }}>← Draft XI</Link></div>);

  const done = info.status === "accepted" || info.expired;

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-6 text-center">
          <div className="font-body" style={{ fontSize: 13, color: "#8a948f" }}>YOU&apos;VE BEEN CHALLENGED</div>
          <h1 className="font-display tracking-wide leading-none mt-1" style={{ fontSize: 40, color: "#fff" }}>
            BEAT <span style={{ color: "#aeea00" }}>{info.challengerName}</span>
          </h1>
          <div className="font-body mt-2" style={{ fontSize: 14, color: "#c4ccc6" }}>
            Their XI · <b style={{ color: "#aeea00" }}>{info.strength}</b> strength · {info.formation}
          </div>
        </div>

        {info.squad && info.formation && (
          <div className="mt-5">
            <Pitch formation={info.formation} squad={info.squad} compact />
          </div>
        )}

        {err && <div className="rounded-xl px-4 py-2 mt-4 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

        <div className="mt-5 space-y-3">
          {accepted ? (
            /* Match resolved — show friend card then let them view result */
            <>
              {info.challengerId && info.challengerName && (
                <AddFriendCard
                  userId={info.challengerId}
                  displayName={info.challengerName}
                  context={`You just played ${info.challengerName}!`}
                />
              )}
              <Button variant="primary" tone="lime" size="md" fullWidth onClick={() => router.push("/38-0/match/result")}>
                VIEW RESULT →
              </Button>
            </>
          ) : done ? (
            <div className="rounded-2xl p-4 text-center font-body" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)", color: "#8a948f", fontSize: 14 }}>
              {info.expired ? "This challenge has expired." : "This challenge has already been played."}
            </div>
          ) : !user ? (
            /* Guest — show inline sign-in. After auth the user lands back here
               with their session set and can tap ACCEPT WITH MY XI. */
            <div className="rounded-2xl p-4" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="font-body text-center mb-4" style={{ fontSize: 13, color: "#8a948f" }}>
                Sign in to accept this challenge with your XI.
              </p>
              <AuthProviders nextPath={`/38-0/challenge/${code}`} />
            </div>
          ) : (
            <Button variant="primary" tone="lime" size="md" fullWidth onClick={accept} disabled={busy}>
              {busy ? "RESOLVING…" : "ACCEPT WITH MY XI ⚔️"}
            </Button>
          )}
          <Button variant="ghost" size="md" fullWidth href="/38-0">
            Build / view my XI
          </Button>
        </div>
      </div>
    </div>
  );
}
