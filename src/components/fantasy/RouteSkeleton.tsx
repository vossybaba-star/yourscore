import { BottomNav } from "@/components/ui/BottomNav";
import { SkeletonBlock as Block } from "@/components/ui/SkeletonBlock";

/**
 * Shared route-transition fallback for the Fantasy sub-routes. App Router holds
 * the PREVIOUS screen until a route's data resolves unless the segment has a
 * loading.tsx — that's what made every fantasy tab switch feel dead (founder,
 * 3 Aug). Each fantasy child route re-exports this as its loading.tsx, so a tap
 * paints an instant skeleton (header + content) instead of freezing.
 *
 * Deliberately generic: it flashes for a beat during navigation, so it just needs
 * to read as "the fantasy shell, loading", not match each page pixel-for-pixel.
 */
export default function RouteSkeleton() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#080d0a" }}>
      <div className="max-w-lg mx-auto px-4 pt-8 space-y-4">
        <Block h={26} w={200} />
        <div className="flex gap-2">
          <Block h={40} r={12} w={90} />
          <Block h={40} r={12} w={90} />
          <Block h={40} r={12} w={90} />
          <Block h={40} r={12} w={90} />
        </div>
        <Block h={120} r={16} />
        <div className="grid grid-cols-2 gap-3">
          <Block h={80} r={14} />
          <Block h={80} r={14} />
        </div>
        <div className="space-y-3 pt-1">
          <Block h={54} r={14} />
          <Block h={54} r={14} />
          <Block h={54} r={14} />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
