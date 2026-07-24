import { BottomNav } from "@/components/ui/BottomNav";

/**
 * Route-transition fallback for the Play tab (and every game route nested under
 * it, which inherit this boundary). Without it the App Router holds the previous
 * screen — the game you are trying to leave — frozen on display while the server
 * replies, which on a resumed phone can be several seconds of apparently nothing
 * happening. This shows an instant skeleton shaped like the Play header + pack
 * grid, and keeps BottomNav visible so the tapped tab is already highlighted.
 */
function Block({ h = 16, w = "100%", r = 12 }: { h?: number; w?: number | string; r?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: r, background: "rgba(255,255,255,0.06)" }}
    />
  );
}

export default function PlayLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">
        {/* QUIZ title + game switcher row */}
        <div className="flex items-center justify-between">
          <Block h={26} w={110} />
          <Block h={30} w={96} r={15} />
        </div>
        {/* featured pack */}
        <Block h={132} r={20} />
        {/* pack grid */}
        <div className="grid grid-cols-2 gap-3">
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
