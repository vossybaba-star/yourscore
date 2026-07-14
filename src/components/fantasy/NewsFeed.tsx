"use client";
/**
 * The fantasy news feed stream — filter chips + content cards.
 *
 * Client component (the chips hold state) fed entirely by server-rendered props,
 * so /fantasy/news stays ISR: no client fetch, no waterfall, no spinner.
 *
 * Design notes:
 * - IMAGES are the point. A feed of grey text blocks reads as unfinished no
 *   matter how good the words are; a journalist's photo is what makes it feel
 *   like football. Tweets and articles both carry one when the source has one.
 * - Cards, but ONE level deep and never nested. Each card is a whole tap target.
 * - Gold is reserved for state and the one thing that tells you what to DO
 *   (the tip). If everything is gold, nothing is.
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NewsDoubt, NewsInsight, NewsItem, NewsTips } from "@/lib/fantasy/news";

const GOLD = "#E3B54C";
const PANEL = "#16261C";
const LINE = "#2A4032";
const INK = "#EDEAE0";
const MUTED = "#9FB2A5";
const WARN = "#E0A34A";

type Filter = "all" | "team-news" | "transfers" | "tips";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tips", label: "Tips" },
  { id: "team-news", label: "Team news" },
  { id: "transfers", label: "Transfers" },
];

/** "Drafted Tue 14:00" — tips can be re-drafted mid-week (a doubt naming the
 *  tipped player forces it), so this is what makes staleness honest: even when
 *  a redraft attempt fails and the previous pick is left standing, the reader
 *  can see it wasn't written today. */
function draftedLabel(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const day = d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short" });
  const time = d.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  return `Drafted ${day} ${time}`;
}

/** "2h ago" — a feed without timestamps doesn't read as news. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const cardBase: CSSProperties = {
  background: PANEL,
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  overflow: "hidden",
  display: "block",
  textDecoration: "none",
  WebkitTapHighlightColor: "transparent",
};

function Thumb({ src, alt }: { src: string; alt: string }) {
  return (
    <div style={{ aspectRatio: "16 / 9", background: "#0B1712", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}

function ItemCard({ item }: { item: NewsItem }) {
  const p = item.payload;
  const isTweet = item.kind === "tweet";
  return (
    <a href={p.url} target="_blank" rel="noopener noreferrer" style={cardBase} className="ys-card">
      {p.image && <Thumb src={p.image} alt="" />}
      <div style={{ padding: 12 }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 5,
            fontSize: 11, color: MUTED,
          }}
        >
          <span style={{ color: isTweet ? GOLD : MUTED, fontWeight: 600 }}>
            {isTweet ? p.handle : p.source}
          </span>
          {isTweet && p.verified === "true" && (
            <span aria-hidden="true" style={{ color: "#4FA8E0", fontSize: 12, lineHeight: 1 }}>✓</span>
          )}
          <span aria-hidden="true">·</span>
          <span>{ago(item.createdAt)}</span>
        </div>
        <div
          style={{
            color: INK, fontSize: 14, lineHeight: 1.45,
            fontWeight: isTweet ? 400 : 600,
          }}
        >
          {isTweet ? p.text : p.title}
        </div>
      </div>
    </a>
  );
}

export function NewsFeed({
  tips, doubts, insights, teamItems, transferItems,
}: {
  tips?: NewsTips;
  doubts: NewsDoubt[];
  insights: NewsInsight[];
  teamItems: NewsItem[];
  transferItems: NewsItem[];
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const hasTips = !!(tips?.captain || tips?.differential || tips?.note);
  const show = useMemo(
    () => ({
      tips: hasTips && (filter === "all" || filter === "tips"),
      insights: insights.length > 0 && (filter === "all" || filter === "tips"),
      doubts: doubts.length > 0 && (filter === "all" || filter === "team-news"),
      team: teamItems.length > 0 && (filter === "all" || filter === "team-news"),
      transfers: transferItems.length > 0 && (filter === "all" || filter === "transfers"),
    }),
    [filter, hasTips, insights.length, doubts.length, teamItems.length, transferItems.length],
  );
  const nothing = !Object.values(show).some(Boolean);

  return (
    <>
      <style>{`
        .ys-chip { transition: background 160ms cubic-bezier(.22,1,.36,1), color 160ms; }
        .ys-card { transition: border-color 160ms cubic-bezier(.22,1,.36,1); }
        @media (hover: hover) { .ys-card:hover { border-color: ${GOLD}55; } }
        .ys-card:active { border-color: ${GOLD}88; }
        @media (prefers-reduced-motion: reduce) {
          .ys-chip, .ys-card { transition: none; }
        }
      `}</style>

      {/* Filter chips — the feed's one interaction. Scannable, thumb-sized. */}
      <div
        role="tablist"
        aria-label="Filter the feed"
        style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}
      >
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.id)}
              className="ys-chip"
              style={{
                flex: "0 0 auto",
                padding: "7px 14px",
                minHeight: 34,
                borderRadius: 999,
                border: `1px solid ${on ? GOLD : LINE}`,
                background: on ? GOLD : "transparent",
                color: on ? "#12200F" : MUTED,
                fontSize: 12.5,
                fontWeight: on ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {nothing && (
        <div style={{ ...cardBase, padding: 16 }}>
          <div style={{ color: INK, fontSize: 14, fontWeight: 600 }}>Nothing here yet</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            {filter === "all"
              ? "Team news, transfer talk and tips land here as the gameweek builds."
              : "Try another filter — there's news in the other tabs."}
          </div>
        </div>
      )}

      {/* Tip first: the only thing on the page that tells you what to DO, so it
          gets the accent and the top slot. */}
      {show.tips && (
        <section
          style={{
            background: "#1B2A1E", border: `1px solid ${GOLD}66`,
            borderRadius: 12, padding: 14,
          }}
        >
          <div
            style={{
              color: GOLD, fontSize: 11, fontWeight: 700,
              letterSpacing: "0.02em", marginBottom: 8,
            }}
          >
            THE MOVE · GW{tips && "gw" in tips ? (tips as { gw?: number }).gw : ""}
          </div>
          {tips?.captain && (
            <p style={{ color: INK, fontSize: 14, margin: "0 0 8px", lineHeight: 1.5 }}>
              <strong>Captain {tips.captain.player}.</strong> {tips.captain.why}
            </p>
          )}
          {tips?.differential && (
            <p style={{ color: INK, fontSize: 14, margin: "0 0 8px", lineHeight: 1.5 }}>
              <strong>Differential: {tips.differential.player}.</strong> {tips.differential.why}
            </p>
          )}
          {tips?.note && (
            <p style={{ color: MUTED, fontSize: 13, margin: 0, lineHeight: 1.5 }}>{tips.note}</p>
          )}
          {tips?.draftedAt && (
            <div style={{ color: MUTED, fontSize: 11, marginTop: 8 }}>
              {draftedLabel(tips.draftedAt)}
            </div>
          )}
        </section>
      )}

      {show.doubts && (
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ color: INK, fontSize: 13, fontWeight: 600, margin: 0 }}>Doubts</h2>
          {doubts.map((d) => (
            <div
              key={d.smId}
              style={{
                background: PANEL, border: `1px solid ${WARN}44`, borderRadius: 12,
                padding: 12, display: "flex", gap: 10, alignItems: "flex-start",
              }}
            >
              <span aria-hidden="true" style={{ color: WARN, fontSize: 15, lineHeight: 1.35 }}>!</span>
              <div style={{ color: INK, fontSize: 14, lineHeight: 1.45 }}>
                <strong>{d.name}</strong>{" "}
                <span style={{ color: MUTED }}>({d.club})</span> — {d.reason}
              </div>
            </div>
          ))}
        </section>
      )}

      {show.insights && (
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ color: INK, fontSize: 13, fontWeight: 600, margin: 0 }}>Worth knowing</h2>
          {insights.map((n, i) => (
            <div key={i} style={{ ...cardBase, padding: 12 }}>
              <div style={{ color: INK, fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
                {n.title}
              </div>
              <div style={{ color: MUTED, fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>
                {n.body}
              </div>
            </div>
          ))}
        </section>
      )}

      {show.team && (
        <section style={{ display: "grid", gap: 10 }}>
          <h2 style={{ color: INK, fontSize: 13, fontWeight: 600, margin: 0 }}>Team news</h2>
          {teamItems.map((it, i) => <ItemCard key={`t${i}`} item={it} />)}
        </section>
      )}

      {show.transfers && (
        <section style={{ display: "grid", gap: 10 }}>
          <h2 style={{ color: INK, fontSize: 13, fontWeight: 600, margin: 0 }}>Transfers &amp; talk</h2>
          {transferItems.map((it, i) => <ItemCard key={`x${i}`} item={it} />)}
        </section>
      )}
    </>
  );
}
