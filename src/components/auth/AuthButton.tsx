"use client";

import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/Spinner";
import { useState } from "react";
import { isNative, NATIVE_AUTH_CALLBACK, openOAuthInBrowser } from "@/lib/native";
import { checkEmail, suggestEmailCorrection } from "@/lib/email";

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
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
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
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
  }

  const styles: Record<Provider, { bg: string; border: string; color: string }> = {
    google:   { bg: "#15211a", border: "rgba(255,255,255,0.12)", color: "#ffffff" },
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

// ── Email sign-in (magic link OR password) ────────────────────────────────────

type EmailMode = "magic" | "password" | "signup";

function EmailSignIn({ nextPath }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<EmailMode>("magic");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  async function sendMagicLink() {
    if (!email.trim() || loading) return;
    const check = checkEmail(email);
    if (!check.ok) { setError(check.reason ?? "Enter a valid email address."); return; }
    setLoading(true); setError("");
    try {
      const sb = createClient();
      // In the native app the link MUST come back via the custom scheme so iOS opens the
      // app (and the PKCE verifier — stored in the app — can complete the exchange).
      // Sending it to the web origin opens Safari instead and fails the exchange.
      const base = isNative() ? NATIVE_AUTH_CALLBACK : `${window.location.origin}/auth/callback`;
      const emailRedirectTo = nextPath ? `${base}?next=${encodeURIComponent(nextPath)}` : base;
      const { error: err } = await sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo } });
      if (err) throw err;
      setSent(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setLoading(false); }
  }

  async function signInWithPassword() {
    if (!email.trim() || !password || loading) return;
    setLoading(true); setError("");
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (err) throw err;
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Sign in failed"); }
    finally { setLoading(false); }
  }

  async function signUp() {
    if (!email.trim() || !password || loading) return;
    const check = checkEmail(email);
    if (!check.ok) { setError(check.reason ?? "Enter a valid email address."); return; }
    if (password !== confirmPassword) { setError("Passwords don't match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.signUp({ email: email.trim().toLowerCase(), password });
      if (err) throw err;
      setSent(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Sign up failed"); }
    finally { setLoading(false); }
  }

  async function forgotPassword() {
    if (!email.trim()) { setError("Enter your email above first"); return; }
    const check = checkEmail(email);
    if (!check.ok) { setError(check.reason ?? "Enter a valid email address."); return; }
    setLoading(true); setError("");
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (err) throw err;
      setResetSent(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send reset email"); }
    finally { setLoading(false); }
  }

  if (sent) {
    return (
      <div className="rounded-xl p-4 text-center" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.2)" }}>
        <p className="font-body text-sm font-semibold text-white mb-1">Check your email</p>
        <p className="font-body text-xs text-text-muted">
          {mode === "signup"
            ? `We sent a confirmation link to ${email}. Click it to activate your account.`
            : `We sent a sign-in link to ${email}. Tap it to continue.`}
        </p>
      </div>
    );
  }

  if (resetSent) {
    return (
      <div className="rounded-xl p-4 text-center" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.2)" }}>
        <p className="font-body text-sm font-semibold text-white mb-1">Reset email sent</p>
        <p className="font-body text-xs text-text-muted">Check your inbox for a password reset link.</p>
      </div>
    );
  }

  const inputStyle = (hasError: boolean) => ({
    background: "#0e1611",
    border: `1px solid ${hasError ? "rgba(255,71,87,0.4)" : "rgba(255,255,255,0.1)"}`,
  });

  return (
    <div className="space-y-2">
      {/* Mode tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {(["magic", "password", "signup"] as EmailMode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setError(""); }}
            className="flex-1 py-1.5 rounded-lg font-body text-xs font-semibold transition-all"
            style={mode === m
              ? { background: "#aeea00", color: "#0a0a0f" }
              : { background: "transparent", color: "#8a948f" }}>
            {m === "magic" ? "Magic link" : m === "password" ? "Password" : "Sign up"}
          </button>
        ))}
      </div>

      {/* Email */}
      <input type="email" value={email} onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === "Enter" && (mode === "magic" ? sendMagicLink() : mode === "signup" ? signUp() : signInWithPassword())}
        placeholder="your@email.com" autoComplete="email"
        className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none placeholder:text-white/25"
        style={inputStyle(!!error)} />

      {/* Typo nudge — non-blocking "did you mean…?" for common domain typos */}
      {(() => {
        const fix = email.trim() ? suggestEmailCorrection(email) : null;
        if (!fix) return null;
        return (
          <button
            type="button"
            onClick={() => { setEmail(fix); setError(""); }}
            className="w-full text-left font-body text-xs px-1 transition-colors hover:text-white"
            style={{ color: "#ffb800" }}
          >
            Did you mean <span className="underline">{fix}</span>?
          </button>
        );
      })()}

      {/* Password (password + signup modes) */}
      {(mode === "password" || mode === "signup") && (
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (mode === "signup" ? signUp() : signInWithPassword())}
          placeholder="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none placeholder:text-white/25"
          style={inputStyle(!!error)} />
      )}

      {/* Confirm password (signup only) */}
      {mode === "signup" && (
        <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && signUp()}
          placeholder="Confirm password" autoComplete="new-password"
          className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none placeholder:text-white/25"
          style={inputStyle(!!error)} />
      )}

      {error && <p className="font-body text-xs text-red-400">{error}</p>}

      {/* Submit */}
      <button
        onClick={mode === "magic" ? sendMagicLink : mode === "signup" ? signUp : signInWithPassword}
        disabled={!email.trim() || ((mode !== "magic") && !password) || loading}
        className="w-full py-3.5 rounded-xl font-body font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
        style={{
          background: email.trim() && (mode === "magic" || password) ? "#aeea00" : "rgba(255,255,255,0.06)",
          color: email.trim() && (mode === "magic" || password) ? "#0a0a0f" : "#8a948f",
        }}>
        {loading ? <Spinner size={18} /> : mode === "magic" ? "Send sign-in link" : mode === "signup" ? "Create account" : "Sign in"}
      </button>

      {/* Forgot password */}
      {mode === "password" && (
        <button onClick={forgotPassword} disabled={loading}
          className="w-full py-1.5 font-body text-xs transition-colors hover:text-white"
          style={{ color: "#8a948f" }}>
          Forgot your password?
        </button>
      )}
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
      {/* Apple goes ABOVE Google. Apple HIG and Sign in with Apple guidelines
          require the Apple button to be at least as prominent as any other
          third-party OAuth option. Putting it first is the cleanest read. */}
      <OAuthButton
        provider="apple"
        label="Continue with Apple"
        nextPath={nextPath}
        icon={
          <svg width="18" height="18" viewBox="0 0 18 18" fill="white">
            <path d="M14.94 13.94c-.27.62-.59 1.2-.97 1.73-.51.72-.93 1.21-1.25 1.49-.49.45-1.02.68-1.59.69-.41 0-.9-.12-1.48-.36-.58-.24-1.11-.36-1.6-.36-.51 0-1.06.12-1.65.36-.59.24-1.07.36-1.43.37-.55.02-1.09-.22-1.62-.71-.34-.3-.78-.81-1.32-1.54-.57-.78-1.05-1.69-1.42-2.73C.39 11.96.18 10.85.18 9.77c0-1.23.27-2.3.8-3.19.42-.71.97-1.27 1.66-1.69.69-.42 1.43-.63 2.23-.65.43 0 1 .14 1.71.41.71.27 1.17.41 1.37.41.15 0 .65-.16 1.52-.48.82-.3 1.51-.42 2.08-.37 1.54.12 2.7.73 3.47 1.82-1.38.84-2.06 2.01-2.04 3.52.01 1.17.44 2.15 1.27 2.93.38.35.8.62 1.27.81-.1.29-.21.57-.33.84z"/>
            <path d="M11.31 1.93c0 .92-.34 1.78-1.02 2.57-.81.95-1.79 1.5-2.86 1.41a2.88 2.88 0 0 1-.02-.35c0-.88.39-1.83 1.07-2.59.34-.39.78-.71 1.31-.97.52-.26 1.02-.4 1.49-.42.01.12.02.24.02.35z"/>
          </svg>
        }
      />

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
