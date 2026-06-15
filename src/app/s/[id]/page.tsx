/**
 * /s/[id] — public scorecard for a shared 38-0 season result.
 *
 * Shows the full season record, squad XI, awards, and GF/GA so visitors
 * can see exactly which players were used and debate the outcome.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createDraftDb } from "@/lib/draft/server";

export const runtime = "nodejs";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

interface SquadPlayer { position: string; name: string; ovr: number; }

function parseXi(xi: string): SquadPlayer[] {
  return xi.split("|").map((chunk) => {
    const [position, name, ovrStr] = chunk.split("~");
    return { position: position ?? "", name: name ?? "", ovr: parseInt(ovrStr ?? "0", 10) };
  }).filter((p) => p.name);
}

function parseAward(s: string): string[] { return (s || "").split("~"); }

function positionOrder(pos: string): number {
  const order: Record<string, number> = {
    GK: 0,
    LB: 1, CB: 2, RB: 3,
    LWB: 1, CDM: 4, RWB: 3,
    LM: 5, CM: 6, RM: 7, CAM: 8,
    LW: 9, ST: 10, CF: 10, RW: 11,
    SS: 10,
  };
  return order[pos] ?? 50;
}

function ovrColor(ovr: number): string {
  if (ovr >= 90) return "#ffd700";
  if (ovr >= 85) return "#aeea00";
  if (ovr >= 80) return "#aeea00";
  if (ovr >= 75) return "#ffb800";
  return "#aeea00";
}

async function loadPayload(id: string): Promise<Record<string, string> | null> {
  try {
    const db = createDraftDb();
    const { data } = await db.from("draft_shares").select("payload").eq("id", id).maybeSingle();
    const p = data?.payload as Record<string, string> | undefined;
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

function ogUrl(id: string): string {
  return `${BASE}/api/draft/season-og?id=${encodeURIComponent(id)}&wide=1`;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const p = await loadPayload(params.id);
  if (!p) {
    const title = "YourScore 38-0 — build your all-time XI";
    return { title, description: "Build an all-time XI and simulate your season. Think you can beat it?" };
  }
  const pos = parseInt(p.pos || "10", 10);
  const title = `${p.w ?? 0}-${p.d ?? 0}-${p.l ?? 0} · finished ${ordinal(pos)} on ${p.pts ?? 0} pts | YourScore 38-0`;
  const description = p.xi
    ? `${p.xi.split("|").slice(0, 3).map(c => c.split("~")[1]).join(", ")} and more — build your own XI and take them on.`
    : "Build an all-time XI and simulate your season on YourScore. Think you can beat it?";
  const image = ogUrl(params.id);
  return {
    title, description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SeasonShortSharePage({ params }: { params: { id: string } }) {
  const p = await loadPayload(params.id);

  // Live H2H match link — redirect to the match page which has its own OG tags.
  if (p?.matchId) redirect(`/38-0/match/${p.matchId}`);

  // Quiz challenge share link — redirect to the challenge page.
  if (p?.challengeSlug) redirect(`/challenges/${p.challengeSlug}`);

  if (!p) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-body" style={{ fontSize: 13, color: "#8a948f", letterSpacing: 1 }}>38-0 · YOURSCORE</div>
          <div className="font-display tracking-wide mt-3" style={{ fontSize: 28, color: "#fff" }}>This link has expired</div>
          <Link href="/38-0" className="inline-block mt-6 rounded-2xl px-6 py-4 font-display tracking-wide" style={{ background: "#aeea00", color: "#062013", fontSize: 24 }}>
            BUILD YOUR OWN XI →
          </Link>
        </div>
      </div>
    );
  }

  const pos = parseInt(p.pos || "10", 10);
  const pts = p.pts || "0";
  const w = p.w || "0", d = p.d || "0", l = p.l || "0";
  const gf = p.gf || null;
  const ga = p.ga || null;
  const verdict = p.verdict || null;
  const formation = p.form || null;
  const mode = p.mode || "Normal";
  const ovr = p.ovr ? parseInt(p.ovr, 10) : null;
  const isInvincible = p.inv === "1";

  const accent = isInvincible ? "#ffd700" : pos === 1 ? "#aeea00" : pos <= 4 ? "#aeea00" : pos <= 12 ? "#ffb800" : "#ff4757";
  const verdictColor = verdict === "OVERPERFORMED" ? "#aeea00" : verdict === "UNDERPERFORMED" ? "#ff4757" : "#8a948f";

  // Parse squad
  const squad = p.xi ? parseXi(p.xi).sort((a, b) => positionOrder(a.position) - positionOrder(b.position)) : [];

  // Parse awards
  const [bootName, bootGoals] = parseAward(p.boot || "");
  const [potsName, potsGoals, potsAssists] = parseAward(p.pots || "");
  const [playName, playAssists] = parseAward(p.play || "");
  const [glovName, glovSheets] = parseAward(p.glov || "");

  const awards = [
    bootName ? { icon: "👟", label: "Golden Boot", name: bootName, stat: `${bootGoals} goals` } : null,
    potsName ? { icon: "⭐", label: "Player of the Season", name: potsName, stat: `${potsGoals}G ${potsAssists}A` } : null,
    playName ? { icon: "🅰️", label: "Playmaker", name: playName, stat: `${playAssists} assists` } : null,
    glovName ? { icon: "🧤", label: "Golden Glove", name: glovName, stat: `${glovSheets} clean sheets` } : null,
  ].filter(Boolean) as { icon: string; label: string; name: string; stat: string }[];

  return (
    <div className="min-h-[100dvh] pb-10" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-10">

        {/* Brand header */}
        <div className="flex items-center justify-between mb-6">
          <div className="font-body text-xs tracking-widest" style={{ color: "#586058" }}>38-0 · YOURSCORE</div>
          <div className="font-body text-xs px-3 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "#8a948f" }}>
            {mode} Mode{ovr ? ` · STR ${ovr}` : ""}
          </div>
        </div>

        {/* Season record hero */}
        <div className="rounded-3xl p-5 mb-4" style={{ background: "#0e1611", border: `1px solid ${accent}30` }}>
          {isInvincible && (
            <div className="text-center mb-3">
              <span className="font-display text-xs tracking-widest px-3 py-1 rounded-full" style={{ background: "rgba(255,215,0,0.15)", color: "#ffd700", border: "1px solid rgba(255,215,0,0.4)" }}>
                🏆 INVINCIBLE
              </span>
            </div>
          )}

          <div className="text-center">
            <div className="font-display tracking-wide leading-none" style={{ fontSize: 56, color: "#fff" }}>{w}–{d}–{l}</div>
            <div className="font-body mt-1 mb-3" style={{ fontSize: 11, color: "#586058", letterSpacing: 3 }}>WON · DRAWN · LOST</div>

            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="font-body px-3 py-1.5 rounded-xl text-sm font-semibold" style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}40` }}>
                {ordinal(pos)} place
              </span>
              <span className="font-body px-3 py-1.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "#fff" }}>
                {pts} pts
              </span>
              {gf && ga && (
                <span className="font-body px-3 py-1.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "#8a948f" }}>
                  {gf} — {ga}
                </span>
              )}
              {verdict && (
                <span className="font-body px-3 py-1.5 rounded-xl text-xs font-semibold tracking-wide" style={{ background: `${verdictColor}15`, color: verdictColor, border: `1px solid ${verdictColor}30` }}>
                  {verdict}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Squad section */}
        {squad.length > 0 && (
          <div className="rounded-3xl p-5 mb-4" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-display text-sm text-white tracking-wide">THE XI</p>
              {formation && (
                <span className="font-body text-xs px-2.5 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.06)", color: "#8a948f" }}>
                  {formation}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {squad.map((player, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  {/* Position chip */}
                  <div className="flex-shrink-0 flex items-center justify-center rounded-lg font-display text-xs"
                    style={{ width: 38, height: 28, background: "rgba(255,255,255,0.07)", color: "#8a948f", fontSize: 10, letterSpacing: 1 }}>
                    {player.position}
                  </div>

                  {/* Name */}
                  <span className="flex-1 font-body text-sm text-white truncate">{player.name}</span>

                  {/* OVR badge */}
                  <span className="font-display text-sm font-bold flex-shrink-0" style={{ color: ovrColor(player.ovr) }}>
                    {player.ovr}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Awards section */}
        {awards.length > 0 && (
          <div className="rounded-3xl p-5 mb-4" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="font-display text-sm text-white tracking-wide mb-4">SEASON AWARDS</p>
            <div className="space-y-2">
              {awards.map((award, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <span className="text-lg flex-shrink-0">{award.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs" style={{ color: "#5b645e" }}>{award.label}</p>
                    <p className="font-body text-sm text-white font-semibold truncate">{award.name}</p>
                  </div>
                  <span className="font-display text-sm flex-shrink-0" style={{ color: "#ffb800" }}>{award.stat}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <Link href="/38-0"
          className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
          style={{ background: "#aeea00", color: "#062013", fontSize: 20 }}>
          BUILD YOUR OWN XI →
        </Link>

        <p className="text-center mt-4 font-body text-xs" style={{ color: "#3a423d" }}>
          yourscore.app · Your football knowledge. Ranked.
        </p>

      </div>
    </div>
  );
}
