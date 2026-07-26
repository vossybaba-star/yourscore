import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";

// /play/today — a STABLE deep link for ads (especially PlayQuiz-optimised cold traffic).
//
// The gap it closes: /play is a hub, so no quiz event fires there — a cold ad click
// needed 2 taps (hub → pick a pack → START) before PlayQuiz fired, and there was no
// permanent direct-to-quiz URL because pack slugs change. This route resolves "today's
// quiz" server-side and 302s straight to its challenge, where the first START fires
// PlayQuiz. Ads point here once and the link never goes stale.
//
// Resolution (built to land COLD ad traffic on a NEUTRAL quiz, not a club-specific one):
//   1. a pack explicitly flagged metadata.daily (the true "quiz of the day"), newest first
//   2. else the lead featured NON-CLUB pack — an evergreen general quiz (e.g. "Premier League
//      Records"), so a cold PL fan of any club lands somewhere neutral rather than a rival's club quiz
//   3. else the lead featured pack /play shows (lowest featured_order) — club packs, last resort
//   4. else fall back to /play, so the link is never a dead end
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PackRow {
  name: string;
  type: string | null;
  featured: boolean | null;
  featured_order: number | null;
  parameter: string | null;
  created_at: string | null;
  metadata: { series?: string; daily?: boolean; date?: string } | null;
}

// Mirror of /play's isWorldCupPack — WC packs are a retired daily series, never an
// evergreen ad landing.
function isWorldCupPack(p: PackRow): boolean {
  if ((p.metadata?.series ?? "").toLowerCase().startsWith("wc")) return true;
  return /world cup/i.test(p.name) || /world cup/i.test(p.parameter ?? "");
}

export default async function PlayTodayPage() {
  let target = "/play";
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("quiz_packs")
      .select("name, type, featured, featured_order, parameter, created_at, metadata")
      .eq("status", "published")
      .eq("rotation_active", true);
    const packs = ((data ?? []) as PackRow[]).filter((p) => !isWorldCupPack(p));

    const byOrder = (a: PackRow, b: PackRow) => (a.featured_order ?? 99) - (b.featured_order ?? 99);

    // 1) explicit "quiz of the day", newest first
    const daily = packs
      .filter((p) => p.metadata?.daily === true)
      .sort((a, b) =>
        (b.metadata?.date ?? b.created_at ?? "").localeCompare(a.metadata?.date ?? a.created_at ?? ""),
      );
    // 2) lead featured NON-CLUB pack — the neutral, club-agnostic landing (e.g. "Premier League Records")
    const neutral = packs.filter((p) => p.featured && p.type !== "club").sort(byOrder);
    // 3) lead featured pack /play shows (club packs) — last resort
    const featured = packs.filter((p) => p.featured).sort(byOrder);

    const lead = daily[0] ?? neutral[0] ?? featured[0];
    if (lead?.name) target = `/challenges/${slugify(lead.name)}`;
  } catch {
    // keep the /play fallback
  }
  redirect(target);
}
