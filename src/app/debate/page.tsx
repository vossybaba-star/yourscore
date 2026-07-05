import type { Metadata } from "next";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { todaysDebate } from "@/lib/debate";
import { DebateCard } from "@/components/debate/DebateCard";

// Public landing for shared debates: guests can read the question and the
// argument; voting or commenting walks them into sign-up. This page is the
// destination of every "DRAG A FRIEND INTO IT" share.

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store"; // today's debate rotates daily — never cache the list

export async function generateMetadata(): Promise<Metadata> {
  const debate = await todaysDebate(createServiceClient()).catch(() => null);
  const title = debate ? `${debate.question} — settle it on YourScore` : "Today's debate — YourScore";
  return {
    title,
    description: "One football debate a day. Vote, see the community split, argue it out.",
    openGraph: {
      title,
      description: "One football debate a day. Vote, see the split, argue it out.",
      images: [{ url: "/api/og/debate", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default function DebatePage() {
  return (
    <main className="min-h-dvh bg-bg">
      <div className="max-w-lg mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="font-display text-lg text-white">
            YOUR<span className="text-green">SCORE</span>
          </Link>
          <Link
            href="/versus"
            className="font-body text-xs font-bold px-3 py-1.5 rounded-full"
            style={{ background: "rgba(174,234,0,0.12)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.3)" }}
          >
            Play →
          </Link>
        </div>

        <h1 className="font-body text-xs font-bold uppercase tracking-[0.28em] mb-3" style={{ color: "#586058" }}>
          One football debate a day
        </h1>

        <DebateCard withDiscussion signInNext="/debate" />

        <p className="font-body text-xs text-text-muted text-center mt-6">
          Think your football knowledge settles it?{" "}
          <Link href="/versus" className="font-bold" style={{ color: "#00d8c0" }}>
            Prove it in a Quiz Battle →
          </Link>
        </p>
      </div>
    </main>
  );
}
