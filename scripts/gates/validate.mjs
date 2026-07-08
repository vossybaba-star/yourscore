// Eyeball the generators on the LIVE public FPL feed. Run via validate.sh (it
// compiles the TS modules to .tmp-gates-val first). Prints a sample of generated
// questions with the real values so we can confirm answers are correct + clean.

const base = new URL("../../.tmp-gates-val/lib/gates/", import.meta.url);
const { fetchFplBootstrap, fplToPlayers } = await import(new URL("fpl.js", base));
const { generateHigherLower, generateThisSeasonForm } = await import(new URL("higher-lower.js", base));
const { buildFameIndex } = await import(new URL("fame.js", base));
const { statValue } = await import(new URL("types.js", base));

const boot = await fetchFplBootstrap();
const players = fplToPlayers(boot);
const byId = new Map(players.map((p) => [p.id, p]));
const fame = buildFameIndex(players);
console.log(`\nplayers mapped: ${players.length}`);
const withGoals = players.filter((p) => p.goals > 0).length;
const withPoints = players.filter((p) => p.points > 0).length;
console.log(`  with goals>0: ${withGoals} · with points>0: ${withPoints} (0 = pre-season)`);

function show(title, qs) {
  console.log(`\n=== ${title} (${qs.length}) ===`);
  let wrong = 0;
  for (const q of qs.slice(0, 8)) {
    const [a, b] = q.options.map((o) => byId.get(o.id));
    const va = statValue(a, q.stat), vb = statValue(b, q.stat);
    const correct = (va > vb ? a.id : b.id) === q.answerId;
    if (!correct) wrong++;
    const ans = byId.get(q.answerId).name;
    console.log(
      `  ${q.prompt}  ${a.name}(${va}) vs ${b.name}(${vb})  → ${ans}  ` +
        `[diff ${q.difficulty} · fame ${fame.fame(a.id)}/${fame.fame(b.id)}]${correct ? "" : "  ‼ WRONG"}`,
    );
  }
  // Full correctness sweep (not just the printed sample):
  let sweepWrong = 0;
  for (const q of qs) {
    const [a, b] = q.options.map((o) => byId.get(o.id));
    if ((statValue(a, q.stat) > statValue(b, q.stat) ? a.id : b.id) !== q.answerId) sweepWrong++;
  }
  console.log(`  sweep: ${qs.length - sweepWrong}/${qs.length} answers correct`);
  return sweepWrong;
}

let bad = 0;
bad += show("Higher/Lower · price", generateHigherLower(players, { stat: "price", seed: "v1", count: 30 }));
bad += show("Higher/Lower · goals", generateHigherLower(players, { stat: "goals", seed: "v1", count: 30 }));
bad += show("This-season form · points", generateThisSeasonForm(players, { seed: "v1", count: 30, stat: "points" }));

console.log(`\n${bad === 0 ? "✅ all generated answers correct" : `‼ ${bad} incorrect answers`}`);
process.exit(bad === 0 ? 0 : 1);
