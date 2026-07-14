/**
 * Sequentially generate every NON-CLUB live-quiz cover (WC + all-time/EOS records),
 * routed by theme. Resumable (skips existing). One at a time (no concurrency).
 * Usage: node --env-file=.env.local scripts/_gen-noncover-covers.mjs <inventoryJson> <outDir>
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [, , invPath, OUT] = process.argv;
const inv = JSON.parse((await import("node:fs")).readFileSync(invPath, "utf8"));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
const isWC = (q) => (q.series === "wc2026") || (q.type === "national") || /world cup/i.test(q.parameter || "") || /world cup/i.test(q.name || "");

const nonClub = inv.filter((q) => q.type !== "club");
let i = 0, ok = 0, fail = 0, skip = 0;
for (const q of nonClub) {
  i++;
  const slug = slugify(q.name);
  const cover = join(OUT, `${slug}-cover.png`);
  if (existsSync(cover)) { console.log(`[${i}/${nonClub.length}] ${q.name} — skip (exists)`); skip++; continue; }
  const route = isWC(q) ? "WC" : "REC";
  console.log(`[${i}/${nonClub.length}] ${q.name} — ${route}`);
  let r;
  if (route === "WC") {
    const j = spawnSync("node", ["--env-file=.env.local", "scripts/_fetch-quiz-json.mjs", q.name, join(OUT, "wc-json")], { encoding: "utf8" });
    const jsonPath = (j.stdout || "").trim().split("\n").pop();
    if (!jsonPath || !existsSync(jsonPath)) { console.log(`   ✗ fetch-json failed: ${(j.stderr||"").slice(0,200)}`); fail++; continue; }
    // Force S2 flat retro-poster so WC covers match the clubs + records (one cohesive library style).
    r = spawnSync("node", ["--env-file=.env.local", "scripts/gen-quiz-images.mjs", "--quiz", jsonPath, "--cover-only", "--style", "2", "--out", OUT, "--quality", "high"], { stdio: "inherit" });
  } else {
    r = spawnSync("node", ["--env-file=.env.local", "scripts/gen-records-cover.mjs", "--name", q.name, "--out", OUT, "--quality", "high"], { stdio: "inherit" });
  }
  if (existsSync(cover)) { console.log(`   ✓ ${q.name}`); ok++; }
  else { console.log(`   ✗ FAILED ${q.name} (exit ${r.status})`); fail++; }
}
console.log(`\nNONCLUB_DONE — ok=${ok} skip=${skip} fail=${fail} of ${nonClub.length}`);
