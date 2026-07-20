import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getRecommendedQuizzes } from "@/lib/versus/recommend";
// Vercel data cache pins service-role GETs (constant cache key) — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

// "Beat someone's score" — quizzes the caller hasn't played where other
// players' scored runs are waiting. Signed-in only (it's personalised).
export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  try {
    const quizzes = await getRecommendedQuizzes(createServiceClient(), user.id);
    return NextResponse.json({ quizzes });
  } catch {
    return NextResponse.json({ error: "Could not load recommendations" }, { status: 500 });
  }
}
