import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";

/**
 * Push fan-out for a newly-released quiz pack.
 *
 * Called by scripts/release-packs.mjs (the VPS release cron) — NOT by Vercel cron. The
 * release job has to live on the VPS because campaign email only works there
 * (RESEND_CAMPAIGNS_API_KEY is used exclusively by scripts/lib/broadcast.mjs and is
 * referenced nowhere in src/). But push lives here, in notifyUsers(), which owns the
 * opt-in filter and the log-before-deliver dedupe. Rather than re-implement that in a
 * .mjs script — and inevitably let the two copies drift — the VPS job calls this route.
 *
 * Auth: the same CRON_SECRET bearer the Vercel crons use.
 */
export const fetchCache = "force-no-store";

const MAX_PER_RUN = 5000;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { packId, title, body, url } = await req.json().catch(() => ({}));
  if (!packId || !title || !body) {
    return NextResponse.json({ error: "packId, title and body are required" }, { status: 400 });
  }

  const db = createServiceClient();

  // Only push for a pack that is genuinely live. Guards against a push firing for a pack
  // the founder never approved, or one that was pulled between release and this call.
  const { data: pack } = await db
    .from("quiz_packs")
    .select("id, name, status, rotation_active")
    .eq("id", packId)
    .maybeSingle();

  if (!pack || pack.status !== "published" || !pack.rotation_active) {
    return NextResponse.json({ error: "pack is not live — refusing to push", targeted: 0 }, { status: 409 });
  }

  const { data: users } = await db
    .from("profiles")
    .select("id")
    .eq("notifications_opt_in", true)
    .limit(MAX_PER_RUN);

  const userIds = (users ?? []).map((u) => u.id);
  if (!userIds.length) return NextResponse.json({ targeted: 0, reason: "no opted-in users" });

  // dedupeKey is per-pack, so a retry of the release job cannot double-push. notifyUsers
  // writes the log rows BEFORE delivery for exactly this reason.
  const { targeted } = await notifyUsers({
    userIds,
    title,
    body,
    url: url ?? `/challenges/${pack.name}`,
    dedupeKey: `pack-release:${packId}`,
  });

  return NextResponse.json({ targeted, pack: pack.name });
}
