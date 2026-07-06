/**
 * load-suppressions.mjs
 *
 * Shared utility for all send scripts.
 * Returns a Set of lowercase suppressed email addresses from two sources:
 *   1. Supabase email_suppressions table (bounces + complaints via Resend webhook)
 *   2. Local suppressions.json (manual removals)
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadSuppressions() {
  const suppressed = new Set();

  // 1. Supabase email_suppressions table
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("email_suppressions")
          .select("email")
          .range(from, from + 999);
        if (error) { console.warn(`   ⚠️  Could not fetch Supabase suppressions: ${error.message}`); break; }
        for (const row of data) suppressed.add(row.email.toLowerCase().trim());
        if (data.length < 1000) break;
        from += 1000;
      }
    } catch (e) {
      console.warn(`   ⚠️  Suppression table fetch failed: ${e.message}`);
    }
  }

  // 2. Local suppressions.json
  try {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, "suppressions.json"), "utf-8"));
    for (const s of raw.suppressions ?? []) suppressed.add(s.email.trim().toLowerCase());
  } catch {}

  if (suppressed.size > 0) console.log(`   🚫 ${suppressed.size} suppressed address(es) loaded (bounces + manual)`);
  return suppressed;
}
