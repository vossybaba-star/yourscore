"use client";
/**
 * Feed image block (Phase 2a). One rounded 12px container, images laid out by
 * count: 1 large and natural, 2 side by side, 3 as one large left + two stacked
 * right, 4 as a 2x2 grid. Every cell is object-fit cover with a 2px gap. Used for
 * both the new multi-image posts AND legacy single-image posts (the caller just
 * passes a one-item array for those). Tapping any cell opens the full-screen
 * MediaGallery at that index.
 */
import type { CSSProperties } from "react";
import { LINE } from "@/components/fantasy/shared";

const GRID_HEIGHT = 260;

function Cell({ src, onClick, style }: { src: string; onClick: () => void; style?: CSSProperties }) {
  return (
    <button onClick={onClick} aria-label="Open image" style={{
      display: "block", width: "100%", height: "100%", padding: 0, margin: 0,
      border: "none", cursor: "pointer", overflow: "hidden", background: "none", ...style,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
    </button>
  );
}

export function ImageGrid({ images, onOpen }: { images: string[]; onOpen: (index: number) => void }) {
  const shown = images.slice(0, 4);
  if (!shown.length) return null;

  const wrap: CSSProperties = { marginTop: 10, borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}` };

  if (shown.length === 1) {
    return (
      <div style={wrap}>
        <button onClick={() => onOpen(0)} aria-label="Open image" style={{
          display: "block", width: "100%", padding: 0, margin: 0, border: "none", cursor: "pointer", background: "none",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown[0]} alt="" loading="lazy" style={{ display: "block", width: "100%", maxHeight: 440, objectFit: "cover" }} />
        </button>
      </div>
    );
  }

  if (shown.length === 2) {
    return (
      <div style={{ ...wrap, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, height: GRID_HEIGHT }}>
        {shown.map((src, i) => <Cell key={i} src={src} onClick={() => onOpen(i)} />)}
      </div>
    );
  }

  if (shown.length === 3) {
    return (
      <div style={{ ...wrap, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 2, height: GRID_HEIGHT }}>
        <Cell src={shown[0]} onClick={() => onOpen(0)} style={{ gridRow: "1 / 3" }} />
        <Cell src={shown[1]} onClick={() => onOpen(1)} />
        <Cell src={shown[2]} onClick={() => onOpen(2)} />
      </div>
    );
  }

  return (
    <div style={{ ...wrap, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 2, height: GRID_HEIGHT }}>
      {shown.map((src, i) => <Cell key={i} src={src} onClick={() => onOpen(i)} />)}
    </div>
  );
}
