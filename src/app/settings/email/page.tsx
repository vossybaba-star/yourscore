"use client";

/**
 * /settings/email — the target of every email's "Unsubscribe" / "Pause emails" link
 * (and reachable from Settings). Reads ?unsub=all / ?pause=<scope> & u=<userId>.
 *
 * Prefetch-safe: the opt-out is NEVER applied on load (some mail clients GET links) —
 * the user taps a button, which POSTs /api/email/unsubscribe. Always offers the reverse
 * action so it's fully self-service.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { BackPill } from "@/components/ui/BackPill";

type State = "idle" | "working" | "unsubscribed" | "paused" | "subscribed" | "error";

function EmailPrefsInner() {
  const params = useSearchParams();
  const u = params.get("u") ?? "";
  const intent: "pause" | "unsub" = params.get("pause") ? "pause" : "unsub";
  const scope = params.get("pause") ?? params.get("scope") ?? "all";

  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function act(action: "unsub" | "pause" | "resub") {
    setState("working"); setError("");
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ u, action, scope }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong. Please try again.");
      setState((j.state as State) ?? "unsubscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }

  const card = (children: React.ReactNode) => (
    <main className="min-h-dvh bg-bg flex items-center justify-center px-5" style={{ background: "#0a0a0f" }}>
      <div className="w-full max-w-md rounded-3xl p-7 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="font-display tracking-wide mb-5" style={{ fontSize: 22, color: "#fff" }}>
          YOUR<span style={{ color: "#aeea00" }}>SCORE</span>
        </div>
        {children}
      </div>
    </main>
  );

  // No id and not actionable — point them into the app.
  if (!u) {
    return card(
      <>
        <p className="font-display tracking-wide" style={{ fontSize: 24, color: "#fff" }}>EMAIL PREFERENCES</p>
        <p className="font-body mt-3" style={{ fontSize: 14, color: "#8a948f", lineHeight: 1.55 }}>
          Open this from the link at the bottom of any YourScore email to manage your emails.
        </p>
        <div className="mt-6"><BackPill href="/" label="Home" tone="neutral" /></div>
      </>,
    );
  }

  if (state === "working") return card(<div className="py-6"><Spinner size={32} /></div>);

  if (state === "unsubscribed" || state === "paused") {
    const paused = state === "paused";
    return card(
      <>
        <div style={{ fontSize: 40 }}>{paused ? "⏸️" : "✅"}</div>
        <p className="font-display tracking-wide mt-3" style={{ fontSize: 24, color: "#fff" }}>
          {paused ? "EMAILS PAUSED" : "YOU'RE UNSUBSCRIBED"}
        </p>
        <p className="font-body mt-3" style={{ fontSize: 14, color: "#c4ccc6", lineHeight: 1.55 }}>
          {paused
            ? "We'll hold off for now. You can turn YourScore emails back on whenever you like."
            : "You won't receive YourScore emails any more. Changed your mind? You can resubscribe anytime."}
        </p>
        <button onClick={() => act("resub")} className="w-full mt-6 rounded-2xl py-3.5 font-body font-semibold transition-all hover:opacity-90"
          style={{ background: "rgba(174,234,0,0.1)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.28)", fontSize: 15 }}>
          {paused ? "Resume emails" : "Resubscribe"}
        </button>
        <Link href="/" className="inline-block mt-3 font-body text-sm" style={{ color: "#8a948f" }}>← Back to YourScore</Link>
      </>,
    );
  }

  if (state === "subscribed") {
    return card(
      <>
        <div style={{ fontSize: 40 }}>📬</div>
        <p className="font-display tracking-wide mt-3" style={{ fontSize: 24, color: "#fff" }}>YOU&apos;RE SUBSCRIBED</p>
        <p className="font-body mt-3" style={{ fontSize: 14, color: "#c4ccc6", lineHeight: 1.55 }}>
          You&apos;ll get YourScore emails again. You can opt out at any time from the link in any email.
        </p>
        <button onClick={() => act("unsub")} className="w-full mt-6 rounded-2xl py-3.5 font-body font-semibold transition-all hover:opacity-90"
          style={{ background: "rgba(255,71,87,0.08)", color: "#ff4757", border: "1px solid rgba(255,71,87,0.2)", fontSize: 15 }}>
          Unsubscribe from all emails
        </button>
        <Link href="/" className="inline-block mt-3 font-body text-sm" style={{ color: "#8a948f" }}>← Back to YourScore</Link>
      </>,
    );
  }

  // idle / error → the confirm prompt.
  const paused = intent === "pause";
  return card(
    <>
      <p className="font-display tracking-wide" style={{ fontSize: 24, color: "#fff" }}>
        {paused ? "PAUSE EMAILS?" : "UNSUBSCRIBE?"}
      </p>
      <p className="font-body mt-3" style={{ fontSize: 14, color: "#c4ccc6", lineHeight: 1.55 }}>
        {paused
          ? "We'll stop sending YourScore emails until you turn them back on."
          : "You'll stop receiving all YourScore emails — game results, league updates and reminders."}
      </p>
      {error && <p className="font-body text-xs mt-3" style={{ color: "#f87171" }}>{error}</p>}
      <button onClick={() => act(paused ? "pause" : "unsub")} className="w-full mt-6 rounded-2xl py-3.5 font-body font-semibold transition-all hover:opacity-90"
        style={{ background: "#ff4757", color: "#fff", fontSize: 15 }}>
        {paused ? "Pause my emails" : "Unsubscribe me"}
      </button>
      <Link href="/" className="inline-block mt-3 font-body text-sm" style={{ color: "#8a948f" }}>
        No thanks, keep me subscribed
      </Link>
    </>,
  );
}

export default function EmailPrefsPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-bg flex items-center justify-center" style={{ background: "#0a0a0f" }}><Spinner size={32} /></main>}>
      <EmailPrefsInner />
    </Suspense>
  );
}
