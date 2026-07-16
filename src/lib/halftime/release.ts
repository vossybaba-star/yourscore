import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { slugify } from "@/lib/utils";
import {
  assembleQuestions,
  isReleased,
  londonDayRange,
  londonMatchday,
  packDescription,
  packName,
  packUrl,
  pushCopy,
  pushDedupeKey,
  questionsForRelease,
  validatePackQuestions,
  type HalftimeRow,
  type QuizQuestion,
} from "@/lib/halftime/shared";

/**
 * The halftime release engine.
 *
 * ONE code path for every side effect, because two callers can fire at the same
 * instant: the VPS poller (6s live poll) and the Vercel watchdog (the 5-minute
 * cron backstop). Both call releaseFixture(); the compare-and-set inside decides
 * which one wins. Nothing here is safe to duplicate in a route handler.
 *
 * Exactly-once is enforced at THREE independent layers, so no single bug can
 * double-release or double-push:
 *   1. state: `update ... where state = 'staged'` — a single-statement CAS.
 *      Under READ COMMITTED the loser blocks on the row lock, then re-evaluates
 *      its WHERE against the winner's committed row (EvalPlanQual), sees
 *      'released', and updates 0 rows. Exactly one caller proceeds.
 *   2. pack: insert with the pre-assigned uuid + `on conflict do nothing`.
 *   3. push: notification_log has PRIMARY KEY (user_id, key) and notifyUsers
 *      logs BEFORE it delivers — a duplicate key aborts the insert and nothing
 *      is sent.
 */

/**
 * quiz_packs.type MUST be one of club|national|records — there is a CHECK
 * constraint on the column in prod (`quiz_packs_type_check`, verified
 * 2026-07-14). A "halftime" type would be rejected at insert, which means every
 * pack would fail AT THE WHISTLE and nowhere earlier. So we use the same type
 * the daily WC packs use; the fixture linkage lives in metadata.halftime and in
 * `parameter` (the fixture id), not in `type`.
 *
 * Adding a new type value would mean ALTERing quiz_packs, which the spec
 * forbids (AC33: metadata-only usage, no schema change).
 *
 * Side effect worth knowing: the challenge page renders type='records' with its
 * lime accent, and resolves the cover by competition name — which will not match
 * a halftime pack name, so packs ship with the existing gradient card and no
 * generated art. That is exactly the locked creative rule: plumbing ships,
 * pixels wait.
 */
const PACK_TYPE = "records";
/** quiz_packs_source_check allows only 'system' | 'user'. */
const PACK_SOURCE = "system";
const MAX_PUSH_PER_RUN = 2000;

const HALFTIME_COLS =
  "id, fixture_id, season_id, round_name, pack_id, home, away, kickoff_at, state, " +
  "base_questions, fresh_questions, pack_questions, fresh_state, veto_deadline_at, " +
  "telegram_message_id, released_at";

/** halftime_* tables are not in the generated DB types — untyped handle. */
function db(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

export type StoredRow = HalftimeRow;

export interface ReleaseOutcome {
  fixtureId: number;
  state: StoredRow["state"] | "unknown";
  released: boolean;
  already: boolean;
  /** A released fixture whose quiz_packs row was missing and has been re-inserted. */
  repaired: boolean;
  packId: string | null;
  slug: string | null;
  pushTargeted: number;
  reason?: string;
}

export async function getFixtureRow(fixtureId: number): Promise<StoredRow | null> {
  const { data } = await db()
    .from("halftime_releases")
    .select(HALFTIME_COLS)
    .eq("fixture_id", fixtureId)
    .maybeSingle();
  return (data as StoredRow | null) ?? null;
}

/**
 * Insert the quiz_packs row for an already-released fixture. Idempotent: the
 * uuid is pre-assigned at assembly, so `on conflict do nothing` makes a repeat
 * call (or a concurrent one) a no-op. Returns true if a row now exists.
 */
async function ensurePackRow(row: StoredRow, questions: QuizQuestion[]): Promise<boolean> {
  if (!row.pack_id) return false;

  const name = packName(row);
  const matchday = londonMatchday(new Date(row.kickoff_at));

  const { error } = await db()
    .from("quiz_packs")
    .upsert(
      {
        id: row.pack_id,
        name,
        type: PACK_TYPE,
        parameter: String(row.fixture_id),
        source: PACK_SOURCE,
        status: "published",
        rotation_active: true,
        featured: false,
        question_count: questions.length,
        questions,
        description: packDescription(row),
        metadata: {
          halftime: {
            fixture_id: row.fixture_id,
            season_id: row.season_id,
            round_name: row.round_name,
            matchday,
            kickoff_at: row.kickoff_at,
            home: row.home,
            away: row.away,
          },
        },
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

  if (error) {
    console.error("[halftime] quiz_packs insert failed", row.fixture_id, error);
    return false;
  }
  return true;
}

/**
 * Push, once per user per fixture, and at most ONE UNSOLICITED halftime push per
 * user per day — a 5-fixture Saturday must not mean five notifications. First
 * whistle of the day wins; users already pushed for any of today's fixtures are
 * excluded before fan-out.
 *
 * "Notify me" changes who gets what, in two ways:
 *   1. A user who ASKED for this fixture is pushed for it, always. The daily cap
 *      exists to stop us spamming people with matches they didn't ask about; it
 *      must not gag a notification they explicitly requested.
 *   2. A user who asked for ANY of today's fixtures is dropped from the blanket
 *      push. They've told us which match they care about — sending them a
 *      different one would be the exact spam the cap is there to prevent, and
 *      (before this) the cap would then have suppressed the one they wanted.
 *
 * requireOptIn stays true throughout: tapping "Notify me" is a request, not
 * consent to be pushed at all. Someone who asked but never enabled notifications
 * is skipped here — the UI tells them so rather than quietly dropping it.
 */
async function pushForFixture(row: StoredRow, slug: string): Promise<number> {
  if (process.env.HALFTIME_PUSH_ENABLED !== "true") return 0;
  if (!row.pack_id) return 0;

  const raw = db();
  const matchday = londonMatchday(new Date(row.kickoff_at));
  const { startUtc, endUtc } = londonDayRange(matchday);

  // Today's fixtures → the set of push keys that count against the daily cap.
  const { data: todays } = await raw
    .from("halftime_releases")
    .select("fixture_id")
    .gte("kickoff_at", startUtc)
    .lt("kickoff_at", endUtc);

  const todayKeys = ((todays ?? []) as { fixture_id: number }[]).map((r) =>
    pushDedupeKey(Number(r.fixture_id)),
  );

  const { data: alreadyToday } = await raw
    .from("notification_log")
    .select("user_id")
    .in("key", todayKeys.length ? todayKeys : [pushDedupeKey(row.fixture_id)]);

  const capped = new Set(
    ((alreadyToday ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );

  const todayFixtureIds = ((todays ?? []) as { fixture_id: number }[]).map((r) => Number(r.fixture_id));

  // Who explicitly asked for THIS fixture, and who asked for anything today.
  const [{ data: askedThis }, { data: askedToday }] = await Promise.all([
    raw.from("halftime_reminders").select("user_id").eq("fixture_id", row.fixture_id),
    raw
      .from("halftime_reminders")
      .select("user_id")
      .in("fixture_id", todayFixtureIds.length ? todayFixtureIds : [row.fixture_id]),
  ]);

  const requesters = ((askedThis ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const hasRequestToday = new Set(((askedToday ?? []) as { user_id: string }[]).map((r) => r.user_id));

  const { data: optedIn } = await raw
    .from("profiles")
    .select("id")
    .eq("notifications_opt_in", true);

  const blanket = ((optedIn ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !capped.has(id) && !hasRequestToday.has(id));

  // Requesters first, so a run that hits MAX_PUSH_PER_RUN truncates the blanket
  // audience rather than the people who actually asked.
  const targets = Array.from(new Set([...requesters, ...blanket])).slice(0, MAX_PUSH_PER_RUN);

  if (!targets.length) return 0;

  const copy = pushCopy(row);
  const { targeted } = await notifyUsers({
    userIds: targets,
    title: copy.title,
    body: copy.body,
    url: packUrl(slug, row.pack_id),
    dedupeKey: pushDedupeKey(row.fixture_id),
    requireOptIn: true,
  });
  return targeted;
}

/**
 * Release a fixture's pack. Idempotent and safe to call concurrently.
 *
 * `late` = the second half is already under way (the poller died and the
 * watchdog caught it). The pack still goes live — its content was frozen before
 * kick-off and is still true — but NO push fires: a notification arriving after
 * the restart is both useless and a spoiler risk.
 */
export async function releaseFixture(
  fixtureId: number,
  opts: { late?: boolean } = {},
): Promise<ReleaseOutcome> {
  const raw = db();
  const row = await getFixtureRow(fixtureId);

  if (!row) {
    return {
      fixtureId, state: "unknown", released: false, already: false, repaired: false,
      packId: null, slug: null, pushTargeted: 0, reason: "no such fixture",
    };
  }

  const slug = slugify(packName(row));

  // Already released. Re-invocation must never push again or change state — but
  // it IS the repair path for a crash between the CAS and the pack insert.
  if (isReleased(row.state)) {
    const repaired = row.pack_id
      ? await ensurePackRow(row, questionsForRelease(row))
      : false;
    return {
      fixtureId, state: row.state, released: false, already: true, repaired,
      packId: row.pack_id, slug, pushTargeted: 0,
    };
  }

  if (row.state !== "staged") {
    return {
      fixtureId, state: row.state, released: false, already: false, repaired: false,
      packId: row.pack_id, slug, pushTargeted: 0,
      reason: `not staged (state=${row.state})`,
    };
  }

  // Content gate. A pack that fails validation must never reach a player.
  let questions = questionsForRelease(row);
  let errs = validatePackQuestions(questions);
  if (errs.length) {
    // Fall back to the base slate before giving up — a broken fresh slice must
    // not cost the fixture its pack.
    questions = assembleQuestions(row.base_questions, [], row.fixture_id, { baseOnly: true });
    errs = validatePackQuestions(questions);
  }
  if (errs.length) {
    console.error("[halftime] pack failed validation, marking failed", fixtureId, errs);
    await raw
      .from("halftime_releases")
      .update({ state: "failed" })
      .eq("id", row.id)
      .eq("state", "staged");
    return {
      fixtureId, state: "failed", released: false, already: false, repaired: false,
      packId: row.pack_id, slug, pushTargeted: 0,
      reason: `invalid pack: ${errs.join("; ")}`,
    };
  }

  const nextState = opts.late ? "released_late" : "released";

  // ── THE COMPARE-AND-SET ───────────────────────────────────────────────────
  // One statement, conditional on the row still being 'staged'. Whoever loses
  // updates zero rows and stops here — no pack, no push, no state change.
  const { data: won, error: casErr } = await raw
    .from("halftime_releases")
    .update({ state: nextState, released_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("state", "staged")
    .select("id");

  if (casErr) {
    console.error("[halftime] release CAS failed", fixtureId, casErr);
    return {
      fixtureId, state: row.state, released: false, already: false, repaired: false,
      packId: row.pack_id, slug, pushTargeted: 0, reason: `cas error: ${casErr.message}`,
    };
  }

  if (!won || won.length === 0) {
    // Lost the race — the other caller owns the pack insert and the push.
    const now = await getFixtureRow(fixtureId);
    return {
      fixtureId, state: now?.state ?? row.state, released: false, already: true,
      repaired: false, packId: now?.pack_id ?? row.pack_id, slug, pushTargeted: 0,
      reason: "lost CAS race",
    };
  }

  // We won. From here the pack insert and the push happen exactly once.
  const inserted = await ensurePackRow(row, questions);
  if (!inserted) {
    // State says released but the pack is missing. Do NOT push (nothing to open).
    // The next watchdog tick hits the repair path above and inserts it.
    return {
      fixtureId, state: nextState, released: true, already: false, repaired: false,
      packId: row.pack_id, slug, pushTargeted: 0, reason: "pack insert failed; needs repair",
    };
  }

  const pushTargeted = opts.late ? 0 : await pushForFixture(row, slug);

  return {
    fixtureId, state: nextState, released: true, already: false, repaired: false,
    packId: row.pack_id, slug, pushTargeted,
  };
}

/**
 * Freeze a fixture's final 10 and stage it (base_ready → staged, CAS).
 * Called at the veto deadline by the poller, and by the watchdog with
 * `baseOnly` when the poller died before assembly — the watchdog NEVER ships
 * fresh questions, because a dead poller means the veto ledger can't be trusted.
 */
export async function stageFixture(
  fixtureId: number,
  opts: { baseOnly?: boolean } = {},
): Promise<{ staged: boolean; packId: string | null; state: string; reason?: string }> {
  const raw = db();
  const row = await getFixtureRow(fixtureId);
  if (!row) return { staged: false, packId: null, state: "unknown", reason: "no such fixture" };

  if (row.state === "staged") {
    return { staged: false, packId: row.pack_id, state: row.state, reason: "already staged" };
  }
  if (row.state !== "base_ready") {
    return { staged: false, packId: row.pack_id, state: row.state, reason: `not base_ready (state=${row.state})` };
  }

  const baseOnly = opts.baseOnly || row.fresh_state === "killed";
  const questions = assembleQuestions(row.base_questions, row.fresh_questions, row.fixture_id, { baseOnly });

  const errs = validatePackQuestions(questions);
  if (errs.length) {
    return { staged: false, packId: row.pack_id, state: row.state, reason: `invalid pack: ${errs.join("; ")}` };
  }

  const packId = row.pack_id ?? crypto.randomUUID();

  const { data: won, error } = await raw
    .from("halftime_releases")
    .update({ state: "staged", pack_id: packId, pack_questions: questions })
    .eq("id", row.id)
    .eq("state", "base_ready")
    .select("id");

  if (error) return { staged: false, packId: row.pack_id, state: row.state, reason: error.message };
  if (!won || won.length === 0) {
    const now = await getFixtureRow(fixtureId);
    return { staged: false, packId: now?.pack_id ?? null, state: now?.state ?? row.state, reason: "lost CAS race" };
  }
  return { staged: true, packId, state: "staged" };
}

/**
 * Postponed / abandoned / cancelled. No pack is ever inserted and no push ever
 * fires. Only pre-release states can be cancelled — an already-released pack
 * stays up (its content is pre-kickoff and still true even if the match is
 * later abandoned).
 */
export async function cancelFixture(
  fixtureId: number,
  reason: string,
): Promise<{ cancelled: boolean; state: string }> {
  const raw = db();
  const row = await getFixtureRow(fixtureId);
  if (!row) return { cancelled: false, state: "unknown" };
  if (isReleased(row.state) || row.state === "cancelled") {
    return { cancelled: false, state: row.state };
  }

  const { data: won } = await raw
    .from("halftime_releases")
    .update({ state: "cancelled" })
    .eq("id", row.id)
    .in("state", ["scheduled", "base_ready", "staged", "failed"])
    .select("id");

  if (won && won.length) {
    console.warn(`[halftime] fixture ${fixtureId} cancelled: ${reason}`);
    return { cancelled: true, state: "cancelled" };
  }
  return { cancelled: false, state: row.state };
}
