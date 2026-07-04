import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  // FAIL CLOSED. This endpoint runs with the service-role key, so an unsigned
  // request must never be processed. Previously, a missing RESEND_WEBHOOK_SECRET
  // silently skipped verification and turned this into an unauthenticated
  // account-mutation endpoint. If the secret is not configured, reject.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET is not set — rejecting request");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = req.headers.get("svix-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const body = await req.text();
  const { Webhook } = await import("svix");
  const wh = new Webhook(secret);
  try {
    wh.verify(body, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": signature,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  return handleEvent(event);
}

async function handleEvent(event: { type: string; data: Record<string, unknown> }) {
  const { type, data } = event;

  // Bounces + spam complaints → suppress. These are the direct bounce-rate drivers.
  if (type === "email.bounced" || type === "email.complained") {
    const email = (data.to as string[] | undefined)?.[0] ?? (data.email as string | undefined);
    if (!email) return NextResponse.json({ ok: true });

    const reason = type === "email.bounced" ? "bounce" : "complaint";
    const detail =
      type === "email.bounced"
        ? ((data.bounce_type as string | undefined) ?? (data.bounce as { type?: string } | undefined)?.type ?? null)
        : ((data.complaint_type as string | undefined) ?? null);

    await suppress(email, reason, detail);
    return NextResponse.json({ ok: true });
  }

  // Unsubscribes. Broadcasts carry Resend's MANAGED unsubscribe link, so an opt-out
  // there flips the contact to unsubscribed and fires contact.updated — but our sends
  // rebuild a fresh audience from auth.users every time, so a Resend-side unsubscribe
  // would be silently re-subscribed on the next send. Mirror it into email_suppressions
  // (the table every send filters against) so the opt-out sticks permanently.
  if (type === "contact.updated" || type === "contact.deleted") {
    const email = data.email as string | undefined;
    const unsubscribed = data.unsubscribed === true;
    if (email && unsubscribed) await suppress(email, "unsubscribe", "resend managed unsubscribe");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

// SUPPRESS-ONLY. Stop emailing this address — but never destroy the account. A bounce
// (even "permanent"), a complaint, or an unsubscribe must not delete a user's account
// and game history: bounces can be transient and are spoofable upstream, and neither a
// complaint nor an unsubscribe is a deletion request. Account deletion is handled only
// by the authenticated self-serve flow (delete_user_account, gated by the signed-in user).
// ignoreDuplicates so we never downgrade a stronger reason already on the row.
async function suppress(email: string, reason: string, detail: string | null) {
  await supabase.from("email_suppressions").upsert(
    { email: email.toLowerCase().trim(), reason, detail },
    { onConflict: "email", ignoreDuplicates: true }
  );
}
