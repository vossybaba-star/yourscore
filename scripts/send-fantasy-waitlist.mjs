/**
 * send-fantasy-waitlist.mjs
 *
 * Targeted launch email to ONLY the fantasy "notify me" cohort — waitlist_emails
 * rows with source in the chosen set (default: fantasy-tab). NOT the broadcast.
 * Transactional per-recipient send (RESEND_API_KEY), suppressions honored, a
 * local ledger + X-Entity-Ref-ID guard against double-sends.
 *
 *   node --env-file=.env.local scripts/send-fantasy-waitlist.mjs                # DRY RUN (no send)
 *   node --env-file=.env.local scripts/send-fantasy-waitlist.mjs --include-hold # add the 13 fantasy-hold
 *   node --env-file=.env.local scripts/send-fantasy-waitlist.mjs --send         # actually send
 */
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { loadSuppressions } from "./load-suppressions.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const SEND = args.includes("--send");
const SOURCES = args.includes("--include-hold") ? ["fantasy-tab", "fantasy-hold"] : ["fantasy-tab"];

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "hello@yourscore.app";
const SUBJECT = "You asked us to tell you: Fantasy squads are open";
const LEDGER = path.join(__dirname, "data", "fantasy-waitlist-sent.json");

if (!SUPA_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env");

async function render() {
  let html = await fs.readFile(path.join(__dirname, "..", "emails", "lifecycle", "29-fantasy-launch.html"), "utf-8");
  html = html.replace(/\{\{PAUSE_URL\}\}/g, "https://yourscore.app/settings/email")
             .replace(/\{\{UNSUB_URL\}\}/g, "https://yourscore.app/settings/email");
  const missing = html.match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) throw new Error(`Unsubstituted tokens: ${[...new Set(missing)].join(", ")}`);
  return html;
}

const db = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Cohort
const { data: rows, error } = await db.from("waitlist_emails").select("email, source").in("source", SOURCES);
if (error) throw new Error(error.message);
const cohort = [...new Set((rows ?? []).map((r) => (r.email || "").trim().toLowerCase()).filter(Boolean))];

// Suppressions (bounces/complaints/unsubscribes)
const supp = await loadSuppressions();
const afterSupp = cohort.filter((e) => !supp.has(e));

// Local ledger (already sent)
let sent = new Set();
try { sent = new Set(JSON.parse(await fs.readFile(LEDGER, "utf-8"))); } catch { /* none yet */ }
const todo = afterSupp.filter((e) => !sent.has(e));

console.log(`Sources: ${SOURCES.join(", ")}`);
console.log(`Cohort: ${cohort.length}  |  after suppressions: ${afterSupp.length}  |  already-sent (ledger): ${afterSupp.length - todo.length}  |  WILL SEND: ${todo.length}`);
console.log(`Suppressed from cohort: ${cohort.length - afterSupp.length}`);
console.log(`Sample recipients: ${todo.slice(0, 5).join(", ")}${todo.length > 5 ? " …" : ""}`);
await render(); // verify the template renders (throws on missing tokens)
console.log(`Template 29 renders OK. Subject: "${SUBJECT}"  From: ${FROM}`);

if (!SEND) { console.log("\nDRY RUN — nothing sent. Re-run with --send to fire."); process.exit(0); }

if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
const html = await render();
const resend = new Resend(RESEND_API_KEY);
let ok = 0, fail = 0;
for (const email of todo) {
  try {
    const { error: e } = await resend.emails.send({
      from: FROM, to: email, replyTo: REPLY_TO, subject: SUBJECT, html,
      headers: { "X-Entity-Ref-ID": `fantasy-waitlist:${email}` },
    });
    if (e) { fail++; console.error(`  ✗ ${email}: ${e.message}`); }
    else { ok++; sent.add(email); await fs.mkdir(path.dirname(LEDGER), { recursive: true }).catch(() => {}); await fs.writeFile(LEDGER, JSON.stringify([...sent])); }
    await new Promise((r) => setTimeout(r, 120)); // gentle pace
  } catch (err) { fail++; console.error(`  ✗ ${email}: ${err.message}`); }
}
console.log(`\nDone. Sent ${ok}, failed ${fail}.`);
