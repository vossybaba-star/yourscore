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
  Card, SectionLabel, Crest, INK, MUTED, PANEL_2, LINE, TEAL, LIME, GOLD,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";
import { OwnedBadge } from "@/components/fantasy/OwnedBadge";

/** The one new accent the plan allows — Scout's Gamble. */
const PURPLE = "#a78bfa";

/** Local copy: shared.tsx is a "use client" module, so its exported tint() is a
 *  client reference that isn't callable from this server component. The colour
 *  string constants serialize fine; a function does not. */
const tint = (hex: string, a = "1e") => `${hex}${a}`;

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

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="font-display tracking-widest" style={{
      fontSize: 10.5, fontWeight: 700, color, letterSpacing: "0.1em",
    }}>{text}</span>
  );
}

function Chip({ text, color = MUTED }: { text: string; color?: string }) {
  return (
    <span className="font-body rounded-md whitespace-nowrap" style={{
      fontSize: 10.5, fontWeight: 600, padding: "2px 7px",
      color, background: PANEL_2, border: `1px solid ${color === MUTED ? LINE : tint(color, "44")}`,
    }}>{text}</span>
  );
}

function fixtureLabel(fx: ResolvedScoutPick["fixture"]): string | null {
  if (!fx.length) return null;
  return fx.map((f) => `${f.home ? "vs" : "@"} ${f.opponent}`).join(" · ");
}

function PickCard({ pick }: { pick: ResolvedScoutPick }) {
  const meta = CATEGORY[pick.category];
  const price = (pick.player.priceTenths / 10).toFixed(1);
  const fx = fixtureLabel(pick.fixture);
  const cold = pick.signal === "fpl_ep_next_cold_start";
  const showOwnership = (pick.category === "value" || pick.category === "gamble")
    && pick.facts.ownershipPercent != null;

  return (
    <Link href={`/fantasy/scout/picks/${pick.category}`} style={{ textDecoration: "none" }}>
      <Card style={{ padding: 13, borderColor: tint(meta.color, "33") }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Badge text={meta.label} color={meta.color} />
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {pick.isBackup && <Chip text="Backup pick" color={MUTED} />}
            {cold && <Chip text="FPL projection" color={MUTED} />}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 10 }}>
          <PlayerAvatar name={pick.player.name} avatarUrl={faceFor(pick.player.name)} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="font-body" style={{ color: INK, fontSize: 15, fontWeight: 700, lineHeight: 1.15 }}>
              {pick.player.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
              <Crest club={pick.player.club} size={13} />
              <span className="font-body" style={{ color: MUTED, fontSize: 12 }}>
                {pick.player.club} · {pick.player.pos}
              </span>
            </div>
          </div>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <span className="font-body" style={{ color: INK, fontSize: 14, fontWeight: 700 }}>£{price}m</span>
            <OwnedBadge playerId={pick.player.id} />
          </span>
        </div>

        {(fx || showOwnership) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {fx && <Chip text={fx} color={MUTED} />}
            {showOwnership && (
              <Chip text={`${pick.facts.ownershipPercent!.toFixed(1)}% (FPL ownership)`} color={MUTED} />
            )}
          </div>
        )}

        <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 5 }}>
          {pick.reasons.map((r, i) => (
            <li key={i} className="font-body" style={{ color: INK, fontSize: 13, lineHeight: 1.4, display: "flex", gap: 7 }}>
              <span style={{ color: meta.color, flexShrink: 0 }}>›</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>

        {pick.risk && (
          <div className="font-body" style={{
            color: MUTED, fontSize: 12.5, lineHeight: 1.4, marginTop: 8,
            paddingTop: 8, borderTop: `1px solid ${LINE}`,
          }}>
            <span style={{ color: PURPLE, fontWeight: 700 }}>The risk: </span>{pick.risk}
          </div>
        )}
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
  if (!picks.length) return null; // nothing published — render nothing, don't clutter

  const sorted = [...picks].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <SectionLabel>SCOUT&rsquo;S FOUR PICKS</SectionLabel>
      {sorted.map((p) => <PickCard key={p.category} pick={p} />)}
    </section>
  );
}
