import { createClient } from "@/lib/supabase/client";
import { uploadPostImage } from "@/lib/postMedia";

/**
 * Upload one video for a Social post to the public `post-videos` bucket
 * (RLS: write only your own path, mig 256), mirroring the `post-media`/
 * `postMedia.ts` pattern. Direct-to-storage, no transcoding, no HLS — a video
 * is uploaded, then it is ready (founder-locked architecture, 5 Aug).
 *
 * Uses XMLHttpRequest rather than supabase-js's storage client because
 * supabase-js gives no upload progress callback, and the composer needs a
 * real progress bar for a file that can be up to 100MB.
 */
export const MAX_POST_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_POST_VIDEO_MS = 60_000; // 60 seconds

export class PostVideoError extends Error {
  /** True when this error is the result of the caller's own AbortSignal
   *  firing (composer removed the tile / abandoned the sheet mid-upload) —
   *  the composer uses this to land in "cancelled", not "failed". */
  cancelled?: boolean;
}

/** Read the first few bytes of a file without loading the whole thing. */
async function readHeader(file: File, n = 12): Promise<Uint8Array> {
  const buf = await file.slice(0, n).arrayBuffer();
  return new Uint8Array(buf);
}

/** Both MP4 and QuickTime (.mov) are ISO-base-media-file-format containers: a
 *  `ftyp` box sits at byte offset 4 regardless of container variant. Sniffing
 *  this (rather than trusting file.type or the file extension, either of
 *  which a renamed/mislabelled file can lie about) is the only reliable
 *  client-side check available without decoding the whole file. */
function hasFtypBox(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // "ftyp"
}

export interface ProbedVideo { durationMs: number; width: number; height: number }

/** Read a video file's duration + dimensions without uploading it, via a
 *  hidden `<video preload="metadata">` element on an object URL. Rejects with
 *  a user-facing PostVideoError for anything the browser can't decode
 *  metadata for (corrupt file, exotic codec). */
export function probeVideo(file: File): Promise<ProbedVideo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const cleanup = () => { URL.revokeObjectURL(url); video.removeAttribute("src"); video.load(); };
    const fail = () => { if (done) return; done = true; cleanup(); reject(new PostVideoError("That video format isn't supported.")); };
    const timeout = setTimeout(fail, 10_000);
    video.onloadedmetadata = () => {
      if (done) return;
      const durationMs = Math.round((video.duration || 0) * 1000);
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!Number.isFinite(durationMs) || durationMs <= 0 || !width || !height) { fail(); return; }
      done = true; clearTimeout(timeout); cleanup();
      resolve({ durationMs, width, height });
    };
    video.onerror = () => { clearTimeout(timeout); fail(); };
    video.src = url;
  });
}

/** Seek to ~0.1s in and grab a JPEG poster frame. Best-effort: an undrawable
 *  frame (exotic/undecodable codec on this device) resolves null rather than
 *  rejecting — the post still works with no poster, falling back to a dark
 *  placeholder in the player. */
export function capturePoster(file: File, atMs = 100): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const cleanup = () => URL.revokeObjectURL(url);
    const finish = (blob: Blob | null) => { if (done) return; done = true; cleanup(); resolve(blob); };
    const timeout = setTimeout(() => finish(null), 8_000);
    video.onerror = () => { clearTimeout(timeout); finish(null); };
    video.onloadedmetadata = () => {
      const target = Math.min(atMs / 1000, Math.max(0, (video.duration || 0.2) - 0.05));
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.width && canvas.height ? canvas.getContext("2d") : null;
          if (!ctx) { clearTimeout(timeout); finish(null); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => { clearTimeout(timeout); finish(blob); }, "image/jpeg", 0.82);
        } catch { clearTimeout(timeout); finish(null); }
      };
      video.currentTime = target;
    };
    video.src = url;
  });
}

/** Validate (MIME sniff, size, decodability) and probe (duration, dimensions)
 *  a picked file, WITHOUT uploading anything. Shared by the composer's fast
 *  "selecting" step (fail early, before showing a preview tile) and
 *  `uploadPostVideo` below (which re-validates rather than trusting a caller
 *  who skipped the pre-check) — one source of truth for the three rejection
 *  messages, so the composer and the upload path can never drift apart. */
export async function validateAndProbeVideo(file: File): Promise<ProbedVideo> {
  const declaredMimeOk = file.type === "video/mp4" || file.type === "video/quicktime";
  const header = await readHeader(file);
  if (!declaredMimeOk || !hasFtypBox(header)) throw new PostVideoError("That video format isn't supported.");
  if (file.size > MAX_POST_VIDEO_BYTES) throw new PostVideoError("That video is too big. Keep it under 100 MB.");

  const probed = await probeVideo(file);
  if (probed.durationMs > MAX_POST_VIDEO_MS) throw new PostVideoError("That video is too long. Keep it under a minute.");
  return probed;
}

export interface UploadedPostVideo {
  url: string;
  posterUrl: string | null;
  width: number;
  height: number;
  durationMs: number;
  sizeBytes: number;
}

/** Validate, probe, upload one video to `post-videos` under the user's own
 *  prefix, with progress + cancel via XHR, then best-effort a poster into
 *  `post-media`. Validation order matters: MIME sniff + size + duration are
 *  all checked BEFORE the (potentially 100MB) upload starts. */
export async function uploadPostVideo(
  file: File,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedPostVideo> {
  const { onProgress, signal } = opts;

  const { durationMs, width, height } = await validateAndProbeVideo(file);

  const sb = createClient();
  const { data: auth } = await sb.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new PostVideoError("Sign in to add a video.");
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new PostVideoError("Sign in to add a video.");

  const ext = file.type === "video/quicktime" ? "mov" : "mp4";
  const path = `${uid}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const uploadUrl = `${base}/storage/v1/object/post-videos/${path}`;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new PostVideoError("Upload failed. Tap to retry."));
    };
    xhr.onerror = () => reject(new PostVideoError("Upload failed. Tap to retry."));
    xhr.onabort = () => { const err = new PostVideoError("Upload cancelled."); err.cancelled = true; reject(err); };
    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });

  const url = `${base}/storage/v1/object/public/post-videos/${path}`;

  // Poster is best-effort — a capture or upload failure never blocks the post.
  let posterUrl: string | null = null;
  try {
    const posterBlob = await capturePoster(file);
    if (posterBlob) {
      const posterFile = new File([posterBlob], "poster.jpg", { type: "image/jpeg" });
      posterUrl = await uploadPostImage(posterFile);
    }
  } catch {
    posterUrl = null;
  }

  return { url, posterUrl, width, height, durationMs, sizeBytes: file.size };
}
