/**
 * The "YourScore community account" disclosure for synthetic accounts
 * (`profiles.source === "bot"`).
 *
 * DISABLED (founder, 8 Aug 2026): the label is no longer shown on any surface —
 * the founder asked for the bot personas to carry no community-member label.
 * Rendering is turned off HERE, at the single disclosure point, so it's gone
 * everywhere at once (feed posts, profile, post detail, quoted previews,
 * Discover, member sheets) and trivially restorable if the call is reversed —
 * the `isCommunity` / `actorIsCommunity` flags and every call site are left
 * intact. The original copy + glyph live in git history at this file.
 *
 * Server-safe (no hooks) — usable from either a server or a client component.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CommunityBadge({ compact = false }: { compact?: boolean }) {
  return null;
}
