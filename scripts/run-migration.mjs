/**
 * Run supabase/migrations/04_multiplayer_rooms.sql via the Supabase Management API.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<personal_access_token> node scripts/run-migration.mjs
 *
 * Get your access token at: https://supabase.com/dashboard/account/tokens
 * Or via CLI: supabase login  (stores token, then run: supabase db push --project-ref mznvuswzgkaupvaqznkm)
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = "mznvuswzgkaupvaqznkm";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("❌  SUPABASE_ACCESS_TOKEN is required.");
  console.error("   Get it at: https://supabase.com/dashboard/account/tokens");
  console.error("   Then run:  SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migration.mjs");
  console.error("");
  console.error("   Alternative: supabase login && supabase db push --project-ref mznvuswzgkaupvaqznkm");
  process.exit(1);
}

const sql = readFileSync(
  join(__dirname, "../supabase/migrations/04_multiplayer_rooms.sql"),
  "utf8"
);

console.log("🚀 Running migration 04_multiplayer_rooms.sql ...");

const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  }
);

const body = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error("❌  Migration failed:", body);
  process.exit(1);
}

console.log("✅  Migration applied successfully.");
console.log("   New columns on rooms: room_mode, question_count, pack_id,");
console.log("   category_filter, difficulty_filter, questions_json,");
console.log("   current_question_idx, question_started_at");
