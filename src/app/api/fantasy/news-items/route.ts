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

type Topic = "team-news" | "transfer" | "general";

interface Item {
  kind: "article" | "tweet";
  /** Which feed section this belongs to. Without it, one untyped table fed BOTH
   *  "Team news" and "Transfers" and every item rendered twice (migration 78). */
  topic?: Topic;
  /** Stable identity of the SOURCE (tweet id / article guid) — the dedupe key.
   *  The ingester re-reads the same accounts and feeds hourly, so it WILL see
   *  the same item again; this is what stops the feed filling with duplicates. */
  source_key?: string;
  payload: Record<string, string>;
}

const TOPICS: Topic[] = ["team-news", "transfer", "general"];

const valid = (i: Item) =>
  (i.topic === undefined || TOPICS.includes(i.topic)) &&
  (i.source_key === undefined || typeof i.source_key === "string") &&
  ((i.kind === "article" && typeof i.payload?.title === "string" && typeof i.payload?.url === "string") ||
    (i.kind === "tweet" && typeof i.payload?.text === "string" && typeof i.payload?.url === "string" &&
      typeof i.payload?.handle === "string"));

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

  // De-dupe WITHIN the incoming batch first — the caller (or two overlapping
  // runs racing each other) can send the same source_key twice in one POST,
  // and inserting that twice would trip the same unique-violation as an
  // already-stored item.
  const seenInBatch = new Set<string>();
  const deduped = items.filter((i) => {
    if (!i.source_key) return true;
    if (seenInBatch.has(i.source_key)) return false;
    seenInBatch.add(i.source_key);
    return true;
  });
  const dupesInBatch = items.length - deduped.length;

  // Drop items we've already stored. The ingester is an hourly loop over the same
  // X accounts and RSS feeds, so re-seeing an item is the NORMAL case, not an
  // error — without this the feed fills with duplicates (LOOP-STANDARD rule 4).
  //
  // Read-then-insert rather than upsert-on-conflict: the unique index on
  // source_key is PARTIAL (`where source_key is not null`), and Postgres can't
  // infer a conflict target from a partial index.
  const keys = deduped.map((i) => i.source_key).filter((k): k is string => !!k);
  let seen = new Set<string>();
  if (keys.length) {
    const { data: existing } = await db
      .from("fantasy_news_items").select("source_key").in("source_key", keys);
    seen = new Set((existing ?? []).map((r) => r.source_key as string));
  }

  const rows = deduped
    .filter((i) => !i.source_key || !seen.has(i.source_key))
    .map((i) => ({
      kind: i.kind,
      topic: i.topic ?? "general",
      source_key: i.source_key ?? null,
      payload: i.payload,
    }));

  // Insert row-by-row rather than one multi-row insert: the read-then-insert
  // above isn't atomic, so a concurrent run (or the same source_key slipping
  // through by a race) can still trip the partial unique index. A single
  // multi-row insert fails the WHOLE batch on one conflict — including
  // genuinely fresh items. Row-by-row means only that one row is skipped.
  let inserted = 0;
  let raceDupes = 0;
  const otherErrors: string[] = [];
  for (const row of rows) {
    const { error } = await db.from("fantasy_news_items").insert(row);
    if (!error) { inserted++; continue; }
    if (error.code === "23505") { raceDupes++; continue; } // unique_violation — expected
    otherErrors.push(error.message);
  }

  return NextResponse.json({
    ok: true,
    received: items.length,
    inserted,
    skippedDuplicate: dupesInBatch + (deduped.length - rows.length) + raceDupes,
    ...(otherErrors.length ? { failed: otherErrors.length, errors: otherErrors } : {}),
  });
}
