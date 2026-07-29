/** Captain Assist — the ONE recommendation the research actually validated.
 *
 *  Scope is deliberately narrow. Season points-per-game beat the most-owned
 *  template captain in BOTH historical seasons (+0.61/GW in 2025/26, +1.00/GW
 *  in 2024/25, measured under YourScore's own scoring, which awards no bonus).
 *  Full best-XI selection did NOT beat that template, so it is absent here and
 *  this never claims an optimal team.
 *
 *  Every recommendation is FROZEN to a row (migration 211) and returned with its
 *  id. Applying a change must quote that id, and apply() revalidates against it:
 *  a stale card — squad changed, new injury news, deadline passed, snapshot gone
 *  cold — is refused rather than silently applied, and the proposed player can
 *  never change between the card the user read and the write that follows.
 *
 *  Cold start is honest rather than silent: season PPG needs completed
 *  gameweeks, so before MIN_GW_FOR_PPG we fall back to FPL's own ep_next and say
 *  so, at reduced confidence.
 *
 *  Reads only the append-only snapshot tables (migration 210) that the hosted
 *  collector fills — never live third-party APIs at request time, so one
 *  response always has a single frozen data cutoff.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pointsPerAppearance, type ScoreRow } from "./ppg";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/** Explicit model identities. The GW6 switch must be visible in every frozen
 *  recommendation, so the identity encodes WHICH model produced it — never a
 *  single opaque version string that hides the change. */
export const MODEL_COLD_START = "captain_ep_next_v1_gw1_5";
export const MODEL_SEASON_PPG = "captain_season_ppg_v1_gw6_plus";
export const FEATURE_VERSION = "captain-features-v1";
/** Retained for callers that just want "the model family". */
export const CAPTAIN_ASSIST_MODEL = MODEL_SEASON_PPG;
/** Season PPG is unreliable until a few gameweeks have actually been played. */
export const MIN_GW_FOR_PPG = 5;
const MAX_SNAPSHOT_AGE_H = 24;
/** Below this a player is treated as unavailable rather than merely doubtful. */
const UNAVAILABLE_BELOW = 50;
const DOUBTFUL_BELOW = 75;

export type Alternative = { id: number; name: string; label: string; reason: string };
export type Evidence = { label: string; value: string };

export type CaptainAssist =
  | { enabled: false }
  | { enabled: true; available: false; reason: string }
  | {
      enabled: true;
      available: true;
      recommendationId: string;
      gameweek: number | null;
      model: string;
      signal: "season_points_per_game" | "fpl_ep_next_cold_start";
      earlySeason: boolean;
      dataCutoff: string;
      stale: boolean;
      captain: { id: number; name: string };
      vice: { id: number; name: string };
      headline: string;
      evidence: Evidence[];
      viceReason: string;
      alternatives: Alternative[];
      confidence: "High" | "Medium" | "Low";
      confidenceReason: string;
      warnings: { kind: "availability" | "early_season" | "chasing_form" | "stale"; text: string }[];
      currentCaptain: number | null;
      currentVice: number | null;
      captainChanges: boolean;
      viceChanges: boolean;
      currentCaptainName: string | null;
      currentViceName: string | null;
      fixtureStatus: FixtureStatus;
      /** false when fixture data is unknown: the card still shows, but applying
       *  is blocked, because the gameweek could contain blanks or doubles. */
      canApply: boolean;
      disclaimer: string;
    };

export function captainAssistEnabled(): boolean {
  return process.env.FANTASY_CAPTAIN_ASSIST === "1";
}

type SnapRow = {
  player_id: number; web_name: string | null; position: string | null; team: number | null;
  ep_next: number | null; form: number | null; status: string | null;
  news: string | null; chance_of_playing_next_round: number | null; next_event: number | null;
};

/** Detects a squad change between viewing a recommendation and confirming it. */
function fingerprint(xi: number[], captain: number | null, vice: number | null): string {
  return `${[...xi].sort((a, b) => a - b).join(",")}|${captain ?? ""}|${vice ?? ""}`;
}

export type FixtureCtx = { fixture_id: number; opponent_id: number; opponent: string | null; home: boolean };

/** Fixture context for a gameweek, keyed by FPL team id.
 *  EXPLANATION ONLY — it never feeds the ranking. A fixture-adjusted model would
 *  be a different model, needing its own version and its own evaluation. */
async function loadFixtures(db: Db, gw: number, cutoff?: string, isRehearsal = false): Promise<Map<number, FixtureCtx[]>> {
  return (await loadFixtureSet(db, gw, cutoff, isRehearsal)).byTeam;
}

export type FixtureSet = {
  byTeam: Map<number, FixtureCtx[]>;
  /** complete = we hold a fixture capture for this gameweek that predates the
   *  recommendation cutoff, so an absent club is a REAL blank rather than a
   *  collection gap. */
  complete: boolean;
  clubs: number;
  fixtures: number;
};

/** Missing fixture data must never be silently read as "this player has a
 *  fixture" — that would recommend a captain in a blank gameweek whenever
 *  collection failed. Absence of data and absence of a fixture are different
 *  facts and are reported as such. */
async function loadFixtureSet(db: Db, gw: number, cutoff?: string, isRehearsal = false): Promise<FixtureSet> {
  const byTeam = new Map<number, FixtureCtx[]>();
  // Rehearsal rows must never leak into a real read, and the rehearsal harness
  // must only ever see its own — never hardcode `false` here.
  let q = db.from("fantasy_fixture_snapshot").select("captured_at")
    .eq("event", gw).eq("is_rehearsal", isRehearsal)
    .order("captured_at", { ascending: false }).limit(1);
  // The fixture snapshot must predate the recommendation cutoff, or the
  // explanation would be built from data the recommendation never saw.
  if (cutoff) q = q.lte("captured_at", cutoff);
  const { data: latest } = await q;
  const cap = latest?.[0]?.captured_at;
  if (!cap) return { byTeam, complete: false, clubs: 0, fixtures: 0 };
  const { data: fx } = await db
    .from("fantasy_fixture_snapshot")
    .select("fixture_id, team_h, team_a, team_h_name, team_a_name")
    .eq("event", gw).eq("captured_at", cap).eq("is_rehearsal", isRehearsal);
  for (const f of (fx ?? []) as { fixture_id: number; team_h: number; team_a: number; team_h_name: string | null; team_a_name: string | null }[]) {
    const home = byTeam.get(f.team_h) ?? [];
    home.push({ fixture_id: f.fixture_id, opponent_id: f.team_a, opponent: f.team_a_name, home: true });
    byTeam.set(f.team_h, home);
    const away = byTeam.get(f.team_a) ?? [];
    away.push({ fixture_id: f.fixture_id, opponent_id: f.team_h, opponent: f.team_h_name, home: false });
    byTeam.set(f.team_a, away);
  }
  const rows = (fx ?? []).length;
  // The collector writes a gameweek's fixtures from one successful fetch, so a
  // capture that exists is complete by construction. The club count is recorded
  // for the completeness check rather than used to guess.
  return { byTeam, complete: rows > 0, clubs: byTeam.size, fixtures: rows };
}

export type FixtureStatus = "confirmed_fixture" | "confirmed_blank" | "unknown";

export function fixtureStatusFor(set: FixtureSet, team: number | null): FixtureStatus {
  if (!set.complete) return "unknown";
  if (team === null) return "unknown";
  return (set.byTeam.get(team)?.length ?? 0) > 0 ? "confirmed_fixture" : "confirmed_blank";
}

/** "Home to Everton" / "Away at Fulham" / both, joined, for a double gameweek. */
export function fixtureLabel(fixtures: FixtureCtx[] | undefined): string {
  if (!fixtures || !fixtures.length) return "No fixture this gameweek";
  return fixtures
    .map((f) => (f.home ? `Home to ${f.opponent ?? "TBC"}` : `Away at ${f.opponent ?? "TBC"}`))
    .join(" · ");
}

function availabilityLabel(c: number | null, status: string | null): string {
  if (status && status !== "a") return "Doubtful";
  if (c === null) return "High availability";
  if (c >= 100) return "High availability";
  if (c >= DOUBTFUL_BELOW) return "Likely to play";
  return `${c}% chance of playing`;
}

/** `ignoreFlag` exists for shadow mode: recommendations are generated and frozen
 *  for EVERY eligible user regardless of who can see the feature, otherwise the
 *  control group has nothing to compare against and the experiment is dead. */
export async function getCaptainAssist(
  db: Db, userId: string, opts: { ignoreFlag?: boolean; isRehearsal?: boolean } = {},
): Promise<CaptainAssist> {
  if (!opts.ignoreFlag && !captainAssistEnabled()) return { enabled: false };

  const { data: squad } = await db
    .from("fantasy_squads")
    .select("xi, captain, vice")
    .eq("user_id", userId)
    .maybeSingle();
  // The captain must be a starter, so the XI is the candidate set — not the bench.
  const xi: number[] = (squad?.xi ?? []) as number[];
  if (!xi.length) return { enabled: true, available: false, reason: "no squad yet" };

  // A rehearsal row must never become production's "latest" — and the
  // rehearsal harness, which passes isRehearsal explicitly, must only ever see
  // its own rows, never real ones.
  const { data: latest } = await db
    .from("fantasy_fpl_snapshot")
    .select("captured_at")
    .eq("is_rehearsal", !!opts.isRehearsal)
    .order("captured_at", { ascending: false })
    .limit(1);
  const cutoff: string | undefined = latest?.[0]?.captured_at;
  if (!cutoff) return { enabled: true, available: false, reason: "no data collected yet" };

  const { data: rows } = await db
    .from("fantasy_fpl_snapshot")
    .select("player_id, web_name, position, team, ep_next, form, status, news, chance_of_playing_next_round, next_event")
    .eq("captured_at", cutoff)
    .eq("is_rehearsal", !!opts.isRehearsal)
    .in("player_id", xi);
  const snap = (rows ?? []) as SnapRow[];
  if (!snap.length) return { enabled: true, available: false, reason: "squad not present in latest snapshot" };

  const ageH = (Date.now() - new Date(cutoff).getTime()) / 3.6e6;
  const stale = ageH > MAX_SNAPSHOT_AGE_H;
  const warnings: { kind: "availability" | "early_season" | "chasing_form" | "stale"; text: string }[] = [];
  if (stale) {
    warnings.push({ kind: "stale", text: `This data is ${Math.round(ageH)} hours old, so treat it with caution.` });
  }

  // Availability: exclude the clearly out, warn on the doubtful. Historical
  // injury data never existed, so this is the first season we can do this at all.
  for (const r of snap) {
    const c = r.chance_of_playing_next_round;
    if (c !== null && c < DOUBTFUL_BELOW) {
      warnings.push({
        kind: "availability",
        text: `${r.web_name} is currently marked with a ${c}% chance of playing${r.news ? ` (${r.news})` : ""}.`,
      });
    }
  }
  const gwForFixtures = snap[0]?.next_event ?? null;
  const fixtureSet: FixtureSet = gwForFixtures !== null
    ? await loadFixtureSet(db, gwForFixtures, cutoff, !!opts.isRehearsal)
    : { byTeam: new Map<number, FixtureCtx[]>(), complete: false, clubs: 0, fixtures: 0 };
  const fixturesByTeam = fixtureSet.byTeam;
  // Only a CONFIRMED blank excludes a player. Unknown never does — but it costs
  // confidence and blocks applying, rather than quietly passing as a fixture.
  const notBlank = (r: SnapRow) => fixtureStatusFor(fixtureSet, r.team) !== "confirmed_blank";

  let pool = snap.filter((r) => {
    const c = r.chance_of_playing_next_round;
    return r.status === "a" && !(c !== null && c < UNAVAILABLE_BELOW) && notBlank(r);
  });
  if (pool.length < 2) pool = snap.filter(notBlank);
  if (pool.length < 2) pool = snap; // never fail closed on a fully flagged squad

  // Signal choice: season PPG once there is enough season to average over.
  const { data: scored } = await db
    .from("fantasy_player_scores")
    .select("gw, player_id, points, minutes")
    .in("player_id", pool.map((p) => p.player_id));
  const scoreRows = (scored ?? []) as ScoreRow[];
  const usePpg = new Set(scoreRows.map((s) => s.gw)).size >= MIN_GW_FOR_PPG;

  const scoreById = usePpg ? pointsPerAppearance(scoreRows) : new Map<number, number>();
  if (!usePpg) {
    for (const r of pool) scoreById.set(r.player_id, Number(r.ep_next ?? 0));
    warnings.push({
      kind: "early_season",
      text: "There is not enough current-season data yet, so this uses FPL's projection and current availability information.",
    });
  }

  const ranked = [...pool]
    .map((r) => ({
      id: r.player_id,
      name: r.web_name ?? String(r.player_id),
      score: scoreById.get(r.player_id) ?? 0,
      form: Number(r.form ?? 0),
      chance: r.chance_of_playing_next_round,
      status: r.status,
      team: r.team,
    }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length < 2) return { enabled: true, available: false, reason: "not enough available players to rank" };

  const [cap, vice] = ranked;
  const gap = (cap.score - vice.score) / (Math.abs(cap.score) + 1e-6);
  let confidence: "High" | "Medium" | "Low" = gap > 0.2 ? "High" : gap < 0.05 ? "Low" : "Medium";
  if (stale || !usePpg) confidence = confidence === "High" ? "Medium" : "Low";

  // Chasing recent form was the worst captaincy strategy in both seasons tested
  // (3.64 and 6.64 points per gameweek, against 6.46 and 8.42 for season form).
  // But that is OUR finding, not the user's mistake: the copy states both facts
  // and lets them choose, rather than telling them they are getting it wrong.
  // Only fires when their ACTUAL captain differs from the pick AND is the
  // in-form player, never as generic copy.
  const currentCap = (squad?.captain ?? null) as number | null;
  const currentCapRow = ranked.find((r) => r.id === currentCap);
  const hottest = [...ranked].sort((a, b) => b.form - a.form)[0];
  if (currentCap && currentCap !== cap.id && currentCapRow && hottest?.id === currentCap && currentCapRow.form > 0) {
    warnings.push({
      kind: "chasing_form",
      text: `${currentCapRow.name} is your in-form pick. ${cap.name} has scored more per game across the season.`,
    });
  }

  // Season PPG is our own measured fact and is stated plainly. The cold-start
  // number is a FORECAST — GW1-5 genuinely cannot be past-tensed — so it is
  // attributed to FPL rather than voiced as ours, per the founder's ruling.
  const scoringLabel = usePpg ? "Season scoring" : "FPL's projection";
  const unit = usePpg ? "points per appearance this season" : "for this gameweek";
  const fixtureUnknown = !fixtureSet.complete;
  if (fixtureUnknown) {
    warnings.push({ kind: "stale", text: "Fixture information is temporarily unavailable." });
    confidence = "Low";
  }
  const capFixtures = cap.team !== null ? fixturesByTeam.get(cap.team) : undefined;
  const viceFixtures = vice.team !== null ? fixturesByTeam.get(vice.team) : undefined;
  const evidence: Evidence[] = [
    { label: scoringLabel, value: `${cap.score.toFixed(1)} ${unit}` },
    { label: "Availability", value: availabilityLabel(cap.chance, cap.status) },
  ];
  if (fixtureSet.complete) evidence.push({ label: "Fixture", value: fixtureLabel(capFixtures) });

  // Frozen with the recommendation so a historical explanation is never rebuilt
  // from newer data if the fixture is later moved or postponed.
  const fixtureContext = {
    complete: fixtureSet.complete,
    clubs: fixtureSet.clubs,
    fixtures: fixtureSet.fixtures,
    captain: {
      fixtures: capFixtures ?? [],
      status: fixtureStatusFor(fixtureSet, cap.team),
      label: fixtureSet.complete ? fixtureLabel(capFixtures) : "Fixture information is temporarily unavailable",
    },
    vice: {
      fixtures: viceFixtures ?? [],
      status: fixtureStatusFor(fixtureSet, vice.team),
      label: fixtureSet.complete ? fixtureLabel(viceFixtures) : "Fixture information is temporarily unavailable",
    },
  };

  // Two alternatives, labelled from the data rather than from marketing copy.
  const altRows = ranked.slice(2, 4);
  const safest = [...altRows].sort((a, b) => (b.chance ?? 100) - (a.chance ?? 100))[0];
  const alternatives: Alternative[] = altRows.map((r) => ({
    id: r.id,
    name: r.name,
    label: safest && r.id === safest.id && altRows.length > 1 ? "Safer alternative" : "Higher upside",
    reason: `${r.score.toFixed(1)} ${unit} · ${availabilityLabel(r.chance, r.status)}`,
  }));

  const currentVice = (squad?.vice ?? null) as number | null;
  const nameOf = (id: number | null) => (id ? (snap.find((s) => s.player_id === id)?.web_name ?? null) : null);

  const gw = snap[0]?.next_event ?? null;
  const fp = fingerprint(xi, currentCap, currentVice);

  // Freeze it. The id is the contract for applying it later.
  const { data: rec } = await db
    .from("fantasy_captain_recommendation")
    .insert({
      user_id: userId,
      gameweek: gw,
      model_version: usePpg ? MODEL_SEASON_PPG : MODEL_COLD_START,
      signal: usePpg ? "season_points_per_game" : "fpl_ep_next_cold_start",
      data_cutoff: cutoff,
      recommended_captain: cap.id,
      recommended_vice: vice.id,
      alternatives,
      confidence,
      warnings,
      squad_fingerprint: fp,
      previous_captain: currentCap,
      previous_vice: currentVice,
      fixture_context: fixtureContext,
      is_rehearsal: !!opts.isRehearsal,
    })
    .select("id")
    .single();

  return {
    enabled: true,
    available: true,
    recommendationId: rec?.id as string,
    gameweek: gw,
    model: usePpg ? MODEL_SEASON_PPG : MODEL_COLD_START,
    signal: usePpg ? "season_points_per_game" : "fpl_ep_next_cold_start",
    earlySeason: !usePpg,
    dataCutoff: cutoff,
    stale,
    captain: { id: cap.id, name: cap.name },
    vice: { id: vice.id, name: vice.name },
    headline: usePpg
      ? "The strongest combination of scoring rate and playing time in your XI."
      : "FPL's projection and current availability are the strongest in your XI for this gameweek.",
    evidence,
    // Fact, not a superlative: the vice is simply rank two by score, and can be
    // a flagged player in the all-flagged fallback — never call it "safest".
    viceReason: `${vice.name} is the second-highest score in your XI: ${availabilityLabel(vice.chance, vice.status).toLowerCase()}.`,
    alternatives,
    confidence,
    confidenceReason:
      confidence === "High"
        ? "Strong availability and a clear advantage over your alternatives."
        : confidence === "Medium"
          ? "A modest advantage over the alternatives."
          : "The alternatives are close, so this is a marginal call.",
    warnings,
    currentCaptain: currentCap,
    currentVice,
    captainChanges: currentCap !== cap.id,
    viceChanges: currentVice !== vice.id,
    currentCaptainName: nameOf(currentCap),
    currentViceName: nameOf(currentVice),
    fixtureStatus: fixtureStatusFor(fixtureSet, cap.team),
    canApply: !fixtureUnknown,
    disclaimer: "Recommended.",
  };
}

export type ApplyResult =
  | { ok: true; appliedCaptain: boolean; appliedVice: boolean; captain: number; vice: number }
  | { ok: false; code: "refresh_required" | "not_found" | "nothing_to_apply"; message: string };

/** Apply a FROZEN recommendation. Revalidates before writing: the squad must not
 *  have moved, the players must still be in the XI, the snapshot must still be
 *  fresh, and captain/vice must differ. Anything else sends the user back to a
 *  refreshed card rather than applying something they did not see. The gameweek
 *  deadline is enforced downstream by setSelection's isOpenForEdits check. */
export async function applyCaptainRecommendation(
  db: Db,
  userId: string,
  input: { recommendationId: string; applyCaptain: boolean; applyVice: boolean },
): Promise<ApplyResult> {
  if (!input.applyCaptain && !input.applyVice) {
    return { ok: false, code: "nothing_to_apply", message: "Nothing selected to apply." };
  }

  const { data: rec } = await db
    .from("fantasy_captain_recommendation")
    .select("*")
    .eq("id", input.recommendationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!rec) return { ok: false, code: "not_found", message: "That recommendation could not be found." };
  // Every read below must stay on the same side of the rehearsal line as the
  // recommendation itself — a real recommendation must never be revalidated
  // against a rehearsal snapshot, and vice versa.
  const isRehearsal = !!rec.is_rehearsal;

  const { data: squad } = await db
    .from("fantasy_squads")
    .select("xi, bench, captain, vice")
    .eq("user_id", userId)
    .maybeSingle();
  if (!squad) return { ok: false, code: "refresh_required", message: "No squad found." };

  const xi: number[] = (squad.xi ?? []) as number[];
  if (fingerprint(xi, squad.captain ?? null, squad.vice ?? null) !== rec.squad_fingerprint) {
    return {
      ok: false, code: "refresh_required",
      message: "Your team has changed since this recommendation was created. Refresh Captain Assist before confirming.",
    };
  }
  if (!xi.includes(rec.recommended_captain) || !xi.includes(rec.recommended_vice)) {
    return { ok: false, code: "refresh_required", message: "Those players are no longer in your XI. Refresh Captain Assist." };
  }

  // The snapshot behind the frozen card must still be the current one — new
  // availability information must not be applied under an old recommendation.
  const { data: latest } = await db
    .from("fantasy_fpl_snapshot")
    .select("captured_at")
    .eq("is_rehearsal", isRehearsal)
    .order("captured_at", { ascending: false })
    .limit(1);
  const newest = latest?.[0]?.captured_at as string | undefined;
  if (newest && new Date(newest).getTime() > new Date(rec.data_cutoff).getTime()) {
    const { data: fresher } = await db
      .from("fantasy_fpl_snapshot")
      .select("player_id, status, chance_of_playing_next_round")
      .eq("captured_at", newest)
      .eq("is_rehearsal", isRehearsal)
      .in("player_id", [rec.recommended_captain, rec.recommended_vice]);
    const nowDoubtful = (fresher ?? []).some(
      (r: { status: string | null; chance_of_playing_next_round: number | null }) =>
        r.status !== "a" || (r.chance_of_playing_next_round !== null && r.chance_of_playing_next_round < UNAVAILABLE_BELOW),
    );
    if (nowDoubtful) {
      return {
        ok: false, code: "refresh_required",
        message: "New availability information has changed this recommendation. Refresh Captain Assist.",
      };
    }
  }

  // Applying is blocked while fixture data is unknown: without it we cannot
  // tell a blank gameweek from a collection gap, and a captain in a blank scores
  // nothing. The card is still shown; only the write is refused.
  const frozenCtx = rec.fixture_context as { complete?: boolean } | null;
  if (frozenCtx && frozenCtx.complete === false) {
    return {
      ok: false, code: "refresh_required",
      message: "Fixture information is temporarily unavailable, so this change cannot be applied yet. Refresh Captain Assist shortly.",
    };
  }

  // Fixture context must still hold. A postponement, a move between gameweeks,
  // or a switch to a blank/double changes what the user was told, so the card is
  // refused rather than applied under a stale explanation. Compared on fixture
  // IDS — the frozen names are display-only.
  if (rec.gameweek !== null && rec.gameweek !== undefined && rec.fixture_context) {
    const current = await loadFixtures(db, rec.gameweek, undefined, isRehearsal);
    const { data: capRow } = await db
      .from("fantasy_fpl_snapshot").select("team")
      .eq("player_id", rec.recommended_captain).eq("is_rehearsal", isRehearsal)
      .order("captured_at", { ascending: false }).limit(1);
    const team: number | null = capRow?.[0]?.team ?? null;
    const nowIds = team === null ? [] : (current.get(team) ?? []).map((f) => f.fixture_id).sort();
    const frozen = ((rec.fixture_context as { captain?: { fixtures?: { fixture_id: number }[] } })
      .captain?.fixtures ?? []).map((f) => f.fixture_id).sort();
    if (current.size > 0 && JSON.stringify(nowIds) !== JSON.stringify(frozen)) {
      await db.from("fantasy_captain_recommendation")
        .update({ status: "superseded", superseded_at: new Date().toISOString(), change_reason: "fixture_context_changed" })
        .eq("id", rec.id);
      return {
        ok: false, code: "refresh_required",
        message: "This gameweek's fixtures have changed since this recommendation. Refresh Captain Assist before confirming.",
      };
    }
  }

  const captain = input.applyCaptain ? rec.recommended_captain : (squad.captain as number);
  const vice = input.applyVice ? rec.recommended_vice : (squad.vice as number);
  if (captain === vice) {
    return { ok: false, code: "refresh_required", message: "That would make the same player captain and vice-captain." };
  }

  const { setSelection } = await import("./server");
  await setSelection(db, userId, { xi, bench: (squad.bench ?? []) as number[], captain, vice });

  try {
    const { recordFunnel } = await import("./captainFunnel");
    if (rec.gameweek !== null && rec.gameweek !== undefined) {
      if (input.applyCaptain) await recordFunnel(db, userId, rec.gameweek, "captain_applied");
      if (input.applyVice) await recordFunnel(db, userId, rec.gameweek, "vice_applied");
    }
  } catch { /* analytics must never break a captain change */ }

  await db
    .from("fantasy_captain_recommendation")
    .update({
      applied_captain: input.applyCaptain,
      applied_vice: input.applyVice,
      confirmed_at: new Date().toISOString(),
      outcome: input.applyCaptain && input.applyVice ? "both" : input.applyCaptain ? "captain_only" : "vice_only",
    })
    .eq("id", rec.id);

  return { ok: true, appliedCaptain: input.applyCaptain, appliedVice: input.applyVice, captain, vice };
}
