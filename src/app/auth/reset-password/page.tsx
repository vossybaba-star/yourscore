"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { BackPill } from "@/components/ui/BackPill";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  // Supabase puts the recovery token in the URL hash.
  // The browser client picks it up automatically on subscribe — we just need
  // to wait for the onAuthStateChange SIGNED_IN event with type=recovery.
  useEffect(() => {
    const sb = createClient();
    const { data: { subscription } } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    // Also handle the case where the user is already signed in via the hash token
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    try {
      const sb = createClient();
      const { error: err } = await sb.auth.updateUser({ password });
      if (err) throw err;
      setSuccess(true);
      setTimeout(() => router.push("/"), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: "#0e1611",
    border: `1px solid ${error ? "rgba(255,71,87,0.4)" : "rgba(255,255,255,0.1)"}`,
  };

  return (
    <main className="min-h-dvh flex items-center justify-center px-5" style={{ background: "#0a0a0f" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto", margin: "0 auto 20px" }} />
          <h1 className="font-display text-2xl text-white tracking-wide mb-1">Set new password</h1>
          <p className="font-body text-sm text-text-muted">Choose a password for your account</p>
        </div>

        {success ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.2)" }}>
            <p className="text-3xl mb-3">✅</p>
            <p className="font-body text-sm font-semibold text-white mb-1">Password updated!</p>
            <p className="font-body text-xs text-text-muted">Redirecting you home…</p>
          </div>
        ) : !ready ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <Spinner size={28} />
            <p className="font-body text-sm text-text-muted">Verifying your reset link…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="New password" autoComplete="new-password" required
              className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none placeholder:text-white/25"
              style={inputStyle} />
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm password" autoComplete="new-password" required
              className="w-full rounded-xl px-4 py-3.5 font-body text-white text-sm outline-none placeholder:text-white/25"
              style={inputStyle} />
            {error && <p className="font-body text-xs" style={{ color: "#f87171" }}>{error}</p>}
            <Button type="submit" variant="primary" tone="lime" size="lg" fullWidth
              disabled={loading || !password || !confirm}>
              {loading ? <Spinner size={18} /> : "Set password"}
            </Button>
          </form>
        )}

        <div className="mt-6 flex justify-center">
          <BackPill href="/" label="Home" tone="neutral" />
        </div>
      </div>
    </main>
  );
}
