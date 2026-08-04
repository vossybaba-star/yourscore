/**
 * /r/[id] — a shared Scout rating. Server-rendered from the immutable snapshot;
 * the interactive verdict + CTA live in RateShareView (client). generateMetadata
 * feeds the tweet's text preview a real chunk of the read, and opengraph-image.tsx
 * (same folder) supplies the card, so the feed shows the score before any click.
 *
 * Service-role reads → force-no-store, or Vercel's data cache pins the row.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { fetchRateShare } from "@/lib/fantasy/rateShare";
import { RateShareView } from "@/components/fantasy/RateShareView";
import { INK, MUTED, TEAL, page, tint } from "@/components/fantasy/shared";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const row = await fetchRateShare(params.id);
  if (!row) {
    return {
      title: "Rate your FPL team · YourScore Scout",
      description: "Get your Premier League fantasy team scored out of 10 by the YourScore Scout.",
    };
  }
  const s = row.rating.month.score.toFixed(1);
  const title = `This FPL team scored ${s}/10 · rated by the YourScore Scout`;
  // Lead with the verdict, close with the one move — the chunk that earns a tap.
  const description = `${row.rating.month.verdict} One move worth making: ${row.rating.month.moveLine}`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

function ExpiredView() {
  return (
    <main data-fantasy style={page}>
      <div style={{ textAlign: "center", padding: "56px 8px" }}>
        <div className="font-display" style={{ fontSize: 24, color: INK, marginBottom: 8 }}>
          This rating has moved on
        </div>
        <p style={{ fontSize: 14, color: MUTED, margin: "0 auto 22px", maxWidth: 320, lineHeight: 1.5 }}>
          We could not find this one, friend. Rate your own team and the Scout scores it out of 10 in seconds.
        </p>
        <Link href="/fantasy/rate" style={{
          display: "inline-block", padding: "12px 20px", borderRadius: 12, textDecoration: "none",
          background: tint(TEAL, "1e"), border: `1px solid ${tint(TEAL, "66")}`, color: TEAL, fontWeight: 700, fontSize: 14,
        }}>
          Rate your team
        </Link>
      </div>
    </main>
  );
}

export default async function RateSharePage({ params }: { params: { id: string } }) {
  const row = await fetchRateShare(params.id);
  if (!row) return <ExpiredView />;
  return <RateShareView row={row} />;
}
