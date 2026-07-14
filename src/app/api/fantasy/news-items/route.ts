import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Ingest endpoint for the VPS content pipeline (docs/fantasy-news-hub-spec.md §4.4).
 *
 * The VPS dash is file-based (no Supabase) — this is its only path into the app
 * DB, and it keeps DB credentials off the VPS. Bearer CRON_SECRET, same trust
 * boundary as the crons.
 *
 * Tweets must arrive with text/author/handle already extracted: we render
 * native cards, never X's widgets.js (page weight + embed flakiness).
 */
export const fetchCache = "force-no-store";

interface Item {
  kind: "article" | "tweet";
  payload: Record<string, string>;
}

const valid = (i: Item) =>
  (i.kind === "article" && typeof i.payload?.title === "string" && typeof i.payload?.url === "string") ||
  (i.kind === "tweet" && typeof i.payload?.text === "string" && typeof i.payload?.url === "string" &&
    typeof i.payload?.handle === "string");

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let items: Item[];
  try {
    const body = await req.json();
    items = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (items.length === 0 || items.length > 50 || !items.every(valid)) {
    return NextResponse.json({ error: "invalid items" }, { status: 400 });
  }

  // fantasy_news_items isn't in the generated Database types until migration
  // 77 is applied + types regenerated — untyped handle for this call only
  // (same precedent as notify.ts / migration 56).
  const db = createServiceClient() as unknown as SupabaseClient;
  const { error } = await db
    .from("fantasy_news_items")
    .insert(items.map((i) => ({ kind: i.kind, payload: i.payload })));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, inserted: items.length });
}
