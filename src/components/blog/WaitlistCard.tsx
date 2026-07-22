"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";

/**
 * Fantasy waitlist CTA — ONE button, two paths (founder, 2026-07-16).
 *
 *   signed in   → tap "Save my spot" and they're on the list. No email field:
 *                 asking for the address we already hold read like a form for
 *                 the sake of a form. The server uses the session email.
 *   signed out  → same button, but it walks them into creating an account
 *                 (that's the thing we actually want from an anonymous reader),
 *                 remembers the intent in localStorage, and finishes the save
 *                 automatically when they land back — same resume pattern as
 *                 the halftime "Notify me" flow. They return already saved,
 *                 not staring at the same button again.
 *
 * Renders on the blog index, blog posts, and the Fantasy holding screen; pass
 * `source` so the ledger records where each signup came from.
 */

const INTENT_KEY = "ys:waitlist-intent";

export function WaitlistCard({ source = "blog" }: { source?: string }) {
  const { user, loading } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? "Something went wrong — try again");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setError("Network hiccup — try again");
      setState("error");
    }
  }

  // Already saved? And: they tapped, went to sign up, and they're back —
  // finish what they started instead of showing them the same button.
  useEffect(() => {
    if (loading || !user) return;
    let alive = true;
    (async () => {
      const res = await fetch("/api/waitlist", { cache: "no-store" }).catch(() => null);
      const j = res && res.ok ? await res.json() : null;
      if (!alive) return;
      if (j?.saved) {
        setState("done");
        try { window.localStorage.removeItem(INTENT_KEY); } catch { /* ignore */ }
        return;
      }
      let pending = false;
      try { pending = window.localStorage.getItem(INTENT_KEY) === "1"; } catch { /* ignore */ }
      if (pending) {
        try { window.localStorage.removeItem(INTENT_KEY); } catch { /* ignore */ }
        await save();
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  function onClick() {
    if (!user) {
      // Remember the tap, go get them an account, finish on return.
      try { window.localStorage.setItem(INTENT_KEY, "1"); } catch { /* ignore */ }
      router.push(`/auth/sign-in?next=${encodeURIComponent(pathname || "/matchweek")}`);
      return;
    }
    void save();
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
    <div
      className="rounded-2xl bg-surface border border-border px-6 py-6"
      style={{ borderColor: "rgba(174,234,0,0.35)" }}
    >
      <p className="font-display text-2xl tracking-wide text-text-primary">
        FANTASY FOOTBALL IS COMING
      </p>
      <p className="font-body text-sm text-text-muted mt-2 leading-6">
        YourScore Fantasy Football launches mid-August: your football knowledge earns your
        transfers. Save your spot and you&apos;ll get gameweek-1 access the moment it opens.
      </p>
      <button
        onClick={onClick}
        disabled={state === "busy" || loading}
        className="mt-4 w-full sm:w-auto rounded-xl px-6 py-3 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
        style={{ background: "#aeea00", color: "#062013", fontSize: 15 }}
      >
        {state === "busy" ? "SAVING…" : "SAVE MY SPOT"}
      </button>
      {error && <p className="font-body text-xs mt-2" style={{ color: "#ff8a3d" }}>{error}</p>}
      <p className="font-body text-[11px] text-text-muted mt-3">
        {user
          ? "One launch email, no spam. Unsubscribe any time."
          : "Takes one tap once you're signed in — one launch email, no spam."}
      </p>
    </div>
  );
}
