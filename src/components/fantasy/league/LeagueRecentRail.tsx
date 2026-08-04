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

const TYPE_ICON: Record<string, string> = {
  squad_complete: "👕", squad_update: "🔁", transfer: "🔁", captain: "Ⓒ",
  chip: "✨", haul: "🔥", rank_jump: "📈", shortlist_add: "⭐",
};

export function LeagueRecentRail({ code }: { code: string }) {
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
            <button key={ev.id} onClick={() => router.push(`/profile/${ev.actorId}`)} style={{
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
                <span style={{ fontSize: 13, lineHeight: 1.3 }} aria-hidden>{TYPE_ICON[ev.type] ?? "•"}</span>
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
