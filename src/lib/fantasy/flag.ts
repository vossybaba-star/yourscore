/**
 * The fantasy release gate.
 *
 * The game is BUILT and the 26/27 season is cut over, but it is not finished to
 * the founder's bar and must not face users yet (founder, 24 Jul). This is what
 * keeps it off the product surface while it ships in the same build as
 * everything else — a long-lived branch is how the nav drift happened, so the
 * code merges and a flag decides who sees it.
 *
 * OFF by default. Prod stays dark until NEXT_PUBLIC_FANTASY_ENABLED=true.
 *
 * `?fantasy=preview` is the escape hatch so the founder can test on the real
 * deployment without opening it to everyone. It sticks for the tab (sessionStorage)
 * so navigating between the section, the round and leagues doesn't lose it, and it
 * dies when the tab closes. It only reveals UI a signed-in user could already
 * reach by URL — the API routes are authenticated on their own — so it is a
 * VISIBILITY gate, not a security boundary. Do not use it as one.
 */
const PREVIEW_KEY = "ys-fantasy-preview";

/**
 * The founder-preview allowlist: accounts that get fantasy in the REAL app while
 * the global gate is still shut, so it can be lived-in on production before it
 * opens to everyone (founder, 24 Jul).
 *
 * A user id is not a secret — it's already in that user's own browser session —
 * so hard-coding it ships the preview with the build and needs no env step or
 * redeploy to change who's in. When fantasy opens to everyone the global env
 * flag goes true and this list stops mattering.
 */
// Emptied 25 Jul (founder): "make my version the same as all users." With no
// one on the list and the env gate still off, EVERY account — the founder's
// included — sees the public Fantasy teaser, not the full build. Re-add an id
// here to preview the real game on prod again without opening it to everyone.
export const FANTASY_ALLOWLIST: readonly string[] = [];

/** Env answer only. Safe on the server; ignores the preview escape hatch. */
export function fantasyEnabledByEnv(): boolean {
  return process.env.NEXT_PUBLIC_FANTASY_ENABLED === "true";
}

/** The authoritative answer for a KNOWN user — env-on, or on the allowlist. Used
 *  on both sides: the client hides the tab from everyone else, the server refuses
 *  their API calls, so "for me only" is real, not just a hidden button. */
export function fantasyAllowed(userId: string | null | undefined): boolean {
  if (fantasyEnabledByEnv()) return true;
  return !!userId && FANTASY_ALLOWLIST.includes(userId);
}

/** Client answer: allowed for this user, or a preview session they opted into
 *  with `?fantasy=preview`. Pass the signed-in user's id so the allowlist can
 *  apply; without it, only the env flag and the preview hatch are considered. */
export function fantasyVisible(userId?: string | null): boolean {
  if (fantasyAllowed(userId)) return true;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("fantasy") === "preview") {
      window.sessionStorage.setItem(PREVIEW_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    // Private mode / storage disabled — fall back to the URL for this page only.
    return typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("fantasy") === "preview";
  }
}
