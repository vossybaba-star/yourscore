import { BottomNav } from "@/components/ui/BottomNav";

/**
 * Route-transition fallback for the Profile tab. Profile is a Server Component
 * that awaits auth + several parallel queries before rendering; without this
 * boundary the tab tap appears to do nothing until the server replies. This shows
 * an instant skeleton and keeps BottomNav visible (active tab highlights at once).
 */
function Block({ h = 16, w = "100%", r = 12 }: { h?: number; w?: number | string; r?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: r, background: "rgba(255,255,255,0.06)" }}
    />
  );
}

export default function ProfileLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-10 space-y-6">
        {/* avatar + name */}
        <div className="flex items-center gap-4">
          <div className="animate-pulse" style={{ width: 72, height: 72, borderRadius: 36, background: "rgba(255,255,255,0.06)" }} />
          <div className="flex-1 space-y-2">
            <Block h={22} w={160} />
            <Block h={14} w={110} />
          </div>
        </div>
        {/* stat cards */}
        <div className="grid grid-cols-3 gap-3">
          <Block h={84} r={18} />
          <Block h={84} r={18} />
          <Block h={84} r={18} />
        </div>
        {/* sections */}
        <div className="space-y-3">
          <Block h={20} w={140} />
          <Block h={64} r={16} />
          <Block h={64} r={16} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
