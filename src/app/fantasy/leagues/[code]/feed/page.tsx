"use client";
/** The league's own activity feed — the full, vertical version of the Hub rail.
 *  Everything the members have been doing (squads completed, transfers, captains,
 *  hauls), filtered to this league. A squad tile renders the real pitch and taps
 *  through to that manager's profile; the back button retraces here. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Btn, Header, INK, LINE, Loading, MUTED, page, PANEL, TEAL } from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import type { BoardPlayer } from "@/lib/fantasy/board";

interface FeedBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain?: number; vice?: number }
interface FeedFace { name: string; avatarUrl: string | null }
interface FeedEvent {
  id: string; actorId: string; actorName: string; actorAvatar: string | null;
  type: string; gw: number | null; sentence: string; createdAt: string;
  likeCount: number; commentCount: number;
  board?: FeedBoard | null; player?: FeedFace | null; playerId?: number | null;
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function FeedCard({ ev }: { ev: FeedEvent }) {
  return (
    <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PlayerAvatar name={ev.actorName} avatarUrl={ev.actorAvatar} size={32} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.35 }}>
            <Link href={`/profile/${ev.actorId}`} style={{ color: INK, fontWeight: 700, textDecoration: "none" }}>{ev.actorName}</Link>
            <span style={{ color: "#c7d0cb" }}> {ev.sentence}</span>
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{timeAgo(ev.createdAt)}</div>
        </div>
      </div>

      {ev.board && ev.board.xi.length > 0 && (
        <Link href={`/profile/${ev.actorId}#fantasy-xi`} style={{ display: "block", marginTop: 11, textDecoration: "none" }}>
          {/* paddingBottom reserves room for the keeper's name, which sits just
              past the square pitch edge — without it the caption overlaps it. */}
          <div style={{ paddingBottom: 12 }}>
            <SquadBoard mode="complete" players={ev.board.players} xi={ev.board.xi} bench={ev.board.bench} captain={ev.board.captain} vice={ev.board.vice} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: TEAL }}>
            See {ev.actorName}&apos;s squad <span aria-hidden>›</span>
          </div>
        </Link>
      )}

      {ev.player && ev.playerId != null && (
        <Link href={`/fantasy/players/${ev.playerId}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", marginTop: 11, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}` }}>
          <PlayerAvatar name={ev.player.name} avatarUrl={ev.player.avatarUrl} size={38} />
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: INK }}>{ev.player.name}</span>
          <span style={{ color: MUTED, fontSize: 18 }}>›</span>
        </Link>
      )}

      {(ev.likeCount > 0 || ev.commentCount > 0) && (
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: MUTED }}>
          {ev.likeCount > 0 && <span>♥ {ev.likeCount}</span>}
          {ev.commentCount > 0 && <span>💬 {ev.commentCount}</span>}
        </div>
      )}
    </div>
  );
}

export default function LeagueFeedPage() {
  const router = useRouter();
  const code = String(useParams().code ?? "").toUpperCase();
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/fantasy/leagues/${code}/feed?limit=40`);
      if (!res.ok) throw new Error("Couldn't load the feed");
      const d = await res.json();
      setEvents(d.events ?? []);
    } catch (e) { setErr((e as Error).message); }
  }, [code]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <main data-fantasy style={page}>
        <Header right={<Btn small onClick={() => router.push(`/fantasy/leagues/${code}`)}>← League</Btn>} />
        <h1 style={{ fontSize: 20, margin: "0 0 3px", fontWeight: 700 }}>League activity</h1>
        <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px" }}>Every move your league makes, newest first.</p>

        {err ? (
          <p style={{ fontSize: 13, color: "#E08A6B" }}>{err}</p>
        ) : events === null ? (
          <Loading label="Loading the league feed" />
        ) : events.length === 0 ? (
          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16 }}>
            <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
              Nothing yet. As your league picks squads, makes transfers and racks up points, every move lands here.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {events.map((ev) => <FeedCard key={ev.id} ev={ev} />)}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
