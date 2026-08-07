/**
 * Scout's Latest — the daily, rotating ideas strip at the top of the Picks tab.
 *
 * A SERVER component, same shape as FourPicks: it reads the most recent day's
 * auto-published ideas straight from the DB via a service client (shared,
 * public data), resolved against the newest availability. The Scout chooses the
 * players mechanically (scoutLatest.ts); the AI only writes the one narrative
 * line, grounded. This renders facts and a route to act on them, nothing more.
 *
 * Renders nothing when there are no ideas — the Four Picks below it are the
 * always-present anchor, so an empty day just shows those.
 */
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { loadLatestScoutIdeas, type ScoutIdea, type ScoutLatestKind, type Db } from "@/lib/fantasy/scoutLatest";
import { Card, SectionLabel, Crest, INK, MUTED, PANEL, TEAL, LIME } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor, faceUrlById } from "@/lib/fantasy/faces";

const AMBER = "#f6c454";

/** Server component: shared.tsx's tint() is a client reference, so keep a local
 *  string-concat copy (colour strings serialize; a function does not). */
const tint = (hex: string, a = "1e") => `${hex}${a}`;

const KIND: Record<ScoutLatestKind, { label: string; color: string }> = {
  momentum: { label: "ON THE MOVE", color: LIME },
  fixture_swing: { label: "FIXTURES TURNING", color: TEAL },
  watch: { label: "ON WATCH", color: AMBER },
};

/** Same service-client shape as FourPicks: the per-fetch `revalidate` dodges
 *  the Vercel data-cache pin on service-role GETs (CLAUDE.md gotcha). */
function serviceClient(): Db {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, next: { revalidate: 300 } }),
      },
    },
  );
}

/** "Fri 8 Aug" in London time — dates the strip so its freshness is visible. */
function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short",
  });
}

function IdeaRow({ idea }: { idea: ScoutIdea }) {
  const meta = KIND[idea.kind];
  const price = (idea.priceTenths / 10).toFixed(1);
  const ctaLabel = idea.cta === "compare" ? "Weigh him up" : "Add to shortlist";
  return (
    <Link href={`/fantasy/news?tab=players&focus=${idea.playerId}`} style={{ textDecoration: "none" }}>
      <Card style={{
        padding: "12px 13px", borderColor: tint(meta.color, "55"),
        background: `linear-gradient(180deg, ${tint(meta.color, "10")}, ${PANEL})`,
        display: "flex", gap: 12, alignItems: "flex-start",
      }}>
        <PlayerAvatar name={idea.name} avatarUrl={faceUrlById(idea.playerId) ?? faceFor(idea.name)} size={46} ring={meta.color} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span className="font-display" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", color: meta.color }}>
              {meta.label}
            </span>
            <span className="font-body" style={{ fontSize: 11, color: MUTED }}>{idea.headline}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <span className="font-body" style={{ color: INK, fontSize: 14.5, fontWeight: 700 }}>{idea.name}</span>
            <Crest club={idea.club} size={13} />
            <span className="font-body" style={{ color: MUTED, fontSize: 11 }}>{idea.pos} · £{price}m</span>
          </div>
          <p className="font-body" style={{ color: INK, fontSize: 12.5, lineHeight: 1.45, margin: "6px 0 0", opacity: 0.92 }}>
            {idea.body}
          </p>
          <span className="font-body" style={{ display: "inline-block", marginTop: 8, fontSize: 11.5, fontWeight: 600, color: meta.color }}>
            {ctaLabel} ›
          </span>
        </div>
      </Card>
    </Link>
  );
}

export async function ScoutLatest() {
  let ideas: ScoutIdea[] = [];
  try {
    ideas = await loadLatestScoutIdeas(serviceClient());
  } catch {
    ideas = [];
  }
  if (!ideas.length) return null;

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <SectionLabel>SCOUT&rsquo;S LATEST</SectionLabel>
        <span className="font-body" style={{ fontSize: 11, color: MUTED }}>{todayLabel()}</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {ideas.map((idea) => <IdeaRow key={idea.id} idea={idea} />)}
      </div>
    </section>
  );
}
