import { NextRequest, NextResponse } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { HttpError } from "@/lib/fantasy/server";

// The league display picture — admin only. POST a file (multipart) to upload it to
// the league-avatars bucket and stamp fantasy_leagues.image_url; DELETE to clear.
// The owner check runs server-side, so only the admin can change the picture.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownedLeague(db: any, code: string, userId: string): Promise<{ id: string }> {
  const { data } = await db.from("fantasy_leagues").select("id, owner_id").eq("join_code", code.toUpperCase()).maybeSingle();
  if (!data) throw new HttpError(404, "League not found");
  if (data.owner_id !== userId) throw new HttpError(403, "Only the league admin can change the picture");
  return { id: data.id };
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "That's not an image" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image is over 5MB" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");

  return withFantasyUser("league-image", async (db, userId) => {
    const league = await ownedLeague(db, params.code, userId);
    const path = `${league.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from("league-avatars").upload(path, bytes, { contentType: file.type, upsert: true });
    if (upErr) throw new HttpError(500, "Upload failed, try again");
    const url = db.storage.from("league-avatars").getPublicUrl(path).data.publicUrl as string;
    await db.from("fantasy_leagues").update({ image_url: url }).eq("id", league.id);
    return { imageUrl: url };
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { code: string } }) {
  return withFantasyUser("league-image", async (db, userId) => {
    const league = await ownedLeague(db, params.code, userId);
    await db.from("fantasy_leagues").update({ image_url: null }).eq("id", league.id);
    return { imageUrl: null };
  });
}
