"use client";

import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/Spinner";
import { useState } from "react";
import { isNative, NATIVE_AUTH_CALLBACK, openOAuthInBrowser } from "@/lib/native";

type Provider = "google" | "apple" | "facebook";

const REDIRECT = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/auth/callback`
    : "/auth/callback";

// ── OAuth button (Google / Apple / Facebook) ──────────────────────────────────

function OAuthButton({ provider, label, icon, nextPath }: { provider: Provider; label: string; icon: React.ReactNode; nextPath?: string }) {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      alert("Supabase not configured — add .env.local keys");
      return;
    }
    setLoading(true);
    const sb = createClient();

    if (isNative()) {
      const redirectTo = nextPath
        ? `${NATIVE_AUTH_CALLBACK}?next=${encodeURIComponent(nextPath)}`
        : NATIVE_AUTH_CALLBACK;
      const { data, error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data?.url) {
        setLoading(false);
        alert(`Sign-in failed: ${error?.message ?? "unknown"}`);
        return;
      }
      await openOAuthInBrowser(data.url);
      setLoading(false);
      return;
    }

    const redirectTo = nextPath
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
      : REDIRECT();
    await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
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

function EmailSignIn({ nextPath }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendMagicLink() {
    if (!email.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const sb = createClient();
      const emailRedirectTo = nextPath
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
        : REDIRECT();
      const { error: err } = await sb.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo },
      });
      if (err) throw err;
      setSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function signInWithPasswordHandler() {
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setError("");
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (err) throw err;
      // auth state listener in NativeBootstrap / useUser handles navigation
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sign in failed");
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

  const canSubmit = email.trim() && (!usePassword || password);

  return (
    <div className="space-y-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (usePassword ? signInWithPasswordHandler() : sendMagicLink())}
        placeholder="your@email.com"
        autoComplete="email"
        className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none transition-all placeholder:text-white/25"
        style={{ background: "#12121e", border: `1px solid ${error ? "rgba(255,71,87,0.4)" : "rgba(255,255,255,0.1)"}` }}
      />
      {usePassword && (
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && signInWithPasswordHandler()}
          placeholder="Password"
          autoComplete="current-password"
          className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none transition-all placeholder:text-white/25"
          style={{ background: "#12121e", border: `1px solid ${error ? "rgba(255,71,87,0.4)" : "rgba(255,255,255,0.1)"}` }}
        />
      )}
      {error && <p className="font-body text-xs text-red-400">{error}</p>}
      <button
        onClick={usePassword ? signInWithPasswordHandler : sendMagicLink}
        disabled={!canSubmit || loading}
        className="w-full py-3.5 rounded-xl font-body font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
        style={{ background: canSubmit ? "#00ff87" : "rgba(255,255,255,0.06)", color: canSubmit ? "#0a0a0f" : "#8888aa" }}
      >
        {loading ? <Spinner size={18} /> : usePassword ? (
          "Sign in"
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 3h12v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M1 3l6 5 6-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Send sign-in link
          </>
        )}
      </button>
      <button
        onClick={() => { setUsePassword(!usePassword); setError(""); }}
        className="w-full py-2 font-body text-xs text-text-muted hover:text-white transition-colors"
      >
        {usePassword ? "Use email link instead" : "I have a password"}
      </button>
    </div>
  );
}

// ── Full sign-in panel ────────────────────────────────────────────────────────

export function SignInWithGoogle({ redirectTo }: { redirectTo?: string }) {
  return <AuthProviders nextPath={redirectTo} />;
}

export function AuthProviders({ nextPath }: { nextPath?: string }) {
  const [showEmail, setShowEmail] = useState(false);

  return (
    <div className="space-y-3">
      <OAuthButton
        provider="google"
        label="Continue with Google"
        nextPath={nextPath}
        icon={
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
        }
      />

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
        <span className="font-body text-xs text-text-muted">or</span>
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
      </div>

      {showEmail ? (
        <EmailSignIn nextPath={nextPath} />
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
