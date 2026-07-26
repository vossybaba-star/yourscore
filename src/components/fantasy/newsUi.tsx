/**
 * Shared server-safe UI for the fantasy news surfaces (/fantasy/news feed and
 * /fantasy/fixtures ticker).
 *
 * Lives here rather than in shared.tsx because that module is "use client" —
 * its exports can't cross into a server component, and both news surfaces are
 * server components (ISR, SEO-indexable, zero client JS).
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import type { Difficulty, NewsDoc } from "@/lib/fantasy/news";

// These MUST mirror the shared fantasy tokens in shared.tsx. They're re-declared
// (not imported) because shared.tsx is "use client" and these surfaces are server
// components — but the VALUES are the app's, so the news hub stops being a
// green-tinted island and reads as the same game as every other Fantasy screen.
export const TEAL = "#00d8c0";
export const GOLD = "#ffc233";
export const PITCH = "#080d0a";
export const PANEL = "#0e1611";
export const PANEL_2 = "#15211a";
export const LINE = "rgba(255,255,255,0.07)";
export const INK = "#eef2f0";
export const MUTED = "#8a948f";

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
  maxWidth: 512, margin: "0 auto", display: "grid", gap: 14,
};

/** Server-safe twin of shared.tsx's <Header>: the same teal "YOURSCORE FANTASY"
 *  wordmark and a back pill, so the news surfaces wear the exact fantasy masthead
 *  every other screen wears. A <Link> instead of an onClick, so it stays a server
 *  component (ISR + SEO). `title` renders as the section heading beneath it. */
export function FantasyMasthead({ title }: { title: string }) {
  return (
    <header style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link href="/fantasy" aria-label="Back to Fantasy"
          style={{
            background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED,
            fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999,
            textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
          }}>&larr; Fantasy</Link>
        <span className="font-display tracking-widest" style={{ fontSize: 15, color: TEAL }}>
          YOURSCORE FANTASY
        </span>
      </div>
      <h1 className="font-display" style={{
        color: INK, fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em", margin: "12px 0 0",
      }}>{title}</h1>
    </header>
  );
}

export const ukTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });

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
