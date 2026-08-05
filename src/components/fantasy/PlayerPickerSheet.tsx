"use client";
/**
 * Player search sheet for the post composer (Phase 2b) — same portaled bottom
 * sheet pattern as GifPicker. Loads the pool once on open (it's the same
 * public, cached /api/fantasy/pool the builder uses), then filters locally by
 * name/club substring — no per-keystroke network round trip for a ~700-player
 * pool.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { INK, LINE, MUTED, PANEL, TEAL, tint, PosTag, type Pos } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";

export interface PickablePlayer {
  id: number; name: string; club: string; pos: Pos; price: number; avatarUrl?: string | null;
}

const MAX_RESULTS = 20;

export function PlayerPickerSheet({ open, onClose, onSelect }: {
  open: boolean; onClose: () => void; onSelect: (p: PickablePlayer) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<PickablePlayer[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || players !== null) return;
    setError(false);
    fetch("/api/fantasy/pool")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPlayers(Array.isArray(d.players) ? d.players : []))
      .catch(() => { setPlayers([]); setError(true); });
  }, [open, players]);

  const results = useMemo(() => {
    if (!players) return [];
    const q = query.trim().toLowerCase();
    if (q) {
      return players
        .filter((p) => p.name.toLowerCase().includes(q) || p.club.toLowerCase().includes(q))
        .slice(0, MAX_RESULTS);
    }
    // No query: the pool arrives ordered by club, and Arsenal is alphabetically
    // first, so a raw first-20 slice showed ONLY Arsenal players and read as a
    // club-locked picker (founder, 6 Aug). Default to the biggest names by
    // price instead, which naturally spans clubs.
    return [...players].sort((a, b) => b.price - a.price).slice(0, MAX_RESULTS);
  }, [players, query]);

  if (!open || !mounted) return null;

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 65, background: "rgba(4,8,6,0.72)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Attach a player" style={{
        width: "100%", maxWidth: 480, height: "75vh",
        background: PANEL, borderTopLeftRadius: 18, borderTopRightRadius: 18,
        border: `1px solid ${tint(TEAL, "44")}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px", flexShrink: 0 }}>
          <span className="font-display" style={{ fontSize: 17, color: INK }}>Attach a player</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: MUTED, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or club" autoFocus
            style={{
              width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", borderRadius: 10,
              background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}`, color: INK, outline: "none",
            }} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 16px" }}>
          {players === null && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>Loading players</p>}
          {error && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>Couldn&apos;t load players. Try again in a moment.</p>}
          {players !== null && !error && results.length === 0 && (
            <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>No players found.</p>
          )}
          {results.map((p) => (
            <button key={p.id} onClick={() => onSelect(p)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
              background: "none", border: "none", padding: "8px 8px", borderRadius: 10,
            }}>
              <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={36} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: MUTED, marginTop: 1 }}>
                  <Crest club={p.club} size={12} /> {p.club} · <PosTag pos={p.pos} />
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
