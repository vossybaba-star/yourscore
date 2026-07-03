"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackPill } from "@/components/ui/BackPill";
import { useUser } from "@/hooks/useUser";
import { useVersusStats } from "@/hooks/useVersusStats";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// Versus-owned 38-0 challenge entry. Reuses the live-match API (/api/draft/live)
// but presents the mockup's "who are you playing → challenge sent (code)" flow
// inside Versus, so 38-0 challenges feel like their own experience instead of
// bouncing to the standalone /38-0/live game tab.

const LIME = "#aeea00";
type Resp = { match?: { id: string; join_code?: string }; error?: string };

export default function Versus380Page() {
  const router = useRouter();
  const { user, loading } = useUser();
  const { rivalries } = useVersusStats();
  const [code, setCode] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needTeam, setNeedTeam] = useState(false);

  async function api(body: Record<string, unknown>): Promise<Resp> {
    const res = await fetch("/api/draft/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, competition: "PL" }) });
    return res.json().catch(() => ({ error: "Request failed" }));
  }

  async function createChallenge() {
    if (busy) return;
    setBusy(true); setError(null); setNeedTeam(false);
    const r = await api({ action: "create" });
    setBusy(false);
    if (r.error) { if (/team/i.test(r.error)) setNeedTeam(true); else setError(r.error); return; }
    if (r.match) { setMatchId(r.match.id); setCode(r.match.join_code ?? null); }
  }

  async function join() {
    const c = joinCode.trim().toUpperCase();
    if (!c || busy) return;
    setBusy(true); setError(null);
    const r = await api({ action: "join", code: c });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    if (r.match) router.push(`/38-0/live/match/${r.match.id}`);
  }

  function share() {
    if (!code || typeof navigator === "undefined") return;
    const url = `${location.origin}/38-0/live/${code}`;
    navigator.share?.({ title: "38-0", text: `Take me on at 38-0 — code ${code}`, url }).catch(() => {});
  }

  if (!loading && !user) {
    return (
      <main className="min-h-dvh bg-bg grid place-items-center px-6">
        <div className="text-center">
          <p className="font-display text-2xl text-white mb-2">Challenge at 38-0</p>
          <p className="font-body text-sm text-text-muted mb-5">Sign in to build your XI and play.</p>
          <Link href="/auth/sign-in?next=/versus/38-0" className="inline-block rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: LIME, color: "#13200a" }}>Sign in →</Link>
        </div>
      </main>
    );
  }

  const rivals = rivalries.slice(0, 6);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      {/* Image-backed header */}
      <div className="relative">
        <div className="absolute inset-0" style={{ background: "url(/email/wc-draft.png) center/cover" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,13,10,0.72) 0%, rgba(8,13,10,0.86) 55%, #080d0a 100%)" }} />
        <div className="relative max-w-lg mx-auto px-5 pt-safe">
          <div className="pt-4"><BackPill href="/versus" label="Versus" tone="draft" /></div>
          <div className="pt-6 pb-5">
            <div className="flex items-center gap-2 mb-2">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M8 2.5 3 5.5 5 9.5 7.3 8.3V19a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1V8.3L17 9.5l2-4-5-3C14 4.4 12.7 5.6 11 5.6S8 4.4 8 2.5Z" stroke={LIME} strokeWidth="1.7" strokeLinejoin="round" fill={LIME} fillOpacity={0.15} /></svg>
              <span className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: LIME }}>38-0 · Versus</span>
            </div>
            <p className="font-display text-white leading-[0.92]" style={{ fontSize: 36 }}>BUILD YOUR XI.<br />CHALLENGE A RIVAL.</p>
            <p className="font-body text-sm mt-2" style={{ color: "#cdeee7" }}>Draft your ultimate squad and take on a real opponent.</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5">
        {code ? (
          /* ── Challenge created — share the code ── */
          <div className="rounded-3xl p-6 mt-4 text-center" style={{ background: "linear-gradient(160deg, #16210f, #0c1613)", border: `1px solid ${LIME}40` }}>
            <p className="font-display text-2xl text-white">Challenge created</p>
            <p className="font-body text-sm text-text-muted mt-1">Share this code with your friend.</p>
            <div className="font-mono font-bold tracking-[0.35em] my-5" style={{ fontSize: 42, color: LIME }}>{code}</div>
            <button onClick={share} className="w-full rounded-2xl py-3.5 font-display tracking-wide mb-2.5" style={{ background: LIME, color: "#13200a" }}>SHARE CHALLENGE →</button>
            {matchId && <button onClick={() => router.push(`/38-0/live/match/${matchId}`)} className="w-full rounded-2xl py-3.5 font-display tracking-wide" style={{ background: "rgba(255,255,255,0.05)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.14)" }}>ENTER LOBBY →</button>}
            <div className="flex items-start justify-between gap-2 mt-5 text-left">
              {["Share the challenge", "Your friend joins", "Kick off"].map((step, i) => (
                <div key={step} className="flex-1 min-w-0">
                  <p className="font-display text-lg leading-none" style={{ color: `${LIME}88` }}>{i + 1}</p>
                  <p className="font-body text-[10px] text-text-muted mt-1 leading-snug">{step}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {rivals.length > 0 && (
              <>
                <p className="font-body text-xs font-bold uppercase tracking-widest mt-5 mb-2.5" style={{ color: "#586058" }}>Your rivals</p>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                  {rivals.map((r) => (
                    <div key={r.opponentId} className="flex flex-col items-center gap-1.5 flex-shrink-0" style={{ width: 56 }}>
                      <PlayerAvatar seed={r.opponentId} name={r.name} avatarUrl={r.avatarUrl} size={48} />
                      <span className="font-body text-[10px] text-text-muted truncate w-full text-center">{r.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {needTeam ? (
              <div className="rounded-2xl p-6 mt-5 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-body text-sm text-white">Save a team first</p>
                <p className="font-body text-xs text-text-muted mt-1 mb-3">Draft and save your XI, then come back to challenge.</p>
                <Link href="/38-0" className="inline-block rounded-xl px-4 py-2 font-display text-sm tracking-wide" style={{ background: LIME, color: "#13200a" }}>Build your XI →</Link>
              </div>
            ) : (
              <button onClick={createChallenge} disabled={busy} className="w-full rounded-2xl py-4 font-display tracking-wide mt-6 active:scale-[0.99] transition-transform disabled:opacity-60" style={{ background: LIME, color: "#13200a" }}>
                {busy ? "Creating…" : "CREATE A CHALLENGE →"}
              </button>
            )}

            {/* Join with a code */}
            <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>Got a code?</p>
            <div className="flex gap-2.5">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="e.g. 8KP2LD"
                className="flex-1 rounded-2xl px-4 py-3.5 font-display tracking-[0.15em] text-white uppercase outline-none"
                style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.12)" }} />
              <button onClick={join} disabled={!joinCode.trim() || busy} className="rounded-2xl px-6 font-display tracking-wide disabled:opacity-40" style={{ background: "rgba(174,234,0,0.15)", color: LIME, border: `1px solid ${LIME}40` }}>JOIN</button>
            </div>

            {/* Instant matchmaking (the polished find-an-opponent flow) */}
            <Link href="/versus/find?game=38-0" className="flex items-center gap-3 rounded-2xl px-4 py-3.5 mt-7 active:scale-[0.99] transition-transform" style={{ background: "rgba(174,234,0,0.08)", border: `1px solid ${LIME}40` }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="flex-shrink-0">
                <circle cx="10" cy="10" r="8" stroke={LIME} strokeWidth="1.5" opacity="0.35" />
                <circle cx="10" cy="10" r="4.5" stroke={LIME} strokeWidth="1.5" opacity="0.6" />
                <circle cx="10" cy="10" r="1.6" fill={LIME} />
                <path d="M10 10 16 4.5" stroke={LIME} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm text-white leading-none tracking-wide">FIND A LIVE OPPONENT</p>
                <p className="font-body text-[11px] text-text-muted mt-1">Get matched instantly and play now</p>
              </div>
              <span className="font-display text-xs tracking-wide flex-shrink-0" style={{ color: LIME }}>GO →</span>
            </Link>

            {error && <p className="font-body text-sm mt-4 text-center" style={{ color: "#ff6b78" }}>{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
