import {
  sendFirstLeagueCreatedEmail,
  sendFirstMemberJoinsEmail,
  sendFirstQuizEmail,
  sendLeagueInviteEmail,
} from "@/lib/email/senders";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { NextRequest, NextResponse } from "next/server";

/**
 * Lifecycle email dispatcher — clients post here after key events.
 * The server does the "is this the first?" check, then fires the right email.
 *
 * POST /api/email/lifecycle
 * Body: { event: "first_challenge" | "league_created" | "league_joined",
 *         data: { ... event-specific } }
 *
 * All sends are fire-and-forget — failures are logged, not surfaced. The
 * response always returns ok:true once auth + validation pass, so the
 * caller's UX is never blocked on email delivery.
 */
type EventBody =
  | { event: "first_challenge"; data: { club: string; score: number; accuracy: number; streak: number } }
  | { event: "league_created"; data: { leagueId: string } }
  | { event: "league_joined"; data: { leagueId: string } };

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This route triggers outbound email (some of it to OTHER users, e.g. the
  // league creator), so it must not be spammable: legit lifecycle events fire
  // at most once or twice per session.
  const { ok } = await rateLimitDistributed(`email-lifecycle:${user.id}`, 5, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: EventBody;
  try {
    body = (await req.json()) as EventBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Each handler is responsible for its own first-time check.
  switch (body.event) {
    case "first_challenge": {
      const d = body.data;
      // Solo challenge attempts are tracked in quiz_attempts.
      const { count, error } = await supabase
        .from("quiz_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (error) {
        console.error("[email/lifecycle] count quiz_attempts failed:", error);
        return NextResponse.json({ ok: true, sent: false, reason: "count-failed" });
      }
      // count includes the current attempt that just inserted.
      if ((count ?? 0) !== 1) {
        return NextResponse.json({ ok: true, sent: false, reason: "not-first" });
      }
      await sendFirstQuizEmail({
        userId: user.id,
        email: user.email,
        club: d.club,
        score: d.score,
        accuracy: d.accuracy,
        streak: d.streak,
      });
      return NextResponse.json({ ok: true, sent: true, template: "02-first-quiz" });
    }

    case "league_created": {
      const { leagueId } = body.data;
      const { data: league, error } = await supabase
        .from("leagues")
        .select("id, name, code, created_by")
        .eq("id", leagueId)
        .single();
      if (error || !league) {
        return NextResponse.json({ ok: true, sent: false, reason: "league-not-found" });
      }
      if (league.created_by !== user.id) {
        return NextResponse.json({ ok: true, sent: false, reason: "not-creator" });
      }
      // First league = this user created exactly one league.
      const { count } = await supabase
        .from("leagues")
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id);
      if ((count ?? 0) !== 1) {
        return NextResponse.json({ ok: true, sent: false, reason: "not-first-league" });
      }
      await sendFirstLeagueCreatedEmail({
        userId: user.id,
        email: user.email,
        leagueId: league.id,
        leagueName: league.name,
        leagueCode: league.code,
      });
      return NextResponse.json({ ok: true, sent: true, template: "03-first-league-created" });
    }

    case "league_joined": {
      const { leagueId } = body.data;
      // Fetch league + creator info.
      const { data: league } = await supabase
        .from("leagues")
        .select("id, name, code, created_by")
        .eq("id", leagueId)
        .single();
      if (!league) {
        return NextResponse.json({ ok: true, sent: false, reason: "league-not-found" });
      }
      // Guard: leagues without a creator can't be processed for invite/first-member emails.
      const creatorId: string | null = league.created_by;

      // Fetch inviter (creator) name for the invite email.
      const inviterName = creatorId
        ? (
            await supabase
              .from("profiles")
              .select("display_name")
              .eq("id", creatorId)
              .single()
          ).data?.display_name ?? "A friend"
        : "A friend";

      // Member count + top 3 for the invite email body.
      const { count: memberCount } = await supabase
        .from("league_members")
        .select("user_id", { count: "exact", head: true })
        .eq("league_id", leagueId);

      const { data: topRows } = await supabase
        .from("league_members")
        .select("user_id, total_score")
        .eq("league_id", leagueId)
        .order("total_score", { ascending: false, nullsFirst: false })
        .limit(3);

      const top3 = await Promise.all(
        (topRows ?? []).map(async (row) => {
          const { data: p } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("id", row.user_id)
            .single();
          return {
            name: p?.display_name ?? "Player",
            score: row.total_score ?? 0,
          };
        }),
      );

      // 1. Send invite email to the joiner (skip if joiner is the creator — they don't need to be welcomed to their own league).
      if (creatorId !== user.id) {
        await sendLeagueInviteEmail({
          userId: user.id,
          email: user.email,
          inviterName,
          leagueId: league.id,
          leagueName: league.name,
          memberCount: memberCount ?? 1,
          top3,
        });
      }

      // 2. If this brings the league to exactly 2 members AND the joiner is not the creator,
      //    notify the creator that their first member joined.
      if (creatorId && (memberCount ?? 0) === 2 && creatorId !== user.id) {
        // Get creator's email via service role + joiner's display name.
        const svc = createServiceClient();
        const { data: creatorAuth } = await svc.auth.admin
          .getUserById(creatorId)
          .catch(() => ({ data: null }));
        const creatorEmail = creatorAuth?.user?.email;
        const { data: joinerProfile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .single();
        const joinerName = joinerProfile?.display_name ?? "Someone";

        if (creatorEmail) {
          await sendFirstMemberJoinsEmail({
            creatorUserId: creatorId,
            creatorEmail,
            joinerName,
            leagueId: league.id,
            leagueName: league.name,
            leagueCode: league.code,
          });
        }
      }

      return NextResponse.json({ ok: true, sent: true, template: "04 + maybe 09" });
    }

    default:
      return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }
}
