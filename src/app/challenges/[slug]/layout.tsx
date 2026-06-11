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
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";

const SITE = "https://yourscore.app";

// Always read the quiz's metadata fresh when generating the link-preview tags.
// generateMetadata's Supabase query would otherwise sit in Next's Data Cache
// (which even survives deploys on Vercel), so a share image attached after the
// page was first rendered would never appear on the card. force-dynamic disables
// all fetch caching for this segment, so attached/swapped images show immediately.
export const dynamic = "force-dynamic";

type PackMeta = {
  name: string;
  description: string | null;
  question_count: number | null;
  metadata: { share_image?: string; icon?: string } | null;
};

async function getPack(slug: string): Promise<PackMeta | null> {
  try {
    const sb = createServiceClient();
    const { data: list } = await sb.from("quiz_packs").select("id, name").eq("status", "published");
    const found = ((list ?? []) as { id: string; name: string }[]).find((p) => slugify(p.name) === slug);
    if (!found) return null;
    // `description` exists in the live DB but not the stale generated types; select
    // via a string var to dodge literal-type validation (same trick as the pack route).
    const cols: string = "name, description, question_count, metadata";
    const { data } = await sb.from("quiz_packs").select(cols).eq("id", found.id).single();
    return (data as unknown as PackMeta) ?? null;
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
  // set by scripts/set-quiz-share-image.mjs). Fall back to the auto-generated
  // card at /api/og/quiz when no custom image has been attached.
  const ogImage = pack?.metadata?.share_image || `${SITE}/api/og/quiz?slug=${encodeURIComponent(slug)}`;

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
