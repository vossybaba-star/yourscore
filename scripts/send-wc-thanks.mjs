/**
 * WC Mastermind thank-you campaign (emails/lifecycle/29-wc-thanks.html).
 *
 * Audience: wc_thanks_prompts cohort (the >10-ranked-days players seeded by
 * migration 100), minus email_suppressions, minus the founder's manually-added
 * test row. Copy LOCKED by founder 2026-07-21.
 *
 * Usage (from repo root):
 *   node --env-file=.env.local scripts/send-wc-thanks.mjs --test   # founder inbox only
 *   node --env-file=.env.local scripts/send-wc-thanks.mjs --dry    # list recipients, send nothing
 *   node --env-file=.env.local scripts/send-wc-thanks.mjs --send   # the real thing
 */
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const MODE = args.includes("--send") ? "send" : args.includes("--test") ? "test" : "dry";

const FOUNDER_ID = "4050ec90-5323-46aa-8dc0-811e0aac701a"; // manually-added test row, not a real cohort member
const FOUNDER_EMAIL = "vossybaba@gmail.com";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";
// hello@ has no mailbox (verified 2026-07-21: bounces). Replies must go to support@.
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "support@yourscore.app";
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars — run with --env-file=.env.local");
if (!RESEND_KEY) throw new Error("Missing RESEND_API_KEY — run with --env-file=.env.local");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const resend = new Resend(RESEND_KEY);

const SUBJECT = "You played the whole World Cup — thank you";
const TEMPLATE = "29-wc-thanks";

async function renderTemplate(userId) {
  const filePath = path.join(__dirname, "..", "emails", "lifecycle", `${TEMPLATE}.html`);
  let html = await fs.readFile(filePath, "utf-8");
  const tokens = {
    PAUSE_URL: `${APP_URL}/settings/email?pause=all&u=${encodeURIComponent(userId)}`,
    UNSUB_URL: `${APP_URL}/settings/email?unsub=all&u=${encodeURIComponent(userId)}`,
  };
  for (const [key, value] of Object.entries(tokens)) html = html.replaceAll(`{{${key}}}`, value);
  const missing = html.match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) throw new Error(`Unsubstituted tokens: ${[...new Set(missing)].join(", ")}`);
  return html;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function recipients() {
  if (MODE === "test") return [{ id: FOUNDER_ID, email: FOUNDER_EMAIL }];
  const { data: rows, error: qErr } = await supabase
    .from("wc_thanks_prompts")
    .select("user_id")
    .neq("user_id", FOUNDER_ID)
    .limit(1000);
  if (qErr) throw qErr;
  // Emails live in auth.users (not exposed over REST) — fetch per cohort member.
  const out = [];
  for (const { user_id } of rows) {
    const { data, error } = await supabase.auth.admin.getUserById(user_id);
    if (!error && data?.user?.email) out.push({ id: user_id, email: data.user.email });
  }
  const { data: sup } = await supabase.from("email_suppressions").select("email").limit(10000);
  const suppressed = new Set((sup ?? []).map((s) => (s.email || "").toLowerCase()));
  return out.filter((r) => !suppressed.has(r.email.toLowerCase()));
}

const list = await recipients();
console.log(`Mode: ${MODE} — ${list.length} recipient(s)`);
if (MODE === "dry") {
  console.log(list.slice(0, 10).map((r) => r.email).join("\n") + (list.length > 10 ? `\n… +${list.length - 10} more` : ""));
  process.exit(0);
}

let sent = 0, failed = 0;
for (const [i, batch] of chunk(list, 100).entries()) {
  const payloads = await Promise.all(
    batch.map(async (u) => ({
      from: FROM,
      to: u.email,
      replyTo: REPLY_TO,
      subject: MODE === "test" ? `[TEST] ${SUBJECT}` : SUBJECT,
      html: await renderTemplate(u.id),
      headers: { "X-Entity-Ref-ID": `wc-thanks-${u.id}` },
      tags: [
        { name: "category", value: "campaign" },
        { name: "template", value: TEMPLATE },
      ],
    })),
  );
  const { error } = await resend.batch.send(payloads);
  if (error) { console.error(`batch ${i + 1} error:`, error); failed += batch.length; }
  else sent += batch.length;
}
console.log(`Done. sent=${sent} failed=${failed}`);
