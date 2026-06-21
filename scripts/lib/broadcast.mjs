/**
 * Resend Broadcasts helper library.
 * Uses the full-access RESEND_CAMPAIGNS_API_KEY for audience + broadcast management.
 * The send-only RESEND_API_KEY is kept for transactional emails (password resets etc.)
 */

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
