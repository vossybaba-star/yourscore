/**
 * /38-0/wc/share — the link a player tweets after a World Cup Mastermind run. Its whole
 * job is the unfurl: generateMetadata points og:image / twitter:image at the personalised
 * scorecard (/api/draft/wc-og), so the player's own card shows in-feed — not a generic
 * entry image. The card params travel in the query string (no DB read needed).
 *
 * For a human who taps the link, the body shows the card + a "play today's run" CTA and
 * the share-on-X nudge.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";

const CARD_PARAMS = ["mode", "run", "player", "quiz", "rec", "rank", "date", "status", "stage", "world", "nation", "crest"] as const;

function buildOgQuery(sp: Record<string, string | string[] | undefined>): string {
  const p = new URLSearchParams();
  for (const k of CARD_PARAMS) {
    const v = sp[k];
    const val = Array.isArray(v) ? v[0] : v;
    if (val) p.set(k, val);
  }
  return p.toString();
}

// The unfurl TITLE/description, resolved server-side from the run id so the link text never
// falls back to "A manager" even when only `run` travels (the image is already self-contained
// via the og route). Cheap: just the player's name + quiz score. Fails soft to null.
async function resolveTitleBits(runId: string): Promise<{ player: string; quiz: string | null } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const { data: r } = await db
      .from("draft_wc_runs").select("user_id,quiz_correct,quiz_total").eq("id", runId).maybeSingle();
    if (!r) return null;
    const { data: p } = await db.from("profiles").select("display_name").eq("id", r.user_id).maybeSingle();
    const player = (p?.display_name as string | undefined)?.trim() || "A manager";
    const quiz = r.quiz_total ? `${r.quiz_correct ?? 0}/${r.quiz_total}` : null;
    return { player, quiz };
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { searchParams }: { searchParams: Record<string, string | string[] | undefined> },
): Promise<Metadata> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "yourscore.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const img = `${origin}/api/draft/wc-og?${buildOgQuery(searchParams)}`;

  const runId = Array.isArray(searchParams.run) ? searchParams.run[0] : searchParams.run;
  let player = (Array.isArray(searchParams.player) ? searchParams.player[0] : searchParams.player) || "";
  let quiz = (Array.isArray(searchParams.quiz) ? searchParams.quiz[0] : searchParams.quiz) || "";
  // No explicit name/quiz in the link? Resolve them from the run so the title isn't generic.
  if ((!player || !quiz) && runId) {
    const bits = await resolveTitleBits(runId);
    if (bits) { player = player || bits.player; quiz = quiz || (bits.quiz ?? ""); }
  }
  if (!player) player = "A manager";
  const title = `${player} · World Cup Mastermind`;
  const description = quiz
    ? `${quiz} on today's World Cup Mastermind quiz. Think you know football? Beat them on 38-0.`
    : "Today's World Cup Mastermind — answer to draft your World XI and win the World Cup. 38-0.";

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [img] },
  };
}

export default function WcSharePage(
  { searchParams }: { searchParams: Record<string, string | string[] | undefined> },
) {
  const img = `/api/draft/wc-og?${buildOgQuery(searchParams)}`;
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-5 py-10" style={{ background: "#0a0a0f" }}>
      <div className="w-full max-w-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt="World Cup Mastermind scorecard" style={{ width: "100%", aspectRatio: "1200 / 630", borderRadius: 16, display: "block" }} />
        <div className="text-center mt-7">
          <h1 className="font-display tracking-wide" style={{ fontSize: 26, color: "#fff" }}>WORLD CUP <span style={{ color: "#ffd700" }}>MASTERMIND</span></h1>
          <p className="font-body mt-2" style={{ fontSize: 15, color: "#9a9ab0", lineHeight: 1.5 }}>
            Answer World Cup questions to build your World XI, then win the tournament. One ranked run a day — closest to a perfect 8-0-0 tops the board.
          </p>
          <Link href="/38-0/wc?daily=1"
            className="inline-block mt-6 rounded-2xl px-8 py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "#ffd700", color: "#1a1300", fontSize: 20 }}>
            ▶ Play today&apos;s run
          </Link>
          <p className="font-body mt-4" style={{ fontSize: 13, color: "#a89060" }}>📣 Share your result on 𝕏.</p>
        </div>
      </div>
    </main>
  );
}
