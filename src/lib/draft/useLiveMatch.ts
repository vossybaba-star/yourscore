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
import type { DraftLiveMatchRow } from "@/types/draft-db";

const TERMINAL = new Set(["result", "abandoned"]);

export type LiveSide = "p1" | "p2" | null;

export type UseLiveMatch = {
  match: DraftLiveMatchRow | null;
  side: LiveSide;
  opponentOnline: boolean;
  secondsLeft: number | null;
  loading: boolean;
  error: string | null;
  ready: () => Promise<void>;
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

  const matchRef = useRef<DraftLiveMatchRow | null>(null);
  const advancedForPhaseRef = useRef<string | null>(null);
  matchRef.current = match;

  // Resolve who we are once.
  useEffect(() => {
    let live = true;
    createClient().auth.getUser().then(({ data }) => { if (live) setUserId(data.user?.id ?? null); });
    return () => { live = false; };
  }, []);

  // Initial state + realtime subscription, re-created per matchId.
  useEffect(() => {
    if (!matchId) return;
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

    channel = sb
      .channel(`draft:match:${matchId}`, { config: { presence: { key: "self" } } })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "draft_live_matches", filter: `id=eq.${matchId}` },
        (payload) => setMatch(payload.new as DraftLiveMatchRow))
      .on("presence", { event: "sync" }, () => {
        const state = channel?.presenceState() ?? {};
        const mine = userId;
        const others = Object.values(state).flat().filter((p) => (p as { uid?: string }).uid && (p as { uid?: string }).uid !== mine);
        setOpponentOnline(others.length > 0);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && userId) channel?.track({ uid: userId });
      });

    return () => { cancelled = true; if (channel) sb.removeChannel(channel); };
  }, [matchId, userId]);

  // Local countdown → ping /advance once when the deadline passes.
  useEffect(() => {
    const t = setInterval(() => {
      const m = matchRef.current;
      if (!m || !m.phase_deadline || TERMINAL.has(m.phase)) { setSecondsLeft(null); return; }
      const ms = Date.parse(m.phase_deadline) - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0 && advancedForPhaseRef.current !== m.phase) {
        advancedForPhaseRef.current = m.phase;
        post("/api/draft/live/advance", { matchId: m.id }).then((next) => { if (next) setMatch(next); }).catch(() => {});
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
      setError((e as Error).message);
    }
  }, [matchId]);

  return {
    match,
    side,
    opponentOnline,
    secondsLeft,
    loading,
    error,
    ready: () => act("/api/draft/live/ready", {}),
    swap: (slotId, newPlayer) => act("/api/draft/live/swap", { slotId, newPlayer }),
    drawChoice: (wantsPens) => act("/api/draft/live/swap", { wantsPens }),
  };
}
