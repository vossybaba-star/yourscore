"use client";

/**
 * /38-0/leagues — your private leagues: create one (get a join code), join by
 * code, or open a board. Self-organising, no fixtures (spec §4.3).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { BottomNav } from "@/components/ui/BottomNav";
import { DraftHeader } from "@/components/draft/DraftHeader";
import { useUser } from "@/hooks/useUser";
import { afLeagueCreate, afLeagueJoin } from "@/lib/analytics/appsflyerEvents";

type League = { id: string; name: string; code: string; member_count: number };

export default function Leagues() {
  const router = useRouter();
  const { user, loading } = useUser();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/draft/league").then((r) => r.json()).then((d) => setLeagues(d.leagues ?? [])).catch(() => {});
  }, [user]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/draft/league", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "Could not create"); setBusy(false); return; }
      afLeagueCreate({ leagueType: "38-0" });
      router.push(`/38-0/league/${d.code}`);
    } catch { setErr("Network error"); setBusy(false); }
  }

  async function join() {
    if (!code.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/draft/league/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "Could not join"); setBusy(false); return; }
      afLeagueJoin({ leagueType: "38-0" });
      router.push(`/38-0/league/${d.code}`);
    } catch { setErr("Network error"); setBusy(false); }
  }

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <DraftHeader />
        <h1 className="font-display tracking-wide leading-none" style={{ fontSize: 44, color: "#fff" }}>
          MY <span style={{ color: "#aeea00" }}>LEAGUES</span>
        </h1>
        <p className="font-body mt-1 mb-5" style={{ fontSize: 13, color: "#8a948f" }}>
          Compete just with your mates — separate from the global board.
        </p>

        {!user && !loading ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#fff" }}>SIGN IN FOR LEAGUES</div>
            <p className="font-body mt-2" style={{ fontSize: 13, color: "#8a948f" }}>Create or join a private league to compete with your group.</p>
            <Button variant="primary" tone="lime" size="md" className="mt-4" href="/auth/sign-in">SIGN IN →</Button>
          </div>
        ) : (
          <>
            {err && <div className="rounded-xl px-4 py-2 mb-3 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

            {/* create */}
            <div className="rounded-2xl p-4 mb-3" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.25)" }}>
              <div className="font-display tracking-wide mb-2" style={{ fontSize: 18, color: "#aeea00" }}>CREATE A LEAGUE</div>
              <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="League name"
                  className="flex-1 rounded-xl px-3 py-3 font-body" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }} />
                <Button variant="primary" tone="lime" size="sm" onClick={create} disabled={busy || !name.trim()}>CREATE</Button>
              </div>
            </div>

            {/* join */}
            <div className="rounded-2xl p-4 mb-5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="font-display tracking-wide mb-2" style={{ fontSize: 18, color: "#fff" }}>JOIN BY CODE</div>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123"
                  className="flex-1 rounded-xl px-3 py-3 font-display tracking-widest" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)", fontSize: 20 }} />
                <Button variant="primary" tone="lime" size="sm" onClick={join} disabled={busy || !code.trim()}>JOIN</Button>
              </div>
            </div>

            {/* my leagues */}
            {leagues.length > 0 && (
              <div className="space-y-2">
                {leagues.map((l) => (
                  <Link key={l.id} href={`/38-0/league/${l.code}`} className="flex items-center justify-between rounded-xl px-4 py-3 active:scale-[0.98] transition-transform"
                    style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div>
                      <div className="font-body" style={{ fontSize: 16, color: "#fff" }}>{l.name}</div>
                      <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>{l.member_count} member{l.member_count === 1 ? "" : "s"} · {l.code}</div>
                    </div>
                    <span className="font-display" style={{ fontSize: 20, color: "#aeea00" }}>→</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
