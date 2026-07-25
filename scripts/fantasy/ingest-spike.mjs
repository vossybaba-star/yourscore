/**
 * Phase 0 ingestion spike — prove the full-game scoring pipe end to end:
 *   SportMonks per-fixture player stats → YourScore points → sanity vs FPL actual.
 *
 * Pulls every fixture of a real completed gameweek (default: 25/26 GW30,
 * 14–16 Mar 2026) with lineups.details, aggregates per-player match facts
 * (minutes, goals, assists, cards, saves, clean sheets), scores them with the
 * candidate YourScore values (same as familiarity.mjs), maps players to FPL ids
 * by name+club, and reports coverage + rank correlation vs FPL's actual points.
 *
 * PASS = high player-match coverage AND Spearman ≥ 0.95 vs FPL actual
 * (slightly looser than the familiarity ceiling test because this run also
 * absorbs SM↔FPL data differences, not just scoring-value differences).
 *
 * Usage: SPORTMONKS_API_KEY=… node scripts/fantasy/ingest-spike.mjs
 * (fixture responses cached in scripts/data/spike-cache/)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = process.env.SPORTMONKS_API_KEY;
if (!KEY) { console.error("SPORTMONKS_API_KEY not set (run: SPORTMONKS_API_KEY=$(grep '^SPORTMONKS_API_KEY=' .env.local | cut -d= -f2) node …)"); process.exit(1); }

const FROM = "2026-03-14", TO = "2026-03-17", FPL_GW = 30;
const cacheDir = join(root, "scripts/data/spike-cache");
mkdirSync(cacheDir, { recursive: true });

async function sm(path) {
  const key = path.replace(/[^a-z0-9]/gi, "_").slice(0, 80);
  const f = join(cacheDir, key + ".json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const res = await fetch(`https://api.sportmonks.com/v3/football/${path}${path.includes("?") ? "&" : "?"}api_token=${KEY}`);
  const j = await res.json();
  if (!res.ok) throw new Error(`SM ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  writeFileSync(f, JSON.stringify(j));
  return j;
}

// 1. fixtures of the gameweek
const fxList = (await sm(`fixtures/between/${FROM}/${TO}?filters=fixtureLeagues:8&per_page=15`)).data;
console.log(`fixtures in window: ${fxList.length}`);

// 2. per-fixture lineups with stat details + participants + scores
const players = new Map(); // smPlayerId → aggregate
const statVal = (details, re) => {
  const d = details.find((x) => re.test(x.type?.name ?? ""));
  const v = d?.data?.value;
  return typeof v === "number" ? v : v === true ? 1 : 0;
};
for (const fx of fxList) {
  const d = (await sm(`fixtures/${fx.id}?include=lineups.details.type;participants;scores`)).data;
  const teams = new Map(d.participants.map((p) => [p.id, p.name]));
  // final score per team
  const goalsFor = new Map();
  for (const s of d.scores ?? []) if (s.description === "CURRENT")
    goalsFor.set(s.participant_id ?? s.score?.participant_id, s.score?.goals ?? 0);
  const conceded = new Map();
  for (const [tid] of teams) {
    const other = [...teams.keys()].find((x) => x !== tid);
    conceded.set(tid, goalsFor.get(other) ?? 0);
  }
  for (const l of d.lineups ?? []) {
    const det = l.details ?? [];
    const mins = statVal(det, /^Minutes Played$/i);
    if (!mins) continue;
    const cur = players.get(l.player_id) ?? {
      name: l.player_name, club: teams.get(l.team_id) ?? "?",
      minutes: 0, goals: 0, assists: 0, yellows: 0, reds: 0, saves: 0, pensSaved: 0,
      ownGoals: 0, conceded: 0, cs: 0, dc: 0,
    };
    cur.minutes += mins;
    cur.goals += statVal(det, /^Goals$/i);
    cur.assists += statVal(det, /^Assists$/i);
    cur.yellows += statVal(det, /^Yellowcards$|^Yellow Cards$/i);
    cur.reds += statVal(det, /^Redcards$|^Red Cards$|^Yellowred Cards$/i);
    cur.saves += statVal(det, /^Saves$/i);
    cur.pensSaved += statVal(det, /^Penalties Saved$/i);
    cur.ownGoals += statVal(det, /^Own Goals$/i);
    // per-player conceded (SM tracks it while the player is on the pitch)
    const pc = statVal(det, /^Goals Conceded$|^Goalkeeper Goals Conceded$/i);
    cur.conceded += pc;
    if (mins >= 60 && pc === 0 && (conceded.get(l.team_id) ?? 0) === 0) cur.cs = 1;
    // defensive contribution (mirror FPL 25/26: CBIT for DEF, +recoveries for others)
    const cbit = statVal(det, /^Clearances$/i) + statVal(det, /^Interceptions$/i) +
      statVal(det, /^Tackles$/i) + statVal(det, /^Shots Blocked$|^Blocked Shots$/i);
    cur.dc += cbit;
    cur.dcRec = (cur.dcRec ?? 0) + cbit + statVal(det, /^Ball Recovery$/i);
    players.set(l.player_id, cur);
  }
}
console.log(`players with minutes: ${players.size}`);

// 3. map to FPL by normalized name + club
const boot = JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
const norm = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").trim();
const fplTeamName = new Map(boot.teams.map((t) => [t.id, norm(t.name)]));
const fplByKey = new Map();
for (const e of boot.elements) {
  const club = fplTeamName.get(e.team) ?? "";
  for (const nm of [e.web_name, e.second_name, `${e.first_name} ${e.second_name}`])
    fplByKey.set(`${norm(nm)}|${club}`, e);
}
const clubAlias = (c) => {
  const n = norm(c);
  return n.replace("afc bournemouth", "bournemouth").replace("brighton hove albion", "brighton hove albion")
    .replace("wolverhampton wanderers", "wolverhampton wanderers").replace(" fc", "");
};
let matched = 0; const rows = [];
const fplPos = { 1: 1, 2: 2, 3: 3, 4: 4 };
for (const [, p] of players) {
  const club = clubAlias(p.club);
  const nm = norm(p.name);
  const toks = nm.split(" ").filter(Boolean);
  let fpl = null;
  for (const cand of [nm, toks.at(-1), toks.slice(-2).join(" "), toks[0]]) {
    // exact club match on any name form
    for (const [k, e] of fplByKey) {
      const [kn, kc] = k.split("|");
      if (kn === cand && (club.includes(kc.split(" ")[0]) || kc.includes(club.split(" ")[0]))) { fpl = e; break; }
    }
    if (fpl) break;
  }
  if (!fpl) continue;
  matched++;
  const pos = fplPos[fpl.element_type] ?? 3;
  // candidate YourScore values (same as familiarity.mjs)
  let pts = 0;
  pts += p.minutes >= 60 ? 6 : p.minutes > 0 ? 3 : 0;
  pts += p.goals * (pos <= 2 ? 15 : pos === 3 ? 13 : 11);
  pts += p.assists * 8;
  if (p.cs && pos <= 2) pts += 10; else if (p.cs && pos === 3) pts += 3;
  if (pos === 1) pts += Math.floor(p.saves / 3) * 2 + p.pensSaved * 12;
  if (pos <= 2) pts -= Math.floor(p.conceded / 2) * 2;
  pts -= p.yellows * 3 + p.reds * 8 + p.ownGoals * 5;
  if (pos === 2 ? p.dc >= 10 : (p.dcRec ?? 0) >= 12) pts += 5; // defensive contribution
  rows.push({ id: fpl.id, name: fpl.web_name, ours: pts });
}
console.log(`matched to FPL: ${matched}/${players.size} (${(matched / players.size * 100).toFixed(0)}%)`);

// 4. compare vs FPL actual for the same GW
const live = JSON.parse(readFileSync(join(root, `scripts/data/gw${FPL_GW}-live.json`), "utf8"));
const fplPts = new Map(live.elements.map((e) => [e.id, e.stats.total_points]));
const both = rows.filter((r) => fplPts.has(r.id) && fplPts.get(r.id) !== 0);
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
const r = spearman(both.map((x) => x.ours), both.map((x) => fplPts.get(x.id)));
console.log(`\n═══ SPIKE VERDICT — SM-sourced YourScore points vs FPL actual, GW${FPL_GW} ═══`);
console.log(`  compared players: ${both.length}`);
console.log(`  Spearman rank correlation: ${r.toFixed(3)}  (pass bar 0.95)`);
const top = [...both].sort((a, b) => b.ours - a.ours).slice(0, 8);
const fplRank = new Map([...both].sort((a, b) => fplPts.get(b.id) - fplPts.get(a.id)).map((x, i) => [x.id, i + 1]));
console.log(`  top 8 by our SM-sourced points:`);
for (const t of top) console.log(`   ${t.name.padEnd(16)} ours ${String(t.ours).padStart(3)} · FPL ${String(fplPts.get(t.id)).padStart(2)} (their rank #${fplRank.get(t.id)})`);
console.log(r >= 0.95 && matched / players.size >= 0.8 ? "\n  ✅ PIPE PROVEN: SportMonks → YourScore points works end to end" : "\n  ❌ needs attention (coverage or correlation below bar)");
