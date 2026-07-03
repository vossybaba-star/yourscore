/**
 * verify-audience.mjs — one-time (re-runnable) deliverability sweep of the whole
 * user base. MX/A-verifies every signed-up email's domain and writes the
 * undeliverable ones to email_suppressions so no future daily/segment broadcast
 * ever mails them again. This is the list-clean Resend wants to see before lifting
 * a high-bounce-rate suspension.
 *
 *   node --env-file=.env.local scripts/verify-audience.mjs            # dry run (report only)
 *   node --env-file=.env.local scripts/verify-audience.mjs --commit   # write suppressions
 *
 * Mirrors src/lib/email-verify.ts (plain .mjs can't import the TS module).
 * Suppress reason = "invalid_mx". SUPPRESS-ONLY — never deletes accounts.
 */
import { promises as dns } from "node:dns";
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_DOMAINS = new Set(["yourscore.fake", "example.com", "test.com"]);
const DOMAIN_TYPOS = new Set([
  "gmial.com","gmai.com","gmail.co","gmail.con","gmail.cm","gnail.com","gmaill.com","gmail.comm",
  "hotmial.com","hotmal.com","hotnail.com","hotmail.co","hotmail.con",
  "outlool.com","outlok.com","outloo.com","outlook.con","outlook.co",
  "yaho.com","yahooo.com","yahoo.con","yahoo.co","yhaoo.com",
  "icloud.con","iclod.com","icloud.co","live.con","live.co",
]);

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("dns_timeout")), ms))]);

async function hasAddressRecord(domain) {
  try { return (await withTimeout(dns.resolve(domain), 5000)).length > 0; }
  catch { try { return (await withTimeout(dns.resolve6(domain), 5000)).length > 0; } catch { return false; } }
}

// true = accepts mail, false = cannot, null = unknown (transient)
async function domainAcceptsMail(domain) {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 5000);
    if (mx && mx.some((r) => r.exchange)) return true;
    return await hasAddressRecord(domain);
  } catch (err) {
    const code = err?.code;
    if (code === "ENOTFOUND" || code === "NXDOMAIN" || code === "ENODATA") return await hasAddressRecord(domain);
    return null; // SERVFAIL / timeout / etc.
  }
}

async function main() {
  console.log(`\n🔎 Deliverability sweep — ${COMMIT ? "⚡ COMMIT (will write suppressions)" : "DRY RUN"}\n`);

  // 1. All auth-user emails
  const emails = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000, page });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data?.users ?? []) if (u.email) emails.push(u.email.trim().toLowerCase());
    if ((data?.users ?? []).length < 1000) break;
    page++;
  }
  const uniqueEmails = [...new Set(emails)];
  console.log(`   ${uniqueEmails.length} unique addresses across ${emails.length} accounts`);

  // 2. Already-suppressed — skip
  const { data: supRows } = await supabase.from("email_suppressions").select("email");
  const suppressed = new Set((supRows ?? []).map((r) => r.email));
  console.log(`   ${suppressed.size} already suppressed\n`);

  // 3. Verify per unique domain (dedup — thousands of gmail users = one lookup)
  const byDomain = new Map();
  for (const e of uniqueEmails) {
    const d = e.split("@")[1] ?? "";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(e);
  }
  const domains = [...byDomain.keys()];
  console.log(`   Resolving ${domains.length} unique domains…`);

  const domainStatus = new Map(); // domain -> true/false/null
  let idx = 0;
  const CONC = 24;
  async function worker() {
    while (idx < domains.length) {
      const d = domains[idx++];
      if (!EMAIL_RE.test(`x@${d}`) || BLOCKED_DOMAINS.has(d) || DOMAIN_TYPOS.has(d)) { domainStatus.set(d, false); continue; }
      domainStatus.set(d, await domainAcceptsMail(d));
      if (idx % 200 === 0) console.log(`     …${idx}/${domains.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // 4. Classify
  const dead = [];       // undeliverable, not yet suppressed
  let unknown = 0, alreadyDeadSuppressed = 0, ok = 0;
  for (const [d, list] of byDomain) {
    const st = domainStatus.get(d);
    for (const e of list) {
      if (st === false) {
        if (suppressed.has(e)) alreadyDeadSuppressed++;
        else dead.push(e);
      } else if (st === null) unknown++;
      else ok++;
    }
  }

  const deadDomains = [...byDomain.entries()].filter(([d]) => domainStatus.get(d) === false)
    .map(([d, l]) => [d, l.length]).sort((a, b) => b[1] - a[1]);

  console.log(`\n   ✅ deliverable:        ${ok}`);
  console.log(`   ❔ unknown (kept):     ${unknown}   (transient DNS — not suppressed)`);
  console.log(`   🚫 undeliverable NEW:  ${dead.length}`);
  console.log(`   🚫 undeliverable (already suppressed): ${alreadyDeadSuppressed}`);
  console.log(`\n   Top dead domains:`);
  for (const [d, n] of deadDomains.slice(0, 15)) console.log(`     ${String(n).padStart(4)}  ${d}`);
  if (dead.length) console.log(`\n   Sample new suppressions: ${dead.slice(0, 8).join(", ")}`);

  // 5. Write
  if (!COMMIT) { console.log(`\n🛑 DRY RUN — re-run with --commit to write ${dead.length} suppression(s).\n`); return; }
  if (!dead.length) { console.log(`\n✅ Nothing new to suppress.\n`); return; }

  const rows = dead.map((email) => ({ email, reason: "invalid_mx", detail: "domain has no mail server (verify-audience sweep)" }));
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("email_suppressions").upsert(rows.slice(i, i + 500), { onConflict: "email", ignoreDuplicates: true });
    if (error) { console.warn(`   ⚠️  batch write failed: ${error.message}`); continue; }
    written += rows.slice(i, i + 500).length;
  }
  console.log(`\n✅ Wrote ${written} suppression(s) (reason=invalid_mx).\n`);
}

main().catch((e) => { console.error("fatal:", e.message); process.exit(1); });
