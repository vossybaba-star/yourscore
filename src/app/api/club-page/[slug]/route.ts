import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { slugify } from "@/lib/utils";

// Edge-cached loader for a club page (src/app/club/[slug]/page.tsx): the
// 2025/26 season pack + the four topic packs (History & Honours / Legends /
// Modern Era / Rivalries), if they've been pre-generated.
//
// Named /api/club-page (not /api/club) because /api/club/[slug] already
// exists for the unrelated Club Leagues feature (fan-club hubs, src/lib/club.ts) —
// same top-level word, different product surface.
//
// Same pattern as /api/challenges/pack: published pack content is effectively
// static, so this runs next to the DB and is cached at Vercel's CDN edge — no
// per-visitor round trip to eu-central-1.

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

// The CDN header above is the ONLY intended cache. Without this, Vercel's
// durable Data Cache pins the service-client GET forever.
export const fetchCache = "force-no-store";

const TOPICS: { category: string; label: string }[] = [
  { category: "history-honours", label: "History & Honours" },
  { category: "legends", label: "Legends" },
  { category: "modern-era", label: "Modern Era" },
  { category: "rivalries-derbies", label: "Rivalries" },
];

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params;
  const sb = createServiceClient();

  // Resolve slug → club by matching against the 20 in-rotation season packs
  // (type=club, published, rotation_active=true) — the same set the Quiz hub
  // grid already lists, so this is the same slug the hub already produces.
  const { data: seasonPacks } = await sb
    .from("quiz_packs")
    .select("id, name, question_count, metadata")
    .eq("type", "club")
    .eq("status", "published")
    .eq("rotation_active", true);

  const seasonPack = (seasonPacks ?? []).find((p) => slugify(p.name) === slug);
  if (!seasonPack) {
    return NextResponse.json(
      { error: "not found" },
      { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } },
    );
  }

  const clubName = seasonPack.name;

  // Topic packs are matched on parameter = club name AND metadata->>club_topic
  // = category AND status='published'. Pack presence is the ONLY availability
  // truth here — never call /api/quiz/availability.
  const { data: topicPacks } = await sb
    .from("quiz_packs")
    .select("id, name, question_count, metadata")
    .eq("type", "club")
    .eq("status", "published")
    .eq("parameter", clubName);

  // A topic can hold more than one pack: where a club has enough distinct facts left
  // over, the seed deals a II/III/IV. `.find()` here would return one and silently
  // orphan the rest, which is the exact defect the club page exists to fix, so return
  // every volume in order.
  const topics = TOPICS.map(({ category, label }) => {
    const packs = (topicPacks ?? [])
      .filter((p) => (p.metadata as { club_topic?: string } | null)?.club_topic === category)
      .map((p) => ({
        id: p.id,
        slug: slugify(p.name),
        name: p.name,
        question_count: p.question_count,
        volume: (p.metadata as { club_topic_volume?: number } | null)?.club_topic_volume ?? 1,
      }))
      .sort((a, b) => a.volume - b.volume);
    return {
      category,
      label,
      // `pack` stays for the single-volume case so nothing downstream has to special-case it.
      pack: packs[0] ?? null,
      packs,
    };
  });

  return NextResponse.json(
    {
      club: { name: clubName, slug },
      seasonPack: {
        id: seasonPack.id,
        slug,
        name: seasonPack.name,
        question_count: seasonPack.question_count,
        metadata: seasonPack.metadata,
      },
      topics,
    },
    { headers: CACHE_HEADERS },
  );
}
