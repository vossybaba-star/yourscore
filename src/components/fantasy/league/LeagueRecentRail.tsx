"use client";
/** Recent activity — a horizontal rail of what the league has been up to, sitting
 *  above the chat tile on the Hub. Same events as the main fantasy feed (squads
 *  completed, transfers, captains, hauls), but filtered to THIS league's members.
 *  Each card taps into that manager's profile; "See all" opens the full league
 *  feed. It's the league's pulse at a glance. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";

interface FeedEvent {
  id: string; actorId: string; actorName: string; actorUsername: string | null; actorAvatar: string | null; actorClub: string | null;
  type: string; sentence: string; createdAt: string;
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Bare SVG, not emoji (house rule — see LeagueChatView's ChipIcon comment).
// "captain" stays the Ⓒ glyph used everywhere else captain is marked; it's a
// Unicode letter, not an emoji, so it's outside the sweep.
const TYPE_ICON_PATH: Record<string, string> = {
  squad_complete: "M8 4l-4 3 2 3 2-1v11h8V9l2 1 2-3-4-3a4 4 0 0 1-8 0z",
  squad_update: "M17 2l4 4-4 4 M21 6H8a4 4 0 0 0-4 4v1 M7 22l-4-4 4-4 M3 18h13a4 4 0 0 0 4-4v-1",
  transfer: "M17 2l4 4-4 4 M21 6H8a4 4 0 0 0-4 4v1 M7 22l-4-4 4-4 M3 18h13a4 4 0 0 0 4-4v-1",
  chip: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  haul: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  rank_jump: "M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6",
  shortlist_add: "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z",
};

function TypeGlyph({ type }: { type: string }) {
  if (type === "captain") return <span aria-hidden style={{ fontSize: 13, lineHeight: 1.3 }}>Ⓒ</span>;
  const d = TYPE_ICON_PATH[type];
  if (!d) return <span aria-hidden style={{ fontSize: 13, lineHeight: 1.3 }}>•</span>;
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
      <path d={d} />
    </svg>
  );
}

export function LeagueRecentRail({ code, onSelect }: {
  code: string;
  /** Open the shared member action sheet instead of jumping straight to the
   *  profile (Phase 1B) — omitted (falls back to the direct profile link)
   *  when the caller has no member context to hand it (a non-member browse). */
  onSelect?: (ev: FeedEvent) => void;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<FeedEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/feed?limit=12`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => { if (live) setEvents(d.events ?? []); })
      .catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [code]);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>RECENT ACTIVITY</span>
        {events && events.length > 0 && (
          <Link href={`/fantasy/leagues/${code}/feed`} style={{ fontSize: 12, fontWeight: 700, color: TEAL, textDecoration: "none" }}>See all →</Link>
        )}
      </div>

      {events === null ? (
        <div style={{ display: "flex", gap: 8, overflow: "hidden" }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ flex: "0 0 158px", height: 92, borderRadius: 12, background: PANEL_2 }} />)}
        </div>
      ) : events.length === 0 ? (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 13px" }}>
          <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.45 }}>
            No moves yet. As your league picks squads, makes transfers and racks up points, it all shows up here.
          </p>
        </div>
      ) : (
        // Horizontal scroll rail. Edge-to-edge so cards can bleed off the right,
        // hinting there's more to swipe to.
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, margin: "0 -16px", padding: "0 16px 4px", scrollbarWidth: "none" }}>
          {events.map((ev) => (
            <button key={ev.id} onClick={() => (onSelect ? onSelect(ev) : router.push(`/profile/${ev.actorId}`))} style={{
              flex: "0 0 168px", textAlign: "left", cursor: "pointer",
              background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11,
              display: "flex", flexDirection: "column", gap: 7,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ position: "relative", flexShrink: 0, width: 26, height: 26 }}>
                  <PlayerAvatar name={ev.actorName} avatarUrl={ev.actorAvatar} size={26} />
                  {(() => { const c = ev.actorClub ? getTeamBadgeUrlSync(ev.actorClub) : null; return c ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c} alt="" width={13} height={13} style={{ position: "absolute", right: -3, bottom: -2, width: 13, height: 13, objectFit: "contain", borderRadius: "50%", background: PANEL, padding: 0.5, boxShadow: "0 0 0 1.5px " + PANEL }} />
                  ) : null; })()}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.actorName}</div>
                  <div style={{ fontSize: 10.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.actorUsername ? `@${ev.actorUsername} · ` : ""}{timeAgo(ev.createdAt)}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <TypeGlyph type={ev.type} />
                <span style={{
                  fontSize: 12, color: "#c7d0cb", lineHeight: 1.35,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>{ev.sentence}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
