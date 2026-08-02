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
import type { Difficulty, NewsDoc } from "@/lib/fantasy/news";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";

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
  minHeight: "100dvh", background: PITCH,
  // Top: clear the iPhone status bar (viewport-fit=cover draws under it), so the
  // Back pill isn't hidden behind the clock. Bottom: clear the fixed BottomNav
  // (~58px) + the home-indicator safe area, or the last feed items sit under it.
  padding:
    "calc(16px + env(safe-area-inset-top)) 14px calc(88px + env(safe-area-inset-bottom))",
};
export const column: CSSProperties = {
  // minmax(0,1fr), not a bare auto track: a single `auto` grid track adopts its
  // widest child's MIN-content (the header's 4 nowrap nav pills ≈ 428px) and
  // overflows the viewport, dragging every child off-centre. Capping the track at
  // the container keeps wide children (pill scrollers, tables) inside their own box.
  maxWidth: 512, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14,
};

/** The Scout surfaces' top chrome — just the shared FantasyHeader (big FANTASY
 *  title + Squad | Scout | Leagues pills). The radar ScoutCover is a LANDING
 *  element and lives only on the Briefing, not on the tool sub-tabs (Players /
 *  Shortlist), where it pushed the search below the fold. `title` renders a small
 *  section heading for non-Scout callers (the fixtures ticker). */
export function FantasyMasthead({ title }: { title?: string }) {
  return (
    <header style={{ marginBottom: title ? 6 : 2 }}>
      <FantasyHeader />
      {title && (
        <h1 className="font-display" style={{
          color: INK, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", margin: "10px 0 0",
        }}>{title}</h1>
      )}
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
