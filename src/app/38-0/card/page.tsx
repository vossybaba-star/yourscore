/**
 * /38-0/card — public unfurl page for a shared quick-match result.
 *
 * Anonymous quick matches live only in the player's localStorage, so there's no
 * server record to link to. Instead the in-app Share button encodes the finished
 * match into the query string (the same params /api/draft/live-og takes — built by
 * liveOgQuery), and this page renders the premium scorecard from those params, so a
 * follower who opens the shared link lands on the real card (not a flat image). The
 * og:image still points at the landscape stat panel so the in-feed preview shows the
 * scoreline + stats. Then a clear CTA into 38-0.
 *
 * No DB, no auth — purely the params it's given, so it works for guests. The card
 * shows the scoreboard, stats and player of the match; line-ups + goal minutes
 * aren't carried in the share URL, so those sections are simply omitted here.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ScorecardView, type ScorecardData, type ScorecardStat } from "@/components/draft/Scorecard";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Re-serialise the incoming params (single-valued) for the live-og image URL. */
function ogQuery(sp: SP): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const s = one(v); if (s != null) q.set(k, s); }
  return q.toString();
}

export function generateMetadata({ searchParams }: { searchParams: SP }): Metadata {
  const image = `${BASE}/api/draft/live-og?${ogQuery(searchParams)}`;
  const p1 = one(searchParams.p1) ?? "Your XI";
  const p2 = one(searchParams.p2) ?? "Opponent";
  const s1 = one(searchParams.s1) ?? "0";
  const s2 = one(searchParams.s2) ?? "0";
  const potm = one(searchParams.potm);
  const title = `${p1} ${s1}–${s2} ${p2} — Draft XI`;
  const description = potm
    ? `Star of the match: ${potm}. Build your all-time Premier League XI and take them on — no sign-up to play.`
    : "Build your all-time Premier League XI and take them on — no sign-up to play.";
  return {
    title, description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** "55-45" → [55, 45]; returns null if absent/malformed. */
function pair(v: string | undefined): [number, number] | null {
  if (!v) return null;
  const [a, b] = v.split("-").map((n) => parseInt(n, 10));
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

export default function CardPage({ searchParams }: { searchParams: SP }) {
  const p1 = one(searchParams.p1) ?? "You";
  const p2 = one(searchParams.p2) ?? "Opponent";
  const s1 = parseInt(one(searchParams.s1) ?? "0", 10) || 0;
  const s2 = parseInt(one(searchParams.s2) ?? "0", 10) || 0;
  const str1 = one(searchParams.str1), str2 = one(searchParams.str2);
  const pens = pair(one(searchParams.pens));
  const potm = one(searchParams.potm), potmR = one(searchParams.potmR);

  const youWon = pens ? pens[0] > pens[1] : s1 > s2;
  const oppWon = pens ? pens[1] > pens[0] : s2 > s1;
  const outcome: ScorecardData["outcome"] = youWon ? "you" : oppWon ? "opp" : "draw";

  const statSpec: [string, string, string?][] = [
    ["Possession", "pos", "%"], ["Shots", "sh"], ["On target", "sot"],
    ["Corners", "cor"], ["Fouls", "fo"], ["Offsides", "off"], ["Throw-ins", "thr"],
  ];
  const stats: ScorecardStat[] = [];
  for (const [label, key, suffix] of statSpec) {
    const p = pair(one(searchParams[key]));
    if (p) stats.push(suffix ? { label, a: p[0], b: p[1], suffix } : { label, a: p[0], b: p[1] });
  }

  const data: ScorecardData = {
    context: one(searchParams.ctx) ?? "Quick Match",
    you: { name: p1, strength: str1 ? Number(str1) : undefined },
    opp: { name: p2, strength: str2 ? Number(str2) : undefined },
    goals: { you: s1, opp: s2 },
    pens: pens ? { you: pens[0], opp: pens[1] } : null,
    outcome,
    stats,
    potm: potm ? { name: potm, rating: potmR ? Number(potmR) : 0, mine: false } : null,
  };

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />
      <div className="relative mx-auto max-w-lg px-4 pt-safe">
        <div className="py-3">
          <Link href="/38-0" className="font-mono text-sm uppercase" style={{ color: "#8a948f", letterSpacing: "0.1em" }}>← 38-0</Link>
        </div>

        <ScorecardView data={data} />

        <div className="mt-6">
          <Link href="/38-0" className="block w-full rounded-[20px] py-4 text-center font-display tracking-wide transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98]"
            style={{ background: "#aeea00", color: "#062013", fontSize: 26 }}>
            BUILD YOUR OWN XI →
          </Link>
          <p className="mt-2 text-center font-body" style={{ fontSize: 12, color: "#8a948f" }}>
            Draft your all-time Premier League XI and take them on head-to-head. No sign-up to play.
          </p>
        </div>
      </div>
    </div>
  );
}
