/**
 * "Perfect 10" — a ranked top-10 list game (third Quiz game-type, alongside
 * Higher-or-Lower / Guess the Player). Name everyone in a ranked top-10
 * football list (e.g. "Premier League's all-time top 10 goalscorers").
 *
 * SERVER-ONLY. The answers (p10_lists.entries — display/surname/aliases/clues)
 * must never reach the client pre-solve: the play page fetches an answer-free
 * clientList() (word-length arrays only) and grading happens here, against the
 * service-role-loaded list. Mirrors src/lib/games/serve.ts's server-only
 * architecture but is stateful (p10_attempts) rather than seed-derived, since a
 * list is a persisted daily assignment shared by everyone, not a per-play draw.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

// ── Types ────────────────────────────────────────────────────────────────

export interface P10Entry {
  rank: number;
  display: string;
  surname: string;
  aliases: string[];
  clue1: string;
  clue2: string;
}

export interface P10List {
  id: string;
  title: string;
  day: string | null;
  status: string;
  entries: P10Entry[];
  created_at?: string;
}

export interface FoundEntry {
  rank: number;
  display: string;
  surname: string;
  points: number;
  hintsUsed: number;
}

export interface HintTaken {
  rank: number;
  tier: 1 | 2;
}

export interface P10Attempt {
  id: string;
  list_id: string;
  user_id: string | null;
  found: FoundEntry[];
  hints: HintTaken[];
  strikes: number;
  tokens_left: number;
  score: number;
  done: boolean;
  share_token: string;
  created_at?: string;
  updated_at?: string;
}

// ── Constants ────────────────────────────────────────────────────────────

export const TOTAL_RUNGS = 10;
export const MAX_STRIKES = 3;
export const MAX_HINT_TOKENS = 3;

/** Points for solving a rung, by how many hint tiers were taken on it first. */
export const RUNG_POINTS: Record<0 | 1 | 2, number> = { 0: 10, 1: 6, 2: 3 };

export function pointsForHints(hintsUsed: number): number {
  const clamped = Math.max(0, Math.min(2, hintsUsed)) as 0 | 1 | 2;
  return RUNG_POINTS[clamped];
}

// ── Name normalization ──────────────────────────────────────────────────
// KEEP IN SYNC with scripts/perfect10/build-player-index.mjs and
// scripts/perfect10/generate-lists.mjs — all three must derive the same
// normalized key from the same raw name so guesses match across the pool.

export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (é→e, ü→u, …)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // punctuation (apostrophes, hyphens, dots) → space
    .replace(/\s+/g, " ")
    .trim();
}

/** Letters per word of a display name, e.g. "Alan Shearer" → [4, 7]. Punctuation
 * (hyphens, apostrophes) doesn't count as a letter-dot. */
export function wordLens(display: string): number[] {
  return display
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-zÀ-ɏḀ-ỿ]/g, "").length)
    .filter((n) => n > 0);
}

// ── Europe/London "today" ───────────────────────────────────────────────
// Daily lists are assigned by the London calendar date, not UTC — compute via
// Intl so a UTC-midnight rollover doesn't run a day early/late for UK players.

export function londonDateISO(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ── Loading ──────────────────────────────────────────────────────────────

/** Today's list (Europe/London date). Any status — a list only gets a `day`
 * once it's meant to run, so status isn't a serving gate (unlike a draft/
 * publish flag elsewhere); generate-lists.mjs is the only writer of `day`. */
export async function loadListForDay(day: string = londonDateISO()): Promise<P10List | null> {
  const db = createServiceClient();
  const { data } = await db.from("p10_lists").select("*").eq("day", day).maybeSingle();
  return (data as unknown as P10List) ?? null;
}

export async function loadListById(id: string): Promise<P10List | null> {
  const db = createServiceClient();
  const { data } = await db.from("p10_lists").select("*").eq("id", id).maybeSingle();
  return (data as unknown as P10List) ?? null;
}

/** A list is playable once its day has arrived (Europe/London). Drafts (day null)
 * and future-dated lists are never served, listed, or gradeable. */
export function isServed(list: P10List, today: string = londonDateISO()): boolean {
  return Boolean(list.day) && (list.day as string) <= today;
}

export interface LibraryItem {
  id: string;
  title: string;
  day: string;
}

/** Past + today's lists, newest first — the playable back-catalogue. */
export async function loadLibrary(limit = 60): Promise<LibraryItem[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("p10_lists")
    .select("id, title, day")
    .not("day", "is", null)
    .lte("day", londonDateISO())
    .order("day", { ascending: false })
    .limit(limit);
  return (data as unknown as LibraryItem[]) ?? [];
}

export async function loadAttemptsForLists(userId: string, listIds: string[]): Promise<P10Attempt[]> {
  if (listIds.length === 0) return [];
  const db = createServiceClient();
  const { data } = await db.from("p10_attempts").select("*").eq("user_id", userId).in("list_id", listIds);
  return (data as unknown as P10Attempt[]) ?? [];
}

export async function loadAttempt(listId: string, userId: string): Promise<P10Attempt | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("p10_attempts")
    .select("*")
    .eq("list_id", listId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as unknown as P10Attempt) ?? null;
}

export async function loadAttemptByShareToken(token: string): Promise<P10Attempt | null> {
  const db = createServiceClient();
  const { data } = await db.from("p10_attempts").select("*").eq("share_token", token).maybeSingle();
  return (data as unknown as P10Attempt) ?? null;
}

export async function createOrLoadAttempt(listId: string, userId: string): Promise<P10Attempt> {
  const existing = await loadAttempt(listId, userId);
  if (existing) return existing;
  const db = createServiceClient();
  const { data, error } = await db
    .from("p10_attempts")
    .insert({ list_id: listId, user_id: userId })
    .select("*")
    .single();
  if (error || !data) {
    // Race: another request created it first — load instead of failing.
    const again = await loadAttempt(listId, userId);
    if (again) return again;
    throw error ?? new Error("Failed to create p10 attempt");
  }
  return data as unknown as P10Attempt;
}

export async function saveAttempt(attempt: P10Attempt): Promise<void> {
  const db = createServiceClient();
  await db
    .from("p10_attempts")
    .update({
      // jsonb columns — the typed shapes are plain objects/arrays at runtime,
      // just not structurally assignable to the generated Json type.
      found: attempt.found as unknown as Json,
      hints: attempt.hints as unknown as Json,
      strikes: attempt.strikes,
      tokens_left: attempt.tokens_left,
      score: attempt.score,
      done: attempt.done,
      updated_at: new Date().toISOString(),
    })
    .eq("id", attempt.id);
}

// ── Client-safe shapes ──────────────────────────────────────────────────

export interface ClientRung {
  rank: number;
  wordLens: number[];
}

export interface ClientList {
  listId: string;
  title: string;
  rungs: ClientRung[];
}

/** Answer-free shape: word-length arrays only. NO names, surnames, aliases, clues. */
export function clientList(list: P10List): ClientList {
  return {
    listId: list.id,
    title: list.title,
    rungs: list.entries
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((e) => ({ rank: e.rank, wordLens: wordLens(e.display) })),
  };
}

// ── Grading ──────────────────────────────────────────────────────────────

export interface GradeHit {
  hit: true;
  rank: number;
  display: string;
  surname: string;
}
export interface GradeMiss {
  hit: false;
  /** The guess matches an entry the player already solved (e.g. a double
   * winner like Messi on a Golden Ball list, both rungs done) — costs no strike. */
  alreadyFound?: boolean;
}
export type GradeResult = GradeHit | GradeMiss;

/**
 * Grade a guess against the list's UNSOLVED entries (caller filters solvedRanks
 * out before calling — an already-solved rung isn't re-gradeable). Matches the
 * normalized guess against each entry's normalized display, surname, or any
 * alias — diacritic/case-insensitive both directions since normalizeName()
 * strips diacritics on both the guess and the stored names.
 */
export function gradeGuess(list: P10List, guessRaw: string, solvedRanks: readonly number[]): GradeResult {
  const guess = normalizeName(guessRaw);
  if (!guess) return { hit: false };
  const solved = new Set(solvedRanks);
  let matchedSolved = false;
  for (const e of list.entries) {
    const candidates = [e.display, e.surname, ...(e.aliases ?? [])].map(normalizeName);
    if (!candidates.includes(guess)) continue;
    if (solved.has(e.rank)) {
      // Keep scanning — the same name may sit on another, unsolved rung
      // (double winners on recency-ranked lists).
      matchedSolved = true;
      continue;
    }
    return { hit: true, rank: e.rank, display: e.display, surname: e.surname };
  }
  return matchedSolved ? { hit: false, alreadyFound: true } : { hit: false };
}

// ── Hints ────────────────────────────────────────────────────────────────

/** tier 1 = clue1 (clubs), tier 2 = clue2 (starts-with letter). */
export function hintFor(list: P10List, rank: number, tier: 1 | 2): string | null {
  const e = list.entries.find((x) => x.rank === rank);
  if (!e) return null;
  return tier === 1 ? e.clue1 : e.clue2;
}

/** Full remaining-answers reveal (post-game only: win or 3rd strike). */
export function revealRemaining(list: P10List, solvedRanks: readonly number[]): FoundEntry[] {
  const solved = new Set(solvedRanks);
  return list.entries
    .filter((e) => !solved.has(e.rank))
    .sort((a, b) => a.rank - b.rank)
    .map((e) => ({ rank: e.rank, display: e.display, surname: e.surname, points: 0, hintsUsed: 0 }));
}
