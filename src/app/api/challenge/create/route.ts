import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { notifyUsers } from "@/lib/notify";

// Create a group challenge: a quiz + a set of participants (the creator, plus any
// invited friends). The creator may seed the board with their own score or skip
// and play later. invitedUserIds get participant rows (status invited) and will
// see it in their Your-Turns inbox; anyone with the link can also join (/join).
// Server-side so scoring stays authoritative (no client writes to the tables).

interface CreateBody {
  quizPackId?: string;
  quizPackName?: string;
  totalQuestions?: number;
  maxScore?: number;
  invitedUserIds?: string[];
  myScore?: number | null; // present if the creator played first
  myCorrect?: number | null;
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`grp-create:${user.id}`, 15, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: CreateBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { quizPackId, quizPackName, totalQuestions, maxScore, invitedUserIds, myScore, myCorrect } = body;
  if (!quizPackId || !quizPackName) return NextResponse.json({ error: "Missing quiz pack" }, { status: 400 });
  for (const [k, v] of Object.entries({ totalQuestions, maxScore })) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return NextResponse.json({ error: `Invalid ${k}` }, { status: 400 });
    }
  }
  const invited = Array.isArray(invitedUserIds)
    ? Array.from(new Set(invitedUserIds.filter((id) => typeof id === "string" && id !== user.id))).slice(0, 50)
    : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  // Names: creator + invited.
  const { data: profs } = await db
    .from("profiles").select("id, display_name").in("id", [user.id, ...invited]);
  const names: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (profs ?? []).forEach((p: any) => { names[p.id] = p.display_name ?? "Player"; });

  const { data: challenge, error: cErr } = await db
    .from("group_challenges")
    .insert({
      kind: "group",
      creator_id: user.id,
      creator_name: names[user.id] ?? "Someone",
      quiz_pack_id: quizPackId,
      quiz_pack_name: quizPackName,
      total_questions: Math.round(totalQuestions as number),
      max_score: Math.round(maxScore as number),
    })
    .select("id")
    .single();
  if (cErr || !challenge) return NextResponse.json({ error: "Could not create challenge" }, { status: 500 });

  const played = typeof myScore === "number" && Number.isFinite(myScore);
  const rows = [
    {
      challenge_id: challenge.id, user_id: user.id, display_name: names[user.id] ?? "Someone",
      score: played ? Math.round(myScore as number) : null,
      correct: played ? Math.round((myCorrect as number) ?? 0) : null,
      invited: false, played_at: played ? new Date().toISOString() : null, seen: true,
    },
    ...invited.map((id) => ({
      challenge_id: challenge.id, user_id: id, display_name: names[id] ?? "Player",
      score: null, correct: null, invited: true, played_at: null, seen: false,
    })),
  ];
  await db.from("group_challenge_participants").insert(rows);

  // Push the invited friends: "X started a group challenge" → opens the board.
  // Best-effort, opt-in-gated, one push per invitee for this board.
  if (invited.length) {
    void notifyUsers({
      userIds: invited,
      title: "New group challenge",
      body: `${names[user.id] ?? "Someone"} started a ${quizPackName} board — beat the group`,
      url: `/g/${challenge.id}`,
      dedupeKey: `grp-invite:${challenge.id}`,
    });
  }

  return NextResponse.json({ id: challenge.id });
}
