import { BottomNav } from "@/components/ui/BottomNav";
import { SkeletonBlock as Block } from "@/components/ui/SkeletonBlock";

/**
 * Route-transition fallback for the Leaderboard tab. The board is fetched after
 * mount, so without this boundary the previous screen sits frozen through both the
 * segment load and the rank query. Skeleton rows keep the tap responsive.
 */
export default function LeaderboardLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-8 space-y-5">
        <Block h={30} w={190} />
        {/* scope toggle: all players vs friends */}
        <Block h={34} r={17} w={200} />
        {/* ranked rows */}
        <div className="space-y-2.5 pt-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <Block key={i} h={54} r={16} />
          ))}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
