import { SkeletonBlock as Block } from "@/components/ui/SkeletonBlock";

/**
 * Route-transition fallback for the Quiz challenges tab. This one is a SERVER
 * segment, so the App Router genuinely awaits its queries before it can render —
 * the case a loading boundary helps most. No BottomNav here: the page itself
 * doesn't render one, and adding it would shift the layout on hand-off.
 */
export default function ChallengesLoading() {
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-8 space-y-5">
        <div className="space-y-2">
          <Block h={14} w={100} />
          <Block h={30} w={180} />
        </div>
        <Block h={120} r={20} />
        <div className="space-y-3 pt-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Block key={i} h={72} r={18} />
          ))}
        </div>
      </div>
    </div>
  );
}
