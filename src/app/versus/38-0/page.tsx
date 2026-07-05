"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackPill } from "@/components/ui/BackPill";
import { useUser } from "@/hooks/useUser";
import { useVersusStats } from "@/hooks/useVersusStats";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { PitchArt } from "@/components/versus/GameTileArt";

// Versus-owned 38-0 challenge entry (carousel mockup): pitch-art hero, a
// "HOW DO YOU WANT TO PLAY?" chevron-row stack (find / challenge / share code),
// recent rivals with records, and a compact join-by-code. Reuses the live-match
// API (/api/draft/live).

const LIME = "#aeea00";
type Resp = { match?: { id: string; join_code?: string }; error?: string };

function PlayRow({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3.5 rounded-2xl px-4 py-4 text-left active:scale-[0.99] transition-transform" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.22)" }}>
      <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.28)" }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-display text-base text-white leading-none tracking-wide">{title}</span>
        <span className="block font-body text-xs text-text-muted mt-1">{sub}</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: LIME, flexShrink: 0 }}><path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

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

  /** Create a friend Lobby; optionally fire the native share sheet straight away. */
  async function createChallenge(thenShare: boolean) {
    if (busy) return;
    setBusy(true); setError(null); setNeedTeam(false);
    const r = await api({ action: "create" });
    setBusy(false);
    if (r.error) { if (/team/i.test(r.error)) setNeedTeam(true); else setError(r.error); return; }
    if (r.match) {
      setMatchId(r.match.id);
      setCode(r.match.join_code ?? null);
      if (thenShare && r.match.join_code && typeof navigator !== "undefined") {
        const url = `${location.origin}/38-0/live/${r.match.join_code}`;
        navigator.share?.({ title: "38-0", text: `Take me on at 38-0 — code ${r.match.join_code}`, url }).catch(() => {});
      }
    }
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
      {/* Pitch-art hero (built graphics, not photos) */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 0%, rgba(174,234,0,0.14), #080d0a 70%)" }} />
        <div className="absolute inset-0 opacity-60"><PitchArt /></div>
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,13,10,0.25) 0%, rgba(8,13,10,0.7) 60%, #080d0a 100%)" }} />
        <div className="relative max-w-lg mx-auto px-5 pt-safe">
          <div className="pt-4"><BackPill fallback="/versus" label="Back" tone="draft" /></div>
          <div className="pt-6 pb-6">
            <div className="flex items-center gap-2 mb-2">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M8 2.5 3 5.5 5 9.5 7.3 8.3V19a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1V8.3L17 9.5l2-4-5-3C14 4.4 12.7 5.6 11 5.6S8 4.4 8 2.5Z" stroke={LIME} strokeWidth="1.7" strokeLinejoin="round" fill={LIME} fillOpacity={0.15} /></svg>
              <span className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: LIME }}>38-0</span>
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
        ) : needTeam ? (
          <div className="rounded-2xl p-6 mt-5 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="font-body text-sm text-white">Save a team first</p>
            <p className="font-body text-xs text-text-muted mt-1 mb-3">Draft and save your XI, then come back to challenge.</p>
            <Link href="/38-0" className="inline-block rounded-xl px-4 py-2 font-display text-sm tracking-wide" style={{ background: LIME, color: "#13200a" }}>Build your XI →</Link>
          </div>
        ) : (
          <>
            {/* How do you want to play? */}
            <p className="font-body text-xs font-bold uppercase tracking-widest mt-5 mb-2.5" style={{ color: "#586058" }}>How do you want to play?</p>
            <div className="space-y-2.5">
              <PlayRow
                icon={<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke={LIME} strokeWidth="1.5" opacity="0.4" /><circle cx="10" cy="10" r="4.5" stroke={LIME} strokeWidth="1.5" opacity="0.7" /><circle cx="10" cy="10" r="1.6" fill={LIME} /><path d="M10 10 16 4.5" stroke={LIME} strokeWidth="1.5" strokeLinecap="round" /></svg>}
                title="FIND OPPONENT" sub="Get matched instantly"
                onClick={() => router.push("/versus/find?game=38-0")} />
              <PlayRow
                icon={<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M17.5 2.5 9 11M17.5 2.5 12 17.5l-3-6.5-6.5-3L17.5 2.5Z" stroke={LIME} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>}
                title="CHALLENGE FRIEND" sub="Pick a friend to play"
                onClick={() => createChallenge(true)} />
              <PlayRow
                icon={<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="4.5" width="16" height="11" rx="2.5" stroke={LIME} strokeWidth="1.5" /><path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01" stroke={LIME} strokeWidth="2.4" strokeLinecap="round" /></svg>}
                title="SHARE CODE" sub="Invite a friend to play"
                onClick={() => createChallenge(false)} />
            </div>
            {busy && <p className="font-body text-xs text-text-muted mt-3 text-center">Creating your challenge…</p>}

            {/* Recent rivals */}
            {rivals.length > 0 && (
              <>
                <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>Recent rivals</p>
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-1">
                  {rivals.map((r) => (
                    <div key={r.opponentId} className="flex flex-col items-center gap-1.5 flex-shrink-0" style={{ width: 60 }}>
                      <PlayerAvatar seed={r.opponentId} name={r.name} avatarUrl={r.avatarUrl} size={48} />
                      <span className="font-body text-[10px] text-text-muted truncate w-full text-center">{r.name}</span>
                      <span className="font-display text-[11px] leading-none" style={{ color: r.lead > 0 ? LIME : r.lead < 0 ? "#ff6b78" : "#ffc233" }}>{r.wins}-{r.losses}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Join with a code */}
            <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>Got a code?</p>
            <div className="flex gap-2.5">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="e.g. 8KP2LD"
                className="flex-1 rounded-2xl px-4 py-3.5 font-display tracking-[0.15em] text-white uppercase outline-none"
                style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.12)" }} />
              <button onClick={join} disabled={!joinCode.trim() || busy} className="rounded-2xl px-6 font-display tracking-wide disabled:opacity-40" style={{ background: "rgba(174,234,0,0.15)", color: LIME, border: `1px solid ${LIME}40` }}>JOIN</button>
            </div>

            {error && <p className="font-body text-sm mt-4 text-center" style={{ color: "#ff6b78" }}>{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
