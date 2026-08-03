/**
 * Scout's Four Picks — the Briefing card strip (Stage 4).
 *
 * A SERVER component: reads the PUBLISHED picks straight from the DB via a
 * service client (the same reasoning as newsUi.tsx's loadFeedDoc — shared,
 * public, ISR data, so it reads server-side and stays out of the client). The
 * ONE per-user bit, "Already in your squad", is the OwnedBadge client island,
 * so a signed-out visitor still gets the identical server-rendered strip.
 *
 * The Scout picks the players (mechanically, in scoutPicks.ts); the AI only
 * writes the reason lines, grounded. This component RENDERS facts — it makes
 * no judgement, states no verdict, and carries the category badge as the only
 * framing. Renders nothing at all when nothing is published.
 */
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  loadPublishedScoutPicks, type ResolvedScoutPick, type ScoutCategory, type Db,
} from "@/lib/fantasy/scoutPicks";
import {
  Card, SectionLabel, Crest, INK, MUTED, PANEL, TEAL, LIME, GOLD,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor, faceUrlById } from "@/lib/fantasy/faces";
import { OwnedBadge } from "@/components/fantasy/OwnedBadge";

/** The one new accent the plan allows — Scout's Gamble. */
const PURPLE = "#a78bfa";

/** Local copy: shared.tsx is a "use client" module, so its exported tint() is a
 *  client reference that isn't callable from this server component. The colour
 *  string constants serialize fine; a function does not. */
const tint = (hex: string, a = "1e") => `${hex}${a}`;
// Local copy of the position palette — this is a SERVER component, so it must not
// import POS_COLOR from the "use client" shared.tsx (that made the whole strip crash
// with a React-client-manifest error). Same hues as shared.tsx POS_COLOR.
const POS_HUE: Record<string, string> = { GK: "#f4a63a", DEF: "#00d8c0", MID: "#8ad14f", FWD: "#ff7a85" };

const CATEGORY: Record<ScoutCategory, { label: string; color: string }> = {
  safe: { label: "SAFE PICK", color: TEAL },
  form: { label: "FORM PICK", color: LIME },
  value: { label: "VALUE PICK", color: GOLD },
  gamble: { label: "SCOUT'S GAMBLE", color: PURPLE },
};
const ORDER: ScoutCategory[] = ["safe", "form", "value", "gamble"];

/** Same service-client shape as the read route: the per-fetch `revalidate`
 *  dodges the Vercel data-cache pin on service-role GETs (CLAUDE.md gotcha). */
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

/** One pick as a 2x2 grid tile — portrait-forward so it feels personal (founder,
 *  30 Jul): a big coloured category heading, a big ringed headshot, the name and
 *  one headline fact. The full case (all reasons + the risk) is a tap away on the
 *  detail page. */
function PickCard({ pick }: { pick: ResolvedScoutPick }) {
  const meta = CATEGORY[pick.category];
  const price = (pick.player.priceTenths / 10).toFixed(1);
  const firstReason = pick.reasons[0];

  return (
    <Link href={`/fantasy/scout/picks/${pick.category}`} style={{ textDecoration: "none" }}>
      <Card style={{
        padding: "14px 11px 12px", height: "100%", borderColor: tint(meta.color, "55"),
        background: `linear-gradient(180deg, ${tint(meta.color, "12")}, ${PANEL})`,
        display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
      }}>
        <span className="font-display" style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "0.06em", color: meta.color }}>
          {meta.label}
        </span>

        <div style={{ marginTop: 11 }}>
          <PlayerAvatar name={pick.player.name} avatarUrl={faceUrlById(pick.player.id) ?? faceFor(pick.player.name)} size={68} ring={meta.color} priority />
        </div>

        <div className="font-body" style={{ color: INK, fontSize: 15.5, fontWeight: 700, lineHeight: 1.15, marginTop: 9 }}>
          {pick.player.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4 }}>
          <Crest club={pick.player.club} size={13} />
          <span className="font-body" style={{ color: MUTED, fontSize: 11.5 }}>
            <span style={{ color: POS_HUE[pick.player.pos] ?? MUTED, fontWeight: 700 }}>{pick.player.pos}</span> · £{price}m
          </span>
        </div>
        <div style={{ marginTop: 5 }}><OwnedBadge playerId={pick.player.id} /></div>

        {firstReason && (
          <p className="font-body" style={{ color: INK, fontSize: 12.5, lineHeight: 1.4, margin: "9px 0 0", opacity: 0.92 }}>
            {firstReason}
          </p>
        )}

        <span className="font-body" style={{ marginTop: "auto", paddingTop: 10, fontSize: 11.5, fontWeight: 600, color: meta.color }}>
          See the case ›
        </span>
      </Card>
    </Link>
  );
}

export async function FourPicks() {
  let picks: ResolvedScoutPick[] = [];
  try {
    picks = await loadPublishedScoutPicks(serviceClient());
  } catch {
    picks = [];
  }
  // Nothing published yet: a quiet one-line teaser rather than a silent gap, so
  // the feature is discoverable (and its detail route reachable once a set lands).
  if (!picks.length) return (
    <section style={{ display: "grid", gap: 8 }}>
      <SectionLabel>SCOUT&rsquo;S FOUR PICKS</SectionLabel>
      <Card style={{ padding: 13 }}>
        <p className="font-body" style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          The Scout&rsquo;s four picks land before the deadline: one safe, one in form, one for value, one gamble.
        </p>
      </Card>
    </section>
  );

  const sorted = [...picks].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <SectionLabel>SCOUT&rsquo;S FOUR PICKS</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {sorted.map((p) => <PickCard key={p.category} pick={p} />)}
      </div>
    </section>
  );
}
