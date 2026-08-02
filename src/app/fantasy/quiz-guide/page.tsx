"use client";
/**
 * The fantasy quiz explainer (founder, 2 Aug). Reached from the "Earn extra
 * transfers with the weekly quiz" tile. A tappable card story (same shape as the
 * How It Works page), each card with a visual: right answers earn transfers, the
 * gameweek round, the gameday quiz in the Play tab, and the free baseline.
 */
import { useRouter } from "next/navigation";
import { Header, INK, MUTED, page } from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";
import { QuizGuideCards } from "@/components/fantasy/QuizGuideCards";

export default function FantasyQuizGuidePage() {
  const router = useRouter();
  return (
    <>
      <main data-fantasy style={page}>
        <Header exit={{ label: "Fantasy", onClick: () => router.push("/fantasy") }} />
        <h1 className="font-display" style={{ fontSize: 26, color: INK, lineHeight: 1.05, margin: "2px 0 4px" }}>The weekly quiz</h1>
        <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 4px", lineHeight: 1.5 }}>
          A bonus, not a must. Answer football questions to bank extra transfers.
        </p>
        <QuizGuideCards />
      </main>
      <BottomNav />
    </>
  );
}
