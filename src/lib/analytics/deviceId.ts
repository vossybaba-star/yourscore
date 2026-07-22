// A durable, anonymous per-device id. Generated once on the first call that has
// storage, kept in localStorage, and stable across sessions and guest→signup. It
// gives guest plays a handle that survives registration, so a player's pre-signup
// activity can later be linked to their account (see /api/profile/source, which
// persists it onto the profile at signup). Purely anonymous — a random UUID, no PII.
const KEY = "ys:did";

/**
 * Returns the device id, minting one if absent. SSR-safe (returns "" on the server)
 * and storage-safe (returns "" when localStorage is blocked, e.g. private mode) so
 * callers never throw. A "" result simply means "no durable id available here".
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : // Fallback for older webviews without crypto.randomUUID.
            `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return ""; // storage blocked — no durable id
  }
}
