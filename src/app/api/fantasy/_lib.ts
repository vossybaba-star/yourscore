/** Shared plumbing for /api/fantasy routes: auth → rate limit → handler → errors. */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { HttpError } from "@/lib/fantasy/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export async function withFantasyUser(
  op: string,
  fn: (db: Db, userId: string) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { ok } = await rateLimitDistributed(`fantasy:${op}:${user.id}`, 30, 60_000);
    if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const db = createServiceClient();
    return NextResponse.json(await fn(db, user.id));
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error(`[fantasy:${op}]`, e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
