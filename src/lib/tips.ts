// First-launch onboarding flag — synchronous and localStorage-backed. Every
// storage access is wrapped — a throw (Safari private mode / WebView quirks)
// fails *closed* ("already seen") so a storage error can never trap a user in
// a tour loop.
//
// The `:v1` suffix lets a future rewritten tour re-trigger for everyone by
// bumping the key, with no migration (same convention as onboarding.ts).

export type TipId = "app-tour";

function tipKey(id: TipId): string {
  return `ys:tip:${id}:v1`;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return true; // fail closed
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // ignore — worst case the tour shows once more
  }
}

export function hasSeenTip(id: TipId): boolean {
  return readFlag(tipKey(id));
}

export function markTipSeen(id: TipId): void {
  writeFlag(tipKey(id));
}

const ELIGIBLE_WINDOW_DAYS = 14;

/**
 * New-user gate: guests (no account yet) are always eligible; a signed-in
 * account is eligible only within its first 14 days. `createdAt` is missing
 * for guests by definition, so null/undefined reads as "not an aged account"
 * rather than "unknown" — a parse failure on a real value fails *closed*
 * (not eligible) so a bad timestamp can never wedge the tour on for everyone.
 */
export function tipsEligible(createdAt: string | null | undefined): boolean {
  if (createdAt == null) return true;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  const ageMs = Date.now() - created;
  return ageMs <= ELIGIBLE_WINDOW_DAYS * 86_400_000;
}

// QA helper — clears the flag so the tour can be replayed on-device. Wired to
// window.__resetTips in non-production (see SpotlightTour).
export function resetTips(): void {
  try {
    localStorage.removeItem(tipKey("app-tour"));
  } catch {
    // ignore
  }
}
