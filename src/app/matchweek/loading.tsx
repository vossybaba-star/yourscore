import { BottomNav } from "@/components/ui/BottomNav";

/**
 * Route-transition fallback for the Premier League tab. Shaped like its big
 * PREMIER LEAGUE masthead, the section switcher, then the fixture list. See
 * play/loading.tsx for why every tab route needs one of these.
 */
function Block({ h = 16, w = "100%", r = 12 }: { h?: number; w?: number | string; r?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: r, background: "rgba(255,255,255,0.06)" }}
    />
  );
}

export default function MatchweekLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-8 space-y-5">
        <Block h={32} w={240} />
        {/* section switcher */}
        <div className="flex gap-2">
          <Block h={34} r={17} />
          <Block h={34} r={17} />
          <Block h={34} r={17} />
        </div>
        {/* fixture rows */}
        <div className="space-y-3 pt-1">
          <Block h={64} r={16} />
          <Block h={64} r={16} />
          <Block h={64} r={16} />
          <Block h={64} r={16} />
          <Block h={64} r={16} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
