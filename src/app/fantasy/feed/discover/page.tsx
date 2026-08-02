"use client";
/**
 * Managers to follow — with a reason, not just a directory (founder, 2 Aug). The
 * most relevant few show as activity tiles (their squad on the pitch); the rest
 * are rows, each with WHY you'd follow (shared picks, a player in common, a fresh
 * squad) and their captain's-club crest. Reached from the feed / home.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { GOLD, INK, LINE, MUTED, PANEL, TEAL, page, tint } from "@/components/fantasy/shared";
import { BackPill } from "@/components/ui/BackPill";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { FollowButton } from "@/components/social/FollowButton";
import { BottomNav } from "@/components/ui/BottomNav";
import type { BoardPlayer } from "@/lib/fantasy/board";

interface DiscoverBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain: number | null; vice: number | null }
interface Manager {
  userId: string; username: string | null; displayName: string; avatarUrl: string | null;
  club: string | null; reason: string; shared: number; followers: number; following: number; board: DiscoverBoard | null;
}

function ManagerFace({ name, avatarUrl, club, size = 40 }: { name: string; avatarUrl: string | null; club: string | null; size?: number }) {
  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <PlayerAvatar name={name} avatarUrl={avatarUrl} size={size} />
      {club && (
        <span aria-hidden style={{ position: "absolute", bottom: -2, right: -3, width: size * 0.5, height: size * 0.5, minWidth: 15, minHeight: 15, borderRadius: "50%", background: "#0a1710", border: "1.5px solid #0a1710", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Crest club={club} size={size * 0.5} />
        </span>
      )}
    </div>
  );
}

function ReasonChip({ m }: { m: Manager }) {
  const strong = m.shared >= 1;
  const accent = m.shared >= 3 ? GOLD : strong ? TEAL : MUTED;
  const icon = m.shared >= 3 ? "🔗" : strong ? "🤝" : "👕";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
      color: accent, background: tint(accent === MUTED ? "#8a948f" : accent, "16"), border: `1px solid ${tint(accent === MUTED ? "#8a948f" : accent, "40")}` }}>
      <span aria-hidden>{icon}</span>{m.reason}
    </span>
  );
}

function ManagerHead({ m }: { m: Manager }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Link href={`/profile/${m.userId}`} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textDecoration: "none" }}>
        <ManagerFace name={m.displayName} avatarUrl={m.avatarUrl} club={m.club} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.displayName}</div>
          {m.username && <div style={{ fontSize: 11.5, color: MUTED }}>@{m.username}</div>}
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
            <b style={{ color: INK, fontWeight: 700 }}>{m.followers.toLocaleString()}</b> followers · <b style={{ color: INK, fontWeight: 700 }}>{m.following.toLocaleString()}</b> following
          </div>
        </div>
      </Link>
      <FollowButton userId={m.userId} size="sm" initialFollowing={false} />
    </div>
  );
}

export default function DiscoverManagersPage() {
  const [managers, setManagers] = useState<Manager[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/discover")
      .then((r) => (r.ok ? r.json() : { managers: [] }))
      .then((d) => { if (live) setManagers(d.managers ?? []); })
      .catch(() => { if (live) setManagers([]); });
    return () => { live = false; };
  }, []);

  // The most relevant few become activity tiles (their squad shown); the rest rows.
  const tiles = (managers ?? []).slice(0, 3);
  const rows = (managers ?? []).slice(3);

  return (
    <>
      <main data-fantasy style={page}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <BackPill fallback="/fantasy" label="Back" tone="neutral" />
        </div>
        <h1 className="font-display" style={{ fontSize: 24, color: INK, margin: "0 0 4px" }}>Managers to follow</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 16px", lineHeight: 1.5 }}>
          Follow them and their transfers, captains and big weeks land in your feed.
        </p>

        {managers === null ? (
          <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>
        ) : managers.length === 0 ? (
          <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>No one to suggest yet. Check back once more managers join.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tiles.map((m) => (
              <div key={m.userId} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12 }}>
                <ManagerHead m={m} />
                <div style={{ margin: "9px 0 2px" }}><ReasonChip m={m} /></div>
                {m.board && m.board.xi.length > 0 && (
                  <Link href={`/profile/${m.userId}#fantasy-xi`} style={{ display: "block", marginTop: 8, textDecoration: "none" }}>
                    <div style={{ paddingBottom: 12 }}>
                      <SquadBoard mode="complete" players={m.board.players} xi={m.board.xi} bench={m.board.bench} captain={m.board.captain ?? undefined} vice={m.board.vice ?? undefined} />
                    </div>
                    <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 700, color: TEAL }}>See {m.displayName}&apos;s squad ›</div>
                  </Link>
                )}
              </div>
            ))}

            {rows.length > 0 && (
              <>
                <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "8px 2px 0" }}>MORE MANAGERS</div>
                {rows.map((m) => (
                  <div key={m.userId} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11 }}>
                    <ManagerHead m={m} />
                    <div style={{ marginTop: 8 }}><ReasonChip m={m} /></div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
