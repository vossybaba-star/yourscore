/** Server layout for the league page — exists ONLY to give the client page an
 *  unfurl. The invite link is the growth loop, so a shared league URL gets the
 *  league card (/api/og/fantasy-league): league name + picture on the left,
 *  the gold Fantasy Premier League pitch on the right. Public fields only
 *  (name, image, member count) — the same ones a link-viewing guest sees. */
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const fallback: Metadata = {
    title: "YourScore Fantasy league",
    description: "Fantasy Premier League on YourScore. Your football knowledge earns your moves.",
  };
  try {
    // fantasy_leagues isn't in the generated Database types yet (same situation
    // as src/lib/fantasy/leagues.ts) — untyped handle for these two reads.
    const svc = createServiceClient() as unknown as SupabaseClient;
    const { data: league } = await svc
      .from("fantasy_leagues")
      .select("id, name, image_url")
      .eq("join_code", (params.code ?? "").trim().toUpperCase())
      .maybeSingle();
    if (!league) return fallback;

    const { count } = await svc
      .from("fantasy_league_members")
      .select("league_id", { count: "exact", head: true })
      .eq("league_id", league.id);

    const qp = new URLSearchParams({ name: league.name ?? "" });
    if (league.image_url) qp.set("img", league.image_url);
    if (count) qp.set("members", String(count));
    const image = `${BASE}/api/og/fantasy-league?${qp.toString()}`;

    const title = `Join ${league.name} on YourScore Fantasy`;
    const description = "Fantasy Premier League on YourScore. Pick fifteen stars with £100m, earn your moves with your football knowledge, take on your friends every gameweek.";
    return {
      title, description,
      openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  } catch {
    return fallback;
  }
}

export default function LeagueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
