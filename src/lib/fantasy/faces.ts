import photoData from "@/data/games/player-photos.json";

/**
 * A player's headshot for the tactical pitch — the SAME verified, licensed
 * Premier League photos the Higher or Lower game already ships
 * (`data/games/player-photos.json`, built + load-checked by
 * `scripts/games/build-player-photos.mjs`). We reuse that map rather than mint a
 * new source: every URL in it was confirmed to return a real image, so a face
 * here is never a broken image, and a miss is simply absent (the caller draws
 * `PlayerAvatar`'s deterministic monogram instead).
 *
 * The map is keyed by a normalised SURNAME (its option labels are surnames), so
 * we key the same way and try the surname first, then the whole name. Coverage
 * is the game pool's ~famous players — a squad's premiums and mid-price picks
 * resolve; a fringe bench name falls back to the monogram. Baking SportMonks
 * `imagePath` into the pool by `smId` would push coverage to ~everyone; that's
 * the follow-up, and it drops in behind this same helper.
 *
 * Client-safe: a plain JSON import, no server-only dependency.
 */
const PHOTOS = (photoData as { photos: Record<string, string> }).photos ?? {};

function key(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** A verified headshot URL for a full player name, or undefined if we don't hold one.
 *  Tries surname, then the last two tokens joined (so "van Dijk" / "De Bruyne"
 *  resolve, not just "Dijk"), then the whole name. Mononym labels ("Gabriel")
 *  still miss — that's what the baked-SM follow-up fixes; here they monogram. */
export function faceFor(name: string): string | undefined {
  if (!name) return undefined;
  const parts = name.trim().split(/\s+/);
  const surname = parts[parts.length - 1];
  const lastTwo = parts.length > 1 ? parts.slice(-2).join("") : surname;
  return PHOTOS[key(surname)] || PHOTOS[key(lastTwo)] || PHOTOS[key(name)] || undefined;
}
