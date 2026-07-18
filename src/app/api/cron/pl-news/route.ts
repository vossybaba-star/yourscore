import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchPlNews } from "@/lib/pl/ingest";

/**
 * GET /api/cron/pl-news — refresh the PL news feed doc. Every 30 min
 * (vercel.json), Bearer CRON_SECRET.
 *
 * Runs the SAME ingest the manual script does (src/lib/pl/ingest.ts) and
 * upserts the singleton pl_news_feed row (id=1). Chosen over a VPS cron so the
 * news tab is self-sustaining from the moment this deploys — no second machine
 * in the loop for a launch-day surface.
 *
 * REFUSES to wipe a good doc with a bad fetch: if both desks fail we keep
 * whatever's already stored (stale news beats no news) and report 502 so the
 * failure is visible in cron logs rather than silently emptying the tab.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { items, sources } = await fetchPlNews();
  if (items.length === 0) {
    console.error("[cron/pl-news] every source failed — keeping the stored doc", sources);
    return NextResponse.json({ ok: false, sources }, { status: 502 });
  }

  const db = createServiceClient() as unknown as SupabaseClient;
  const updatedAt = new Date().toISOString();
  const { error } = await db
    .from("pl_news_feed")
    .upsert({ id: 1, doc: { items, updatedAt }, updated_at: updatedAt }, { onConflict: "id" });

  if (error) {
    console.error("[cron/pl-news] upsert failed", error);
    return NextResponse.json({ ok: false, error: "upsert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: items.length, sources });
}
