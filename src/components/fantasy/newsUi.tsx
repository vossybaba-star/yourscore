/**
 * Shared server-safe UI for the fantasy news surfaces (/fantasy/news feed and
 * /fantasy/fixtures ticker).
 *
 * Lives here rather than in shared.tsx because that module is "use client" —
 * its exports can't cross into a server component, and both news surfaces are
 * server components (ISR, SEO-indexable, zero client JS).
 */
import type { CSSProperties } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Difficulty, NewsDoc, NewsItem } from "@/lib/fantasy/news";

export const GOLD = "#E3B54C";
export const PITCH = "#0E1F17";
export const PANEL = "#16261C";
export const LINE = "#2A4032";
export const INK = "#EDEAE0";
export const MUTED = "#9FB2A5";

export const DIFF: Record<Difficulty, { bg: string; label: string }> = {
  kind: { bg: "#1D5A3A", label: "kind" },
  medium: { bg: "#6B5A22", label: "ok" },
  tough: { bg: "#6B2A2A", label: "tough" },
};

export const card: CSSProperties = {
  background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14,
};
export const h2: CSSProperties = {
  color: INK, fontSize: 15, fontWeight: 600, margin: "0 0 10px",
};
export const shell: CSSProperties = {
  minHeight: "100dvh", background: PITCH, padding: "16px 14px 40px",
};
export const column: CSSProperties = {
  maxWidth: 560, margin: "0 auto", display: "grid", gap: 14,
};

export const ukTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });

/** One tappable content item in the feed — an article or a tweet.
 *  Tweets render as native cards, NOT X's embed script (widgets.js is heavy and
 *  embed availability is flaky — spec §4.4). */
export function ItemCard({ item }: { item: NewsItem }) {
  const p = item.payload;
  return (
    <a
      href={p.url} target="_blank" rel="noopener noreferrer"
      style={{ ...card, display: "block", textDecoration: "none", padding: 12 }}
    >
      {item.kind === "tweet" ? (
        <>
          <div style={{ color: GOLD, fontSize: 12, fontWeight: 600 }}>{p.handle}</div>
          <div style={{ color: INK, fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>{p.text}</div>
        </>
      ) : (
        <>
          <div style={{ color: INK, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{p.title}</div>
          {p.source && <div style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>{p.source}</div>}
        </>
      )}
    </a>
  );
}

/** Read the current feed doc. Both surfaces render from the SAME cron-built
 *  doc — the tabs are two views of one document, not two pipelines. */
export async function loadFeedDoc(): Promise<NewsDoc | null> {
  // Explicit per-fetch revalidate is load-bearing: service-role GETs have a
  // constant cache key and get PINNED in Next's data cache without it
  // (the CLAUDE.md Vercel-cache gotcha — a stale doc survives restarts).
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: { fetch: (url: RequestInfo | URL, init?: RequestInit) =>
        fetch(url, { ...init, next: { revalidate: 300 } }) },
    },
  );
  const { data } = await db
    .from("fantasy_news_feed").select("doc")
    .order("gw", { ascending: false }).limit(1).maybeSingle();
  return (data?.doc ?? null) as NewsDoc | null;
}
