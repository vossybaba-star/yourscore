import { createClient } from "@/lib/supabase/client";

/**
 * Upload a photo as the signed-in user's avatar and return its public URL.
 *
 * One helper so the two entry points — tapping your avatar, and Settings — do
 * exactly the same thing. The file is stored at "<uid>.<ext>" in the public
 * `avatars` bucket; storage RLS (migration 241) lets a user write only their own
 * path, and getPublicUrl gives a CDN URL saved straight onto profiles.avatar_url.
 */

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

export class AvatarUploadError extends Error {}

export async function uploadAvatar(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarUploadError("That's not an image. Pick a photo.");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new AvatarUploadError("That image is too big — keep it under 5 MB.");
  }

  const sb = createClient();
  const { data: auth } = await sb.auth.getUser();
  const uid = auth.user?.id ?? userId;

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${uid}.${ext}`;

  const { error: uploadErr } = await sb.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadErr) throw new AvatarUploadError("Upload failed. Try again.");

  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  const publicUrl = data?.publicUrl;
  if (!publicUrl) throw new AvatarUploadError("Upload failed. Try again.");

  // Cache-bust so the new photo shows immediately (same path is reused on upsert).
  const url = `${publicUrl}?t=${Date.now()}`;
  const { error: saveErr } = await sb.from("profiles").update({ avatar_url: url }).eq("id", uid);
  if (saveErr) throw new AvatarUploadError("Saved the photo but couldn't set it. Try again.");

  return url;
}
