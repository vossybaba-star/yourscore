/**
 * Scout's Four Picks — Pick Detail (Stage 4).
 *
 * A published pick, expanded: Overview / Fixtures / Why this pick. Same Scout
 * chrome as the rest of the hub. Facts only — the reasons are the grounded
 * lines the Scout wrote; nothing here tells you to transfer anyone in.
 */
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  loadPublishedScoutPicks, SCOUT_CATEGORIES, type ResolvedScoutPick, type ScoutCategory, type Db,
} from "@/lib/fantasy/scoutPicks";
import { FantasyMasthead, column, shell, MUTED } from "@/components/fantasy/newsUi";
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { ScoutCover } from "@/components/fantasy/ScoutCover";
import { BottomNav } from "@/components/ui/BottomNav";
import {
  Card, SectionLabel, Crest, INK, PANEL_2, LINE, TEAL, LIME, GOLD,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";

export const revalidate = 300;

const PURPLE = "#a78bfa";
const CATEGORY: Record<ScoutCategory, { label: string; color: string }> = {
  safe: { label: "SAFE PICK", color: TEAL },
  form: { label: "FORM PICK", color: LIME },
  value: { label: "VALUE PICK", color: GOLD },
  gamble: { label: "SCOUT'S GAMBLE", color: PURPLE },
};

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${LINE}` }}>
      <span className="font-body" style={{ color: MUTED, fontSize: 13 }}>{label}</span>
      <span className="font-body" style={{ color: INK, fontSize: 13, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default async function PickDetail({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!SCOUT_CATEGORIES.includes(category as ScoutCategory)) notFound();
  const cat = category as ScoutCategory;
  const meta = CATEGORY[cat];

  let pick: ResolvedScoutPick | undefined;
  try {
    pick = (await loadPublishedScoutPicks(serviceClient())).find((p) => p.category === cat);
  } catch { /* fall through to the empty state */ }

  const cold = pick?.signal === "fpl_ep_next_cold_start";

  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead />
          <ScoutCover />
          <ScoutTabs active="/fantasy/news" />

          <div className="font-display tracking-widest" style={{ fontSize: 11, color: meta.color, letterSpacing: "0.12em", marginTop: 4 }}>
            {meta.label}
          </div>

          {!pick ? (
            <Card style={{ padding: 16, marginTop: 10 }}>
              <div className="font-display tracking-widest" style={{ color: INK, fontSize: 13, marginBottom: 6 }}>
                THIS PICK ISN&rsquo;T LIVE YET
              </div>
              <p className="font-body" style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                The Scout&rsquo;s selection for this slot hasn&rsquo;t been published for the current gameweek.
              </p>
            </Card>
          ) : (
            <>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                <PlayerAvatar name={pick.player.name} avatarUrl={faceFor(pick.player.name)} size={52} />
                <div style={{ minWidth: 0 }}>
                  <div className="font-body" style={{ color: INK, fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>
                    {pick.player.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Crest club={pick.player.club} size={15} />
                    <span className="font-body" style={{ color: MUTED, fontSize: 13 }}>
                      {pick.player.club} · {pick.player.pos} · £{(pick.player.priceTenths / 10).toFixed(1)}m
                    </span>
                  </div>
                </div>
              </div>

              {cold && (
                <div className="font-body" style={{
                  fontSize: 11.5, color: MUTED, marginTop: 10, padding: "6px 10px",
                  background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 8,
                }}>
                  Pre-season: these numbers are FPL&rsquo;s own projection for the gameweek, not results yet played.
                </div>
              )}

              {/* Overview */}
              <div style={{ marginTop: 16 }}><SectionLabel>OVERVIEW</SectionLabel></div>
              <Card style={{ padding: "4px 14px", marginTop: 8 }}>
                <Row label="Price" value={`£${(pick.player.priceTenths / 10).toFixed(1)}m`} />
                <Row label="Availability" value={pick.facts.availability === "available" ? "Available" : pick.facts.availability} />
                {pick.facts.ownershipPercent != null && (
                  <Row label="FPL ownership" value={`${pick.facts.ownershipPercent.toFixed(1)}%`} />
                )}
                {pick.facts.seasonPointsPerAppearance != null && (
                  <Row label="Points per appearance" value={pick.facts.seasonPointsPerAppearance.toFixed(1)} />
                )}
                {pick.facts.recentFormPoints != null && (
                  <Row label={`Points, last ${pick.facts.formWindowGws} gameweeks`} value={String(pick.facts.recentFormPoints)} />
                )}
                {cold && pick.facts.fplProjection != null && (
                  <Row label="FPL projection (this gameweek)" value={pick.facts.fplProjection.toFixed(1)} />
                )}
              </Card>

              {/* Fixtures */}
              <div style={{ marginTop: 16 }}><SectionLabel>FIXTURES</SectionLabel></div>
              <Card style={{ padding: 14, marginTop: 8 }}>
                {pick.fixture.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {pick.fixture.map((f, i) => (
                      <span key={i} className="font-body rounded-md" style={{
                        fontSize: 12.5, fontWeight: 600, padding: "5px 10px",
                        color: INK, background: PANEL_2, border: `1px solid ${LINE}`,
                      }}>{f.home ? "vs" : "@"} {f.opponent}</span>
                    ))}
                  </div>
                ) : (
                  <span className="font-body" style={{ color: MUTED, fontSize: 13 }}>No fixture confirmed in range.</span>
                )}
              </Card>

              {/* Why this pick */}
              <div style={{ marginTop: 16 }}><SectionLabel>WHY THIS PICK</SectionLabel></div>
              <Card style={{ padding: 14, marginTop: 8 }}>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
                  {pick.reasons.map((r, i) => (
                    <li key={i} className="font-body" style={{ color: INK, fontSize: 13.5, lineHeight: 1.45, display: "flex", gap: 8 }}>
                      <span style={{ color: meta.color, flexShrink: 0 }}>›</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
                {pick.risk && (
                  <div className="font-body" style={{
                    color: MUTED, fontSize: 13, lineHeight: 1.45, marginTop: 10,
                    paddingTop: 10, borderTop: `1px solid ${LINE}`,
                  }}>
                    <span style={{ color: PURPLE, fontWeight: 700 }}>The risk: </span>{pick.risk}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
