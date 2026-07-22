#!/usr/bin/env node
/**
 * waitlist-backfill.mjs — push waitlist_emails rows that never made it into the
 * Resend "Fantasy Waitlist" audience (synced_at is null).
 *
 * The /api/waitlist route writes the DB first and syncs Resend best-effort, so
 * signups survive a missing RESEND_CAMPAIGNS_API_KEY or a vendor outage. Run
 * this once after the key lands on Vercel (and any time the health check shows
 * unsynced rows):
 *
 *   node --env-file=.env.local scripts/waitlist-backfill.mjs
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.RESEND_CAMPAIGNS_API_KEY ?? process.env.RESEND_API_KEY;
if (!url || !key || !resendKey) throw new Error("need SUPABASE + RESEND_CAMPAIGNS_API_KEY env");

const sb = (path, init = {}) =>
  fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
const resend = (path, init = {}) =>
  fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
  });

// Resolve (or create) the audience by name — same rule as the route.
const AUDIENCE_NAME = "Fantasy Waitlist";
let audienceId = null;
{
  const list = await resend("/audiences");
  if (!list.ok) throw new Error(`audiences list → ${list.status} (is this the CAMPAIGNS key?)`);
  const found = ((await list.json())?.data ?? []).find((a) => a.name === AUDIENCE_NAME);
  audienceId = found?.id ?? null;
  if (!audienceId) {
    const created = await resend("/audiences", { method: "POST", body: JSON.stringify({ name: AUDIENCE_NAME }) });
    if (!created.ok) throw new Error(`audience create → ${created.status}`);
    audienceId = (await created.json())?.id;
  }
}

const rows = await (await sb("waitlist_emails?select=email&synced_at=is.null&limit=1000")).json();
console.log(`${rows.length} unsynced signup(s)`);
let ok = 0, failed = 0;
for (const { email } of rows) {
  const add = await resend(`/audiences/${audienceId}/contacts`, {
    method: "POST",
    body: JSON.stringify({ email, unsubscribed: false }),
  });
  const dup = add.status === 409 || /exists/i.test(await add.clone().text().catch(() => ""));
  if (add.ok || dup) {
    await sb(`waitlist_emails?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: JSON.stringify({ synced_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    });
    ok++;
  } else {
    failed++;
    console.error(`  ${email} → ${add.status}`);
  }
}
console.log(`synced ${ok}, failed ${failed}`);
