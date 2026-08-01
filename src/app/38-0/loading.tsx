import { BottomNav } from "@/components/ui/BottomNav";
import { SkeletonBlock as Block } from "@/components/ui/SkeletonBlock";

/**
 * Route-transition fallback for the 38-0 hub (and the game routes nested under it,
 * which inherit this boundary). These screens load a sizeable chunk before they can
 * paint, so without a boundary the tap holds the previous screen for that whole time.
 */
export default function DraftLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">
        {/* title + games nav */}
        <div className="flex items-center justify-between">
          <Block h={26} w={100} />
          <Block h={30} w={96} r={15} />
        </div>
        {/* competition tabs */}
        <div className="flex gap-2">
          <Block h={32} w={90} r={16} />
          <Block h={32} w={90} r={16} />
          <Block h={32} w={90} r={16} />
        </div>
        {/* hero pitch card */}
        <Block h={190} r={20} />
        <div className="space-y-3">
          <Block h={64} r={18} />
          <Block h={64} r={18} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
