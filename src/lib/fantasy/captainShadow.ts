/** Captain Assist shadow mode — the live proof.
 *
 *  The backtest showed the captaincy signal beating a synthetic manager across
 *  two seasons. That is not the same as helping REAL users, and no public
 *  performance claim is allowed until this measures it.
 *
 *  Three phases, deliberately separated in time:
 *
 *    freeze()          before the deadline. Keeps the OFFICIAL shadow record
 *                      pointed at the latest valid pre-deadline recommendation
 *                      (status 'provisional'). Runs for every user with a squad,
 *                      not just those who can see the feature — otherwise the
 *                      control arm has nothing to compare against.
 *
 *    captureDeadline() at the deadline. Writes an IMMUTABLE snapshot of what the
 *                      user actually took into the gameweek and flips the shadow
 *                      record to 'final_frozen'. Without this the counterfactual
 *                      is corrupt: a user who changed captain after the
 *                      recommendation was frozen would otherwise be compared
 *                      against a choice they never made.
 *
 *    score()           only once FPL reports the gameweek finished AND
 *                      data_checked. Provisional results would let late bonus or
 *                      corrections move the measured edge.
 *
 *  The metric applies the FULL captain/vice fallback rule rather than naively
 *  comparing two named players: if a captain does not appear, the vice captains
 *  instead. Uplift is effective(recommended) - effective(actual), which is the
 *  incremental team-score value, since the captain slot adds one extra copy of
 *  that player's points.
 *
 *  Recommendation QUALITY and user ADOPTION are recorded separately: a good
 *  recommendation the user ignored is not a failure of the model.
 *
 *  Scoring uses YourScore's own points (fantasy_player_scores), which award no
 *  bonus — never FPL totals, which do.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCaptainAssist, FEATURE_VERSION } from "./captainAssist";
import { SCORING_VERSION } from "./values";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const BOOT = "https://fantasy.premierleague.com/api/bootstrap-static/";

/** Exclusion codes are declared HERE, before any outcome is known, so the
 *  eligible set can never be quietly redefined once results look bad. */
export type ExclusionReason =
  | "no_active_squad" | "stale_snapshot" | "recommendation_after_deadline"
  | "missing_deadline_squad" | "illegal_squad" | "model_error"
  | "player_mapping_error" | "gameweek_not_final";

export const EXPERIMENT_ID = "captain_assist_v1";
export const ASSIGNMENT_VERSION = "v1";

/** FNV-1a over `experiment_id:user_id`. Deliberately dependency-free and
 *  auditable: anyone can recompute an assignment from the two ids alone, which
 *  is the point of a deterministic experiment. Keying on the experiment too
 *  means a future experiment reshuffles independently rather than inheriting
 *  this one's split. */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export async function assignArm(db: Db, userId: string, gw: number | null): Promise<"treatment" | "control"> {
  const { data: existing } = await db
    .from("fantasy_captain_experiment")
    .select("arm").eq("experiment_id", EXPERIMENT_ID).eq("user_id", userId).maybeSingle();
  if (existing?.arm) return existing.arm as "treatment" | "control";
  // Never reassigned after seeing performance — the table's trigger enforces
  // that as well as this read-first path.
  const arm: "treatment" | "control" = stableHash(`${EXPERIMENT_ID}:${userId}`) % 2 === 0 ? "control" : "treatment";
  await db.from("fantasy_captain_experiment").insert({
    experiment_id: EXPERIMENT_ID, user_id: userId, arm,
    assignment_version: ASSIGNMENT_VERSION, assigned_gw: gw,
  });
  return arm;
}

type EventRow = { id: number; finished?: boolean; data_checked?: boolean; deadline_time?: string; is_next?: boolean };

async function fplEvents(): Promise<EventRow[]> {
  const r = await fetch(BOOT, { headers: { "User-Agent": "yourscore-fantasy" }, cache: "no-store" });
  const j = await r.json();
  return (j.events ?? []) as EventRow[];
}

/** Scoreable only when FPL says finished AND data_checked (bonus confirmed). */
export async function isGameweekFinal(gw: number, events?: EventRow[]): Promise<boolean> {
  const evs = events ?? (await fplEvents());
  const e = evs.find((x) => x.id === gw);
  return !!(e?.finished && e?.data_checked);
}

async function upcoming(db: Db, isRehearsal = false): Promise<{ gw: number | null; deadline: string | null }> {
  // A rehearsal row must never become production's "latest", and the
  // rehearsal harness must only ever see its own rows.
  const { data } = await db
    .from("fantasy_fpl_snapshot")
    .select("next_event, next_deadline, captured_at")
    .eq("is_rehearsal", isRehearsal)
    .order("captured_at", { ascending: false })
    .limit(1);
  return { gw: data?.[0]?.next_event ?? null, deadline: data?.[0]?.next_deadline ?? null };
}

export type FreezeReport = { gameweek: number | null; considered: number; written: number; errors: number };

/** Keep the official record on the LATEST valid pre-deadline recommendation.
 *  Idempotent: unique (user_id, gameweek) means a re-run updates rather than
 *  duplicating, so a repeated schedule tick cannot double-count. */
/** Rehearsal seams are GATED, not merely unused.
 *
 *  "Production never passes it" is a weaker guarantee than "production cannot
 *  invoke it": a bug, a stray query param or a future caller could otherwise
 *  force gameweek finality and silently corrupt the evaluation. So any use of a
 *  seam throws unless the process is explicitly a non-production rehearsal
 *  environment, and that condition is read from the environment only — no
 *  request argument can turn it on.
 */
function assertRehearsalAllowed(seam: string): void {
  const enabled = process.env.FANTASY_ALLOW_REHEARSAL_SEAMS === "1";
  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (!enabled || isProd) {
    throw new Error(
      `refusing to use rehearsal seam "${seam}": only permitted when ` +
      `FANTASY_ALLOW_REHEARSAL_SEAMS=1 outside production`,
    );
  }
}

/** `onlyUserIds` scopes a run to specific users and `override` supplies a
 *  gameweek/deadline instead of reading the live one. Both are rehearsal-only
 *  and gated by assertRehearsalAllowed. */
export type ShadowOpts = {
  isRehearsal?: boolean;
  onlyUserIds?: string[];
  override?: { gw: number; deadline: string };
};

export async function freezeShadow(db: Db, opts: ShadowOpts = {}): Promise<FreezeReport> {
  if (opts.override) assertRehearsalAllowed("freezeShadow.override");
  if (opts.onlyUserIds) assertRehearsalAllowed("freezeShadow.onlyUserIds");
  const { gw, deadline } = opts.override ?? (await upcoming(db, !!opts.isRehearsal));
  const report: FreezeReport = { gameweek: gw, considered: 0, written: 0, errors: 0 };
  if (gw === null) return report;
  // Never freeze after the deadline — that is not evidence of anything.
  if (deadline && Date.now() > new Date(deadline).getTime()) return report;

  let sq = db.from("fantasy_squads").select("user_id");
  if (opts.onlyUserIds?.length) sq = sq.in("user_id", opts.onlyUserIds);
  const { data: squads } = await sq;
  const rows = (squads ?? []) as { user_id: string }[];
  report.considered = rows.length;

  for (const s of rows) {
    try {
      const rec = await getCaptainAssist(db, s.user_id, { ignoreFlag: true, isRehearsal: opts.isRehearsal });
      if (!rec.enabled || !("available" in rec) || !rec.available) continue;
      const arm = await assignArm(db, s.user_id, gw);

      // Preserve the history: the previous official recommendation is retired
      // with a reason and a link forward, never overwritten. This is what lets
      // us later ask how often advice changed and whether injury news caused it.
      const { data: prevShadow } = await db.from("fantasy_captain_shadow")
        .select("recommendation_id").eq("user_id", s.user_id).eq("gameweek", gw).maybeSingle();
      const prevId: string | null = prevShadow?.recommendation_id ?? null;
      let version = 1;
      if (prevId && prevId !== rec.recommendationId) {
        const { data: prev } = await db.from("fantasy_captain_recommendation")
          .select("recommendation_version, recommended_captain, data_cutoff, squad_fingerprint")
          .eq("id", prevId).maybeSingle();
        version = (prev?.recommendation_version ?? 1) + 1;
        const reason =
          prev && prev.recommended_captain !== rec.captain.id ? "availability_change"
            : prev && prev.data_cutoff !== rec.dataCutoff ? "newer_snapshot"
              : "squad_change";
        await db.from("fantasy_captain_recommendation").update({
          status: "superseded",
          superseded_by_recommendation_id: rec.recommendationId,
          superseded_at: new Date().toISOString(),
          change_reason: reason,
        }).eq("id", prevId);
      }
      await db.from("fantasy_captain_recommendation")
        .update({ status: "provisional", recommendation_version: version })
        .eq("id", rec.recommendationId);
      const { error } = await db.from("fantasy_captain_shadow").upsert({
        user_id: s.user_id,
        gameweek: gw,
        recommendation_id: rec.recommendationId,
        model_version: rec.model,
        model_identity: rec.model,
        feature_version: FEATURE_VERSION,
        signal: rec.signal,
        confidence: rec.confidence,
        data_cutoff: rec.dataCutoff,
        recommended_captain: rec.captain.id,
        recommended_vice: rec.vice.id,
        exposure: arm,
        status: "provisional",
        is_rehearsal: !!opts.isRehearsal,
      }, { onConflict: "user_id,gameweek" });
      if (error) { report.errors++; continue; }
      report.written++;
    } catch {
      report.errors++;
    }
  }
  return report;
}

export type DeadlineReport = { gameweek: number | null; captured: number; finalised: number; skipped: number };

/** THE critical safeguard: snapshot what the user actually took into the
 *  gameweek, immutably, at the deadline. */
export async function captureDeadlineSquads(db: Db, opts: ShadowOpts = {}): Promise<DeadlineReport> {
  if (opts.override) assertRehearsalAllowed("captureDeadlineSquads.override");
  if (opts.onlyUserIds) assertRehearsalAllowed("captureDeadlineSquads.onlyUserIds");
  const { gw, deadline } = opts.override ?? (await upcoming(db));
  const out: DeadlineReport = { gameweek: gw, captured: 0, finalised: 0, skipped: 0 };
  // Only once the deadline has actually passed — and `upcoming` still points at
  // this gameweek until the collector sees the next one.
  if (gw === null || !deadline || Date.now() < new Date(deadline).getTime()) return out;

  let dq = db.from("fantasy_squads").select("user_id, xi, bench, captain, vice");
  if (opts.onlyUserIds?.length) dq = dq.in("user_id", opts.onlyUserIds);
  const { data: squads } = await dq;
  const rows = (squads ?? []) as { user_id: string; xi: number[] | null; bench: number[] | null; captain: number | null; vice: number | null }[];

  const { data: done } = await db.from("fantasy_deadline_squad").select("user_id").eq("gameweek", gw);
  const already = new Set((done ?? []).map((d: { user_id: string }) => d.user_id));

  for (const s of rows) {
    if (already.has(s.user_id)) { out.skipped++; continue; }
    const xi = s.xi ?? [];
    const fp = `${[...xi].sort((a, b) => a - b).join(",")}|${s.captain ?? ""}|${s.vice ?? ""}`;
    const { error } = await db.from("fantasy_deadline_squad").insert({
      user_id: s.user_id, gameweek: gw, xi, bench: s.bench ?? [],
      captain: s.captain, vice: s.vice, squad_fingerprint: fp,
      is_rehearsal: !!opts.isRehearsal,
    });
    if (!error) out.captured++;

    // Flip the official shadow record to final and attach the ACTUAL choice.
    // `followed` is decided HERE, from the immutable deadline squad — never from
    // the confirmation click, because a user can confirm and then reverse it.
    const { data: shadow } = await db.from("fantasy_captain_shadow")
      .select("recommended_captain, recommendation_id").eq("user_id", s.user_id).eq("gameweek", gw).maybeSingle();
    // The last eligible pre-deadline recommendation is the official one.
    if (shadow?.recommendation_id) {
      await db.from("fantasy_captain_recommendation")
        .update({ status: "final_frozen" }).eq("id", shadow.recommendation_id);
    }
    const eligible = xi.length > 0 && s.captain !== null;
    const followed = shadow ? s.captain === shadow.recommended_captain : null;
    const { data: upd } = await db.from("fantasy_captain_shadow")
      .update({
        status: "final_frozen",
        deadline_captain: s.captain,
        deadline_vice: s.vice,
        user_captain: s.captain,
        user_vice: s.vice,
        followed,
        eligible,
        excluded_reason: eligible ? null : ("illegal_squad" as ExclusionReason),
      })
      .eq("user_id", s.user_id).eq("gameweek", gw).select("id");
    if (upd?.length) out.finalised++;

    if (followed !== null) {
      await db.from("fantasy_captain_funnel")
        .update({ recommendation_followed_at_deadline: followed, eligible, updated_at: new Date().toISOString() })
        .eq("user_id", s.user_id).eq("gameweek", gw);
    }
  }
  return out;
}

export type ScoreReport = { scored: number; waiting: number[]; gameweeks: number[] };

/** Effective captaincy points under the real rule: if the captain does not
 *  appear, the vice captains instead. */
function effective(
  cap: { points: number; minutes: number } | undefined,
  vice: { points: number; minutes: number } | undefined,
): { points: number; viceActivated: boolean; appeared: boolean } {
  const capPlayed = (cap?.minutes ?? 0) > 0;
  if (capPlayed) return { points: cap?.points ?? 0, viceActivated: false, appeared: true };
  return { points: vice?.points ?? 0, viceActivated: true, appeared: false };
}

export async function scoreShadow(
  db: Db,
  opts: { forceFinalGameweeks?: number[] } = {},
): Promise<ScoreReport> {
  if (opts.forceFinalGameweeks) assertRehearsalAllowed("scoreShadow.forceFinalGameweeks");
  const out: ScoreReport = { scored: 0, waiting: [], gameweeks: [] };
  const { data: pending } = await db
    .from("fantasy_captain_shadow").select("gameweek").eq("status", "final_frozen");
  const gws = Array.from(new Set((pending ?? []).map((p: { gameweek: number }) => p.gameweek)));
  if (!gws.length) return out;

  const events = await fplEvents();
  for (const gw of gws) {
    // forceFinalGameweeks exists ONLY for the rehearsal — production passes
    // nothing, so finality always comes from FPL's finished && data_checked.
    const forced = opts.forceFinalGameweeks?.includes(gw) ?? false;
    if (!forced && !(await isGameweekFinal(gw, events))) { out.waiting.push(gw); continue; }
    out.gameweeks.push(gw);

    const { data: rows } = await db
      .from("fantasy_captain_shadow")
      .select("id, recommended_captain, recommended_vice, deadline_captain, deadline_vice, eligible")
      .eq("gameweek", gw).eq("status", "final_frozen");
    const shadowRows = (rows ?? []) as {
      id: number; recommended_captain: number; recommended_vice: number | null;
      deadline_captain: number | null; deadline_vice: number | null; eligible: boolean | null;
    }[];
    if (!shadowRows.length) continue;

    const ids = Array.from(new Set(shadowRows.flatMap((r) =>
      [r.recommended_captain, r.recommended_vice, r.deadline_captain, r.deadline_vice],
    ).filter((x): x is number => x !== null)));
    const { data: scores } = await db
      .from("fantasy_player_scores").select("player_id, points, minutes").eq("gw", gw).in("player_id", ids);
    const byId = new Map<number, { points: number; minutes: number }>();
    for (const s of (scores ?? []) as { player_id: number; points: number | null; minutes: number | null }[]) {
      byId.set(s.player_id, { points: s.points ?? 0, minutes: s.minutes ?? 0 });
    }

    const now = new Date().toISOString();
    for (const r of shadowRows) {
      const rec = effective(byId.get(r.recommended_captain), r.recommended_vice ? byId.get(r.recommended_vice) : undefined);
      const missingActual = r.deadline_captain === null;
      const usr = missingActual
        ? null
        : effective(byId.get(r.deadline_captain as number), r.deadline_vice ? byId.get(r.deadline_vice) : undefined);

      await db.from("fantasy_captain_shadow").update({
        status: "scored",
        scored_at: now,
        scoring_version: SCORING_VERSION,
        eligible: r.eligible === false ? false : !missingActual,
        excluded_reason: missingActual ? ("missing_deadline_squad" as ExclusionReason) : null,
        recommended_points: byId.get(r.recommended_captain)?.points ?? 0,
        user_points: missingActual ? null : byId.get(r.deadline_captain as number)?.points ?? 0,
        recommended_vice_points: r.recommended_vice ? byId.get(r.recommended_vice)?.points ?? 0 : null,
        user_vice_points: r.deadline_vice ? byId.get(r.deadline_vice)?.points ?? 0 : null,
        recommended_effective_points: rec.points,
        user_effective_points: usr?.points ?? null,
        // the headline metric, with the vice fallback applied on both sides
        difference: usr ? rec.points - usr.points : null,
        recommended_appeared: rec.appeared,
        user_appeared: usr ? usr.appeared : null,
        recommended_vice_activated: rec.viceActivated,
        user_vice_activated: usr ? usr.viceActivated : null,
      }).eq("id", r.id);
      out.scored++;
    }

    await db.from("fantasy_captain_funnel")
      .update({ recommendation_scored: true, updated_at: now })
      .eq("gameweek", gw);
  }
  return out;
}
