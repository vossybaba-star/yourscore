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
  const { audienceId, audienceName, cleanupPrefix, emails, name, from, replyTo, subject, previewText, html, dryRun } = opts;
  if (!apiKey) throw new Error("syncAndBroadcast: missing RESEND_CAMPAIGNS_API_KEY");
  if (!audienceId && !audienceName) throw new Error("syncAndBroadcast: pass audienceId or audienceName");

  const resend = new Resend(apiKey);

  // SEGMENTED sends (re-engagement, never-played, etc.) target a subset, but a
  // broadcast goes to a whole audience. So for those, spin up a fresh audience
  // named after the campaign, populated only with the segment's emails, and
  // broadcast to that. WHOLE-AUDIENCE sends pass audienceId and reuse the
  // standing audience. `emails` is REQUIRED when creating a fresh audience.
  let targetAudienceId = audienceId;
  if (!targetAudienceId) {
    if (!Array.isArray(emails) || !emails.length) {
      throw new Error("syncAndBroadcast: audienceName requires a non-empty emails segment");
    }
    if (dryRun) {
      console.log(`   🆕 DRY RUN — would create audience "${audienceName}" and add ${emails.length} contact(s)`);
      targetAudienceId = "(dry-run-audience)";
    } else {
      // Cap safety: a fresh per-campaign audience adds contacts toward the 5,000
      // marketing cap. Delete prior campaign audiences sharing this prefix first
      // (their delivery is long done — this path runs at most once/day) so
      // contacts don't accumulate across days.
      if (cleanupPrefix) {
        const { data: list } = await resend.audiences.list();
        for (const a of list?.data ?? []) {
          if (a.id && typeof a.name === "string" && a.name.startsWith(cleanupPrefix)) {
            await resend.audiences.remove(a.id).catch(() => {});
            console.log(`   🧹 Removed prior audience "${a.name}"`);
          }
        }
      }
      const { data: aud, error: aErr } = await resend.audiences.create({ name: audienceName });
      if (aErr || !aud?.id) throw new Error(`audiences.create failed: ${aErr?.message ?? "no id"}`);
      targetAudienceId = aud.id;
      console.log(`   🆕 Created campaign audience ${targetAudienceId} ("${audienceName}")`);
    }
  }

  // Broadcasts MUST carry an unsubscribe link. Swap any legacy per-user tokens
  // for Resend's managed one, then hard-require it.
  let body = html
    .replaceAll("{{UNSUB_URL}}", "{{{RESEND_UNSUBSCRIBE_URL}}}")
    .replaceAll("{{PAUSE_URL}}", "{{{RESEND_UNSUBSCRIBE_URL}}}");
  if (!body.includes("{{{RESEND_UNSUBSCRIBE_URL}}}")) {
    throw new Error("Broadcast HTML has no unsubscribe link — add {{{RESEND_UNSUBSCRIBE_URL}}}.");
  }
  // Strip valid Resend triple-brace merge tags ({{{FIRST_NAME}}}, {{{FIRST_NAME|there}}},
  // {{{RESEND_UNSUBSCRIBE_URL}}}, …), then flag any leftover double-brace placeholder
  // that never got filled.
  const leftover = body.replace(/\{\{\{[^}]+\}\}\}/g, "").match(/\{\{\s*[\w.|]+\s*\}\}/g);
  if (leftover) throw new Error(`Broadcast HTML has unresolved tokens: ${[...new Set(leftover)].join(", ")}`);

  // Keep the audience complete: add any recipients not already in it (so new
  // signups still receive the send). Only the delta is created.
  let synced = 0;
  if (Array.isArray(emails) && emails.length) {
    // A freshly created campaign audience starts empty; only an existing
    // standing audience needs a read to compute the delta.
    const existing = (audienceId && !dryRun) ? await audienceEmailSet(resend, targetAudienceId) : new Set();
    const missing = emails
      .map((e) => (typeof e === "string" ? { email: e } : e))
      .filter((e) => e.email && !existing.has(e.email.trim().toLowerCase()));
    console.log(`   👥 Audience: ${existing.size} existing · ${missing.length} to add`);
    if (dryRun) {
      if (missing.length) console.log(`   (dry run — would add ${missing.length} contact(s))`);
    } else {
      for (const e of missing) {
        const { error } = await resend.contacts.create({
          audienceId: targetAudienceId, email: e.email, firstName: e.firstName, unsubscribed: false,
        });
        if (!error) synced++;
        else console.warn(`   ⚠️  contact ${e.email}: ${error.message}`);
      }
      if (synced) console.log(`   ➕ Added ${synced} contact(s)`);
    }
  }

  if (dryRun) {
    console.log(`   🛑 DRY RUN — would create + send broadcast "${name}" to audience ${targetAudienceId}.`);
    return { dryRun: true, synced };
  }

  const { data: created, error: cErr } = await resend.broadcasts.create({
    audienceId: targetAudienceId, from, replyTo, subject, name, html: body, previewText,
  });
  if (cErr || !created?.id) throw new Error(`broadcasts.create failed: ${cErr?.message ?? "no id returned"}`);

  const { error: sErr } = await resend.broadcasts.send(created.id);
  if (sErr) throw new Error(`broadcasts.send failed: ${sErr.message}`);

  console.log(`   📣 Broadcast ${created.id} sent to audience ${targetAudienceId} (marketing, not transactional).`);
  return { broadcastId: created.id, synced };
}
