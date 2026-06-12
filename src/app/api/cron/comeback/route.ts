import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { sendComebackEmail } from "@/lib/email/senders";

/**
 * Daily cron: the come-back nudge (template 23-comeback).
 *
 * Cohort: users who signed up 5–21 days ago, confirmed their email, and have
 * never played anything (no quiz attempt, no 38-0 team). Each user can ever
 * receive this email once — enforced by the email_log table (migration 31).
 *
 * Safety rails:
 *  - COMEBACK_EMAILS_ENABLED must be "true" in env, else this is a no-op.
 *    (Guards against blasting seeded/test accounts — flip it on deliberately.)
 *  - Only confirmed email addresses (no bounce fodder).
 *  - Hard cap of 50 sends per run.
 *  - Aborts loudly if email_log doesn't exist yet (apply migration 31 first).
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */
const TEMPLATE = "23-comeback";
const MAX_SENDS_PER_RUN = 50;
const MIN_AGE_DAYS = 5;
const MAX_AGE_DAYS = 21;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.COMEBACK_EMAILS_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, sent: 0, note: "Set COMEBACK_EMAILS_ENABLED=true to activate" });
  }

  const svc = createServiceClient();
  // email_log is not in the generated Database types until migration 31 is
  // applied + types regenerated — use an untyped handle for those calls only.
  const raw = svc as unknown as SupabaseClient;

  // Fail loudly if the dedupe table is missing — never send without it.
  const { error: logProbe } = await raw.from("email_log").select("user_id", { head: true, count: "exact" }).limit(1);
  if (logProbe) {
    return NextResponse.json({ error: "email_log missing — apply migration 31_email_log.sql first" }, { status: 500 });
  }

  const now = Date.now();
  const newestAllowed = now - MIN_AGE_DAYS * 86_400_000;
  const oldestAllowed = now - MAX_AGE_DAYS * 86_400_000;

  let sent = 0;
  let scanned = 0;
  let page = 1;

  // Walk the user list newest-first; the window keeps this bounded.
  while (sent < MAX_SENDS_PER_RUN && page <= 20) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data?.users?.length) break;

    for (const u of data.users) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      scanned++;
      if (!u.email || !u.email_confirmed_at || !u.created_at) continue;
      const created = new Date(u.created_at).getTime();
      if (created > newestAllowed || created < oldestAllowed) continue;

      // Already nudged?
      const { data: logged } = await raw
        .from("email_log")
        .select("user_id")
        .eq("user_id", u.id)
        .eq("template", TEMPLATE)
        .maybeSingle();
      if (logged) continue;

      // Played anything? (quiz attempt or a saved 38-0 team)
      const [{ count: quizCount }, { count: teamCount }] = await Promise.all([
        svc.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("user_id", u.id),
        svc.from("draft_teams").select("user_id", { count: "exact", head: true }).eq("user_id", u.id),
      ]);
      if ((quizCount ?? 0) > 0 || (teamCount ?? 0) > 0) continue;

      // Log BEFORE sending — if the insert races/fails we skip rather than double-send.
      const { error: logErr } = await raw
        .from("email_log")
        .insert({ user_id: u.id, template: TEMPLATE });
      if (logErr) continue;

      await sendComebackEmail({ userId: u.id, email: u.email });
      sent++;
    }

    if (data.users.length < 100) break;
    page++;
  }

  return NextResponse.json({ enabled: true, sent, scanned });
}
