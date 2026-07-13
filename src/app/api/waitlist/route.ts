import { NextRequest, NextResponse } from "next/server";
import { rateLimitDistributed } from "@/lib/ratelimit";

// Blog waitlist capture (fantasy launch). Stores signups as contacts in a
// dedicated Resend audience ("Fantasy Waitlist") so the launch email can go to
// exactly this list — resolved by name at runtime (created on first use), so no
// new env var is needed. RESEND_API_KEY already powers lifecycle email.

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

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { ok } = await rateLimitDistributed(`waitlist:${ip}`, 5, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { email?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That doesn't look like an email" }, { status: 400 });
  }

  const audience = await getAudienceId();
  if (!audience) return NextResponse.json({ error: "Try again in a minute" }, { status: 502 });

  const add = await resend(`/audiences/${audience}/contacts`, {
    method: "POST",
    body: JSON.stringify({ email, unsubscribed: false }),
  });
  // A repeat signup is a success from the reader's point of view.
  if (!add.ok && add.status !== 409) {
    const detail = await add.text().catch(() => "");
    if (!/exists/i.test(detail)) {
      return NextResponse.json({ error: "Try again in a minute" }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true });
}
