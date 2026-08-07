/**
 * Scout's Latest — the PURE core: types, thresholds, and the mechanical
 * selection + dedup that decides which players become the day's ideas. No
 * `server-only`, no DB, no model, no pool/tips imports — so the bare-tsc test
 * harness (scripts/fantasy/run-tests.sh) can exercise it directly. The impure
 * orchestration (DB reads, the grounded AI line, the upsert) lives in
 * scoutLatest.ts, which re-exports everything here so callers import one name.
 *
 * The whole point of the split is that the dedup rule — the thing that stops
 * the tab showing the same idea two days running — is unit tested, not trusted.
 */
import type { FantasyPos, PoolPlayer } from "./engine";
import { clubKey } from "./clubKey";

export type ScoutLatestKind = "fixture_swing" | "momentum" | "watch";
export type CopySource = "model" | "mechanical";

// ── selection thresholds (the test drives these exact numbers) ──────────────
/** Minimum ownership climb (selected_by_percent points, over ~24h) to count as
 *  momentum — below this is noise, not managers moving. */
export const MOMENTUM_MIN_DELTA = 0.15;
/** Don't hype a player FPL barely projects, however fast he's being bought. */
export const MOMENTUM_MIN_EP = 1.5;
/** Only flag a doubt on a player enough managers own for it to be actionable. */
export const WATCH_MIN_OWNERSHIP = 10;
/** How many ideas a day, at most. Small on purpose — a recommendation, not a list. */
export const IDEAS_TARGET = 3;
/** Don't repeat a (kind, player) within this many prior days. */
export const DEDUP_LOOKBACK_DAYS = 2;

const OUT_STATUSES = new Set(["i", "s", "u"]);

// ── the shapes the pure core works in ───────────────────────────────────────

/** One snapshot player, trimmed to what selection reads. */
export interface SnapLite {
  playerId: number;
  team: number | null;
  status: string;
  chance: number | null;
  epNext: number | null;
  ownershipPct: number | null;
}

/** A fixture-swing insight, structurally — kept minimal so the core needn't
 *  import news.ts (a big, impure module). NewsInsight is a superset. */
export interface InsightInput { kind: string; title?: string; body?: string; club?: string }
/** A team-news doubt, structurally. NewsDoubt is a superset. */
export interface DoubtInput { smId: number; name: string; club: string; reason: string }

/** A selected idea before its copy is written. */
export interface IdeaCandidate {
  kind: ScoutLatestKind;
  playerId: number;
  name: string;
  club: string;
  clubId: number;
  pos: FantasyPos;
  priceTenths: number;
  status: string;
  chance: number | null;
  epNext: number | null;
  ownershipPct: number | null;
  ownershipDelta: number | null;
  fixtureNote: string | null;
  doubtReason: string | null;
  rank: number;
}

/** The closed payload the model may speak from — nothing else exists to it. */
export interface IdeaFacts {
  kind: ScoutLatestKind;
  player: string;
  club: string;
  position: FantasyPos;
  priceM: number;
  availability: string;
  chanceOfPlaying: number | null;
  ownershipPercent: number | null;
  ownershipChange: number | null;
  fplProjection: number | null;
  fixtureNote: string | null;
  doubtNote: string | null;
}

/** A finished idea: what the cron stores and the tab renders. */
export interface ScoutIdea {
  id: string; // `${kind}:${playerId}`
  kind: ScoutLatestKind;
  playerId: number;
  name: string;
  club: string;
  clubId: number;
  pos: FantasyPos;
  priceTenths: number;
  headline: string;
  body: string;
  cta: "shortlist" | "compare";
  copySource: CopySource;
  facts: IdeaFacts;
}

export interface ScoutLatestDoc {
  day: string; // YYYY-MM-DD
  gw: number | null;
  generatedAt: string;
  dataCutoff: string | null;
  items: ScoutIdea[];
}

// ── selection ───────────────────────────────────────────────────────────────

/** Momentum ideas: available players whose ownership climbed at least
 *  MOMENTUM_MIN_DELTA over the window and who project at least MOMENTUM_MIN_EP.
 *  Ranked by the climb. A player missing from `prevOwnById` (a brand-new entry)
 *  is skipped, not treated as a climb from zero. */
export function selectMomentumIdeas(
  cur: Map<number, SnapLite>, prevOwnById: Map<number, number>, poolById: Map<number, PoolPlayer>,
): IdeaCandidate[] {
  // forEach, not `for...of` over the Map: this repo's tsconfig target can't
  // iterate a Map's entries directly (the same constraint scoutPicks.ts notes).
  const out: IdeaCandidate[] = [];
  cur.forEach((s, id) => {
    if (s.status !== "a") return;
    if ((s.epNext ?? 0) < MOMENTUM_MIN_EP) return;
    const now = s.ownershipPct;
    const prev = prevOwnById.get(id);
    if (now === null || prev === undefined) return;
    const delta = Math.round((now - prev) * 100) / 100;
    if (delta < MOMENTUM_MIN_DELTA) return;
    const p = poolById.get(id);
    if (!p) return;
    out.push({
      kind: "momentum", playerId: id, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos,
      priceTenths: p.priceTenths, status: s.status, chance: s.chance, epNext: s.epNext,
      ownershipPct: now, ownershipDelta: delta, fixtureNote: null, doubtReason: null, rank: delta,
    });
  });
  return out.sort((a, b) => b.rank - a.rank || a.playerId - b.playerId);
}

/** Fixture-swing ideas: for each fixture-swing insight, the named club's
 *  highest-projected AVAILABLE OUTFIELDER, carrying the insight's own
 *  club-level note. Outfielders only (a "buy for the run" idea pointing at a
 *  keeper reads oddly), but otherwise position-agnostic: a kind run rewards
 *  attackers and defenders alike, so the honest pick is simply the best
 *  projection. One idea per club. */
export function selectFixtureSwingIdeas(
  insights: InsightInput[], snapById: Map<number, SnapLite>, poolByClubKey: Map<string, PoolPlayer[]>,
): IdeaCandidate[] {
  const out: IdeaCandidate[] = [];
  for (const ins of insights) {
    if (ins.kind !== "fixture-swing" || !ins.club) continue;
    const players = poolByClubKey.get(clubKey(ins.club));
    if (!players || !players.length) continue;
    let best: { p: PoolPlayer; s: SnapLite } | null = null;
    for (const p of players) {
      if (p.pos === "GK") continue;
      const s = snapById.get(p.id);
      if (!s || s.status !== "a") continue;
      if ((s.epNext ?? 0) <= 0) continue;
      const cEp = s.epNext ?? 0, bEp = best?.s.epNext ?? -1;
      if (!best || cEp > bEp || (cEp === bEp && p.id < best.p.id)) best = { p, s };
    }
    if (!best) continue;
    out.push({
      kind: "fixture_swing", playerId: best.p.id, name: best.p.name, club: best.p.club,
      clubId: best.p.clubId, pos: best.p.pos, priceTenths: best.p.priceTenths,
      status: best.s.status, chance: best.s.chance, epNext: best.s.epNext,
      ownershipPct: best.s.ownershipPct, ownershipDelta: null,
      fixtureNote: (ins.body || ins.title || "").trim() || null, doubtReason: null,
      rank: best.s.epNext ?? 0,
    });
  }
  const byClub = new Map<number, IdeaCandidate>();
  for (const c of out.sort((a, b) => b.rank - a.rank || a.playerId - b.playerId)) {
    if (!byClub.has(c.clubId)) byClub.set(c.clubId, c);
  }
  return Array.from(byClub.values()).sort((a, b) => b.rank - a.rank || a.playerId - b.playerId);
}

/** Watch ideas: a new doubt over a WIDELY-owned player. `pool.smId` bridges the
 *  SportMonks doubt id to the FPL player; ownership comes from his snapshot row.
 *  Ranked by ownership. */
export function selectWatchIdeas(
  doubts: DoubtInput[], snapById: Map<number, SnapLite>, poolBySmId: Map<number, PoolPlayer>,
): IdeaCandidate[] {
  const out: IdeaCandidate[] = [];
  const seen = new Set<number>();
  for (const d of doubts) {
    const p = poolBySmId.get(d.smId);
    if (!p || seen.has(p.id)) continue;
    const s = snapById.get(p.id);
    const own = s?.ownershipPct ?? null;
    if (own === null || own < WATCH_MIN_OWNERSHIP) continue;
    seen.add(p.id);
    out.push({
      kind: "watch", playerId: p.id, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos,
      priceTenths: p.priceTenths, status: s?.status ?? "u", chance: s?.chance ?? null,
      epNext: s?.epNext ?? null, ownershipPct: own, ownershipDelta: null,
      fixtureNote: null, doubtReason: (d.reason || "").trim() || "a fresh doubt", rank: own,
    });
  }
  return out.sort((a, b) => b.rank - a.rank || a.playerId - b.playerId);
}

/** Round-robin the three kinds into a diverse, deduped set of up to
 *  IDEAS_TARGET ideas. Momentum leads (freshest), then fixture swing, then
 *  watch; the loop refills any remaining slots from whatever is left. No player
 *  appears twice, and no (kind, player) in `recentKeys` is used UNLESS honouring
 *  that would leave the set empty (then dedup relaxes so the tab still has
 *  something). Pure. */
export function assembleIdeas(
  byKind: Record<ScoutLatestKind, IdeaCandidate[]>, recentKeys: ReadonlySet<string>,
): IdeaCandidate[] {
  const order: ScoutLatestKind[] = ["momentum", "fixture_swing", "watch"];
  const key = (c: IdeaCandidate) => `${c.kind}:${c.playerId}`;

  const pick = (allowRepeat: boolean): IdeaCandidate[] => {
    const chosen: IdeaCandidate[] = [];
    const usedPlayers = new Set<number>();
    const cursor: Record<ScoutLatestKind, number> = { momentum: 0, fixture_swing: 0, watch: 0 };
    let progressed = true;
    while (chosen.length < IDEAS_TARGET && progressed) {
      progressed = false;
      for (const k of order) {
        if (chosen.length >= IDEAS_TARGET) break;
        const list = byKind[k];
        while (cursor[k] < list.length) {
          const cand = list[cursor[k]++];
          if (usedPlayers.has(cand.playerId)) continue;
          if (!allowRepeat && recentKeys.has(key(cand))) continue;
          chosen.push(cand);
          usedPlayers.add(cand.playerId);
          progressed = true;
          break;
        }
      }
    }
    return chosen;
  };

  const fresh = pick(false);
  if (fresh.length) return fresh;
  return pick(true);
}

// ── facts + mechanical fallback (deterministic, from the candidate only) ─────

export function ideaFacts(c: IdeaCandidate): IdeaFacts {
  return {
    kind: c.kind,
    player: c.name,
    club: c.club,
    position: c.pos,
    priceM: Math.round((c.priceTenths / 10) * 10) / 10,
    availability: c.status === "a" ? "available" : c.status,
    chanceOfPlaying: c.chance,
    ownershipPercent: c.ownershipPct === null ? null : Math.round(c.ownershipPct * 10) / 10,
    ownershipChange: c.ownershipDelta === null ? null : Math.round(c.ownershipDelta * 10) / 10,
    fplProjection: c.epNext === null ? null : Math.round(c.epNext * 10) / 10,
    fixtureNote: c.fixtureNote,
    doubtNote: c.doubtReason,
  };
}

/** A short mechanical headline per kind — never model-written, so the strip
 *  always has a stable label even when the model is down. */
export function headlineFor(c: IdeaCandidate): string {
  if (c.kind === "momentum") return "Managers are moving";
  if (c.kind === "fixture_swing") return "The fixtures are turning";
  return "Worth a second look";
}

export function ctaFor(kind: ScoutLatestKind): "shortlist" | "compare" {
  // Buy signals send you to add him; a doubt sends you to weigh him up.
  return kind === "watch" ? "compare" : "shortlist";
}

/** The idea's body composed by CODE from the facts — the ground truth, so
 *  nothing here needs grounding. Ships when the model is unavailable or its
 *  line fails the gate. Never a made-up claim. */
export function composeMechanicalBody(c: IdeaCandidate): string {
  const priceM = (c.priceTenths / 10).toFixed(1);
  if (c.kind === "momentum") {
    const own = c.ownershipPct !== null ? `${c.ownershipPct.toFixed(1)}%` : "a rising share";
    const delta = c.ownershipDelta !== null ? c.ownershipDelta.toFixed(1) : null;
    const climb = delta ? `Ownership is up ${delta} points to ${own}` : `Ownership is climbing to ${own}`;
    const proj = c.epNext !== null ? `, and FPL projects ${c.epNext.toFixed(1)} for him` : "";
    return `${climb} as managers back him at £${priceM}m${proj}.`;
  }
  if (c.kind === "fixture_swing") {
    const proj = c.epNext !== null
      ? ` He is their highest projected outfielder at £${priceM}m, FPL projecting ${c.epNext.toFixed(1)}.`
      : ` He is their pick of the outfield at £${priceM}m.`;
    const note = c.fixtureNote ? ` ${c.fixtureNote}` : "";
    return `${c.club}'s run of fixtures is turning kind.${note}${proj}`;
  }
  const own = c.ownershipPct !== null ? `${c.ownershipPct.toFixed(1)}%` : "a big share";
  const reason = c.doubtReason ?? "a fresh doubt";
  return `A doubt has appeared over him, ${reason}, and ${own} of managers own him at £${priceM}m.`;
}

// ── read-time availability resolve ──────────────────────────────────────────

/** Drop any idea whose player is no longer available on the newest snapshot —
 *  ideas have no backups, so an unavailable player is simply removed. A `watch`
 *  idea is KEPT even if he's gone unavailable: the doubt hardening into a
 *  certainty is exactly what that idea is about. Pure. */
export function resolveIdeasAtReadTime(items: ScoutIdea[], liveStatusById: Map<number, string>): ScoutIdea[] {
  return items.filter((it) => {
    if (it.kind === "watch") return true;
    const status = liveStatusById.get(it.playerId);
    if (status === undefined) return true; // no live read — trust the frozen row
    return !OUT_STATUSES.has(status);
  });
}
