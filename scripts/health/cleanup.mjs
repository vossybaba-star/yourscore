/**
 * cleanup.mjs — purge every row the health bot may have written.
 *
 * Runs as Layer 0 (pre-flight: catches leftovers from a crashed run) and again
 * after the journeys layer. DELIBERATELY does NOT touch user_question_history —
 * the bot keeps its question history so it experiences dedup like a real
 * long-term player (that's what makes the repeat-question check meaningful).
 *
 * Standalone: node --env-file=.env.local scripts/health/cleanup.mjs
 */

import { supa } from "./lib/db.mjs";

const BOT_ID = process.env.HEALTH_BOT_USER_ID;

/** Delete bot rows everywhere; returns {table: deletedCount}. */
export async function purgeBotRows() {
  if (!BOT_ID) throw new Error("HEALTH_BOT_USER_ID not set");
  const counts = {};

  const targets = [
    // [table, user column] — draft_wc_matches goes via ON DELETE CASCADE from runs.
    // The user column doubles as the returning column (daily_locks has no id).
    ["quiz_attempts", "user_id"],
    ["draft_wc_runs", "user_id"],
    ["draft_wc_daily_locks", "user_id"], // defensive: ranked probe stops before any lock
    ["h2h_challenges", "challenger_id"],
    ["group_challenges", "creator_id"],
    ["rooms", "created_by"],
  ];

  // Rooms have non-cascading children (answers, question_events, room_scores —
  // only room_members cascades). The health journeys never fire questions, but
  // OTHER harnesses reuse this bot account for authed E2E tests (e.g. Quiz
  // Battle CPU verification), so its rooms can carry children. Clear them first.
  try {
    const { data: rooms } = await supa.from("rooms").select("id").eq("created_by", BOT_ID);
    const roomIds = (rooms ?? []).map((r) => r.id);
    if (roomIds.length) {
      for (const child of ["answers", "question_events", "room_scores"]) {
        const { error } = await supa.from(child).delete().in("room_id", roomIds);
        if (error) counts[child] = `error: ${error.message}`;
      }
    }
  } catch (e) {
    counts.room_children = `error: ${e.message}`;
  }

  for (const [table, col] of targets) {
    const { data, error } = await supa.from(table).delete().eq(col, BOT_ID).select(col);
    if (error) {
      // Missing table/column shouldn't kill the run — record and move on.
      counts[table] = `error: ${error.message}`;
    } else if (data?.length) {
      counts[table] = data.length;
    }
  }
  return counts;
}

/** Layer-0 entry point for the orchestrator. */
export async function run(report, ctx) {
  try {
    const counts = await purgeBotRows();
    ctx.cleanupCounts = counts;
    const leftovers = Object.entries(counts).filter(([, v]) => typeof v === "number");
    const errors = Object.entries(counts).filter(([, v]) => typeof v === "string");
    report.add("cleanup", "bot rows", errors.length === 0, {
      warn: leftovers.length > 0,
      detail: [
        ...leftovers.map(([t, n]) => `${t}:${n} leftover (previous run didn't clean up)`),
        ...errors.map(([t, e]) => `${t} ${e}`),
      ].join("; "),
    });
  } catch (e) {
    report.add("cleanup", "bot rows", false, { detail: e.message });
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const counts = await purgeBotRows();
  console.log(Object.keys(counts).length ? JSON.stringify(counts, null, 2) : "nothing to clean");
}
