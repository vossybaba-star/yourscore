import { BottomNav } from "@/components/ui/BottomNav";

/**
 * Route-transition fallback for the Versus tab. Shaped like its header + the
 * three full-width segmented tabs, then the match list. See play/loading.tsx for
 * why every tab route needs one of these.
 */
function Block({ h = 16, w = "100%", r = 12 }: { h?: number; w?: number | string; r?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: r, background: "rgba(255,255,255,0.06)" }}
    />
  );
}

export default function VersusLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-6 space-y-4">
        <Block h={26} w={120} />
        {/* segmented tabs */}
        <div className="flex gap-2">
          <Block h={36} r={18} />
          <Block h={36} r={18} />
          <Block h={36} r={18} />
        </div>
        {/* match rows */}
        <div className="space-y-3 pt-1">
          <Block h={72} r={16} />
          <Block h={72} r={16} />
          <Block h={72} r={16} />
          <Block h={72} r={16} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
