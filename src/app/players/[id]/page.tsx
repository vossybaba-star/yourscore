/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GridBackground } from "@/components/ui/GridBackground";
import { BottomNav } from "@/components/ui/BottomNav";
import { AddFriendCard } from "@/components/social/AddFriendCard";
import { BackPill } from "@/components/ui/BackPill";

// Inline avatar component — matches the one in profile/page.tsx
function AvatarCircle({
  name,
  size = 64,
  avatarUrl,
}: {
  name: string;
  size?: number;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className="rounded-full object-cover flex-shrink-0"
        style={{
          width: size,
          height: size,
          border: "2px solid rgba(255,255,255,0.1)",
        }}
      />
    );
  }
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" },
    { bg: "#3a423d", text: "#aeea00" },
    { bg: "#1a4a2a", text: "#4ade80" },
    { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div
      className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.text,
        fontSize: size * 0.38,
        border: "2px solid rgba(255,255,255,0.1)",
      }}
    >
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

interface PlayerPageProps {
  params: Promise<{ id: string }>;
}

export default async function PlayerProfilePage({ params }: PlayerPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const sb = supabase as any;

  // Fetch profile and draft standings in parallel
  const [{ data: profile }, { data: draftStanding }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, total_score, games_played, avatar_url")
      .eq("id", id)
      .maybeSingle(),
    sb
      .from("draft_standings")
      .select("wins_all_time, draws_all_time, losses_all_time")
      .eq("user_id", id)
      .is("league_id", null)
      .maybeSingle(),
  ]);

  // Player not found
  if (!profile) {
    return (
      <main
        className="min-h-dvh flex items-center justify-center px-6"
        style={{ background: "#0a0a0f" }}
      >
        <GridBackground opacity={0.02} />
        <div className="relative z-10 text-center space-y-4">
          <p className="text-4xl mb-4">👤</p>
          <p className="font-body text-lg font-semibold text-white">
            Player not found
          </p>
          <p className="font-body text-sm text-text-muted">
            This profile does not exist or has been removed.
          </p>
          <Link
            href="/38-0/history"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-body font-bold text-sm"
            style={{
              background: "rgba(174,234,0,0.1)",
              border: "1px solid rgba(174,234,0,0.28)",
              color: "#aeea00",
            }}
          >
            ← Back
          </Link>
        </div>
      </main>
    );
  }

  const totalScore: number = profile.total_score ?? 0;
  const gamesPlayed: number = profile.games_played ?? 0;
  const name: string = profile.display_name || "Player";

  // Global rank: count of profiles with higher total_score
  const { count } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .gt("total_score", totalScore);
  const globalRank = (count ?? 0) + 1;

  const draftRecord = draftStanding
    ? {
        w: draftStanding.wins_all_time ?? 0,
        d: draftStanding.draws_all_time ?? 0,
        l: draftStanding.losses_all_time ?? 0,
      }
    : null;

  return (
    <main className="min-h-dvh pb-28" style={{ background: "#0a0a0f" }}>
      <GridBackground opacity={0.02} />

      {/* Sticky header */}
      <div
        className="sticky top-0 z-30 pt-safe"
        style={{
          background: "rgba(10,10,15,0.92)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="max-w-lg mx-auto px-5 py-4">
          <div className="flex items-center gap-4">
            {/* Back link */}
            <BackPill fallback="/38-0/history" label="Back" tone="neutral" />

            <AvatarCircle
              name={name}
              size={48}
              avatarUrl={profile.avatar_url}
            />

            <div className="flex-1 min-w-0">
              <p className="font-display text-2xl text-white tracking-wide truncate">
                {name.toUpperCase()}
              </p>
              <p className="font-body text-xs text-text-muted mt-0.5">
                YourScore Player
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Page body */}
      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-5">

        {/* Stats card — rank + score */}
        <div
          className="rounded-2xl px-5 py-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(174,234,0,0.1), rgba(174,234,0,0.05))",
            border: "1px solid rgba(174,234,0,0.2)",
          }}
        >
          <div className="flex items-end justify-between">
            <div>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-1.5">
                Global ranking
              </p>
              <p
                className="font-display text-5xl leading-none"
                style={{ color: "#aeea00" }}
              >
                #{globalRank}
              </p>
              <p className="font-body text-xs text-text-muted mt-1.5">
                {totalScore.toLocaleString()} total points
              </p>
            </div>
            {gamesPlayed > 0 && (
              <div
                className="px-3 py-1.5 rounded-full"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <p className="font-body text-xs" style={{ color: "#8a948f" }}>
                  {gamesPlayed} games
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 38-0 record card */}
        <div
          className="rounded-2xl px-5 py-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(174,234,0,0.07), rgba(174,234,0,0.03))",
            border: "1px solid rgba(174,234,0,0.18)",
          }}
        >
          <p
            className="font-body text-xs uppercase tracking-widest mb-3"
            style={{ color: "#aeea00" }}
          >
            38-0 Head-to-Head record
          </p>
          {draftRecord ? (
            <div className="flex items-end gap-4">
              <div className="text-center">
                <p
                  className="font-display text-4xl leading-none"
                  style={{ color: "#aeea00" }}
                >
                  {draftRecord.w}
                </p>
                <p className="font-body text-xs text-text-muted mt-1">W</p>
              </div>
              <div
                className="pb-1 font-body text-2xl"
                style={{ color: "#334455" }}
              >
                -
              </div>
              <div className="text-center">
                <p
                  className="font-display text-4xl leading-none"
                  style={{ color: "#ffb800" }}
                >
                  {draftRecord.d}
                </p>
                <p className="font-body text-xs text-text-muted mt-1">D</p>
              </div>
              <div
                className="pb-1 font-body text-2xl"
                style={{ color: "#334455" }}
              >
                -
              </div>
              <div className="text-center">
                <p
                  className="font-display text-4xl leading-none"
                  style={{ color: "#f87171" }}
                >
                  {draftRecord.l}
                </p>
                <p className="font-body text-xs text-text-muted mt-1">L</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p
                className="font-display text-3xl leading-none"
                style={{ color: "#334455" }}
              >
                —
              </p>
              <p className="font-body text-sm text-text-muted">
                No 38-0 games yet
              </p>
            </div>
          )}
        </div>

        {/* Add friend card — client component */}
        <AddFriendCard
          userId={id}
          displayName={name}
          context={`Connect with ${name} on YourScore`}
        />

      </div>

      <BottomNav />
    </main>
  );
}
