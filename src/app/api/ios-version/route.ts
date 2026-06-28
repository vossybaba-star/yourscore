import { NextResponse } from "next/server";

// Returns the current App Store version of the iOS app, looked up server-side
// (the iTunes lookup API doesn't send CORS headers, so the client can't hit it
// directly). The UpdateBanner uses this to only nudge users to update when a
// newer build genuinely exists on the store — so it self-activates the moment a
// new version is approved and never dead-ends before then. Cached 30 min.

export const revalidate = 1800;

export async function GET() {
  try {
    const res = await fetch(
      "https://itunes.apple.com/lookup?bundleId=app.yourscore.app",
      { next: { revalidate: 1800 } },
    );
    if (!res.ok) return NextResponse.json({ version: null });
    const json = (await res.json()) as { results?: Array<{ version?: string }> };
    return NextResponse.json({ version: json?.results?.[0]?.version ?? null });
  } catch {
    return NextResponse.json({ version: null });
  }
}
