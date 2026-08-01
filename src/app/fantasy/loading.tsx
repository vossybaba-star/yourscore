import { BottomNav } from "@/components/ui/BottomNav";
import { SkeletonBlock as Block } from "@/components/ui/SkeletonBlock";

/**
 * Route-transition fallback for the Fantasy tab, so tapping it responds instantly
 * instead of holding the previous screen while this segment loads.
 */
export default function FantasyLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-8 space-y-5">
        <div className="space-y-2">
          <Block h={14} w={110} />
          <Block h={30} w={210} />
        </div>
        {/* squad / deadline hero */}
        <Block h={130} r={20} />
        <div className="grid grid-cols-2 gap-3">
          <Block h={92} r={18} />
          <Block h={92} r={18} />
        </div>
        <div className="space-y-3 pt-1">
          <Block h={56} r={16} />
          <Block h={56} r={16} />
          <Block h={56} r={16} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
