/**
 * /api/og/quiz — per-quiz social link-preview image (1200x630).
 *
 * When a quiz link (e.g. /challenges/opening-day-chaos-world-cup-2026-kicks-off)
 * is shared on X/Twitter, WhatsApp, etc., this is the card that unfurls: the
 * YourScore wordmark, the quiz's icon + title, the question count, and a clear
 * "TAKE THE QUIZ" hook. The goal is to pull a scroller straight from the tweet
 * into the game — play, then sign up to save the score on the leaderboard.
 *
 * Referenced from the per-quiz metadata in src/app/challenges/[slug]/layout.tsx.
 * Query: ?slug=<pack-slug>  (or ?pid=<pack-id> for direct-by-id custom packs)
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";
import { slugify } from "@/lib/utils";

export const runtime = "edge";

const GREEN = "#aeea00";
const PURPLE = "#aeea00";

type PackLite = {
  name: string;
  type: string;
  question_count: number;
  metadata: { icon?: string } | null;
};

// Resolve a published pack by slug (slugify(name) match) or by id, using the
// Supabase REST endpoint with the public anon key (edge-safe, read-only).
async function resolvePack(slug: string | null, pid: string | null): Promise<PackLite | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const cols = "select=name,type,question_count,metadata";

  if (pid) {
    const res = await fetch(`${base}/rest/v1/quiz_packs?${cols}&status=eq.published&id=eq.${encodeURIComponent(pid)}`, { headers });
    if (!res.ok) return null;
    const rows = (await res.json()) as PackLite[];
    return rows?.[0] ?? null;
  }
  if (slug) {
    const res = await fetch(`${base}/rest/v1/quiz_packs?${cols}&status=eq.published`, { headers });
    if (!res.ok) return null;
    const rows = (await res.json()) as PackLite[];
    return rows.find((p) => slugify(p.name) === slug) ?? null;
  }
  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const pid = searchParams.get("pid");
  // Result share: when a score is present we render a SCORECARD (the player's score +
  // correct/total) rather than the "take the quiz" promo card.
  const scoreRaw = searchParams.get("score");
  const score = scoreRaw != null && scoreRaw !== "" ? Number(scoreRaw) : null;
  const correct = searchParams.get("correct");
  const total = searchParams.get("total");
  const hasScore = score != null && Number.isFinite(score);

  const pack = await resolvePack(slug, pid).catch(() => null);

  const name = pack?.name ?? "Football Quiz";
  const icon = pack?.metadata?.icon ?? "⚽";
  const qCount = pack?.question_count ?? 15;
  const isRecords = pack?.type === "records";
  const accent = isRecords ? PURPLE : GREEN;
  const accentDim = isRecords ? "rgba(174,234,0,0.16)" : "rgba(174,234,0,0.14)";
  const accentBorder = isRecords ? "rgba(174,234,0,0.5)" : "rgba(174,234,0,0.5)";
  const bg = isRecords
    ? "linear-gradient(150deg, #0a0a0f 0%, #0e1611 55%, #080d0a 100%)"
    : "linear-gradient(150deg, #0a0a0f 0%, #0b1a12 55%, #08130d 100%)";

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", alignItems: "center", background: bg, fontFamily: "sans-serif", position: "relative", padding: "64px 70px" }}>
        {/* top row: wordmark + badge */}
        <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={232} height={62} alt="YourScore" style={{ display: "flex" }} />
          <div style={{ display: "flex", padding: "9px 22px", borderRadius: 999, background: accentDim, border: `1px solid ${accentBorder}` }}>
            <span style={{ display: "flex", color: accent, fontSize: 24, fontWeight: 800, letterSpacing: 3 }}>{hasScore ? "QUIZ RESULT" : "DAILY QUIZ"}</span>
          </div>
        </div>

        {/* center block — spacing via `gap` (Satori honors gap reliably; it
            ignores marginTop on flex children in a centered column). */}
        {hasScore ? (
          // ── Scorecard: the player's result ──
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 96, maxWidth: 1010 }}>
              <span style={{ textAlign: "center", color: "#c4ccc6", fontSize: 40, fontWeight: 800, lineHeight: 1.05, letterSpacing: -0.5 }}>{name}</span>
            </div>
            <span style={{ display: "flex", color: accent, fontSize: 150, fontWeight: 900, lineHeight: 1 }}>{score!.toLocaleString()}</span>
            <span style={{ display: "flex", color: "#9aa39d", fontSize: 28, fontWeight: 700, letterSpacing: 4 }}>POINTS</span>
            {correct && total ? (
              <div style={{ display: "flex", marginTop: 6, padding: "10px 26px", borderRadius: 999, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" }}>
                <span style={{ display: "flex", color: "#c4ccc6", fontSize: 28, fontWeight: 700 }}>{correct}/{total} correct</span>
              </div>
            ) : null}
          </div>
        ) : (
          // ── Promo: take the quiz ──
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "center", gap: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 116, height: 116, borderRadius: 28, background: accentDim, border: `1.5px solid ${accentBorder}` }}>
              <span style={{ display: "flex", fontSize: 68 }}>{icon}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 126, maxWidth: 1010 }}>
              <span style={{ textAlign: "center", color: "#ffffff", fontSize: 52, fontWeight: 800, lineHeight: 1.07, letterSpacing: -1 }}>{name}</span>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <div style={{ display: "flex", padding: "10px 24px", borderRadius: 999, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" }}>
                <span style={{ display: "flex", color: "#c4ccc6", fontSize: 27, fontWeight: 700 }}>{qCount} questions</span>
              </div>
              <div style={{ display: "flex", padding: "10px 24px", borderRadius: 999, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" }}>
                <span style={{ display: "flex", color: "#c4ccc6", fontSize: 27, fontWeight: 700 }}>⚡ Speed scored</span>
              </div>
            </div>
          </div>
        )}

        {/* bottom: CTA + leaderboard hook */}
        <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "16px 34px", borderRadius: 999, background: accent }}>
            <span style={{ display: "flex", color: "#0a0a0f", fontSize: 32, fontWeight: 900, letterSpacing: 1 }}>{hasScore ? "BEAT MY SCORE →" : "TAKE THE QUIZ →"}</span>
          </div>
          <span style={{ display: "flex", color: "#9aa39d", fontSize: 26, fontWeight: 600 }}>Beat the leaderboard · yourscore.app</span>
        </div>

        {/* accent base line */}
        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      emoji: "twemoji",
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    }
  );
}
