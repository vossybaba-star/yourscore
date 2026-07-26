/**
 * Live match events → "your gameweek" moments. Pure and testable.
 *
 * SportMonks carries timed events (a Goal with its minute, scorer and assist) —
 * the same feed the 38-0 live view already reads. The fantasy scorer only pulls
 * stat TOTALS (for points), so this is the separate, minimal parse that turns
 * the event list into the moments involving YOUR squad, for the live ticker.
 *
 * Identity flows through the pool's baked `smId`, exactly like ingest.ts — no
 * name matching. The UI that renders these only has data to show during a live
 * gameweek; this function is what it will render.
 */

/** One SportMonks fixture event (v3 `events` include). */
export interface SmEvent {
  type?: { name?: string };
  /** Minute of the match (0 if the feed omits it). */
  minute?: number;
  /** The player the event is FOR (the scorer, for a goal). */
  player_id?: number;
  player_name?: string;
  /** The assisting player, when the feed provides one. */
  related_player_id?: number;
  related_player_name?: string;
}

export interface SmEventFixture { events?: SmEvent[] }

export interface LiveEvent {
  minute: number;
  smId: number;
  name: string;
  kind: "goal" | "assist";
}

const isGoal = (name: string) => /goal/i.test(name) && !/own[- ]?goal/i.test(name) && !/cancelled|var/i.test(name);

/**
 * Every goal or assist by a player in the given squad (by SM id), oldest minute
 * first. A goal yields a "goal" for the scorer and an "assist" for the related
 * player — but only for the ones you actually own, so the ticker is about YOUR
 * team, not the whole match.
 */
export function extractSquadEvents(
  fixtures: SmEventFixture[],
  squadSmIds: Set<number>,
): LiveEvent[] {
  const out: LiveEvent[] = [];
  for (const fx of fixtures) {
    for (const e of fx.events ?? []) {
      if (!isGoal(e.type?.name ?? "")) continue;
      const minute = e.minute ?? 0;
      if (e.player_id != null && squadSmIds.has(e.player_id)) {
        out.push({ minute, smId: e.player_id, name: e.player_name ?? "", kind: "goal" });
      }
      if (e.related_player_id != null && squadSmIds.has(e.related_player_id)) {
        out.push({ minute, smId: e.related_player_id, name: e.related_player_name ?? "", kind: "assist" });
      }
    }
  }
  return out.sort((a, b) => a.minute - b.minute);
}
