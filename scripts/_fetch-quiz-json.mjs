// Fetch a live quiz's content from the DB into a JSON the WC cover pipeline can load.
// Usage: node --env-file=.env.local scripts/_fetch-quiz-json.mjs "Quiz Name" /out/dir
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2];
const outDir = process.argv[3] || "/tmp";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
const REF = "mznvuswzgkaupvaqznkm";
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");

const sql = `select name, parameter, questions, metadata from quiz_packs where name = $q$${name}$q$ and status='published' and rotation_active limit 1;`;
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const rows = await res.json();
if (!Array.isArray(rows) || !rows[0]) { console.error(`No quiz "${name}"`, JSON.stringify(rows).slice(0, 200)); process.exit(1); }
const r = rows[0];
const quiz = {
  name: r.name,
  parameter: r.parameter || "",
  questions: Array.isArray(r.questions) ? r.questions : (r.questions?.questions || []),
  date: r.metadata?.date || "",
  series: r.metadata?.series || "",
};
const out = join(outDir, `${slugify(name)}.json`);
writeFileSync(out, JSON.stringify(quiz, null, 2));
console.log(out);
