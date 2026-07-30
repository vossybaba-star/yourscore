"use client";
/**
 * FollowButton — the one-way follow control, dropped anywhere you see another
 * player (profiles, post-game screens, lobbies) across every game. Self-contained
 * styling so it looks right on quiz, 38-0 and fantasy surfaces alike.
 *
 * Renders nothing for your own account. Guests see "Follow" and bounce to sign-in
 * on tap. Toggles optimistically. Independent of the mutual friends system — you
 * can follow someone you're not friends with, and vice versa.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const TEAL = "#00d8c0";

interface FollowState {
  following: boolean;
  followsYou: boolean;
  self: boolean;
}

export function FollowButton({
  userId,
  size = "md",
  onChange,
  refreshOnChange = false,
  initialFollowing,
}: {
  userId: string;
  size?: "sm" | "md";
  /** Called after a successful toggle, e.g. to bump a follower count. */
  onChange?: (following: boolean) => void;
  /** Re-fetch the server component after a toggle so server-rendered counts
   *  (followers/following) update without a manual reload. */
  refreshOnChange?: boolean;
  /** When a list already knows the viewer's follow state, pass it to skip the
   *  per-row status fetch (a 50-row list would otherwise fire 50 requests). */
  initialFollowing?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<FollowState | null>(
    initialFollowing === undefined ? null : { following: initialFollowing, followsYou: false, self: false },
  );
  const [busy, setBusy] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    if (initialFollowing !== undefined) return; // list already primed the state
    let live = true;
    fetch(`/api/follow?with=${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setState({ following: d.following, followsYou: d.followsYou, self: d.self }); })
      .catch(() => {});
    return () => { live = false; };
  }, [userId, initialFollowing]);

  const toggle = useCallback(async () => {
    if (busy || !state) return;
    if (needsAuth) { router.push(`/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`); return; }
    const next = !state.following;
    setBusy(true);
    setState({ ...state, following: next }); // optimistic
    try {
      const res = await fetch("/api/follow", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.status === 401) { setNeedsAuth(true); setState({ ...state, following: false }); router.push(`/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`); return; }
      if (!res.ok) { setState({ ...state, following: !next }); return; } // revert
      onChange?.(next);
      if (refreshOnChange) router.refresh();
    } catch {
      setState({ ...state, following: !next }); // revert
    } finally {
      setBusy(false);
    }
  }, [busy, state, needsAuth, userId, onChange, refreshOnChange, router, pathname]);

  if (!state || state.self) return null;

  const following = state.following;
  const pad = size === "sm" ? "6px 12px" : "9px 16px";
  const fontSize = size === "sm" ? 12.5 : 13.5;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: pad, borderRadius: 999, fontWeight: 700, fontSize, cursor: "pointer",
        lineHeight: 1, whiteSpace: "nowrap", transition: "opacity 0.15s",
        background: following ? "transparent" : TEAL,
        color: following ? TEAL : "#04231f",
        border: `1px solid ${following ? "rgba(0,216,192,0.4)" : TEAL}`,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {following ? "Following" : state.followsYou ? "Follow back" : "Follow"}
    </button>
  );
}
