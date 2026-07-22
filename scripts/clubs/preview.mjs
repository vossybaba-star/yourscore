/**
 * preview.mjs — show every club-gameweek message variant + render a real email.
 * Deterministic (no wall-clock, no DB): feeds hand-built Recipients through the
 * exact copy engine the push cron and email job use.
 *
 *   npx tsx scripts/clubs/preview.mjs
 */
import { resultCopy, emailContent } from "../../src/lib/clubs/result.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const R = (o) => ({ clubsRanked: 18, ...o });
const cases = [
  ["played, club 3rd, mid-pack", R({ club: "Arsenal", played: true, rankInClub: 12, clubFans: 42, clubRank: 3 })],
  ["played, club 1st, top scorer", R({ club: "Brentford", played: true, rankInClub: 1, clubFans: 8, clubRank: 1 })],
  ["DID NOT play, club 3rd", R({ club: "Arsenal", played: false, rankInClub: null, clubFans: 42, clubRank: 3 })],
  ["played, club short-handed", R({ club: "Nottingham Forest", played: true, rankInClub: 2, clubFans: 4, clubRank: null })],
  ["DID NOT play, club short-handed", R({ club: "Nottingham Forest", played: false, rankInClub: null, clubFans: 4, clubRank: null })],
];

for (const send of ["results", "newweek"]) {
  console.log(`\n════════ ${send.toUpperCase()} SEND ════════`);
  for (const [label, r] of cases) {
    const c = resultCopy(send, r);
    console.log(`\n  · ${label}`);
    console.log(`    ${c.title}`);
    console.log(`    ${c.body}`);
  }
}

// Render a real email (results · non-player · club 3rd — the re-engagement case).
const r = R({ club: "Arsenal", played: false, rankInClub: null, clubFans: 42, clubRank: 3 });
const e = emailContent("results", r, "12");
let tpl = fs.readFileSync(path.join(__dirname, "..", "..", "emails", "lifecycle", "24-club-gameweek.html"), "utf-8");
const tokens = {
  PREHEADER: e.preheader, BADGE: e.badge, HEADLINE: e.headline, SUBLINE: e.subline,
  PERSONAL: e.personal, CTA_LABEL: e.ctaLabel, CTA_URL: "https://yourscore.app/play",
  PAUSE_URL: "https://yourscore.app/settings/email?pause=all&u=demo",
  UNSUB_URL: "https://yourscore.app/settings/email?unsub=all&u=demo",
};
for (const [k, v] of Object.entries(tokens)) tpl = tpl.replaceAll(`{{${k}}}`, v);
const missing = tpl.match(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g);
if (missing) { console.error(`\n✗ unfilled tokens: ${[...new Set(missing)].join(", ")}`); process.exit(1); }
const out = path.join(__dirname, "..", "..", "..", "club-gameweek-email-preview.html");
fs.writeFileSync(out, tpl);
console.log(`\n\n✓ email rendered (all tokens filled) → ${out}\n`);
