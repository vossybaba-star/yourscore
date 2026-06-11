"use client";

/**
 * 38-0 Live Multiplayer — client realtime hook.
 *
 * Subscribes to the authoritative `draft_live_matches` row over Supabase Realtime
 * (postgres_changes for state, presence for who's online) and drives the local
 * countdown. When the phase deadline passes it pings /advance ONCE per phase; the
 * server's idempotent transition means both clients pinging is safe. Mirrors the
 * live-quiz channel pattern in src/app/play/[roomId]/page.tsx.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { REALTIME_ENABLED } from "@/lib/realtime";
import type { DraftLiveMatchRow } from "@/types/draft-db";

const TERMINAL = new Set(["result", "abandoned"]);

export type LiveSide = "p1" | "p2" | null;

export type UseLiveMatch = {
  match: DraftLiveMatchRow | null;
  side: LiveSide;
  opponentOnline: boolean;
  secondsLeft: number | null;
  loading: boolean;
  /** Fatal — the match couldn't be loaded. Render a dead-end for this only. */
  error: string | null;
  /** Transient — a rejected action (e.g. a swap just after the deadline). Show as
   *  a toast; the match keeps running. Auto-clears. */
  actionError: string | null;
  ready: () => Promise<void>;
  /** Mirror the human's Done for a bot match — call 2 s after ready() when is_bot. */
  botDone: () => Promise<void>;
  swap: (slotId: string, newPlayer: string) => Promise<void>;
  drawChoice: (wantsPens: boolean) => Promise<void>;
};

async function post(path: string, body: unknown): Promise<DraftLiveMatchRow | null> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return (json.match as DraftLiveMatchRow) ?? null;
}

export function useLiveMatch(matchId: string | null): UseLiveMatch {
  const [match, setMatch] = useState<DraftLiveMatchRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [opponentOnline, setOpponentOnline] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const matchRef = useRef<DraftLiveMatchRow | null>(null);
  const advancedForPhaseRef = useRef<string | null>(null);
  matchRef.current = match;

  // Resolve who we are once.
  useEffect(() => {
    let live = true;
    createClient().auth.getUser().then(({ data }) => { if (live) setUserId(data.user?.id ?? null); });
    return () => { live = false; };
  }, []);

  // Best-effort state refresh (reconnect / tab refocus) — never a fatal error.
  const refetch = useCallback(async () => {
    if (!matchId) return;
    try {
      const res = await fetch(`/api/draft/live/${matchId}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.match) setMatch(json.match as DraftLiveMatchRow);
    } catch { /* ignore — realtime / the deadline poll will recover */ }
  }, [matchId]);

  // Initial state + realtime subscription. Gated on userId so we subscribe ONCE with
  // the real presence key (not a placeholder), instead of subscribe-teardown-resub.
  useEffect(() => {
    if (!matchId || !userId) return;
    const sb = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/draft/live/${matchId}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setError(json.error ?? "Couldn't load match"); setLoading(false); return; }
        setMatch(json.match as DraftLiveMatchRow);
        setLoading(false);
      } catch {
        if (!cancelled) { setError("Couldn't load match"); setLoading(false); }
      }
    })();

    (async () => {
      // Re-assert the cookie session on the realtime socket — without this it can stay
      // on the anon token and postgres_changes events silently never arrive (RLS).
      const { data: { session } } = await sb.auth.getSession();
      if (session?.access_token) sb.realtime.setAuth(session.access_token);
      if (cancelled) return;
      if (!REALTIME_ENABLED) return;

      // Drop any leftover channel for this topic before re-subscribing.
      sb.getChannels().filter((c) => c.topic.includes(`draft:match:${matchId}`)).forEach((c) => sb.removeChannel(c));

      channel = sb
        .channel(`draft:match:${matchId}`, { config: { presence: { key: userId } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "draft_live_matches", filter: `id=eq.${matchId}` },
          (payload) => setMatch(payload.new as DraftLiveMatchRow))
        .on("presence", { event: "sync" }, () => {
          const state = channel?.presenceState() ?? {};
          // presence is keyed by user id, so any key that isn't ours is the opponent.
          setOpponentOnline(Object.keys(state).some((k) => k !== userId));
        })
        .subscribe((status) => { if (status === "SUBSCRIBED") channel?.track({ uid: userId }); });
    })();

    return () => { cancelled = true; if (channel) sb.removeChannel(channel); };
  }, [matchId, userId]);

  // Recover stale state after the tab was backgrounded (mobile throttles timers and
  // can drop the socket) — refetch on refocus.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refetch(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch]);

  // Local countdown → ping /advance once when the deadline passes.
  useEffect(() => {
    const t = setInterval(() => {
      const m = matchRef.current;
      if (!m || !m.phase_deadline || TERMINAL.has(m.phase)) { setSecondsLeft(null); return; }
      const ms = Date.parse(m.phase_deadline) - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0 && advancedForPhaseRef.current !== m.phase) {
        advancedForPhaseRef.current = m.phase;
        post("/api/draft/live/advance", { matchId: m.id })
          .then((next) => { if (next) setMatch(next); })
          // On a transient failure (offline, 429, 500) clear the guard so the next
          // tick retries — otherwise the countdown stalls at 0 forever.
          .catch(() => { if (advancedForPhaseRef.current === m.phase) advancedForPhaseRef.current = null; });
      }
    }, 250);
    return () => clearInterval(t);
  }, []);

  const side: LiveSide = !match || !userId ? null : match.p1_id === userId ? "p1" : match.p2_id === userId ? "p2" : null;

  const act = useCallback(async (path: string, body: Record<string, unknown>) => {
    try {
      const next = await post(path, { matchId, ...body });
      if (next) setMatch(next);
    } catch (e) {
      // A rejected action (usually a swap landing just after the deadline) must
      // NOT tear down the match view — surface it as a transient, self-clearing toast.
      setActionError((e as Error).message);
      setTimeout(() => setActionError(null), 3500);
    }
  }, [matchId]);

  return {
    match,
    side,
    opponentOnline,
    secondsLeft,
    loading,
    error,
    actionError,
    ready: () => act("/api/draft/live/ready", {}),
    botDone: () => act("/api/draft/live/ready", { bot: true }),
    swap: (slotId, newPlayer) => act("/api/draft/live/swap", { slotId, newPlayer }),
    drawChoice: (wantsPens) => act("/api/draft/live/swap", { wantsPens }),
  };
}
