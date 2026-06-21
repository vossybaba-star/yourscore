/**
 * Resend Broadcasts helper library.
 * Uses the full-access RESEND_CAMPAIGNS_API_KEY for audience + broadcast management.
 * The send-only RESEND_API_KEY is kept for transactional emails (password resets etc.)
 */

import { createClient } from "@supabase/supabase-js";

const BASE = "https://api.resend.com";

function hdrs(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function apiCall(method, path, apiKey, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: hdrs(apiKey),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${method} ${path} → ${res.status}: ${json.message ?? JSON.stringify(json)}`);
  return json;
}

/** Upsert a single contact into an audience. */
export async function upsertContact(apiKey, audienceId, email) {
  return apiCall("POST", `/audiences/${audienceId}/contacts`, apiKey, {
    email,
    unsubscribed: false,
  });
}

/**
 * Upsert an array of email strings into an audience.
 * Respects rate limit via concurrency cap (default 4 parallel → ~20–30/s safe on Pro).
 */
export async function upsertContacts(apiKey, audienceId, emails, { concurrency = 4, onProgress } = {}) {
  let done = 0;
  const queue = [...emails];
  async function worker() {
    while (queue.length > 0) {
      const email = queue.shift();
      if (!email) break;
      try { await upsertContact(apiKey, audienceId, email); } catch { /* skip bad email */ }
      onProgress?.(++done, emails.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
  return done;
}

/** Create a new Resend audience. Returns { id, name }. */
export async function createAudience(apiKey, name) {
  return apiCall("POST", "/audiences", apiKey, { name });
}

/** Delete a Resend audience (cleanup after targeted sends). */
export async function deleteAudience(apiKey, audienceId) {
  return apiCall("DELETE", `/audiences/${audienceId}`, apiKey);
}

/**
 * Create a broadcast draft.
 * html may contain {{ subscriber.unsubscribeUrl }} — Resend injects it per recipient.
 * Returns { id }.
 */
export async function createBroadcast(apiKey, { name, audienceId, from, replyTo, subject, html }) {
  const body = { name, audience_id: audienceId, from, subject, html };
  if (replyTo) body.reply_to = replyTo;
  return apiCall("POST", "/broadcasts", apiKey, body);
}

/** Fire a broadcast by ID. */
export async function sendBroadcast(apiKey, broadcastId) {
  return apiCall("POST", `/broadcasts/${broadcastId}/send`, apiKey, {});
}

/** Full flow: create audience, upsert contacts, create broadcast, send. */
export async function syncAndBroadcast(apiKey, {
  audienceId,        // existing audience id; or null to create a temp one
  audienceName,      // name for temp audience (required if audienceId is null)
  emails,            // string[] — contacts to add to the audience
  name,              // broadcast name (internal)
  from,
  replyTo,
  subject,
  html,
  concurrency = 4,
  deleteTempAudience = false,
  onProgress,
  dryRun = false,
}) {
  let aud = audienceId;
  let isTemp = false;

  if (!aud) {
    if (dryRun) { console.log(`[DRY RUN] Would create audience "${audienceName}"`); }
    else {
      const created = await createAudience(apiKey, audienceName);
      aud = created.id;
      isTemp = true;
      console.log(`   Created audience "${audienceName}" → ${aud}`);
    }
  }

  if (emails?.length) {
    if (dryRun) { console.log(`[DRY RUN] Would upsert ${emails.length} contacts to audience ${aud}`); }
    else {
      process.stdout.write(`   Upserting ${emails.length} contacts`);
      let last = 0;
      await upsertContacts(apiKey, aud, emails, {
        concurrency,
        onProgress: (done, total) => {
          const pct = Math.floor((done / total) * 10);
          if (pct > last) { process.stdout.write("."); last = pct; }
        },
      });
      console.log(` done`);
    }
  }

  let broadcastId;
  if (dryRun) {
    console.log(`[DRY RUN] Would create+send broadcast "${name}" to audience ${aud}`);
  } else {
    const bc = await createBroadcast(apiKey, { name, audienceId: aud, from, replyTo, subject, html });
    broadcastId = bc.id;
    console.log(`   Broadcast created → ${broadcastId}`);
    await sendBroadcast(apiKey, broadcastId);
    console.log(`   Broadcast sent ✓`);
  }

  if (!dryRun && isTemp && deleteTempAudience) {
    await deleteAudience(apiKey, aud);
    console.log(`   Temp audience deleted`);
  }

  return { audienceId: aud, broadcastId };
}

/**
 * Query a user segment from Supabase and return an array of email strings.
 *
 * @param {string} supabaseUrl
 * @param {string} serviceKey
 * @param {string} rpcName     — e.g. "get_segment_wc_active"
 * @param {object} params      — e.g. { p_days: 7 }
 * @returns {Promise<string[]>}
 */
export async function querySegment(supabaseUrl, serviceKey, rpcName, params = {}) {
  const sb = createClient(supabaseUrl, serviceKey);
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.rpc(rpcName, params).range(from, from + PAGE - 1);
    if (error) throw new Error(`Segment ${rpcName}: ${error.message}`);
    const rows = data ?? [];
    all = all.concat(rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all.map(r => r.email).filter(Boolean);
}

/**
 * Convenience wrapper: query a named segment then call syncAndBroadcast.
 * Segment names map to the SQL functions in migration 55_user_segments.sql.
 *
 * @param {string} campaignsKey       RESEND_CAMPAIGNS_API_KEY
 * @param {string} supabaseUrl
 * @param {string} serviceKey         SUPABASE_SERVICE_ROLE_KEY
 * @param {object} opts
 * @param {string} opts.segment       Segment name, e.g. "wc_active"
 * @param {object} [opts.segmentArgs] Params for the segment RPC, e.g. { p_days: 7 }
 * @param {string} opts.audienceName  Name for the temp Resend audience
 * @param {string} opts.name          Broadcast name (internal label)
 * @param {string} opts.from
 * @param {string} [opts.replyTo]
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {boolean} [opts.dryRun]
 */
export async function broadcastToSegment(campaignsKey, supabaseUrl, serviceKey, {
  segment,
  segmentArgs = {},
  audienceName,
  name,
  from,
  replyTo,
  subject,
  html,
  dryRun = false,
}) {
  const rpc = `get_segment_${segment}`;
  console.log(`   Querying segment: ${rpc}(${JSON.stringify(segmentArgs)})`);
  const emails = await querySegment(supabaseUrl, serviceKey, rpc, segmentArgs);
  console.log(`   Segment size: ${emails.length} users`);

  if (emails.length === 0) {
    console.log("   No users in segment — nothing to send.");
    return { audienceId: null, broadcastId: null, count: 0 };
  }

  const result = await syncAndBroadcast(campaignsKey, {
    audienceId: null,
    audienceName: audienceName ?? `${segment} — ${name}`,
    emails,
    name,
    from,
    replyTo,
    subject,
    html,
    deleteTempAudience: false,
    dryRun,
  });

  return { ...result, count: emails.length };
}
