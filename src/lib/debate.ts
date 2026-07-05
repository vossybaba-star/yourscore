import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Daily debates — one subjective football question a day, no right answer.
// Dead simple by design (founder, Jul 5): every debate carries an explicit
// calendar date (debates.day, unique). "Today's debate" is the row dated
// today — or the most recent past one, so a gap in the schedule never blanks
// the card. The schedule is authored, dated and reviewable in
// scripts/seed-debates.mjs. One vote per user per debate, changeable.

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

/** Today's date in UK time, YYYY-MM-DD — the schedule key. */
export function ukToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** The debate dated today (UK), else the most recent past one. */
export async function todaysDebate(db: Db): Promise<Debate | null> {
  const { data } = await db
    .from("debates")
    .select("id, question, options")
    .eq("active", true)
    .lte("day", ukToday())
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const options = Array.isArray(data.options) ? (data.options as string[]) : [];
  if (options.length < 2) return null;
  return { id: data.id, question: data.question, options };
}

/** The community split: account votes + anonymous device votes. Service-role
 * read (both tables are locked to the API). */
export async function debateSplit(db: Db, debate: Debate): Promise<DebateSplit> {
  const [{ data: users }, { data: anons }] = await Promise.all([
    db.from("debate_votes").select("option_idx").eq("debate_id", debate.id),
    db.from("debate_anon_votes").select("option_idx").eq("debate_id", debate.id),
  ]);
  const counts = debate.options.map(() => 0);
  for (const v of [...(users ?? []), ...(anons ?? [])]) {
    if (v.option_idx >= 0 && v.option_idx < counts.length) counts[v.option_idx] += 1;
  }
  return { debate, counts, total: counts.reduce((a, b) => a + b, 0) };
}
