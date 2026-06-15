"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUser } from "@/hooks/useUser";
import { AuthProviders } from "@/components/auth/AuthButton";
import { GridBackground } from "@/components/ui/GridBackground";

export default function SignInPage() {
  const { user, loading } = useUser();
  const router = useRouter();
  // Where to return after signing in (e.g. ?next=/38-0/wc). Only internal paths.
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    setNext(n && n.startsWith("/") && !n.startsWith("//") ? n : null);
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace(next || "/");
  }, [user, loading, next, router]);

  return (
    <main className="min-h-dvh bg-bg flex flex-col">
      <GridBackground opacity={0.025} />
      <div className="fixed top-0 left-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(174,234,0,0.07) 0%, transparent 60%)" }} />

      <nav className="relative z-10 pt-safe px-6 py-5 flex items-center gap-4">
        <button
          onClick={() => typeof window !== 'undefined' && window.history.length > 1 ? window.history.back() : undefined}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          aria-label="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="#9aa39d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={32} style={{ height: 32, width: "auto" }} />
        </Link>
      </nav>

      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-display text-4xl text-white mb-2">Sign in or sign up</h1>
            <p className="font-body text-sm text-text-muted">New or returning — one tap gets you in. Free forever.</p>
          </div>

          <div className="rounded-2xl p-6 bg-surface border border-border">
            <AuthProviders nextPath={next ?? undefined} />
          </div>

          <p className="text-center font-body text-xs text-text-muted mt-6">
            By signing in you agree to our{" "}
            <Link href="/terms" className="text-white hover:underline">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-white hover:underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
