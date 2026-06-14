/**
 * Per-quiz metadata for /challenges/[slug]. The quiz page itself is a client
 * component (it runs the game loop), so it can't export metadata — this server
 * layout supplies the og:image + Twitter card so a shared quiz link unfurls into
 * a rich, branded card on X/Twitter, WhatsApp, iMessage, etc.
 *
 * The image is rendered by /api/og/quiz?slug=<slug>. The copy is built to convert:
 * play the quiz from the tweet, then sign up to save the score on the leaderboard.
 */

import type { Metadata } from "next";
import { slugify } from "@/lib/utils";

const SITE = "https://yourscore.app";

// Always read the quiz's metadata FRESH when generating the link-preview tags.
// Otherwise the Supabase read sits in Next's Data Cache (which even survives
// deploys on Vercel), so a share image attached after the page was first rendered
// never appears on the card. force-dynamic alone didn't suppress the supabase-js
// query cache, so we read via a direct REST fetch with `cache: "no-store"` — the
// reliable bypass — and keep force-dynamic for the segment.
export const dynamic = "force-dynamic";

type PackMeta = {
  name: string;
  description: string | null;
  question_count: number | null;
  metadata: { share_image?: string; icon?: string } | null;
};

// Published quiz_packs are public, so the anon key suffices (same as /api/og/quiz).
async function getPack(slug: string): Promise<PackMeta | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const listRes = await fetch(`${base}/rest/v1/quiz_packs?select=id,name&status=eq.published`, { headers, cache: "no-store" });
    if (!listRes.ok) return null;
    const list = (await listRes.json()) as { id: string; name: string }[];
    const found = list.find((p) => slugify(p.name) === slug);
    if (!found) return null;
    const res = await fetch(
      `${base}/rest/v1/quiz_packs?select=name,description,question_count,metadata&id=eq.${encodeURIComponent(found.id)}`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as PackMeta[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { slug } = params;
  const pack = await getPack(slug);

  const name = pack?.name ?? "Football Quiz";
  const qCount = pack?.question_count ?? 15;
  const title = `${name} · YourScore`;
  const description =
    pack?.description ||
    `Can you ace this ${qCount}-question football quiz? Play free in seconds, then sign up to save your score and climb the leaderboard.`;
  const url = `${SITE}/challenges/${slug}`;
  // Prefer a hand-made share image attached to the pack (metadata.share_image,
  // set by scripts/set-quiz-share-image.mjs). Proxy it through yourscore.app so
  // Twitter's card crawler can fetch it — Supabase storage returns x-robots-tag:none
  // which blocks Twitter's bot from displaying the image.
  // Fall back to the auto-generated card at /api/og/quiz when no custom image.
  const ogImage = pack?.metadata?.share_image
    ? `${SITE}/api/quiz-image/${encodeURIComponent(slug)}`
    : `${SITE}/api/og/quiz?slug=${encodeURIComponent(slug)}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "YourScore",
      url,
      images: [{ url: ogImage, width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default function ChallengeSlugLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
