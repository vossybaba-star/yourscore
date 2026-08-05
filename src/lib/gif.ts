import "server-only";

/**
 * Klipy GIF provider — server-side only, so the API key never reaches the
 * client. The exact Klipy response shape is unverified (no key issued yet as
 * of Phase 2a build), so the mapper below is deliberately tolerant: it accepts
 * a few plausible list locations and per-item variant shapes, and falls back to
 * an empty result (logging the raw top-level keys) rather than throwing on
 * anything it doesn't recognise.
 */

export interface KlipyGif {
  id: string;
  title: string;
  mp4: string | null;
  webp: string | null;
  gifUrl: string | null;
  previewUrl: string | null;
  width: number;
  height: number;
}

const BASE = "https://api.klipy.com/api/v1";

export class GifUnavailableError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function urlOf(v: any): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v.url === "string" && v.url) return v.url;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstDefined(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

/** Pull mp4/webp/gif/preview URLs (+ dimensions) out of one Klipy list item.
 *  Handles the item nesting its variants under `file`, `media`, or `files`, or
 *  having them directly on the item itself. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickVariant(item: any): Omit<KlipyGif, "id" | "title"> {
  let container = firstDefined(item, ["file", "media", "files"]) ?? item;
  // Klipy (verified live, Aug 2026) nests the variants one level deeper under
  // quality tiers: file.{hd,md,sm}.{gif,webp,mp4,webm,jpg}, each {url,width,
  // height,size}. Prefer the mid tier for feed playback weight, then fall back.
  if (!container?.mp4 && !container?.webp && !container?.gif) {
    const tier = firstDefined(container, ["md", "sm", "hd"]);
    if (tier) container = tier;
  }
  const mp4Src = firstDefined(container, ["mp4", "video"]);
  const webpSrc = firstDefined(container, ["webp"]);
  const gifSrc = firstDefined(container, ["gif", "original"]);
  const previewSrc = firstDefined(container, ["preview", "thumbnail", "thumb", "jpg"]) ?? webpSrc ?? gifSrc ?? mp4Src;

  const mp4 = urlOf(mp4Src);
  const webp = urlOf(webpSrc);
  const gifUrl = urlOf(gifSrc);
  const previewUrl = urlOf(previewSrc) ?? webp ?? gifUrl;

  const dimsFrom = mp4Src ?? webpSrc ?? gifSrc ?? item;
  const width = Number(dimsFrom?.width ?? item?.width) || 0;
  const height = Number(dimsFrom?.height ?? item?.height) || 0;

  return { mp4, webp, gifUrl, previewUrl, width, height };
}

/** Normalise a raw Klipy response into our shape. Never throws — an
 *  unrecognised shape just yields an empty list (with the top-level keys
 *  logged, so a real response can be reconciled against this mapper later). */
export function normalizeKlipyResponse(raw: unknown): { gifs: KlipyGif[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = raw as any;
  const list: unknown[] | null =
    Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.result) ? data.result
    : Array.isArray(data?.data?.data) ? data.data.data
    : Array.isArray(data?.gifs) ? data.gifs
    : null;

  if (!list) {
    console.error("[gif] unrecognised Klipy response shape, top level keys:", data && typeof data === "object" ? Object.keys(data) : typeof raw);
    return { gifs: [] };
  }

  const gifs: KlipyGif[] = list
    .map((item, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = item as any;
      const variant = pickVariant(it);
      return {
        id: String(it?.id ?? it?.slug ?? i),
        title: typeof it?.title === "string" ? it.title : "",
        ...variant,
      };
    })
    .filter((g) => g.mp4 || g.webp || g.gifUrl);

  return { gifs };
}

/** Call Klipy's `/gifs/${path}`. Throws GifUnavailableError when no key is
 *  configured; throws a plain Error on a non-2xx from the provider. */
export async function klipyFetch(path: string): Promise<{ gifs: KlipyGif[] }> {
  const key = process.env.KLIPY_API_KEY;
  if (!key) throw new GifUnavailableError("gif-unavailable");

  const res = await fetch(`${BASE}/${key}/gifs/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`klipy ${res.status}`);
  const json = await res.json().catch(() => null);
  return normalizeKlipyResponse(json);
}
