"use client";

/**
 * The PL general-news stream — filter chips + article cards.
 *
 * A feed you scroll and tap into, not a dashboard. Images carry it (a wall of
 * grey text reads as unfinished); each card is one whole tap target opening the
 * source in a new tab. Teal is the Matchweek accent, used only for the active
 * chip and the source name — restraint keeps it from looking like a casino.
 */

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ago,
  filterByCategory,
  PL_NEWS_CATEGORIES,
  type PlNewsCategory,
  type PlNewsItem,
} from "@/lib/pl/news";

const TEAL = "#00d8c0";
const PANEL = "#141b18";
const LINE = "rgba(255,255,255,0.08)";
const INK = "#e8ede9";
const MUTED = "#8a948f";

const cardBase: CSSProperties = {
  background: PANEL,
  border: `1px solid ${LINE}`,
  borderRadius: 14,
  overflow: "hidden",
  display: "block",
  textDecoration: "none",
  WebkitTapHighlightColor: "transparent",
};

function Thumb({ src }: { src: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null; // a broken image is worse than none — collapse to a text card
  return (
    <div style={{ aspectRatio: "16 / 9", background: "#0b100e", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" onError={() => setOk(false)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  );
}

function Card({ item, now }: { item: PlNewsItem; now: number }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={cardBase} className="ys-plcard">
      {item.image && <Thumb src={item.image} />}
      <div style={{ padding: 13 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 11, color: MUTED }}>
          <span style={{ color: TEAL, fontWeight: 600 }}>{item.source}</span>
          <span aria-hidden="true">·</span>
          <span>{ago(item.publishedAt, now)}</span>
        </div>
        <div style={{ color: INK, fontSize: 14.5, lineHeight: 1.4, fontWeight: 600 }}>{item.title}</div>
      </div>
    </a>
  );
}

export function PlNewsFeed({ items, now }: { items: PlNewsItem[]; now: number }) {
  const [cat, setCat] = useState<PlNewsCategory>("all");
  const shown = useMemo(() => filterByCategory(items, cat, now), [items, cat, now]);

  return (
    <>
      <style>{`
        .ys-plchip { transition: background 160ms cubic-bezier(.22,1,.36,1), color 160ms, border-color 160ms; }
        .ys-plcard { transition: border-color 160ms cubic-bezier(.22,1,.36,1); }
        @media (hover: hover) { .ys-plcard:hover { border-color: ${TEAL}55; } }
        .ys-plcard:active { border-color: ${TEAL}88; }
        @media (prefers-reduced-motion: reduce) { .ys-plchip, .ys-plcard { transition: none; } }
      `}</style>

      <div role="tablist" aria-label="Filter football news"
        style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {PL_NEWS_CATEGORIES.map((f) => {
          const on = cat === f.id;
          return (
            <button key={f.id} role="tab" aria-selected={on} onClick={() => setCat(f.id)} className="ys-plchip"
              style={{
                flex: "0 0 auto", padding: "7px 14px", minHeight: 34, borderRadius: 999,
                border: `1px solid ${on ? TEAL : LINE}`, background: on ? TEAL : "transparent",
                color: on ? "#062018" : MUTED, fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer",
              }}>
              {f.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div style={{ ...cardBase, padding: 16 }}>
          <div style={{ color: INK, fontSize: 14, fontWeight: 600 }}>Nothing here yet</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            {cat === "all"
              ? "The latest football news lands here through the day."
              : "Nothing in this filter right now — try All."}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {shown.map((it) => <Card key={it.id} item={it} now={now} />)}
        </div>
      )}
    </>
  );
}
