import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { slugify } from "@/lib/utils";
import {
  GAMEDAY_PUSH_PREFIX,
  isPublishable,
  londonDayRange,
  londonMatchday,
  packDescription,
  packName,
  packUrl,
  pushCopy,
  pushDedupeKey,
  questionsForPublish,
  validatePackQuestions,
  type GamedayRow,
  type QuizQuestion,
} from "@/lib/gameday/shared";

/**
 * The Gameday publish engine — pack insert + push fan-out, salvaged from
 * src/lib/halftime/release.ts. The big simplification the pivot buys: publish
 * has exactly ONE caller now (the daily Vercel cron), not two racing processes
 * (a VPS poller and a 5-minute watchdog), so the CAS below is a belt to the
 * cron's own single-pass idempotency, not a race it must actually win.
 *
 * Exactly-once is still enforced at the same two layers as before:
 *   1. state: `update ... where state = 'approved'` — a single-statement CAS.
 *   2. pack: insert with the pre-assigned uuid + on conflict (id) do nothing.
 *   3. push: notification_log PK (user_id, key) + notifyUsers logs before it
 *      delivers.
 */

/**
 * quiz_packs.type MUST be one of club|national|records — prod CHECK
 * constraint `quiz_packs_type_check`. Same reuse the halftime pipeline made:
 * fixture linkage lives in metadata.gameday, not in `type`. NO ALTERs to
 * quiz_packs (AC32/AC36 — metadata-only usage).
 */
const PACK_TYPE = "records";
/** quiz_packs_source_check allows only 'system' | 'user'. */
const PACK_SOURCE = "system";
const MAX_PUSH_PER_RUN = 2000;

const GAMEDAY_COLS =
  "id, fixture_id, season_id, round_name, gameweek, pack_id, home, away, kickoff_at, " +
  "publish_at, state, kind, base_questions, questions, published_at, second_half_started_at";

/** halftime_releases is not in the generated DB types — untyped handle. */
function db(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

export interface PublishOutcome {
  fixtureId: number;
  state: GamedayRow["state"] | "unknown";
  published: boolean;
  already: boolean;
  packId: string | null;
  slug: string | null;
  pushTargeted: number;
  reason?: string;
}

export async function getGamedayRow(fixtureId: number): Promise<GamedayRow | null> {
  const { data } = await db()
    .from("halftime_releases")
    .select(GAMEDAY_COLS)
    .eq("fixture_id", fixtureId)
    .maybeSingle();
  return (data as GamedayRow | null) ?? null;
}

/** Every row due for publish: state='approved' and publish_at <= now. */
export async function getDueRows(now: Date = new Date()): Promise<GamedayRow[]> {
  const { data, error } = await db()
    .from("halftime_releases")
    .select(GAMEDAY_COLS)
    .eq("state", "approved")
    .eq("kind", "fixture")
    .lte("publish_at", now.toISOString());
  if (error) {
    console.error("[gameday/publish] getDueRows failed", error);
    return [];
  }
  return (data ?? []) as unknown as GamedayRow[];
}

/**
 * Insert the quiz_packs row for an already-published fixture. Idempotent: the
 * uuid is pre-assigned at the approve gate, so on conflict do nothing makes a
 * repeat call a no-op. Returns true if a row now exists.
 */
async function ensurePackRow(row: GamedayRow, questions: QuizQuestion[]): Promise<boolean> {
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
          gameday: {
            fixture_id: row.fixture_id,
            season_id: row.season_id,
            round_name: row.round_name,
            gameweek: row.gameweek,
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
    console.error("[gameday/publish] quiz_packs insert failed", row.fixture_id, error);
    return false;
  }
  return true;
}

/**
 * Who gets pushed — personalised by club (§4.3). Each user gets the pack for
 * the club they support, if that club has a pack publishing today. No
 * fallback to a random fixture: a user with no club_supporters row gets no
 * gameday push at all (AC14). Per-user daily cap = 1, a backstop for double
 * gameweeks (a club plays once a gameweek in the normal case, so the cap
 * should almost never bind).
 */
async function pushForFixture(row: GamedayRow, slug: string): Promise<number> {
  if (!row.pack_id) return 0;

  const raw = db();
  const matchday = londonMatchday(new Date(row.kickoff_at));
  const { startUtc, endUtc } = londonDayRange(matchday);

  const [{ data: fans }, { data: alreadyToday }] = await Promise.all([
    raw
      .from("club_supporters")
      .select("user_id")
      .eq("season_id", row.season_id ?? 0)
      .in("club", [row.home, row.away]),
    // Per-user daily cap: anyone already holding ANY gameday:% notification_log
    // row sent today has had their one gameday push already.
    raw
      .from("notification_log")
      .select("user_id")
      .like("key", `${GAMEDAY_PUSH_PREFIX}%`)
      .gte("sent_at", startUtc)
      .lt("sent_at", endUtc),
  ]);

  const capped = new Set(((alreadyToday ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const targets = Array.from(
    new Set(((fans ?? []) as { user_id: string }[]).map((r) => r.user_id)),
  )
    .filter((id) => !capped.has(id))
    .slice(0, MAX_PUSH_PER_RUN);

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
 * Publish a fixture's pack. Idempotent and safe to call concurrently, though
 * the daily cron is its only caller in production (AC9 exercises it 3x
 * concurrently anyway).
 */
export async function publishFixture(fixtureId: number): Promise<PublishOutcome> {
  const raw = db();
  const row = await getGamedayRow(fixtureId);

  if (!row) {
    return {
      fixtureId, state: "unknown", published: false, already: false,
      packId: null, slug: null, pushTargeted: 0, reason: "no such fixture",
    };
  }

  const slug = slugify(packName(row));

  // Already published. Re-invocation must never push again or change state —
  // but it IS the repair path for a crash between the CAS and the pack insert.
  if (row.state === "published") {
    const repaired = row.pack_id ? await ensurePackRow(row, questionsForPublish(row)) : false;
    return {
      fixtureId, state: row.state, published: false, already: true,
      packId: row.pack_id, slug, pushTargeted: 0, reason: repaired ? "repaired pack row" : undefined,
    };
  }

  if (!isPublishable(row.state)) {
    return {
      fixtureId, state: row.state, published: false, already: false,
      packId: row.pack_id, slug, pushTargeted: 0, reason: `not approved (state=${row.state})`,
    };
  }

  // Content gate. A pack that fails validation must never reach a player.
  const questions = questionsForPublish(row);
  const errs = validatePackQuestions(questions);
  if (errs.length) {
    console.error("[gameday/publish] pack failed validation, marking failed", fixtureId, errs);
    await raw
      .from("halftime_releases")
      .update({ state: "failed" })
      .eq("id", row.id)
      .eq("state", "approved");
    return {
      fixtureId, state: "failed", published: false, already: false,
      packId: row.pack_id, slug, pushTargeted: 0, reason: `invalid pack: ${errs.join("; ")}`,
    };
  }

  // ── THE COMPARE-AND-SET ───────────────────────────────────────────────────
  const { data: won, error: casErr } = await raw
    .from("halftime_releases")
    .update({ state: "published", published_at: new Date().toISOString(), questions })
    .eq("id", row.id)
    .eq("state", "approved")
    .select("id");

  if (casErr) {
    console.error("[gameday/publish] publish CAS failed", fixtureId, casErr);
    return {
      fixtureId, state: row.state, published: false, already: false,
      packId: row.pack_id, slug, pushTargeted: 0, reason: `cas error: ${casErr.message}`,
    };
  }

  if (!won || won.length === 0) {
    const now = await getGamedayRow(fixtureId);
    return {
      fixtureId, state: now?.state ?? row.state, published: false, already: true,
      packId: now?.pack_id ?? row.pack_id, slug, pushTargeted: 0, reason: "lost CAS race",
    };
  }

  // We won. From here the pack insert and the push happen exactly once.
  const inserted = await ensurePackRow(row, questions);
  if (!inserted) {
    return {
      fixtureId, state: "published", published: true, already: false,
      packId: row.pack_id, slug, pushTargeted: 0, reason: "pack insert failed; needs repair",
    };
  }

  const pushTargeted = await pushForFixture(row, slug);

  return {
    fixtureId, state: "published", published: true, already: false,
    packId: row.pack_id, slug, pushTargeted,
  };
}

/**
 * A pack whose kickoff has already passed while still `approved` → cancelled,
 * never published (AC12) — a pack for a match already played is pointless and
 * its content may now read as stale.
 */
export async function cancelStaleFixture(fixtureId: number, reason: string): Promise<{ cancelled: boolean; state: string }> {
  const raw = db();
  const row = await getGamedayRow(fixtureId);
  if (!row) return { cancelled: false, state: "unknown" };
  if (row.state === "published" || row.state === "cancelled") {
    return { cancelled: false, state: row.state };
  }

  const { data: won } = await raw
    .from("halftime_releases")
    .update({ state: "cancelled" })
    .eq("id", row.id)
    .in("state", ["scheduled", "base_ready", "approved", "failed"])
    .select("id");

  if (won && won.length) {
    console.warn(`[gameday/publish] fixture ${fixtureId} cancelled: ${reason}`);
    return { cancelled: true, state: "cancelled" };
  }
  return { cancelled: false, state: row.state };
}
