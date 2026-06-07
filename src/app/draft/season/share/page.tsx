/**
 * /draft/season/share — public, server-rendered landing for a shared season result.
 * Stateless: the result is encoded in the query string (computed client-side), so
 * generateMetadata sets og:image → /api/draft/season-og and pasted links unfurl as
 * the broadcast graphic. A clean CTA invites the viewer to build their own XI.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const runtime = "edge";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ogUrl(sp: SP): string {
  const keys = ["pos", "pts", "w", "d", "l", "gf", "ga", "head", "verdict", "boot", "inv", "formation"];
  const params = new URLSearchParams();
  for (const k of keys) { const v = one(sp[k]); if (v) params.set(k, v); }
  return `${BASE}/api/draft/season-og?${params.toString()}`;
}

export function generateMetadata({ searchParams }: { searchParams: SP }): Metadata {
  const head = one(searchParams.head) || "Season simulated";
  const pos = parseInt(one(searchParams.pos) || "10", 10);
  const pts = one(searchParams.pts) || "0";
  const title = `${head} — finished ${ordinal(pos)} on ${pts} pts | Draft XI`;
  const description = "Built an all-time Premier League XI and simulated the season. Can you do better?";
  const image = ogUrl(searchParams);
  return {
    title, description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function SeasonSharePage({ searchParams }: { searchParams: SP }) {
  const head = one(searchParams.head) || "SEASON SIMULATED";
  const pos = parseInt(one(searchParams.pos) || "10", 10);
  const pts = one(searchParams.pts) || "0";
  const w = one(searchParams.w), d = one(searchParams.d), l = one(searchParams.l);
  const accent = one(searchParams.inv) === "1" ? "#ffd700" : pos === 1 ? "#00ff87" : pos <= 4 ? "#22d3ee" : pos <= 12 ? "#ffb800" : "#ff4757";

  return (
    <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
      <div>
        <div className="font-body" style={{ fontSize: 13, color: "#8888aa", letterSpacing: 1 }}>YOURSCORE · DRAFT XI</div>
        <div className="font-display tracking-wide leading-none mt-3" style={{ fontSize: 44, color: accent }}>{head}</div>
        <div className="font-body mt-3" style={{ fontSize: 18, color: "#fff" }}>
          Finished <b style={{ color: accent }}>{ordinal(pos)}</b> on <b>{pts}</b> pts
          {w && d && l ? ` · ${w}W ${d}D ${l}L` : ""}
        </div>
        <Link href="/draft" className="inline-block mt-6 rounded-2xl px-6 py-4 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
          BUILD YOUR OWN XI →
        </Link>
      </div>
    </div>
  );
}
