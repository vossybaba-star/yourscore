"use client";
/**
 * "Already in your squad" — the ONE piece of per-user state on an otherwise
 * public, server-rendered Four Picks card (FourPicks.tsx). Kept as its own
 * tiny client island rather than making the whole card strip dynamic, so a
 * signed-out visitor still gets the exact same server-rendered strip (the
 * Briefing's "public/ISR" contract holds) — just without this one badge.
 *
 * Not named in the Stage 4 plan's file list; split out because React requires
 * the client/server boundary to be its own module — FourPicks.tsx cannot be
 * "half server, half client" in one file.
 */
import { useEffect, useState } from "react";
import { api, type FantasyState } from "@/components/fantasy/shared";

const TEAL = "#00d8c0";

// Module-level cache: FourPicks renders up to four of these in one strip, so
// without this every card would independently re-fetch the same squad. One
// shared in-flight promise — the same "load once, everyone reuses it" idea as
// useShortlist.ts's module store, just without the write side.
let squadIds: Set<number> | null = null;
let inflight: Promise<Set<number>> | null = null;

async function loadSquadIds(): Promise<Set<number>> {
  if (squadIds) return squadIds;
  if (!inflight) {
    inflight = api<FantasyState>("state")
      .then((s) => new Set((s.squad?.picks ?? []).map((p) => p.id)))
      // Signed out (401), fantasy not yet allowed for this account (404), or
      // any other failure: no badge, never an error the card has to show.
      .catch(() => new Set<number>());
  }
  squadIds = await inflight;
  return squadIds;
}

export function OwnedBadge({ playerId }: { playerId: number }) {
  const [owned, setOwned] = useState(false);

  useEffect(() => {
    let live = true;
    void loadSquadIds().then((ids) => { if (live) setOwned(ids.has(playerId)); });
    return () => { live = false; };
  }, [playerId]);

  if (!owned) return null;
  return (
    <span className="font-body rounded-full whitespace-nowrap" style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: "0.02em", padding: "2px 7px",
      color: TEAL, border: `1px solid ${TEAL}55`, background: "rgba(0,216,192,0.10)",
    }}>Already in your squad</span>
  );
}
