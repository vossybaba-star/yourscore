"use client";

/**
 * AddFriendCard — drop into any post-game or lobby surface to offer a friend
 * connection. Checks existing relationship status on mount and handles all
 * states (none / pending_sent / pending_received / friends / dismissed).
 *
 * Renders nothing if:
 *  - the viewer isn't authenticated
 *  - userId is the viewer's own ID
 *  - they're already friends
 *  - the card has been dismissed
 *  - status is still loading (avoids layout flash)
 */

import { useState, useEffect } from "react";
import { useUser } from "@/hooks/useUser";
import { FollowButton } from "@/components/social/FollowButton";

type FriendStatus =
  | "loading"
  | "none"
  | "pending_sent"
  | "pending_received"
  | "friends"
  | "dismissed";

interface AddFriendCardProps {
  /** The other person's user ID */
  userId: string;
  /** Their display name */
  displayName: string;
  /** Optional context line above the prompt, e.g. "Great game with Marcus!" */
  context?: string;
  /** Show the one-way Follow button alongside the friend prompt. Default true —
   *  the follow layer rides this shared card onto every game surface. Set false
   *  where a dedicated Follow control already exists (e.g. the profile header). */
  showFollow?: boolean;
}

export function AddFriendCard({ userId, displayName, context, showFollow = true }: AddFriendCardProps) {
  const { user } = useUser();
  const [status, setStatus] = useState<FriendStatus>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !userId || userId === user.id) {
      setStatus("dismissed");
      return;
    }
    fetch(`/api/friends?with=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d: { status?: string }) => {
        const s = d.status;
        if (s === "unauthenticated" || s === "friends") setStatus("dismissed");
        else if (s === "none" || s === "pending_sent" || s === "pending_received") setStatus(s as FriendStatus);
        else setStatus("none");
      })
      .catch(() => setStatus("none"));
  }, [user, userId]);

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ friendId: userId }),
      });
      const data = await res.json() as { status?: string };
      if (data.status === "now_friends" || data.status === "already_friends") {
        setStatus("dismissed"); // treat as done — already friends
      } else {
        setStatus("pending_sent");
      }
    } catch {
      /* leave as-is */
    }
    setBusy(false);
  }

  // The mutual-friend card, which self-hides in several states. Follow is layered
  // on independently below, so a hidden friend card never hides Follow.
  const isPendingReceived = status === "pending_received";
  const friendCard =
    !user || status === "loading" || status === "dismissed" || status === "friends" ? null
    : status === "pending_sent" ? (
      <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(174,234,0,0.05)", border: "1px solid rgba(174,234,0,0.18)" }}>
        <p className="font-body text-sm text-center" style={{ color: "#aeea00" }}>
          Friend request sent to {displayName} ✓
        </p>
      </div>
    ) : (
      <div className="rounded-2xl p-4" style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.18)" }}>
        {context && (
          <p className="font-body text-center mb-1" style={{ fontSize: 12, color: "#8a948f" }}>
            {context}
          </p>
        )}
        <p className="font-body text-center mb-3" style={{ fontSize: 14, color: "#e8e8f0" }}>
          {isPendingReceived
            ? `${displayName} sent you a friend request 👋`
            : `Add ${displayName} as a friend?`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={send}
            disabled={busy}
            className="flex-1 rounded-xl py-2.5 font-body font-semibold text-sm transition-all disabled:opacity-50"
            style={{ background: "rgba(174,234,0,0.2)", border: "1px solid rgba(174,234,0,0.35)", color: "#aeea00" }}
          >
            {busy ? "…" : isPendingReceived ? "Accept ✓" : "Add friend +"}
          </button>
          <button
            onClick={() => setStatus("dismissed")}
            className="flex-1 rounded-xl py-2.5 font-body text-sm"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#8a948f" }}
          >
            Not now
          </button>
        </div>
      </div>
    );

  if (!showFollow) return friendCard;

  // Follow (self-hides for your own account / resolves auth on tap) rides on top;
  // the friend card sits below when there's one to show.
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <FollowButton userId={userId} size="sm" />
      </div>
      {friendCard}
    </div>
  );
}

/**
 * AddFriendInline — compact version for use inside player lists / lobby rows.
 * Just a small button that says "+ Add" until the request is sent.
 */
export function AddFriendInline({ userId, displayName }: { userId: string; displayName: string }) {
  const { user } = useUser();
  const [status, setStatus] = useState<FriendStatus>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !userId || userId === user.id) { setStatus("dismissed"); return; }
    fetch(`/api/friends?with=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d: { status?: string }) => {
        const s = d.status;
        if (s === "unauthenticated" || s === "friends") setStatus("dismissed");
        else if (s === "none" || s === "pending_sent" || s === "pending_received") setStatus(s as FriendStatus);
        else setStatus("none");
      })
      .catch(() => setStatus("none"));
  }, [user, userId]);

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ friendId: userId }),
      });
      const data = await res.json() as { status?: string };
      if (data.status === "now_friends" || data.status === "already_friends") setStatus("dismissed");
      else setStatus("pending_sent");
    } catch { /* ignore */ }
    setBusy(false);
  }

  if (!user || status === "loading" || status === "dismissed" || status === "friends") return null;
  if (status === "pending_sent") {
    return (
      <span className="font-body text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(174,234,0,0.1)", color: "#aeea00" }}>
        Added ✓
      </span>
    );
  }
  return (
    <button
      onClick={send}
      disabled={busy}
      title={`Add ${displayName} as a friend`}
      className="font-body text-xs px-2 py-1 rounded-lg transition-all disabled:opacity-50"
      style={{
        background: "rgba(174,234,0,0.12)",
        border: "1px solid rgba(174,234,0,0.25)",
        color: "#aeea00",
      }}
    >
      {busy ? "…" : status === "pending_received" ? "Accept ✓" : "+ Add"}
    </button>
  );
}
