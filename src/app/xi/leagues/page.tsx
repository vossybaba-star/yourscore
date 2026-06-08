"use client";

/**
 * /xi/leagues — your private leagues: create one (get a join code), join by
 * code, or open a board. Self-organising, no fixtures (spec §4.3).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { useUser } from "@/hooks/useUser";

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
      router.push(`/xi/league/${d.code}`);
    } catch { setErr("Network error"); setBusy(false); }
  }

  async function join() {
    if (!code.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/draft/league/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "Could not join"); setBusy(false); return; }
      router.push(`/xi/league/${d.code}`);
    } catch { setErr("Network error"); setBusy(false); }
  }

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-2">
          <Link href="/xi/leaderboard" className="font-body text-sm" style={{ color: "#8888aa" }}>← Leaderboard</Link>
        </div>
        <h1 className="font-display tracking-wide leading-none" style={{ fontSize: 44, color: "#fff" }}>
          MY <span style={{ color: "#a78bfa" }}>LEAGUES</span>
        </h1>
        <p className="font-body mt-1 mb-5" style={{ fontSize: 13, color: "#8888aa" }}>
          Compete just with your mates — separate from the global board.
        </p>

        {!user && !loading ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#fff" }}>SIGN IN FOR LEAGUES</div>
            <p className="font-body mt-2" style={{ fontSize: 13, color: "#8888aa" }}>Create or join a private league to compete with your group.</p>
            <Link href="/auth/sign-in" className="inline-block mt-4 rounded-xl px-5 py-3 font-display tracking-wide" style={{ background: "#a78bfa", color: "#15082b", fontSize: 18 }}>SIGN IN →</Link>
          </div>
        ) : (
          <>
            {err && <div className="rounded-xl px-4 py-2 mb-3 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

            {/* create */}
            <div className="rounded-2xl p-4 mb-3" style={{ background: "#12121e", border: "1px solid rgba(167,139,250,0.25)" }}>
              <div className="font-display tracking-wide mb-2" style={{ fontSize: 18, color: "#a78bfa" }}>CREATE A LEAGUE</div>
              <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="League name"
                  className="flex-1 rounded-xl px-3 py-3 font-body" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }} />
                <button onClick={create} disabled={busy || !name.trim()} className="rounded-xl px-5 font-display tracking-wide disabled:opacity-50" style={{ background: "#a78bfa", color: "#15082b", fontSize: 18 }}>CREATE</button>
              </div>
            </div>

            {/* join */}
            <div className="rounded-2xl p-4 mb-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="font-display tracking-wide mb-2" style={{ fontSize: 18, color: "#fff" }}>JOIN BY CODE</div>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123"
                  className="flex-1 rounded-xl px-3 py-3 font-display tracking-widest" style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.1)", fontSize: 20 }} />
                <button onClick={join} disabled={busy || !code.trim()} className="rounded-xl px-5 font-display tracking-wide disabled:opacity-50" style={{ background: "#00ff87", color: "#062013", fontSize: 18 }}>JOIN</button>
              </div>
            </div>

            {/* my leagues */}
            {leagues.length > 0 && (
              <div className="space-y-2">
                {leagues.map((l) => (
                  <Link key={l.id} href={`/xi/league/${l.code}`} className="flex items-center justify-between rounded-xl px-4 py-3 active:scale-[0.98] transition-transform"
                    style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div>
                      <div className="font-body" style={{ fontSize: 16, color: "#fff" }}>{l.name}</div>
                      <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>{l.member_count} member{l.member_count === 1 ? "" : "s"} · {l.code}</div>
                    </div>
                    <span className="font-display" style={{ fontSize: 20, color: "#a78bfa" }}>→</span>
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
