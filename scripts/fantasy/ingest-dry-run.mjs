/** Ingest dry-run over cached fixtures — see ingest-dry-run.sh. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GW = Number(process.argv[2] ?? 30);
const { aggregateFixtures, toPlayerScores } = await import(
  new URL("../../.tmp-fantasy-ing/lib/fantasy/ingest.js", import.meta.url));

const cacheDir = join(root, "scripts/data/spike-cache");
const fixtures = readdirSync(cacheDir)
  .filter((f) => f.startsWith("fixtures_194") && f.includes("include"))
  .map((f) => JSON.parse(readFileSync(join(cacheDir, f), "utf8")).data);
console.log(`cached fixtures: ${fixtures.length}`);

const pool = JSON.parse(readFileSync(join(root, "src/data/fantasy/pool.json"), "utf8")).players;
const facts = aggregateFixtures(fixtures);
const { scores, matched, unmatchedSmIds } = toPlayerScores(facts, pool);
console.log(`SM players with minutes: ${facts.size} · matched to pool via smId: ${matched} (${(matched / facts.size * 100).toFixed(0)}%) · unmatched: ${unmatchedSmIds.length}`);

// compare vs FPL actual
const live = JSON.parse(readFileSync(join(root, `scripts/data/gw${GW}-live.json`), "utf8"));
const fplPts = new Map(live.elements.map((e) => [e.id, e.stats.total_points]));
const both = scores.filter((r) => (fplPts.get(r.playerId) ?? 0) !== 0);
function spearman(a, b) {
  const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => q[0] - p[0]); const r = new Array(v.length);
    let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}
const r = spearman(both.map((x) => x.points), both.map((x) => fplPts.get(x.playerId)));
const coverage = matched / facts.size;
console.log(`Spearman vs FPL actual (${both.length} players): ${r.toFixed(3)}`);
console.log(coverage >= 0.8 && r >= 0.95
  ? "✅ PRODUCTION INGEST PATH PROVEN (smId identity, no name matching)"
  : `❌ below bar (coverage ${(coverage * 100).toFixed(0)}% / corr ${r.toFixed(3)})`);
process.exit(coverage >= 0.8 && r >= 0.95 ? 0 : 1);
