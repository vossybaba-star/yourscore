"use client";

/**
 * Invite-a-friend to World Cup Mastermind — a viral-loop CTA that shares the mode link
 * (not a result). Native share where available, clipboard + "copied" toast otherwise.
 * Used on the Mastermind entry page and on the post-game result screen.
 */

import { useState } from "react";

const INVITE_TEXT =
  "Play today's World Cup Mastermind ⚽🧠 — answer football questions to draft a World XI and win the World Cup. Think you know football? Take me on:";

export function InviteMastermind({ label = "INVITE A FRIEND" }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  async function invite() {
    const url = `${typeof window !== "undefined" ? window.location.origin : "https://yourscore.app"}/38-0/wc`;
    // Put the link INSIDE the text rather than as a separate `url` field: when someone picks
    // "Copy" from the native share sheet, several platforms copy only `text` and drop a
    // separate url — so the copied message would have no link. Embedding it guarantees the
    // link is always there (exactly once), whether shared to an app or copied.
    const message = `${INVITE_TEXT} ${url}`;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share({ title: "World Cup Mastermind", text: message }); return; } catch { /* cancelled → fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — nothing we can do */ }
  }

  return (
    <button onClick={invite}
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 active:scale-[0.98] transition-transform"
      style={{ background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.4)" }}>
      <span style={{ fontSize: 24, lineHeight: 1 }}>📣</span>
      <div className="text-left flex-1 min-w-0">
        <div className="font-display tracking-wide" style={{ fontSize: 16, color: "#00d8c0" }}>{copied ? "LINK COPIED ✓" : label}</div>
        <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>Send the Mastermind link — see who knows football best</div>
      </div>
      <span style={{ fontSize: 16, color: "#00d8c0" }}>→</span>
    </button>
  );
}
