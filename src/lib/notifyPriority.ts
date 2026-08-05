/**
 * How much a notification is allowed to interrupt.
 *
 * The per-user floor in notifyUsers used to treat every send as equal, so a
 * scheduled game reminder at 11:30 silenced breaking club news until 15:30. A
 * routine reminder outranking actual news is backwards: the reminder is still
 * true in four hours, the news is not.
 *
 * Derived from the dedupe key rather than a new column, because the key already
 * says which system sent it and notification_log has carried it since day one —
 * so this classifies historic rows too, not just future ones.
 *
 * Pure and dependency-free so it can be unit tested.
 */

export type NotifyPriority = "breaking" | "routine";

/** Higher wins. A send is only blocked by something at least this important. */
const RANK: Record<NotifyPriority, number> = { routine: 1, breaking: 2 };

/**
 * Prefixes that count as breaking. Everything else is routine, deliberately —
 * an unknown key is far more likely to be a scheduled or social notification
 * than genuine news, and guessing "breaking" would let it silence real news.
 */
const BREAKING_PREFIXES = ["club-news:"];

export function priorityOf(key: string): NotifyPriority {
  return BREAKING_PREFIXES.some((p) => key.startsWith(p)) ? "breaking" : "routine";
}

/** Does something already sent block a new send of this priority? */
export function blocks(sentKey: string, incoming: NotifyPriority): boolean {
  return RANK[priorityOf(sentKey)] >= RANK[incoming];
}
