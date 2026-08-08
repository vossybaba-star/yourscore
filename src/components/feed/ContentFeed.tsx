"use client";

/**
 * The live football content feed (founder 8 Aug) — "what's happening now":
 * recent news (headline + snippet, links out to the source, attributed) and
 * embeddable YouTube videos that autoplay muted as they scroll into view. Reads
 * the edge-cached /api/feed/live. Category chips filter reports / transfers /
 * managers / videos.
 *
 * Attribution: every card names its source (approved 8 Aug). News links out in a
 * new tab; videos are embedded via the official YouTube iframe.
 */

import { useEffect, useRef, useState } from "react";

const INK = "#eef2f0";
const MUTED = "#8a948f";
const PANEL = "#0e1611";
const LINE = "rgba(255,255,255,0.08)";
const TEAL = "#00d8c0";
const GOLD = "#ffc233";
const CORAL = "#e0653c";

interface FeedItem {
  id: string; title: string; url: string; source: string;
  image: string | null; summary?: string; publishedAt: string;
  kind?: "news" | "video"; videoId?: string;
  category?: "transfer" | "manager" | "video" | "report";
}

const CATS: { id: "all" | FeedItem["category"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "report", label: "News" },
  { id: "transfer", label: "Transfers" },
  { id: "manager", label: "Managers" },
  { id: "video", label: "Video" },
];
const CAT_COLOR: Record<string, string> = { transfer: GOLD, manager: CORAL, video: TEAL, report: MUTED };
const CAT_LABEL: Record<string, string> = { transfer: "Transfer", manager: "Manager", video: "Video", report: "News" };

function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** A video card — poster until it scrolls into view, then a muted autoplay embed
 *  (founder 8 Aug: "autoplay as scroll"). Out of view → back to the poster, so
 *  only what you're looking at is playing. */
function VideoCard({ item }: { item: FeedItem }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => setPlaying(ents[0]?.isIntersecting && ents[0].intersectionRatio > 0.55),
      { threshold: [0, 0.55, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" }}>
      <div ref={ref} style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
        {playing && item.videoId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${item.videoId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`}
            title={item.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
            loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        ) : (
          <button onClick={() => setPlaying(true)} aria-label={`Play: ${item.title}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, cursor: "pointer", padding: 0, background: "#000" }}>
            {item.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} />
            )}
            <span aria-hidden style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 54, height: 54, borderRadius: 999, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </button>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.3 }}>{item.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11, color: MUTED }}>
          <span style={{ color: TEAL, fontWeight: 700 }}>{item.source}</span>
          <span aria-hidden>·</span><span>{ago(item.publishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

function NewsCard({ item }: { item: FeedItem }) {
  const cat = item.category ?? "report";
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      style={{ display: "flex", gap: 12, textDecoration: "none", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: 12 }}>
      {item.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt="" style={{ width: 92, height: 92, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: "#0a0f0c" }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          {cat !== "report" && (
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: CAT_COLOR[cat], background: `${CAT_COLOR[cat]}1f`, borderRadius: 999, padding: "1px 7px" }}>{CAT_LABEL[cat].toUpperCase()}</span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, color: TEAL }}>{item.source}</span>
          <span style={{ fontSize: 11, color: MUTED }}>· {ago(item.publishedAt)}</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.title}</div>
        {item.summary && (
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.summary}</div>
        )}
      </div>
    </a>
  );
}

export function ContentFeed({ endpoint = "/api/feed/live" }: { endpoint?: string }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [filter, setFilter] = useState<"all" | FeedItem["category"]>("all");

  useEffect(() => {
    let live = true;
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (live) setItems((d.items ?? []) as FeedItem[]); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [endpoint]);

  const shown = (items ?? []).filter((it) => filter === "all" || (it.category ?? "report") === filter);

  return (
    <div>
      {/* Category chips */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 0 12px", scrollbarWidth: "none" }}>
        {CATS.map((c) => {
          const on = filter === c.id;
          return (
            <button key={c.id} onClick={() => setFilter(c.id)} style={{
              flexShrink: 0, padding: "6px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: on ? TEAL : "transparent", color: on ? "#04231f" : MUTED, border: `1px solid ${on ? TEAL : LINE}`,
            }}>{c.label}</button>
          );
        })}
      </div>

      {items === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ height: 96, borderRadius: 16, background: PANEL, border: `1px solid ${LINE}` }} />)}
        </div>
      ) : shown.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "24px 0" }}>Nothing here right now. Check back soon.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((it) => (it.kind === "video" && it.videoId ? <VideoCard key={it.id} item={it} /> : <NewsCard key={it.id} item={it} />))}
        </div>
      )}
    </div>
  );
}
