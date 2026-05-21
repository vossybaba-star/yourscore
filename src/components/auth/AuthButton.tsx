"use client";

import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/Spinner";
import { useState } from "react";

type Provider = "google" | "apple" | "facebook";

const REDIRECT = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/auth/callback`
    : "/auth/callback";

// ── OAuth button (Google / Apple / Facebook) ──────────────────────────────────

function OAuthButton({ provider, label, icon }: { provider: Provider; label: string; icon: React.ReactNode }) {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      alert("Supabase not configured — add .env.local keys");
      return;
    }
    setLoading(true);
    const sb = createClient();
    await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: REDIRECT() },
    });
  }

  const styles: Record<Provider, { bg: string; border: string; color: string }> = {
    google:   { bg: "#1a1a2e", border: "rgba(255,255,255,0.12)", color: "#ffffff" },
    apple:    { bg: "#000000", border: "rgba(255,255,255,0.12)", color: "#ffffff" },
    facebook: { bg: "#1877f2", border: "rgba(255,255,255,0.12)", color: "#ffffff" },
  };

  const s = styles[provider];

  return (
    <button
      onClick={signIn}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-xl font-body font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
    >
      {loading ? <Spinner size={18} /> : icon}
      {loading ? "Signing in…" : label}
    </button>
  );
}

// ── Email magic link ──────────────────────────────────────────────────────────

function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!email.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: REDIRECT() },
      });
      if (err) throw err;
      setSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl p-4 text-center" style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.2)" }}>
        <p className="font-body text-sm font-semibold text-white mb-1">Check your email</p>
        <p className="font-body text-xs text-text-muted">We sent a sign-in link to <span className="text-white">{email}</span>. Tap it to continue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        placeholder="your@email.com"
        className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none transition-all placeholder:text-white/25"
        style={{ background: "#12121e", border: `1px solid ${error ? "rgba(255,71,87,0.4)" : "rgba(255,255,255,0.1)"}` }}
      />
      {error && <p className="font-body text-xs text-red-400">{error}</p>}
      <button
        onClick={send}
        disabled={!email.trim() || loading}
        className="w-full py-3.5 rounded-xl font-body font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
        style={{ background: email.trim() ? "#00ff87" : "rgba(255,255,255,0.06)", color: email.trim() ? "#0a0a0f" : "#8888aa" }}
      >
        {loading ? <Spinner size={18} /> : (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 3h12v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M1 3l6 5 6-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Send sign-in link
          </>
        )}
      </button>
    </div>
  );
}

// ── Full sign-in panel ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SignInWithGoogle({ redirectTo: _redirectTo }: { redirectTo?: string }) {
  return <AuthProviders />;
}

export function AuthProviders() {
  const [showEmail, setShowEmail] = useState(false);

  return (
    <div className="space-y-3">
      <OAuthButton
        provider="google"
        label="Continue with Google"
        icon={
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
        }
      />

      <OAuthButton
        provider="apple"
        label="Continue with Apple"
        icon={
          <svg width="17" height="20" viewBox="0 0 17 20" fill="currentColor">
            <path d="M13.769 10.407c-.023-2.57 2.1-3.819 2.196-3.879-1.197-1.748-3.058-1.988-3.717-2.012-1.573-.16-3.088.932-3.887.932-.8 0-2.024-.913-3.334-.888-1.707.025-3.293.995-4.172 2.52-1.788 3.096-.456 7.68 1.278 10.19.852 1.23 1.863 2.608 3.193 2.558 1.29-.05 1.774-.829 3.33-.829 1.556 0 1.998.83 3.354.8 1.383-.024 2.256-1.248 3.099-2.483a12.57 12.57 0 0 0 1.416-2.883c-.033-.012-2.713-1.04-2.756-4.026zM11.293 3.057C11.99 2.205 12.46.994 12.322-.188c-1.088.046-2.408.726-3.19 1.578-.699.758-1.317 1.981-1.15 3.143 1.215.094 2.455-.618 3.311-1.476z"/>
          </svg>
        }
      />

      <OAuthButton
        provider="facebook"
        label="Continue with Facebook"
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
        }
      />

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
        <span className="font-body text-xs text-text-muted">or</span>
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
      </div>

      {showEmail ? (
        <EmailSignIn />
      ) : (
        <button
          onClick={() => setShowEmail(true)}
          className="w-full py-3.5 rounded-xl font-body font-semibold text-sm text-white transition-all hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Continue with Email
        </button>
      )}
    </div>
  );
}

export function SignOutButton() {
  async function signOut() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const sb = createClient();
    await sb.auth.signOut();
    window.location.href = "/";
  }

  return (
    <button onClick={signOut} className="text-sm font-body text-text-muted hover:text-white transition-colors">
      Sign out
    </button>
  );
}
