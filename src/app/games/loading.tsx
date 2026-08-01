import { BottomNav } from "@/components/ui/BottomNav";
import { SkeletonBlock as Block } from "@/components/ui/SkeletonBlock";

/**
 * Route-transition fallback for the Games tab. Without a loading boundary the App
 * Router keeps the PREVIOUS screen on display while this segment's payload and JS
 * chunk load, so the tap reads as "nothing happened" — see the Home/Play
 * boundaries for the same reasoning. BottomNav stays mounted so the tapped tab is
 * highlighted immediately.
 */
export default function GamesLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">
        {/* title + games nav row */}
        <div className="flex items-center justify-between">
          <Block h={26} w={130} />
          <Block h={30} w={96} r={15} />
        </div>
        {/* game tiles */}
        <div className="grid grid-cols-2 gap-3">
          <Block h={150} r={20} />
          <Block h={150} r={20} />
          <Block h={150} r={20} />
          <Block h={150} r={20} />
          <Block h={150} r={20} />
          <Block h={150} r={20} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
