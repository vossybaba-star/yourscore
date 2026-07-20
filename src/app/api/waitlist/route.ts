import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Fantasy waitlist (launch). SESSION-BASED as of 2026-07-16 (founder): asking a
// signed-in user to type the email we already hold made no sense, and a
// signed-out visitor should be pushed into creating an account, not leaving an
// email. So POST reads the session and uses the account email; there is no
// email in the request body at all. The DB (waitlist_emails) is the ledger,
// written first; the Resend "Fantasy Waitlist" audience is best-effort sync
// (resolved by name, created on first use), marked via synced_at.

export const fetchCache = "force-no-store";

const AUDIENCE_NAME = "Fantasy Waitlist";
const RESEND_API = "https://api.resend.com";

// Module-scope cache: the audience id survives for the lambda's lifetime.
let audienceId: string | null = null;

async function resend(path: string, init?: RequestInit) {
  // Audiences need the full-access key: RESEND_API_KEY is sending-only (401s
  // on /audiences — verified 2026-07-13). Falls back for envs without it.
  const key = process.env.RESEND_CAMPAIGNS_API_KEY ?? process.env.RESEND_API_KEY;
  const res = await fetch(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

async function getAudienceId(): Promise<string | null> {
  if (audienceId) return audienceId;
  const list = await resend("/audiences");
  if (list.ok) {
    const json = await list.json();
    const found = (json?.data ?? []).find(
      (a: { id: string; name: string }) => a.name === AUDIENCE_NAME,
    );
    if (found) return (audienceId = found.id);
  }
  const created = await resend("/audiences", {
    method: "POST",
    body: JSON.stringify({ name: AUDIENCE_NAME }),
  });
  if (!created.ok) return null;
  const json = await created.json();
  return (audienceId = json?.id ?? null);
}

export async function GET() {
  // "Is this account already on the list?" — keeps the button honest across
  // visits. Signed out → trivially not saved.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ signedIn: false, saved: false });

  const db = createServiceClient() as unknown as SupabaseClient;
  const { data: row } = await db.from("waitlist_emails").select("email").eq("email", email).maybeSingle();
  return NextResponse.json({ signedIn: true, saved: Boolean(row) });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok } = await rateLimitDistributed(`waitlist:${ip}`, 5, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  // The email comes from the SESSION, never the body — a signed-in user
  // shouldn't be asked for what we hold, and an unauthenticated caller has no
  // business writing to the list (the UI sends them to create an account).
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Sign in to save your spot" }, { status: 401 });

  const source = await req
    .json()
    .then((b: { source?: unknown }) => (typeof b.source === "string" ? b.source.slice(0, 40) : "waitlist"))
    .catch(() => "waitlist");

  /**
   * DB FIRST, Resend second. The table is the ledger; the audience is
   * best-effort sync with synced_at marking successes (backfill:
   * scripts/waitlist-backfill.mjs). A signup is never lost to a missing env
   * var or a vendor hiccup.
   */
  const db = createServiceClient() as unknown as SupabaseClient;
  const { error: dbErr } = await db
    .from("waitlist_emails")
    .upsert({ email, source }, { onConflict: "email", ignoreDuplicates: true });
  if (dbErr) {
    console.error("[waitlist] ledger write failed", dbErr);
    return NextResponse.json({ error: "Try again in a minute" }, { status: 502 });
  }

  // Best-effort audience sync — failure is logged, never surfaced.
  try {
    const audience = await getAudienceId();
    if (audience) {
      const add = await resend(`/audiences/${audience}/contacts`, {
        method: "POST",
        body: JSON.stringify({ email, unsubscribed: false }),
      });
      if (add.ok || add.status === 409 || /exists/i.test(await add.text().catch(() => ""))) {
        await db.from("waitlist_emails").update({ synced_at: new Date().toISOString() }).eq("email", email);
      }
    }
  } catch (err) {
    console.error("[waitlist] audience sync failed (captured in DB)", err);
  }

  return NextResponse.json({ ok: true });
}
