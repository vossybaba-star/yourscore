/**
 * External video link support (Social video build 2D) — provider resolution
 * for the fallback hierarchy: YouTube gets an inline playable embed
 * (`videoKind: "youtube"`), everything else that declares og:video gets a
 * "rich" tap-through preview, everything else is a plain link card.
 *
 * Pure and import-safe from BOTH server (unfurl.ts) and client
 * (FeedStream.tsx, CreatePostSheet.tsx) code — no `server-only`, no Node
 * builtins, no React. Keep it that way: this file is unit-tested directly
 * with `npx tsx --test src/lib/videoEmbeds.test.ts`.
 */

/** A YouTube video id is always exactly 11 chars of [A-Za-z0-9_-]. Strict on
 *  purpose — this id gets interpolated straight into an iframe src, so
 *  anything that doesn't match this shape is rejected outright rather than
 *  "cleaned up". */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Resolve a URL to a YouTube video id, or null if it isn't a YouTube video
 *  URL (or the id doesn't pass strict validation). Handles:
 *    - youtube.com/watch?v=<id>  (also m.youtube.com, www.youtube.com)
 *    - youtu.be/<id>
 *    - youtube.com/shorts/<id>
 *    - youtube.com/embed/<id>
 *  Everything else (channel pages, playlists, search, other hosts) is never
 *  embedded — this phase is YouTube-only, and only these four shapes. */
export function resolveYouTube(rawUrl: string): { videoId: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_ID_RE.test(id) ? { videoId: id } : null;
  }

  if (host === "youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") ?? "";
      return YOUTUBE_ID_RE.test(id) ? { videoId: id } : null;
    }
    const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shorts) return YOUTUBE_ID_RE.test(shorts[1]) ? { videoId: shorts[1] } : null;
    const embed = url.pathname.match(/^\/embed\/([^/]+)/);
    if (embed) return YOUTUBE_ID_RE.test(embed[1]) ? { videoId: embed[1] } : null;
  }

  return null;
}

/** The privacy-enhanced embed src for a validated YouTube video id. Caller
 *  appends its own `&autoplay=1` only at the point the viewer taps to play
 *  (lazy iframe — never mounted until then). */
export function youTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1`;
}

/** A YouTube video's default thumbnail — used as the poster before the
 *  iframe is mounted, and as a fallback when no og:image was unfurled. */
export function youTubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
