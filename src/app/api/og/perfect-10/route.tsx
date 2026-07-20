/**
 * /api/og/perfect-10 — the Perfect 10 link-preview card (1200x630).
 *
 * Perfect 10's whole identity is the floodlit tapering tower, so the card IS
 * the tower: ten rungs, narrowing to the top, gold where the player named the
 * answer and dark where they didn't. That reads instantly in a timeline and is
 * unmistakably this game — the generic YourScore card it replaced said nothing
 * about Perfect 10 at all.
 *
 * NO ANSWERS ON THE CARD. The rungs are lit/unlit only — never surnames. A
 * result post must not spoil the list for whoever taps it (same rule the tweet
 * text follows), and the OG image is public and uncacheable-by-us once posted.
 *
 * Modes:
 *   ?c=<share_token>  → SCORECARD: that attempt's tower + score + verdict.
 *   ?list=<uuid>      → PROMO for a specific list (guests share this).
 *   (no params)       → PROMO for the latest served list.
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const GOLD = "#ffc400";
const TOTAL_RUNGS = 10;

type Card = { title: string; found: number[] | null; score: number; won: boolean };

// p10_* tables are RLS deny-all, so this reads with the service role. Only the
// list TITLE and the attempt's score/filled-ranks ever leave this function —
// p10_lists.entries (the answers) is never selected.
async function db(pathAndQuery: string): Promise<unknown[] | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as unknown[];
}

// Guests have no p10_attempts row (localStorage-only by design), so there is no
// share token to resolve — their result travels in the link itself as
// &s=<score>&f=<filled ranks>. These params are self-reported and forgeable;
// that is acceptable because nothing is scored, ranked or awarded off this
// image. A token-backed card (?c=) is the verified one and always wins.
function fromParams(score: string | null, found: string | null): { found: number[]; score: number } | null {
  if (score == null || found == null) return null;
  const s = Number(score);
  if (!Number.isFinite(s) || s < 0 || s > 1000) return null;
  const ranks = found
    .split(",")
    .map((r) => Number(r))
    .filter((r) => Number.isInteger(r) && r >= 1 && r <= TOTAL_RUNGS);
  return { found: Array.from(new Set(ranks)), score: Math.round(s) };
}

async function resolve(
  token: string | null,
  listId: string | null,
  self: { found: number[]; score: number } | null
): Promise<Card | null> {
  if (token) {
    const rows = (await db(
      `p10_attempts?select=found,score,list_id&share_token=eq.${encodeURIComponent(token)}&limit=1`
    )) as { found: { rank: number }[]; score: number; list_id: string }[] | null;
    const a = rows?.[0];
    if (!a) return null;
    const lists = (await db(`p10_lists?select=title&id=eq.${a.list_id}&limit=1`)) as { title: string }[] | null;
    const found = (a.found ?? []).map((f) => f.rank);
    return {
      title: lists?.[0]?.title ?? "Perfect 10",
      found,
      score: a.score ?? 0,
      won: found.length >= TOTAL_RUNGS,
    };
  }

  const q = listId
    ? `p10_lists?select=title&id=eq.${encodeURIComponent(listId)}&limit=1`
    : `p10_lists?select=title,day&status=in.(live,live-manual-verify)&order=day.desc&limit=1`;
  const lists = (await db(q)) as { title: string }[] | null;
  if (!lists?.[0]) return null;
  if (self) {
    return {
      title: lists[0].title,
      found: self.found,
      score: self.score,
      won: self.found.length >= TOTAL_RUNGS,
    };
  }
  return { title: lists[0].title, found: null, score: 0, won: false };
}

// The taper: rung 10 (bottom) is full width, rung 1 (top) is narrowest — the
// same ramp the in-game tower uses, so the card and the game look like one thing.
function rungWidth(rank: number): number {
  const t = (TOTAL_RUNGS - rank) / (TOTAL_RUNGS - 1); // 0 at rank 10 … 1 at rank 1
  return 470 - t * 210;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const self = fromParams(searchParams.get("s"), searchParams.get("f"));
  const card =
    (await resolve(searchParams.get("c"), searchParams.get("list"), self).catch(() => null)) ??
    ({ title: "Name the top 10", found: null, score: 0, won: false } as Card);

  const isResult = card.found !== null;
  const filled = new Set(card.found ?? []);
  const foundCount = card.found?.length ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          background: "linear-gradient(150deg, #16130a 0%, #0d0c07 55%, #0a0a0f 100%)",
          fontFamily: "sans-serif",
          position: "relative",
          padding: "40px 54px",
        }}
      >
        {/* floodlight wash behind the tower */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "1200px",
            height: "630px",
            display: "flex",
            background: "radial-gradient(60% 70% at 72% 8%, rgba(255,196,0,0.16) 0%, rgba(255,196,0,0) 60%)",
          }}
        />

        {/* ── left column: brand, topic, result ─────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", width: 590, height: "100%", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_DATA_URI} width={176} height={47} alt="YourScore" style={{ display: "flex" }} />
            <div style={{ display: "flex", padding: "8px 20px", borderRadius: 999, background: "rgba(255,196,0,0.14)", border: `1px solid ${GOLD}80` }}>
              <span style={{ display: "flex", color: GOLD, fontSize: 22, fontWeight: 800, letterSpacing: 3 }}>PERFECT 10</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", maxWidth: 570 }}>
              <span style={{ color: "#ffffff", fontSize: 40, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1 }}>{card.title}</span>
            </div>

            {isResult ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ display: "flex", color: card.won ? GOLD : "#9aa39d", fontSize: 27, fontWeight: 900, letterSpacing: 3 }}>
                  {card.won ? "PERFECT 10 🏆" : "TOWER FALLS"}
                </span>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
                  <span style={{ display: "flex", color: GOLD, fontSize: 88, fontWeight: 900, lineHeight: 0.9 }}>{card.score.toLocaleString()}</span>
                  <span style={{ display: "flex", color: "#9aa39d", fontSize: 26, fontWeight: 700, letterSpacing: 3, paddingBottom: 10 }}>PTS</span>
                </div>
                <div style={{ display: "flex", padding: "9px 22px", borderRadius: 999, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" }}>
                  <span style={{ display: "flex", color: "#c4ccc6", fontSize: 26, fontWeight: 700 }}>{foundCount}/10 named · 3 lives · 3 hints</span>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" }}>
                  <span style={{ display: "flex", color: "#c4ccc6", fontSize: 25, fontWeight: 700 }}>3 lives</span>
                </div>
                <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" }}>
                  <span style={{ display: "flex", color: "#c4ccc6", fontSize: 25, fontWeight: 700 }}>3 hints</span>
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", padding: "15px 32px", borderRadius: 999, background: GOLD, alignSelf: "flex-start" }}>
              <span style={{ display: "flex", color: "#0a0a0f", fontSize: 30, fontWeight: 900, letterSpacing: 1 }}>
                {isResult ? "BEAT MY TOWER →" : "CAN YOU NAME ALL 10? →"}
              </span>
            </div>
          </div>
        </div>

        {/* ── right column: the tower ───────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", gap: 6 }}>
          {Array.from({ length: TOTAL_RUNGS }, (_, i) => i + 1).map((rank) => {
            // Promo card: the tower is outlined in gold but every bar is EMPTY —
            // ten blanks waiting to be named. A fully-filled promo tower would
            // read as somebody's 10/10 result, which is the wrong invitation.
            const lit = isResult ? filled.has(rank) : true;
            const barFilled = isResult ? lit : false;
            return (
              <div
                key={rank}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: rungWidth(rank),
                  height: 40,
                  borderRadius: 9,
                  padding: "0 16px",
                  background: lit ? "rgba(255,196,0,0.17)" : "rgba(255,255,255,0.035)",
                  border: `1.5px solid ${lit ? GOLD : "rgba(255,255,255,0.09)"}`,
                  boxShadow: lit ? "0 0 26px rgba(255,196,0,0.18)" : "none",
                }}
              >
                <span style={{ display: "flex", color: lit ? GOLD : "#5c6360", fontSize: 21, fontWeight: 900, width: 34 }}>{rank}</span>
                {/* the name stays hidden — lit/unlit is the whole story */}
                <div
                  style={{
                    display: "flex",
                    flex: 1,
                    height: 8,
                    borderRadius: 4,
                    background: barFilled ? "rgba(255,196,0,0.42)" : "rgba(255,255,255,0.07)",
                  }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 9, display: "flex", background: GOLD }} />
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
