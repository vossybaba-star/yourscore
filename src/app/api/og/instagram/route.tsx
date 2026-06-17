/**
 * /api/og/instagram — the YourScore Instagram post generator.
 *
 * One route renders every on-brand feed/story post. Pick a preset, a size, and
 * (optionally) override any line of copy via query params. Built on the same
 * next/og brand system as the live share cards (see src/lib/og/igBrand.tsx), so
 * the output is on-brand by construction and never carries an "AI image" look.
 *
 *   ?template=wc|380|quiz|rank|league|stat   (preset, default wc)
 *   ?size=square|portrait|story              (default portrait — biggest feed footprint)
 *   ?badge=…  &supra=…  &hero=…  &sub=…       (override copy; wrap one {token} in
 *                                              `hero` to colour it with the accent)
 *   ?p1=…&p2=…&p3=…                           (the three support pills)
 *   ?cta=…  &url=…                            (footer button + handle)
 *   ?accent=green|gold  &backdrop=trophy|pitch|grid|none
 *
 * Example: /api/og/instagram?template=wc&size=story
 *          /api/og/instagram?template=stat&hero=0.3%25&sub=of teams ever built go 38-0.
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import {
  IG_DIMENSIONS,
  PostFrame,
  Hero,
  Pill,
  BRAND,
  type Accent,
  type Backdrop,
  type IgSize,
} from "@/lib/og/igBrand";

export const runtime = "edge";

type Preset = {
  accent: Accent;
  backdrop: Backdrop;
  badge: string;
  supra?: string;
  hero: string; // wrap one {token} to accent-colour it
  sub: string;
  pills: string[];
  cta: string;
  url: string;
};

// Presets are grounded in YOURSCORE.md — real games, real taglines, real CTAs.
const PRESETS: Record<string, Preset> = {
  // World Cup Mastermind — the launch hook (gold + trophy).
  wc: {
    accent: "gold",
    backdrop: "trophy",
    badge: "World Cup 2026",
    supra: "Daily ranked run",
    hero: "WORLD CUP {MASTERMIND}",
    sub: "One quiz-gated go a day. Answer right, draft a stronger World XI, top the season board.",
    pills: ["Quiz-gated picks", "£25 daily giveaway", "One go a day"],
    cta: "Play today’s run →",
    url: "yourscore.app/38-0/wc",
  },
  // 38-0 — the flagship team-builder (green + pitch).
  "380": {
    accent: "green",
    backdrop: "pitch",
    badge: "The flagship",
    supra: "Build an unbeaten season",
    hero: "GO {38-0}",
    sub: "Spin a squad of all-time legends, draft your best XI, then prove it’s the best — head-to-head.",
    pills: ["20 yrs of legends", "1v1 head-to-head", "Your own leagues"],
    cta: "Build your XI →",
    url: "yourscore.app/38-0",
  },
  // Quiz — the knowledge game (green + grid).
  quiz: {
    accent: "green",
    backdrop: "grid",
    badge: "Football knowledge",
    hero: "Your football knowledge. {Ranked.}",
    sub: "Speed-scored quizzes. Play solo, build packs, or settle it in a multiplayer lobby.",
    pills: ["Speed scored", "Multiplayer lobbies", "Solo challenges"],
    cta: "Take the quiz →",
    url: "yourscore.app/play",
  },
  // YourScore Rank — the cross-game leaderboard (gold + grid).
  rank: {
    accent: "gold",
    backdrop: "grid",
    badge: "YourScore Rank",
    supra: "Both games. One table.",
    hero: "Where do you {rank?}",
    sub: "Knowledge points + match points, combined into one ladder. There’s only one #1.",
    pills: ["#1 is the goal", "Top 50 · Diamond", "Top 1000 · Gold"],
    cta: "Find your rank →",
    url: "yourscore.app/leaderboard",
  },
  // Leagues — the social loop (green + pitch).
  league: {
    accent: "green",
    backdrop: "pitch",
    badge: "Leagues",
    supra: "For the group chat",
    hero: "Start a {league} with your mates.",
    sub: "Compile your group’s results and settle it over a whole season — not one lucky game.",
    pills: ["Join by code", "Live board", "Season-long"],
    cta: "Start a league →",
    url: "yourscore.app/leagues",
  },
  // Pure information-first archetype: the number IS the post.
  stat: {
    accent: "gold",
    backdrop: "trophy",
    badge: "Can you?",
    supra: "Only",
    hero: "{0.3%}",
    sub: "of all teams ever built go a full season unbeaten. Think yours can?",
    pills: ["Real FIFA ratings", "Server-verified", "Real results only"],
    cta: "Try to go 38-0 →",
    url: "yourscore.app/38-0",
  },
};

function pick(q: URLSearchParams, key: string, fallback: string): string {
  const v = q.get(key);
  return v != null && v !== "" ? v : fallback;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  const preset = PRESETS[q.get("template") ?? "wc"] ?? PRESETS.wc;
  const size = (["square", "portrait", "story"].includes(q.get("size") ?? "")
    ? q.get("size")
    : "portrait") as IgSize;
  const accent = (q.get("accent") === "green" || q.get("accent") === "gold"
    ? q.get("accent")
    : preset.accent) as Accent;
  const backdrop = (["trophy", "pitch", "grid", "none"].includes(q.get("backdrop") ?? "")
    ? q.get("backdrop")
    : preset.backdrop) as Backdrop;

  const badge = pick(q, "badge", preset.badge);
  const supra = pick(q, "supra", preset.supra ?? "");
  const hero = pick(q, "hero", preset.hero);
  const sub = pick(q, "sub", preset.sub);
  const cta = pick(q, "cta", preset.cta);
  const url = pick(q, "url", preset.url);
  const pills = [
    pick(q, "p1", preset.pills[0] ?? ""),
    pick(q, "p2", preset.pills[1] ?? ""),
    pick(q, "p3", preset.pills[2] ?? ""),
  ].filter(Boolean);

  const { w, h } = IG_DIMENSIONS[size];
  const pad = size === "story" ? 96 : 80;
  const contentWidth = w - 2 * pad;
  // The hero stays the dominant element; cap scales with canvas height.
  const heroMax = size === "story" ? 220 : size === "portrait" ? 208 : 192;
  const subSize = size === "square" ? 38 : 42;
  const subMax = Math.round(w * 0.82);

  return new ImageResponse(
    (
      <PostFrame size={size} accent={accent} backdrop={backdrop} badge={badge} cta={cta} url={url}>
        {supra ? (
          <span style={{ display: "flex", color: BRAND.muted, fontSize: 34, fontWeight: 800, letterSpacing: 3 }}>
            {supra.toUpperCase()}
          </span>
        ) : (
          <span style={{ display: "flex" }} />
        )}

        <Hero hero={hero} accent={accent} max={heroMax} contentWidth={contentWidth} />

        {sub ? (
          <span
            style={{
              display: "flex",
              color: BRAND.text,
              fontSize: subSize,
              fontWeight: 600,
              lineHeight: 1.3,
              maxWidth: subMax,
              textAlign: "center",
            }}
          >
            {sub}
          </span>
        ) : (
          <span style={{ display: "flex" }} />
        )}

        {pills.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center", marginTop: 8 }}>
            {pills.map((p, i) => (
              <Pill key={i} accent={accent}>{p}</Pill>
            ))}
          </div>
        ) : (
          <span style={{ display: "flex" }} />
        )}
      </PostFrame>
    ),
    {
      width: w,
      height: h,
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    }
  );
}
