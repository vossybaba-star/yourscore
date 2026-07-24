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

/** Env answer only. Safe on the server; ignores the preview escape hatch. */
export function fantasyEnabledByEnv(): boolean {
  return process.env.NEXT_PUBLIC_FANTASY_ENABLED === "true";
}

/** Client answer: the env flag, or a preview session the user opted into. */
export function fantasyVisible(): boolean {
  if (fantasyEnabledByEnv()) return true;
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
