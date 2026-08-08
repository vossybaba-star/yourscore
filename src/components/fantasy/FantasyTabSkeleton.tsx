import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { BottomNav } from "@/components/ui/BottomNav";
import { SkeletonBlock as Block } from "@/components/ui/SkeletonBlock";
import { page } from "@/components/fantasy/shared";

/**
 * The route-transition fallback for the three Fantasy tabs (Feed / Squad /
 * Scout). The old skeletons painted a GENERIC block header, so the real
 * FantasyHeader visibly popped in on top of it on every tab switch — that jump
 * is what read as "glitchy" (founder, 8 Aug). This renders the REAL header
 * instead: because the URL is already the destination while a loading.tsx shows,
 * FantasyHeader lights the correct pill, so the header is pixel-identical before,
 * during and after the switch — only the content below swaps for a skeleton.
 */
export default function FantasyTabSkeleton() {
  return (
    <>
      <main data-fantasy style={page}>
        <FantasyHeader />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Block h={44} r={999} />
          <Block h={140} r={16} />
          <Block h={140} r={16} />
          <Block h={140} r={16} />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
