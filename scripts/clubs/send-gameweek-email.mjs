/**
 * send-gameweek-email.mjs — the batched EMAIL half of the club-gameweek message.
 * (Push is the Vercel cron /api/cron/club-gameweek; this is its email twin.)
 *
 * Runs on the VPS, hourly. It asks the app which sends are due
 * (/api/clubs/gameweek-sends — same tally engine the push cron uses, so the two
 * channels never disagree), resolves user_id → email, drops suppressed and
 * already-emailed recipients, renders the 24-club-gameweek template per person,
 * and sends via Resend.
 *
 * Usage:
 *   node --env-file=.env.local scripts/clubs/send-gameweek-email.mjs          # DRY RUN (default)
 *   node --env-file=.env.local scripts/clubs/send-gameweek-email.mjs --send   # actually send
 *   HALFTIME_API_BASE=http://127.0.0.1:3402 node ... --send                   # point at a demo app
 *
 * Safety, matching the house pattern (send-reengagement.mjs):
 *   - DRY RUN unless --send. Prints exactly who would get what.
 *   - Exactly-once is notification_log's PK (user_id, key): we LOG BEFORE we send,
 *     and a duplicate key insert fails, so a recipient already emailed this
 *     gameweek is skipped — even across overlapping runs or a push/email overlap
 *     (the keys differ by channel, so email and push both fire, once each).
 *   - Resend batch API caps at 100/call; we chunk. Suppressions honoured.
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--send");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const API_BASE = (process.env.HALFTIME_API_BASE || process.env.NEXT_PUBLIC_APP_URL || "https://yourscore.app").replace(/\/$/, "");
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env — run with --env-file=.env.local");
if (!CRON_SECRET) throw new Error("Missing CRON_SECRET");
if (!DRY_RUN && !RESEND_KEY) throw new Error("Missing RESEND_API_KEY (needed for --send)");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function isSendable(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return false;
  // never mail the internal seed/QA accounts
  if (e.endsWith("@yourscore.app") || e.includes("+qa@") || e.includes("+seed@")) return false;
  return true;
}

async function loadTemplate() {
  const p = path.join(__dirname, "..", "..", "emails", "lifecycle", "24-club-gameweek.html");
  return fs.readFile(p, "utf-8");
}
function render(tpl, tokens) {
  let html = tpl;
  for (const [k, v] of Object.entries(tokens)) html = html.replaceAll(`{{${k}}}`, String(v));
  const missing = html.match(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g);
  if (missing) throw new Error(`unfilled tokens: ${[...new Set(missing)].join(", ")}`);
  return html;
}
const footer = (userId) => {
  const u = encodeURIComponent(userId);
  return { PAUSE_URL: `${APP_URL}/settings/email?pause=all&u=${u}`, UNSUB_URL: `${APP_URL}/settings/email?unsub=all&u=${u}` };
};
const unsubHeaders = (userId) => ({
  "List-Unsubscribe": `<${APP_URL}/api/email/unsubscribe?u=${encodeURIComponent(userId)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

async function main() {
  console.log(`\nClub-gameweek email — ${DRY_RUN ? "DRY RUN (nothing sent)" : "⚡ LIVE — WILL SEND"}\n`);

  // 1. what's due (same engine as the push cron)
  const res = await fetch(`${API_BASE}/api/clubs/gameweek-sends`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  if (!res.ok) throw new Error(`gameweek-sends → ${res.status}: ${await res.text()}`);
  const { sends } = await res.json();
  if (!sends?.length) { console.log("Nothing due. Done.\n"); return; }

  // 2. emails for every user_id in scope (one admin.listUsers sweep, paged)
  const wantedIds = new Set(sends.flatMap((s) => s.recipients.map((r) => r.userId)));
  const emailById = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (wantedIds.has(u.id) && u.email) emailById.set(u.id, u.email);
    if (data.users.length < 1000) break;
  }

  // 3. suppressions
  const { data: supp } = await supabase.from("email_suppressions").select("user_id");
  const suppressed = new Set((supp ?? []).map((r) => r.user_id));

  const tpl = await loadTemplate();
  let sent = 0, skippedNoEmail = 0, skippedSupp = 0, skippedDup = 0;

  for (const s of sends) {
    const eligible = [];
    for (const r of s.recipients) {
      const email = emailById.get(r.userId);
      if (!isSendable(email)) { skippedNoEmail++; continue; }
      if (suppressed.has(r.userId)) { skippedSupp++; continue; }
      eligible.push({ ...r, email });
    }

    console.log(`▸ ${s.send} · GW${s.roundName} · ${eligible.length} sendable of ${s.recipients.length}`);
    if (eligible.length) {
      const ex = eligible[0];
      console.log(`   e.g. "${ex.subject}" → ${ex.email}`);
      console.log(`        ${ex.personal}`);
    }
    if (DRY_RUN) continue;

    for (const batch of chunk(eligible, 100)) {
      // log-before-send: claim the dedup key first; a conflict means already emailed.
      const fresh = [];
      for (const r of batch) {
        const { error } = await supabase.from("notification_log").insert({ user_id: r.userId, key: s.dedupeKey });
        if (error) { skippedDup++; continue; } // 23505 = already sent this gameweek
        fresh.push(r);
      }
      if (!fresh.length) continue;

      await Promise.all(fresh.map((r) =>
        resend.emails.send({
          from: FROM,
          to: r.email,
          subject: r.subject,
          html: render(tpl, {
            PREHEADER: r.preheader, BADGE: r.badge, HEADLINE: r.headline,
            SUBLINE: r.subline, PERSONAL: r.personal, CTA_LABEL: r.ctaLabel, CTA_URL: r.ctaUrl,
            ...footer(r.userId),
          }),
          headers: { "X-Entity-Ref-ID": r.refId, ...unsubHeaders(r.userId) },
          tags: [{ name: "category", value: "lifecycle" }, { name: "template", value: "24-club-gameweek" }],
        }).catch((e) => console.error(`  send failed ${r.email}: ${e.message}`)),
      ));
      sent += fresh.length;
    }
  }

  console.log(`\nDone. sent=${sent} · no-email=${skippedNoEmail} · suppressed=${skippedSupp} · already-emailed=${skippedDup}\n`);
  if (DRY_RUN) console.log("DRY RUN — pass --send to actually mail.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
