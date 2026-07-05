import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Daily debates — one subjective football question a day, no right answer.
// Rotation is date-seeded over the active bank (UK day), so there's no
// scheduler to break: everyone computes the same "today's debate", and when
// the cycle wraps a debate returns with its votes intact (a bigger split, not
// a stale one). One vote per user per debate, changeable.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface Debate {
  id: string;
  question: string;
  options: string[];
}

export interface DebateSplit {
  debate: Debate;
  /** Vote count per option index. */
  counts: number[];
  total: number;
}

/** Days since epoch in UK time — the rotation key. */
export function ukDayNumber(now = new Date()): number {
  const uk = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
  return Math.floor(Date.parse(`${uk}T00:00:00Z`) / 86_400_000);
}

/** Today's debate: date-seeded pick from the active bank (stable all day). */
export async function todaysDebate(db: Db): Promise<Debate | null> {
  // id tiebreaker: seeded rows share a created_at; without it the "today's
  // debate" pick could differ between requests.
  const { data } = await db
    .from("debates")
    .select("id, question, options")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (!data?.length) return null;
  const row = data[ukDayNumber() % data.length];
  const options = Array.isArray(row.options) ? (row.options as string[]) : [];
  if (options.length < 2) return null;
  return { id: row.id, question: row.question, options };
}

/** The community split for a debate. Service-role read (votes are RLS own-only). */
export async function debateSplit(db: Db, debate: Debate): Promise<DebateSplit> {
  const { data } = await db.from("debate_votes").select("option_idx").eq("debate_id", debate.id);
  const counts = debate.options.map(() => 0);
  for (const v of data ?? []) {
    if (v.option_idx >= 0 && v.option_idx < counts.length) counts[v.option_idx] += 1;
  }
  return { debate, counts, total: counts.reduce((a, b) => a + b, 0) };
}
