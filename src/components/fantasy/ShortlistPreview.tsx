"use client";
/**
 * Shortlist preview — a compact peek at the Briefing head.
 *
 * Up to three saved players and a link into the full Shortlist tab. It is
 * DELIBERATELY quiet: the Briefing is a stream of facts, and an empty or noisy
 * shortlist block would clutter it — so when nothing is saved (or the load is
 * still in flight) this renders NOTHING at all. Shares its saved ids with the
 * star and the Shortlist tab via useShortlist.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api, Crest, INK, LINE, MUTED, PANEL, TEAL,
  type ClientPoolPlayer,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";
import { useShortlist } from "@/components/fantasy/useShortlist";

export function ShortlistPreview() {
  const shortlist = useShortlist();
  const [pool, setPool] = useState<ClientPoolPlayer[] | null>(null);

  // Only fetch the pool once there is at least one saved player to show — an
  // empty shortlist renders nothing, so it costs the Briefing nothing.
  useEffect(() => {
    if (!shortlist.ids.length || pool) return;
    let live = true;
    api<{ players: ClientPoolPlayer[] }>("pool")
      .then((p) => { if (live) setPool(p.players); })
      .catch(() => {});
    return () => { live = false; };
  }, [shortlist.ids.length, pool]);

  const preview = useMemo(() => {
    if (!pool) return [];
    const byId = new Map(pool.map((p) => [p.id, p]));
    return shortlist.ids
      .map((id) => byId.get(id))
      .filter((p): p is ClientPoolPlayer => !!p)
      .slice(0, 3);
  }, [pool, shortlist.ids]);

  // Nothing saved (or still loading) → render nothing. Don't clutter the Briefing.
  if (!shortlist.ready || !shortlist.ids.length || !preview.length) return null;

  const more = shortlist.ids.length - preview.length;

  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <span className="font-display tracking-widest" style={{ color: "#586058", fontSize: 12 }}>
          SHORTLIST
        </span>
        <Link href="/fantasy/scout/shortlist" style={{ color: TEAL, fontSize: 12, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
          View full shortlist
        </Link>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {preview.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <PlayerAvatar name={p.name} avatarUrl={faceFor(p.name)} size={28} />
            <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{p.name}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Crest club={p.club} size={12} />
                <span style={{ fontSize: 11, color: MUTED }}>{p.club} · {p.pos}</span>
              </span>
            </span>
          </div>
        ))}
      </div>
      {more > 0 && (
        <p style={{ fontSize: 11.5, color: MUTED, margin: "10px 0 0" }}>
          + {more} more saved
        </p>
      )}
    </div>
  );
}
