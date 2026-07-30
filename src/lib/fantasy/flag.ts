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
// Founder-preview only (re-added 27 Jul so the founder can live-in the redesigned
// Fantasy on prod). With the env gate still off, only ids listed here see the full
// build; every other account gets the public teaser. Emptied 25 Jul when the
// founder wanted parity with all users; restored so the Manager's-Matchday work is
// visible on his account. When Fantasy opens to everyone the env flag goes true
// and this list stops mattering.
export const FANTASY_ALLOWLIST: readonly string[] = [
  "4050ec90-5323-46aa-8dc0-811e0aac701a", // vossybaba — founder
  "312598db-271d-45b1-a81b-12cb026b961f", // x_chichi_x@hotmail.co.uk — founder's partner (30 Jul)
  "1f719dca-e968-4af1-b1c2-8b0150f2fe1f", // isaacpep00@gmail.com — tester (30 Jul)
  "6af545fb-b511-47df-a5d5-9259fb475d86", // 00isaacpep00@gmail.com — tester (30 Jul)
];

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
