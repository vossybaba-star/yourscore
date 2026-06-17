#!/usr/bin/env node
/**
 * Roll the active World Cup ranked edition.
 *
 * The ranked daily no longer auto-rolls at UTC midnight — it stays on the current edition
 * (available to everyone who hasn't played it) until this script posts a new one. Run it as
 * a step in the daily quiz launch when you put the morning run out:
 *
 *   node scripts/draft/roll-wc-edition.mjs            # edition = today's UTC date
 *   node scripts/draft/roll-wc-edition.mjs 2026-06-18 # or an explicit edition key
 *
 * Posting a new edition resets the one-go for everyone (a fresh run) and reshuffles a new
 * same-for-everyone question set from the whole bank. Delay the launch and the old edition
 * simply stays live longer — no midnight cutoff.
 *
 * Env (from .env.local or the shell): NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
 *                                     SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Fall back to .env.local so the script runs standalone (the launch may not export env).
function loadEnvLocal() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* shell env only */ }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const edition = process.argv[2] || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(edition)) { console.error(`Edition must be YYYY-MM-DD (got "${edition}")`); process.exit(1); }

const db = createClient(URL, KEY);
// The edition being replaced becomes the catch-up "previous" edition (unless this is a
// no-op re-roll of the same edition, in which case we leave prev untouched).
const { data: cur } = await db.from("wc_ranked_edition").select("edition, prev_edition").eq("id", true).maybeSingle();
const prev_edition = cur && cur.edition && cur.edition !== edition ? cur.edition : (cur?.prev_edition ?? null);
const { error } = await db.from("wc_ranked_edition").upsert(
  { id: true, edition, prev_edition, published_at: new Date().toISOString() },
  { onConflict: "id" },
);
if (error) { console.error("Failed to roll edition:", error.message); process.exit(1); }
console.log(`✅ WC ranked edition is now ${edition}${prev_edition ? ` (catch-up: ${prev_edition})` : ""} — everyone gets a fresh run.`);
