/**
 * scripts/lib/broadcast.mjs
 *
 * Shared helper that sends bulk email as a Resend **Broadcast** (audience /
 * marketing email) instead of looping `resend.batch.send()` (transactional).
 *
 * WHY: every recipient of a `batch.send()` burns one *transactional* credit, so
 * a 3,000-person daily blast = 3,000 transactional emails/day and we blow the
 * transactional quota. A Broadcast is a single send to an Audience, billed as
 * marketing — it does NOT touch the transactional bucket. This is the fix for
 * the recurring over-quota problem: all bulk/marketing sends route through here.
 *
 * Use RESEND_CAMPAIGNS_API_KEY (not RESEND_API_KEY) — broadcasts run on the
 * campaigns key.
 *
 * Resend requires an unsubscribe link in every broadcast, so the template must
 * contain `{{{RESEND_UNSUBSCRIBE_URL}}}` (we also auto-swap the old per-user
 * {{UNSUB_URL}}/{{PAUSE_URL}} tokens to it).
 */

import { Resend } from "resend";

async function audienceEmailSet(resend, audienceId) {
  const { data, error } = await resend.contacts.list({ audienceId });
  if (error) throw new Error(`contacts.list failed: ${error.message}`);
  const set = new Set();
  for (const c of data?.data ?? []) if (c.email) set.add(c.email.trim().toLowerCase());
  return set;
}

/**
 * @param {string} apiKey  RESEND_CAMPAIGNS_API_KEY
 * @param {object} opts
 * @param {string} opts.audienceId
 * @param {Array<string|{email:string,firstName?:string}>|null} opts.emails
 *        Recipients to ensure exist in the audience first (only the missing ones
 *        are created — Resend has no bulk upsert). Pass null to broadcast to the
 *        audience exactly as-is.
 * @param {string} opts.name        internal broadcast name
 * @param {string} opts.from
 * @param {string} [opts.replyTo]
 * @param {string} opts.subject
 * @param {string} [opts.previewText]
 * @param {string} opts.html
 * @param {boolean} opts.dryRun
 * @returns {Promise<{broadcastId?:string, dryRun?:boolean, synced?:number}>}
 */
export async function syncAndBroadcast(apiKey, opts) {
  const { audienceId, emails, name, from, replyTo, subject, previewText, html, dryRun } = opts;
  if (!apiKey) throw new Error("syncAndBroadcast: missing RESEND_CAMPAIGNS_API_KEY");
  if (!audienceId) throw new Error("syncAndBroadcast: missing audienceId");

  const resend = new Resend(apiKey);

  // Broadcasts MUST carry an unsubscribe link. Swap any legacy per-user tokens
  // for Resend's managed one, then hard-require it.
  let body = html
    .replaceAll("{{UNSUB_URL}}", "{{{RESEND_UNSUBSCRIBE_URL}}}")
    .replaceAll("{{PAUSE_URL}}", "{{{RESEND_UNSUBSCRIBE_URL}}}");
  if (!body.includes("{{{RESEND_UNSUBSCRIBE_URL}}}")) {
    throw new Error("Broadcast HTML has no unsubscribe link — add {{{RESEND_UNSUBSCRIBE_URL}}}.");
  }
  // Strip the (valid) triple-brace Resend token first, then flag any leftover.
  const leftover = body.replaceAll("{{{RESEND_UNSUBSCRIBE_URL}}}", "").match(/\{\{\s*[\w.]+\s*\}\}/g);
  if (leftover) throw new Error(`Broadcast HTML has unresolved tokens: ${[...new Set(leftover)].join(", ")}`);

  // Keep the audience complete: add any recipients not already in it (so new
  // signups still receive the send). Only the delta is created.
  let synced = 0;
  if (Array.isArray(emails) && emails.length) {
    const existing = await audienceEmailSet(resend, audienceId);
    const missing = emails
      .map((e) => (typeof e === "string" ? { email: e } : e))
      .filter((e) => e.email && !existing.has(e.email.trim().toLowerCase()));
    console.log(`   👥 Audience: ${existing.size} existing · ${missing.length} to add`);
    if (dryRun) {
      if (missing.length) console.log(`   (dry run — would add ${missing.length} new contact(s))`);
    } else {
      for (const e of missing) {
        const { error } = await resend.contacts.create({
          audienceId, email: e.email, firstName: e.firstName, unsubscribed: false,
        });
        if (!error) synced++;
        else console.warn(`   ⚠️  contact ${e.email}: ${error.message}`);
      }
      if (synced) console.log(`   ➕ Added ${synced} new contact(s)`);
    }
  }

  if (dryRun) {
    console.log(`   🛑 DRY RUN — would create + send broadcast "${name}" to audience ${audienceId}.`);
    return { dryRun: true, synced };
  }

  const { data: created, error: cErr } = await resend.broadcasts.create({
    audienceId, from, replyTo, subject, name, html: body, previewText,
  });
  if (cErr || !created?.id) throw new Error(`broadcasts.create failed: ${cErr?.message ?? "no id returned"}`);

  const { error: sErr } = await resend.broadcasts.send(created.id);
  if (sErr) throw new Error(`broadcasts.send failed: ${sErr.message}`);

  console.log(`   📣 Broadcast ${created.id} sent to audience ${audienceId} (marketing, not transactional).`);
  return { broadcastId: created.id, synced };
}
