import { BottomNav } from "@/components/ui/BottomNav";

/**
 * Route-transition fallback for the Home tab (and any server route without its
 * own loading.tsx). Without this boundary, the App Router holds the previous
 * screen frozen while the server awaits auth + dashboard queries — so a tab tap
 * "does nothing, then catches up". This shows an instant skeleton; BottomNav keeps
 * the nav visible and highlights the tapped tab immediately (the URL is already
 * updated), so navigation always feels responsive.
 */
function Block({ h = 16, w = "100%", r = 12 }: { h?: number; w?: number | string; r?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: r, background: "rgba(255,255,255,0.06)" }}
    />
  );
}

export default function HomeLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-8 space-y-5">
        {/* greeting / header */}
        <div className="space-y-2">
          <Block h={14} w={120} />
          <Block h={30} w={200} />
        </div>
        {/* hero / rank card */}
        <Block h={120} r={20} />
        {/* featured row */}
        <div className="grid grid-cols-2 gap-3">
          <Block h={150} r={20} />
          <Block h={150} r={20} />
        </div>
        {/* list rows */}
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
