/**
 * /38-0/card — public unfurl page for a shared quick-match result.
 *
 * Anonymous quick matches live only in the player's localStorage, so there's no
 * server record to link to. Instead the in-app Share button encodes the finished
 * match into the query string (the same params /api/draft/live-og takes — built
 * by liveOgQuery), and this page turns that into a rich Twitter/social card: its
 * og:image is the landscape stat panel, so a follower who opens the tweet sees the
 * full scoreline + head-to-head stats without playing. Then a clear CTA into 38-0.
 *
 * No DB, no auth — purely the params it's given, so it works for guests.
 */

import type { Metadata } from "next";
import Link from "next/link";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

type SP = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Re-serialise the incoming params (single-valued) for the live-og image URL. */
function ogQuery(sp: SP): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = one(v);
    if (s != null) q.set(k, s);
  }
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
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function CardPage({ searchParams }: { searchParams: SP }) {
  const image = `${BASE}/api/draft/live-og?${ogQuery(searchParams)}`;
  const p1 = one(searchParams.p1) ?? "Your XI";
  const p2 = one(searchParams.p2) ?? "Opponent";
  const s1 = one(searchParams.s1) ?? "0";
  const s2 = one(searchParams.s2) ?? "0";

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="mx-auto max-w-2xl px-5 pt-safe">
        <div className="flex items-center justify-between py-4">
          <span className="font-display" style={{ fontSize: 18, letterSpacing: "0.05em" }}>
            <span style={{ color: "#fff" }}>YOUR</span><span style={{ color: "#00ff87" }}>SCORE</span>
            <span style={{ color: "#8888aa", marginLeft: 8, fontSize: 14 }}>· 38-0</span>
          </span>
          <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#5a5a78" }}>Full time</span>
        </div>

        {/* the shared stat card itself, so a visitor sees exactly what unfurled */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={`${p1} ${s1}–${s2} ${p2} — full-time stats`}
          width={1200}
          height={630}
          className="w-full rounded-2xl"
          style={{ border: "1px solid rgba(255,255,255,0.08)" }}
        />

        <div className="mt-7">
          <Link href="/38-0" className="block w-full rounded-2xl py-4 text-center font-display tracking-wide transition-transform active:scale-[0.98]"
            style={{ background: "#00ff87", color: "#062013", fontSize: 26 }}>
            BUILD YOUR OWN XI →
          </Link>
          <p className="mt-2 text-center font-body" style={{ fontSize: 12, color: "#8888aa" }}>
            Draft your all-time Premier League XI and take them on head-to-head. No sign-up to play.
          </p>
        </div>
      </div>
    </div>
  );
}
