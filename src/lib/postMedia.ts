import { createClient } from "@/lib/supabase/client";

/**
 * Upload one image for a Social post and return its public URL. Stored under the
 * user's own prefix in the public `post-media` bucket (RLS: write only your own
 * path, mig 244). postToFeed re-checks the URL is from this bucket, so a post
 * can't smuggle in an arbitrary external image.
 */
export const MAX_POST_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export class PostImageError extends Error {}

export async function uploadPostImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new PostImageError("That's not an image. Pick a photo.");
  if (file.size > MAX_POST_IMAGE_BYTES) throw new PostImageError("That image is too big. Keep it under 8 MB.");

  const sb = createClient();
  const { data: auth } = await sb.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new PostImageError("Sign in to add an image.");

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${uid}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;

  const { error } = await sb.storage.from("post-media").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new PostImageError("Upload failed. Try again.");

  const { data } = sb.storage.from("post-media").getPublicUrl(path);
  if (!data?.publicUrl) throw new PostImageError("Upload failed. Try again.");
  return data.publicUrl;
}

/** Up to this many images on one post (Phase 2a, multi-image composer). */
export const MAX_POST_IMAGES = 4;

/** Upload several images for one post, reusing uploadPostImage per file. The
 *  composer itself uploads each file independently (so one failure never blocks
 *  the rest and each thumb can show its own state) — this batch helper is for
 *  callers that just want all-or-nothing URLs back. */
export async function uploadPostImages(files: File[]): Promise<string[]> {
  const capped = files.slice(0, MAX_POST_IMAGES);
  const urls: string[] = [];
  for (const file of capped) urls.push(await uploadPostImage(file));
  return urls;
}
