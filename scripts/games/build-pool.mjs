/**
 * build-pool.mjs — regenerate the Higher or Lower half of src/data/games/pool.json
 * from live data, and rebuild `currentPlayers`.
 *
 *   node --env-file=.env.local scripts/games/build-pool.mjs --dry
 *   node --env-file=.env.local scripts/games/build-pool.mjs
 *   # then always:
 *   node scripts/games/build-player-photos.mjs
 *
 * WHY THIS EXISTS: the pool was committed as a single hand-built JSON on
 * 2026-07-11 with no generator in the repo, so it could never be refreshed. Its
 * player ids were FPL element ids from the 2025/26 allocation, which FPL
 * reassigns every summer, and ~40 of the players it names are no longer in the
 * Premier League at all. That is why only 65% of Higher or Lower questions could
 * resolve a headshot: the names were a season out of date.
 *
 * WHAT IT REBUILDS: the four Higher or Lower topics (goals, assists, starts,
 * age), plus the FPL price and total-points questions. Note that price and
 * points are NOT served by either game today: serve.ts's BELONGS map only
 * admits format "higher-lower" with a stat in HL_TOPICS, and who-am-i /
 * career-path. They are regenerated so the data is current if and when a
 * consumer lands, not because anything reads them now. Everything
 * else in the pool (who-am-i, career-path, classic-trivia) is
 * COPIED THROUGH UNTOUCHED — those need career histories and editorial facts
 * this script has no source for, and silently regenerating them would be worse
 * than leaving them.
 *
 * SOURCES
 *   FPL bootstrap-static — squad list, position, price, goals, assists, starts,
 *     and `code` (the stable player code behind the official PL headshot URL).
 *     Verified 2026-07-24: element stats carry the COMPLETED 2025/26 totals
 *     (Haaland 27/8/2953 matches his history_past 2025/26 row exactly) while
 *     `events` is already the 2026/27 fixture list with 0 played. So the
 *     "2025/26 season" wording in the prompts is correct, and must be bumped
 *     the first time this is run after a gameweek has actually been played.
 *   SportMonks squads (league 8, season 28083) — date_of_birth, which FPL does
 *     not publish (5 of 558 elements have it). Joined per club on surname, so
 *     the candidate set is ~25 players rather than the whole league; anything
 *     ambiguous inside a club is dropped rather than guessed.
 *
 * DIFFICULTY is fitted from the old pool, not invented: difficulty correlated
 * 0.904 with how close the two values are, and a least-squares fit over its 240
 * questions gives 28.9 + 58.8 * (lower / higher), mean absolute error 4.9. Same
 * curve, so rounds keep the difficulty feel they already had.
 */

import fs from "node:fs";
import path from "node:path";

const POOL = path.join(process.cwd(), "src/data/games/pool.json");
const DRY = process.argv.includes("--dry");
const KEY = process.env.SPORTMONKS_API_KEY;
const SM_SEASON = 28083; // Premier League 2026/27
const SEASON_LABEL = "2025/26"; // the season the FPL element stats describe

/** Questions per topic, matching the shape of the pool this replaces. */
const TARGETS = { goals: 45, assists: 45, appearances: 45, age: 45, price: 60, points: 50 };

const PROMPTS = {
  goals: `Who scored more goals in the ${SEASON_LABEL} season?`,
  assists: `Who has more assists in the ${SEASON_LABEL} season?`,
  appearances: `Who has more starts in the ${SEASON_LABEL} season?`,
  age: "Who is older?",
  price: `Who costs more in fantasy football (${SEASON_LABEL} season)?`,
  points: `Who scored more fantasy points in the ${SEASON_LABEL} season?`,
};

/**
 * The `format` each stat is emitted under. Not cosmetic: serve.ts's BELONGS map
 * keys the playable Higher or Lower pool off format PLUS stat, so getting this
 * wrong either drops questions out of the game or drags fantasy-only ones in.
 * `points` keeps its own "this-season-form" format, exactly as before.
 */
const FORMAT_FOR = { points: "this-season-form" };
const formatOf = (stat) => FORMAT_FOR[stat] ?? "higher-lower";

const POSITION = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

/** Goals and assists between two goalkeepers is not a question. */
const POSITIONS_FOR = {
  goals: ["DEF", "MID", "FWD"],
  assists: ["DEF", "MID", "FWD"],
  appearances: ["GK", "DEF", "MID", "FWD"],
  age: ["GK", "DEF", "MID", "FWD"],
  price: ["GK", "DEF", "MID", "FWD"],
  points: ["GK", "DEF", "MID", "FWD"],
};

/** FPL short club names that don't match SportMonks' full names. */
const CLUB_ALIASES = {
  "Man City": "Manchester City",
  "Man Utd": "Manchester United",
  "Nott'm Forest": "Nottingham Forest",
  Spurs: "Tottenham Hotspur",
};

const norm = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** Deterministic RNG so a rerun on the same data produces the same pool. */
function rng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const rand = rng("yourscore:pool:v2");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Fitted from the pool this replaces. Closer values = harder. */
function difficultyFor(hi, lo) {
  const ratio = hi > 0 ? lo / hi : 1;
  return Math.max(5, Math.min(98, Math.round(28.9 + 58.8 * ratio)));
}

async function ages() {
  if (!KEY) { console.warn("! SPORTMONKS_API_KEY missing — age questions will be skipped"); return new Map(); }
  const teams = (await (await fetch(`https://api.sportmonks.com/v3/football/teams/seasons/${SM_SEASON}?api_token=${KEY}`)).json()).data ?? [];
  const byClub = new Map(); // normalised club name -> Map(surname -> [dob])
  for (const t of teams) {
    const sq = (await (await fetch(`https://api.sportmonks.com/v3/football/squads/seasons/${SM_SEASON}/teams/${t.id}?api_token=${KEY}&include=player`)).json()).data ?? [];
    const m = new Map();
    for (const row of sq) {
      const p = row.player ?? {};
      if (!p.display_name || !p.date_of_birth) continue;
      const k = norm(p.display_name.split(" ").pop());
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p.date_of_birth);
    }
    byClub.set(norm(t.name), m);
  }
  return byClub;
}

function ageFrom(dob) {
  const d = new Date(dob);
  // Stamped against the build date, not render time: an age baked into a
  // question must not silently drift past a birthday and become wrong.
  const now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) a--;
  return a;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(POOL, "utf8"));
  const fpl = await (await fetch("https://fantasy.premierleague.com/api/bootstrap-static/")).json();

  const played = (fpl.events ?? []).filter((e) => e.finished).length;
  if (played > 0) {
    console.warn(`! ${played} gameweeks are finished — element stats are now ${SEASON_LABEL === "2025/26" ? "the NEW season" : "current"}.`);
    console.warn("! Bump SEASON_LABEL before trusting these prompts.");
  }

  const clubOf = new Map(fpl.teams.map((t) => [t.id, t.name]));
  const dobByClub = await ages();

  let dobHits = 0, dobAmbiguous = 0;
  const players = [];
  for (const e of fpl.elements) {
    const club = clubOf.get(e.team);
    const pos = POSITION[e.element_type];
    if (!club || !pos) continue;

    let age = null;
    const clubKey = norm(CLUB_ALIASES[club] ?? club);
    const cand = dobByClub.get(clubKey)?.get(norm(e.web_name.split(" ").pop()));
    if (cand?.length === 1) { age = ageFrom(cand[0]); dobHits++; }
    else if (cand?.length > 1) dobAmbiguous++;

    players.push({
      id: e.id,
      name: e.web_name,
      club,
      clubId: e.team,
      position: pos,
      price: e.now_cost / 10,
      code: e.code,
      goals: e.goals_scored,
      assists: e.assists,
      appearances: e.starts,
      points: e.total_points,
      age,
      minutes: e.minutes,
    });
  }

  console.log(`FPL squad: ${players.length} players`);
  console.log(`ages resolved: ${dobHits} (${(100 * dobHits / players.length).toFixed(1)}%)  ambiguous within club: ${dobAmbiguous}`);

  // A pair is only a fair question if both players actually played. Without this
  // the pool fills with 0 v 0 bench comparisons that are guesses, not knowledge.
  const eligible = (p, stat) =>
    POSITIONS_FOR[stat].includes(p.position) &&
    p[stat] !== null &&
    p[stat] !== undefined &&
    (stat === "age" || stat === "price" ? true : p.minutes >= 450) &&
    (stat === "age" ? p.age !== null : true);

  const questions = [];
  const perStat = {};

  for (const [stat, target] of Object.entries(TARGETS)) {
    // Build every valid same-position pair, then spread the picks across
    // difficulty bands so a round isn't ten questions of one flavour.
    const pool = players.filter((p) => eligible(p, stat));
    const byPos = new Map();
    for (const p of pool) {
      if (!byPos.has(p.position)) byPos.set(p.position, []);
      byPos.get(p.position).push(p);
    }

    const pairs = [];
    for (const [pos, group] of byPos) {
      const g = shuffle(group);
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const a = g[i], b = g[j];
          if (a[stat] === b[stat]) continue; // no ties: there'd be no answer
          pairs.push({ pos, a, b });
        }
      }
    }

    const banded = new Map();
    for (const p of pairs) {
      const hi = Math.max(p.a[stat], p.b[stat]);
      const lo = Math.min(p.a[stat], p.b[stat]);
      const d = difficultyFor(hi, lo);
      const band = d < 30 ? 0 : d < 55 ? 1 : d < 75 ? 2 : d < 90 ? 3 : 4;
      if (!banded.has(band)) banded.set(band, []);
      banded.get(band).push({ ...p, difficulty: d });
    }

    // Round-robin the bands so the spread survives even when one band is thin.
    const bands = [...banded.keys()].sort();
    for (const b of bands) banded.set(b, shuffle(banded.get(b)));
    const picked = [];
    const usedPlayers = new Set();
    let guard = 0;
    while (picked.length < target && guard++ < target * 60) {
      let progressed = false;
      for (const b of bands) {
        if (picked.length >= target) break;
        const q = banded.get(b);
        while (q.length) {
          const cand = q.pop();
          // Spread the names around: don't let one player headline a whole topic.
          const key = (p) => `${stat}:${p.id}`;
          if (usedPlayers.has(key(cand.a)) && usedPlayers.has(key(cand.b))) continue;
          usedPlayers.add(key(cand.a));
          usedPlayers.add(key(cand.b));
          picked.push(cand);
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
    }

    for (const p of picked) {
      const higher = p.a[stat] > p.b[stat] ? p.a : p.b;
      questions.push({
        format: formatOf(stat),
        stat,
        prompt: PROMPTS[stat],
        options: [{ id: p.a.id, label: p.a.name }, { id: p.b.id, label: p.b.name }],
        answerId: higher.id,
        difficulty: p.difficulty,
        positions: [p.pos],
        meta: { [p.a.name]: p.a[stat], [p.b.name]: p.b[stat] },
      });
    }
    perStat[stat] = picked.length;
  }

  const REGENERATED = new Set(["higher-lower", "this-season-form"]);
  const preserved = existing.questions.filter((q) => !REGENERATED.has(q.format));
  const out = {
    version: new Date().toISOString().slice(0, 10),
    builtAt: new Date().toISOString(),
    seasonLabel: SEASON_LABEL,
    questions: [...questions, ...preserved],
    currentPlayers: players.map(({ id, name, club, clubId, position, price, code }) => ({
      id, name, club, clubId, position, price, code,
    })),
  };

  console.log("\ngenerated per topic:", JSON.stringify(perStat));
  console.log(`preserved untouched: ${preserved.length} (who-am-i, career-path, classic-trivia)`);
  console.log(`total questions: ${out.questions.length} (was ${existing.questions.length})`);

  if (DRY) { console.log("\n--dry: nothing written"); return; }
  fs.writeFileSync(POOL, JSON.stringify(out, null, 1) + "\n");
  console.log(`\nwrote ${POOL}`);
  console.log("NEXT: node scripts/games/build-player-photos.mjs");
}

main().catch((e) => { console.error(e); process.exit(1); });
