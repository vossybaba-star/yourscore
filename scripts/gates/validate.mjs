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

// --- SportMonks enrichment + Who-am-I (live) --------------------------------
const KEY = process.env.SPORTMONKS_API_KEY;
if (!KEY) {
  console.log("\n(SPORTMONKS_API_KEY not set — skipping enrichment + Who-am-I)");
} else {
  const { fetchSmSeasonSquads, matchClubs, buildEnrichment, enrichPlayers } =
    await import(new URL("sportmonks.js", base));
  const { generateWhoAmI, buildClues, isExcluded } = await import(new URL("who-am-i.js", base));

  const SEASON = 28083; // PL 2026/27
  const { teams, players: smPlayers } = await fetchSmSeasonSquads(SEASON, KEY);
  console.log(`\nSportMonks: ${teams.length} teams, ${smPlayers.length} squad players`);

  // FPL bootstrap teams carry full-ish names; refetch raw for the name field.
  const fplTeams = boot.teams.map((t) => ({ id: t.id, name: t.name ?? t.short_name }));
  const clubMap = matchClubs(fplTeams, teams);
  console.log(`clubs mapped: ${clubMap.size}/${fplTeams.length}`);
  const unmapped = fplTeams.filter((t) => !clubMap.has(t.id)).map((t) => t.name);
  if (unmapped.length) console.log(`  unmapped: ${unmapped.join(", ")}`);

  const enrichment = buildEnrichment(players, smPlayers, clubMap, new Date());
  const enriched = enrichPlayers(players, enrichment);
  const full = enriched.filter((p) => p.nationality && p.age !== undefined && p.jersey !== undefined);
  console.log(`players enriched (nat+age+jersey): ${full.length}/${players.length}`);

  const eById = new Map(enriched.map((p) => [p.id, p]));
  const qs = generateWhoAmI(enriched, { seed: "v1", count: 25 });
  console.log(`\n=== Who am I (${qs.length}) ===`);
  let dirty = 0;
  for (const q of qs) {
    const ans = eById.get(q.answerId);
    const clues = buildClues(ans, 3);
    const consistent = q.options.filter((o) => !isExcluded(eById.get(o.id), clues)).length;
    if (consistent !== 1) dirty++;
  }
  for (const q of qs.slice(0, 4)) {
    const ans = eById.get(q.answerId);
    console.log(`  ${q.prompt.replaceAll("\n", " ")}`);
    console.log(`    → ${ans.name} (${ans.club})  options: ${q.options.map((o) => o.label).join(", ")}  [diff ${q.difficulty}]`);
  }
  console.log(`  clean sweep: ${qs.length - dirty}/${qs.length} have exactly one consistent option`);
  bad += dirty;
}

// --- Historical add-on: classic trivia + career-path (live) -----------------
if (KEY) {
  const { fetchPlSeasons, fetchSeasonStandings, fetchSeasonTopScorers, buildCareers } =
    await import(new URL("history.js", base));
  const { generateTrivia } = await import(new URL("trivia.js", base));
  const { generateCareerPath } = await import(new URL("career-path.js", base));
  const { fetchSmSeasonSquads } = await import(new URL("sportmonks.js", base));

  const seasons = await fetchPlSeasons(KEY);
  console.log(`\nPL seasons on plan: ${seasons.length} (${seasons[0].name} → ${seasons[seasons.length - 1].name})`);

  // Trivia over 5 era-spread seasons
  const eraNames = ["2005/2006", "2010/2011", "2013/2014", "2019/2020", "2023/2024"];
  const eras = seasons.filter((s) => eraNames.includes(s.name));
  const history = [];
  for (const s of eras) {
    history.push({
      season: s,
      standings: await fetchSeasonStandings(s.id, KEY),
      topScorers: await fetchSeasonTopScorers(s.id, KEY),
    });
  }
  const trivia = generateTrivia(history, { seed: "v1", nowYear: new Date().getFullYear() });
  console.log(`\n=== Classic trivia (${trivia.length}) ===`);
  for (const q of trivia) {
    const ans = q.options.find((o) => o.id === q.answerId).label;
    console.log(`  ${q.prompt}  → ${ans}  [diff ${q.difficulty}]  (${q.options.map((o) => o.label).join(" / ")})`);
  }

  // Careers over 3 consecutive old seasons (light: ~60 squad requests)
  const careerSeasons = seasons.filter((s) => ["2011/2012", "2012/2013", "2013/2014"].includes(s.name));
  const squads = [];
  for (const s of careerSeasons) {
    const { players: smPlayers } = await fetchSmSeasonSquads(s.id, KEY);
    squads.push({ season: s, players: smPlayers });
    console.log(`  squads ${s.name}: ${smPlayers.length} players`);
  }
  const careers = buildCareers(squads);
  const movers = careers.filter((c) => c.clubs.length >= 2);
  console.log(`careers built: ${careers.length} players, ${movers.length} multi-club`);
  const cq = generateCareerPath(careers, { seed: "v1", count: 12, nowYear: new Date().getFullYear() });
  console.log(`\n=== Career path (${cq.length}) ===`);
  for (const q of cq.slice(0, 6)) {
    const ans = q.options.find((o) => o.id === q.answerId).label;
    console.log(`  ${q.prompt}  → ${ans}  [diff ${q.difficulty}]`);
  }
}

console.log(`\n${bad === 0 ? "✅ all generated answers correct + clean" : `‼ ${bad} bad questions`}`);
process.exit(bad === 0 ? 0 : 1);
