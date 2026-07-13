"use client";

import { useState } from "react";

/**
 * Blog waitlist capture — the one-field "get gameweek-1 access" block the
 * content audit called the funnel's missing bottom: four posts sell the
 * mid-August fantasy launch with nowhere to leave an email. Renders on every
 * blog post and the /blog index; posts to /api/waitlist (Resend audience).
 */
export function WaitlistCard() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "busy" || state === "done") return;
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong — try again");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setError("Network hiccup — try again");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-2xl bg-surface border border-border px-6 py-6 text-center">
        <p className="font-display text-2xl tracking-wide text-green">YOU&apos;RE ON THE LIST ✓</p>
        <p className="font-body text-sm text-text-muted mt-2">
          We&apos;ll email you when gameweek 1 opens. Until then, the daily quiz and 38-0 are live.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface border border-border px-6 py-6"
      style={{ borderColor: "rgba(174,234,0,0.35)" }}>
      <p className="font-display text-2xl tracking-wide text-text-primary">
        FANTASY FOOTBALL IS COMING
      </p>
      <p className="font-body text-sm text-text-muted mt-2 leading-6">
        YourScore Fantasy Football launches mid-August: your football knowledge earns your
        transfers. Leave your email and you&apos;ll get gameweek-1 access the moment it opens.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="flex-1 rounded-xl px-4 py-3 font-body text-sm bg-bg text-text-primary border border-border focus:outline-none"
          style={{ borderColor: state === "error" ? "rgba(255,71,87,0.5)" : undefined }}
        />
        <button
          type="submit"
          disabled={state === "busy"}
          className="rounded-xl px-6 py-3 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
          style={{ background: "#aeea00", color: "#062013", fontSize: 15 }}
        >
          {state === "busy" ? "SAVING…" : "SAVE MY SPOT"}
        </button>
      </form>
      {error && <p className="font-body text-xs mt-2" style={{ color: "#ff8a3d" }}>{error}</p>}
      <p className="font-body text-[11px] text-text-muted mt-3">
        One launch email, no spam. Unsubscribe any time.
      </p>
    </div>
  );
}
