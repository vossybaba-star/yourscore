"use client";
/**
 * Social → Discover's feed-backed filter chips (Phase 5b, AC2): Trending,
 * Players, Polls, Squads, Games. Each fetches /api/fantasy/discover/feed and
 * renders through the SAME FeedCard the main feed uses — no duplicated card
 * markup. Leagues (DiscoverLeagues) and Managers (DiscoverManagers) are
 * separate, unchanged surfaces — this component only covers the five new
 * feed-backed ones.
 */
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { FeedCard, type FeedEvent } from "@/components/fantasy/FeedStream";

export type FeedFilter = "trending" | "players" | "polls" | "squads" | "games";

interface DiscoverPlayer { playerId: number; name: string; club: string; avatarUrl: string | null; postCount: number }
interface DiscoverFeedResult { events: FeedEvent[]; players?: DiscoverPlayer[] }

const EMPTY_COPY: Record<FeedFilter, string> = {
  trending: "Nothing trending yet. It needs a bit more noise.",
  players: "No player talk yet. Posts that tag a player show up here.",
  polls: "No polls yet. Start one from the composer.",
  squads: "No squads revealed yet. Once managers pick, they land here.",
  games: "No game results shared yet.",
};

/** Top discussed players (playerId grouped, min 2 posts — server-enforced)
 *  as a horizontal row of tappable chips above the Players filter's posts. */
function TopPlayersRow({ players }: { players: DiscoverPlayer[] }) {
  if (!players.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
      {players.map((p) => (
        <Link key={p.playerId} href={`/fantasy/players/${p.playerId}`} style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 7, textDecoration: "none",
          padding: "7px 12px 7px 7px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`,
        }}>
          <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={26} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>
              {p.name}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: MUTED, whiteSpace: "nowrap" }}>
              <Crest club={p.club} size={10} /> {p.postCount} post{p.postCount === 1 ? "" : "s"}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function DiscoverFeedFilter({ filter, signInNext = "/fantasy/social?tab=discover" }: { filter: FeedFilter; signInNext?: string }) {
  const [data, setData] = useState<DiscoverFeedResult | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    fetch(`/api/fantasy/discover/feed?filter=${filter}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => { if (live) setData({ events: d.events ?? [], players: d.players }); })
      .catch(() => { if (live) setData({ events: [] }); });
    return () => { live = false; };
  }, [filter]);

  if (data === null) return <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>;

  // Trending's honest empty state (AC2): fewer than 3 qualifying posts reads
  // as "nothing trending" even if 1-2 technically cleared the engagement floor
  // — never pad the list out with them.
  const tooFewForTrending = filter === "trending" && data.events.length < 3;
  const showEmpty = tooFewForTrending || data.events.length === 0;

  return (
    <div>
      {filter === "players" && <TopPlayersRow players={data.players ?? []} />}
      {showEmpty ? (
        <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 20, textAlign: "center" }}>
          <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>{EMPTY_COPY[filter]}</p>
        </div>
      ) : (
        data.events.map((ev) => <FeedCard key={ev.rowKey} ev={ev} signInNext={signInNext} />)
      )}
    </div>
  );
}

export const FEED_FILTER_CHIPS: { id: FeedFilter; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "players", label: "Players" },
  { id: "polls", label: "Polls" },
  { id: "squads", label: "Squads" },
  { id: "games", label: "Games" },
];

/** A single filter chip — extracted so DiscoverTabs can lay every chip
 *  (feed-backed + Leagues/Managers) out in one consistent row. `role`/
 *  `aria-selected` live directly on this button (not a wrapping element) —
 *  putting `role="tab"` on a non-interactive wrapper around the real button
 *  breaks both keyboard/AT activation AND simple event dispatch on the
 *  accessible element, since the actual click handler sits one level down. */
export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} style={{
      flexShrink: 0, padding: "8px 14px", minHeight: 44, borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
      background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : MUTED,
      border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
    }}>{children}</button>
  );
}
