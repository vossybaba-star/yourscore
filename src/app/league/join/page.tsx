"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

function JoinLeagueIndexInner() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) return;
    router.push(`/league/join/${trimmed}`);
  }

  return (
    <main className="min-h-dvh bg-bg">
      {/* Background grid */}
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="fixed top-0 left-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(167,139,250,0.06) 0%, transparent 60%)" }} />

      {/* Nav */}
      <nav className="relative z-10 pt-safe flex items-center justify-between px-6 py-5 max-w-2xl mx-auto">
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
      </nav>

      <div className="relative z-10 max-w-sm mx-auto px-6 pt-8">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 font-body text-xs uppercase tracking-widest"
          style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa" }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 1.5h7v3L6 8l-3.5-3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M3 4.5v4a3 3 0 0 0 6 0v-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          Join a league
        </div>

        <h1 className="font-display text-5xl text-white mb-2 leading-none">JOIN A LEAGUE</h1>
        <p className="font-body text-text-muted text-sm mb-8">Enter the code your mate shared with you.</p>

        {/* Code entry form */}
        <form onSubmit={handleSubmit} className="space-y-3 mb-6">
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            placeholder="e.g. TH5492"
            maxLength={6}
            autoFocus
            autoCapitalize="characters"
            className="w-full rounded-2xl px-5 py-4 font-display text-3xl tracking-[0.18em] text-center outline-none transition-all placeholder:text-white/15"
            style={{
              background: "#12121e",
              border: `1px solid ${code.length >= 4 ? "rgba(167,139,250,0.45)" : "rgba(255,255,255,0.1)"}`,
              color: "#a78bfa",
              letterSpacing: "0.18em",
            }}
          />
          <button
            type="submit"
            disabled={code.trim().length < 4}
            className="w-full py-4 rounded-xl font-body font-bold text-base transition-all"
            style={{
              background: code.trim().length >= 4 ? "#a78bfa" : "rgba(255,255,255,0.06)",
              color: code.trim().length >= 4 ? "#0a0a0f" : "#8888aa",
              boxShadow: code.trim().length >= 4 ? "0 0 20px rgba(167,139,250,0.25)" : "none",
            }}
          >
            Find league →
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          <span className="font-body text-xs text-text-muted">or</span>
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
        </div>

        {/* No code card */}
        <div className="rounded-2xl p-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="font-body text-sm font-semibold text-white mb-1">Don&apos;t have a code?</p>
          <p className="font-body text-xs text-text-muted mb-4">Sign up free and create your own league — then invite your mates.</p>
          <Link
            href="/auth/sign-in"
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-body font-bold text-sm transition-all hover:opacity-90"
            style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.28)" }}
          >
            Sign Up Free →
          </Link>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="font-body text-xs text-text-muted hover:text-white transition-colors">← Back to home</Link>
        </div>
      </div>
    </main>
  );
}

export default function JoinLeagueIndexPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>}>
      <JoinLeagueIndexInner />
    </Suspense>
  );
}
