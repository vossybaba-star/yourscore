import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// DEV-ONLY: the sprite spike (/38-0/sprites) POSTs a baked PNG data URL here and we
// write it to public/sprites/<name>.png. Guarded to development; delete with the spike.
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "dev only" }, { status: 403 });
  }
  const { name, dataUrl } = (await req.json()) as { name?: string; dataUrl?: string };
  if (!name || !/^[a-z0-9_-]+$/i.test(name) || !dataUrl?.startsWith("data:image/png;base64,")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const b64 = dataUrl.slice("data:image/png;base64,".length);
  const dir = path.join(process.cwd(), "public", "sprites");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await writeFile(file, Buffer.from(b64, "base64"));
  return NextResponse.json({ ok: true, file: `/sprites/${name}.png` });
}
