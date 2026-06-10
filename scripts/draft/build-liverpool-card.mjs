/**
 * build-liverpool-card.mjs — a shareable 38-0 "season result" landing page built
 * around the all-time Liverpool XI (marketing / @LFC outreach).
 *
 * The hook: Liverpool chased Arsenal's Invincibles in 2019-20, went 44 league
 * games unbeaten, then lost at Watford. This card "finishes the job": the
 * greatest-ever Reds XI (spanning FIFA editions 2006/07 → 2025/26) goes a perfect
 * 38-0-0 INVINCIBLE, sweeping all 19 other Premier League clubs home and away.
 *
 * Output → public/clubs/liverpool.html  (live at /clubs/liverpool.html)
 * Run: node scripts/draft/build-liverpool-card.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public", "clubs");
const SITE = "https://yourscore.app";
const LFC_RED = "#c8102e";

const LINE = { GK: "gk", RB: "def", CB: "def", LB: "def", CDM: "mid", CM: "mid", CAM: "mid", RW: "att", LW: "att", ST: "att" };
const LINE_COLOR = { gk: "#ffb800", def: "#4fc3f7", mid: "#00ff87", att: "#ff4757" };
// Names whose surname spans more than one word (else "Virgil van Dijk" → "Dijk").
const NAME_OVERRIDE = { "Virgil van Dijk": { first: "Virgil", sur: "Van Dijk" } };
const surname = (n) => NAME_OVERRIDE[n]?.sur ?? n.split(" ").slice(-1)[0];
const firstName = (n) => NAME_OVERRIDE[n]?.first ?? (n.split(" ").slice(0, -1).join(" ") || "");

// All 20 Premier League clubs (2024/25). The XI is Liverpool, so it plays the
// other 19 home & away = a 38-game season.
const PL_OPPONENTS = [
  "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Chelsea",
  "Crystal Palace", "Everton", "Fulham", "Ipswich Town", "Leicester City",
  "Man City", "Man Utd", "Newcastle", "Nott'm Forest", "Southampton",
  "Tottenham", "West Ham", "Wolves",
];

// All-time Liverpool XI — real ratings + the FIFA edition each is taken from
// (era badge shows the all-time span). 4-3-3.
const XI = [
  { pos: "RW", name: "Mohamed Salah",          era: "'25", ovr: 91 },
  { pos: "ST", name: "Fernando Torres",        era: "'10", ovr: 88 },
  { pos: "LW", name: "Sadio Mané",             era: "'22", ovr: 89 },
  { pos: "CM", name: "Steven Gerrard",         era: "'10", ovr: 88 },
  { pos: "CM", name: "Xabi Alonso",            era: "'07", ovr: 85 },
  { pos: "CM", name: "Fabinho",                era: "'22", ovr: 87 },
  { pos: "RB", name: "Trent Alexander-Arnold", era: "'22", ovr: 87 },
  { pos: "CB", name: "Virgil van Dijk",        era: "'25", ovr: 90 },
  { pos: "CB", name: "Jamie Carragher",        era: "'07", ovr: 85 },
  { pos: "LB", name: "Andy Robertson",         era: "'22", ovr: 87 },
  { pos: "GK", name: "Alisson",                era: "'25", ovr: 89 },
];

const REC = { w: 38, d: 0, l: 0, pts: 114, pos: 1, ovr: 90 };
const ACCENT = "#ffd700"; // Invincible gold

const MATCH = {
  label: "MATCHDAY 9 · OLD TRAFFORD",
  hg: 7, ag: 0, result: "WON",
  home: "Liverpool All-Time XI", away: "Manchester United",
  scorers: ["Salah 5', 33', 80' (hat-trick)", "Mané 12', 45'", "Torres 60'", "Gerrard 75'"],
  motm: { name: "Mohamed Salah", era: "'25", rating: 9.7, note: "hat-trick at Old Trafford" },
  cards: "🟨 0   🟥 0",
};
const LEADERS = {
  scorer: { name: "Mohamed Salah", era: "'25", v: "44 goals" },
  assists: { name: "Trent Alexander-Arnold", era: "'22", v: "22 assists" },
  pots: { name: "Virgil van Dijk", era: "'25", v: "9.1 avg" },
  glove: { name: "Alisson", era: "'25", v: "28 clean sheets" },
};
const DISCIPLINE = "Discipline: 9🟨 · 0🟥 · only 8 goals conceded all season";
const BOOT = "Salah~44";
const POTS = "Van Dijk~5~4";

// ── Fixtures: 19 home + 19 away = 38, all wins (Invincible). ──────────────────
const WIN_SCORES = ["2-0", "3-1", "1-0", "2-1", "4-0", "3-0", "2-0", "5-1", "1-0", "3-2", "4-1", "2-0", "3-0", "1-0"];
function buildFixtures() {
  const fx = [];
  PL_OPPONENTS.forEach((opp) => fx.push({ opp, ha: "H" }));
  PL_OPPONENTS.forEach((opp) => fx.push({ opp, ha: "A" }));
  let wc = 0;
  return fx.map((f, i) => {
    // The marquee 7-0 vs Man Utd is the home fixture; rest cycle the win pool.
    let score = f.opp === "Man Utd" && f.ha === "H" ? "7-0" : WIN_SCORES[wc++ % WIN_SCORES.length];
    const [gf, ga] = score.split("-");
    return { ...f, gf, ga, md: i + 1 };
  });
}

// ── og:image via the live season-og endpoint (so X unfurls the broadcast card) ─
function ogUrl() {
  const xi = XI.map((p) => `${p.pos}~${surname(p.name)}~${p.ovr}`).join("|");
  const q = new URLSearchParams({
    w: REC.w, d: REC.d, l: REC.l, pts: REC.pts, pos: REC.pos, ovr: REC.ovr,
    mode: "Normal", inv: "1", boot: BOOT, pots: POTS, xi, wide: "1",
  });
  return `${SITE}/api/draft/season-og?${q.toString()}`;
}

function token(p) {
  const lc = LINE_COLOR[LINE[p.pos] || "att"];
  return `
    <div class="tok">
      <div class="tok-pos" style="color:${lc}">${p.pos}</div>
      <div class="tok-circle" style="border-color:${lc}"><span class="tok-ovr">${p.ovr}</span></div>
      <div class="tok-first">${firstName(p.name)}</div>
      <div class="tok-name">${surname(p.name)}</div>
      <div class="tok-club" style="background:${LFC_RED}">${p.era}</div>
    </div>`;
}
function leaderRow(label, l) {
  return `<div class="lead"><div class="lead-label">${label}</div><div class="lead-name">${l.name} <span class="chip" style="background:${LFC_RED}">${l.era}</span></div><div class="lead-val">${l.v}</div></div>`;
}
function fixtureRow(f) {
  return `<div class="fx"><span class="fx-md">${f.md}</span><span class="fx-ha">${f.ha}</span><span class="fx-opp">${f.opp}</span><span class="fx-score">${f.gf}-${f.ga}</span><span class="fx-res" style="background:#00ff87">W</span></div>`;
}

function build() {
  const og = ogUrl();
  const att = XI.filter((p) => LINE[p.pos] === "att");
  const mid = XI.filter((p) => LINE[p.pos] === "mid");
  const def = XI.filter((p) => LINE[p.pos] === "def");
  const gk = XI.filter((p) => LINE[p.pos] === "gk");
  const fixtures = buildFixtures();
  const half = Math.ceil(fixtures.length / 2);
  const colA = fixtures.slice(0, half), colB = fixtures.slice(half);
  const title = "38-0-0 · INVINCIBLE · The all-time Liverpool XI | YourScore 38-0";
  const desc = "We built the greatest-ever Liverpool XI on YourScore 38-0 and finished the unbeaten season they were denied. 38-0. Invincible. Think you can build better?";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:image" content="${og}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${og}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root { --accent:${ACCENT}; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0f; color:#fff; font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:560px; margin:0 auto; padding:18px 16px 40px; }
  .glow { position:fixed; inset:0; z-index:0; background:radial-gradient(60% 40% at 50% 0%, var(--accent)22, transparent 70%); pointer-events:none; }
  .card { position:relative; z-index:1; }
  .top { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
  .brand { font-family:'Anton'; letter-spacing:1px; font-size:22px; }
  .brand span { color:var(--accent); }
  .pill { border:1.5px solid #2a2a3a; border-radius:999px; padding:5px 13px; font-weight:800; font-size:13px; color:#cfcfe6; }
  .tier { font-family:'Anton'; font-size:14px; letter-spacing:3px; color:var(--accent); text-align:center; }
  .record { font-family:'Anton'; font-size:74px; line-height:.95; text-align:center; margin-top:4px; }
  .wdl { text-align:center; font-size:11px; letter-spacing:3px; color:#8888aa; margin-top:2px; }
  .meta { text-align:center; margin-top:12px; font-size:15px; color:#cfcfe6; }
  .meta b { color:var(--accent); }
  .headline { text-align:center; font-family:'Anton'; font-size:21px; margin-top:14px; line-height:1.15; }
  .sub { text-align:center; color:#9a9ab5; font-size:13px; margin-top:6px; line-height:1.5; }
  .pitch { margin:20px 0; border-radius:18px; padding:22px 6px; background:
      repeating-linear-gradient(0deg,#12351f,#12351f 40px,#0f2c19 40px,#0f2c19 80px);
      border:1px solid #1d3a28; box-shadow:inset 0 0 60px #00000055; }
  .row { display:flex; justify-content:space-evenly; margin:12px 0; }
  .tok { width:84px; text-align:center; }
  .tok-pos { font-size:10px; font-weight:800; letter-spacing:1px; }
  .tok-circle { width:50px; height:50px; margin:2px auto 0; border-radius:50%; border:2.5px solid; background:#0c1a12cc; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px #00000066; }
  .tok-ovr { font-family:'Anton'; font-size:21px; }
  .tok-first { font-size:10px; color:#a9c6b5; margin-top:4px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tok-name { font-size:12px; font-weight:700; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tok-club { display:inline-block; margin-top:3px; font-size:9px; font-weight:800; color:#fff; padding:1px 6px; border-radius:4px; }
  .panel { background:#111119; border:1px solid #20202e; border-radius:16px; padding:16px; margin-bottom:14px; }
  .panel-h { font-family:'Anton'; font-size:13px; letter-spacing:2px; color:#8888aa; margin-bottom:12px; }
  .score { display:flex; align-items:center; justify-content:center; gap:16px; }
  .score .s { font-family:'Anton'; font-size:46px; }
  .score .res { font-size:11px; font-weight:800; letter-spacing:2px; padding:4px 10px; border-radius:999px; background:#00ff8722; color:#00ff87; }
  .teams { display:flex; justify-content:space-between; font-size:12px; color:#9a9ab5; margin-top:4px; }
  .scorers { margin-top:12px; font-size:13px; color:#cfcfe6; line-height:1.7; }
  .scorers .lab { color:#8888aa; font-size:11px; letter-spacing:1px; }
  .motm { display:flex; align-items:center; gap:10px; margin-top:12px; background:#0c0c14; border:1px solid #23233a; border-radius:12px; padding:10px 12px; }
  .motm .badge { font-size:10px; font-weight:800; letter-spacing:1px; color:#0a0a0f; background:var(--accent); padding:3px 7px; border-radius:6px; }
  .motm .rt { margin-left:auto; font-family:'Anton'; font-size:22px; color:var(--accent); }
  .motm .nm { font-weight:700; font-size:14px; }
  .motm .nt { font-size:11px; color:#8888aa; }
  .cards { margin-top:10px; font-size:13px; color:#cfcfe6; }
  .lead { display:flex; align-items:center; gap:8px; padding:9px 0; border-bottom:1px solid #1c1c28; }
  .lead:last-child { border-bottom:0; }
  .lead-label { font-size:11px; letter-spacing:1px; color:#8888aa; width:132px; flex-shrink:0; }
  .lead-name { font-weight:700; font-size:13px; flex:1; }
  .lead-val { font-family:'Anton'; font-size:15px; color:var(--accent); }
  .chip { display:inline-block; font-size:9px; font-weight:800; color:#fff; padding:1px 5px; border-radius:4px; vertical-align:middle; }
  .disc { text-align:center; font-size:12px; color:#8888aa; margin:4px 0 18px; }
  .fxgrid { display:grid; grid-template-columns:1fr 1fr; gap:0 16px; }
  .fx { display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid #181824; font-size:12px; }
  .fx-md { color:#56566e; width:18px; text-align:right; flex-shrink:0; font-variant-numeric:tabular-nums; }
  .fx-ha { color:#8888aa; font-weight:800; width:12px; flex-shrink:0; }
  .fx-opp { flex:1; color:#cfcfe6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .fx-score { font-weight:800; color:#fff; font-variant-numeric:tabular-nums; }
  .fx-res { width:16px; height:16px; border-radius:4px; color:#0a0a0f; font-size:10px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  @media (max-width:480px){ .fxgrid{ grid-template-columns:1fr; } }
  .cta { display:block; text-decoration:none; text-align:center; background:#00ff87; color:#062013; font-family:'Anton'; font-size:24px; letter-spacing:.5px; padding:18px; border-radius:18px; box-shadow:0 8px 28px #00ff8744; }
  .cta-sub { text-align:center; color:#9a9ab5; font-size:13px; margin-top:12px; }
  .made { text-align:center; color:#56566e; font-size:11px; margin-top:22px; line-height:1.6; }
  a.plain { color:#8888aa; }
</style>
</head>
<body>
<div class="glow"></div>
<div class="wrap card">

  <div class="top">
    <div class="brand">YOUR<span>SCORE</span></div>
    <div class="pill">38-0 · SEASON RESULT</div>
  </div>

  <div class="tier">★ INVINCIBLE ★</div>
  <div class="record">38-0-0</div>
  <div class="wdl">WON · DRAWN · LOST</div>
  <div class="meta">Champions · <b>${REC.pts}</b> pts · Squad strength <b>${REC.ovr}</b></div>
  <div class="headline">The all-time Liverpool XI<br>went unbeaten.</div>
  <div class="sub">2019-20 chased the Invincibles and fell at Watford.<br>So we finished the job. 38 games. 38 wins.</div>

  <div class="pitch">
    <div class="row">${att.map(token).join("")}</div>
    <div class="row">${mid.map(token).join("")}</div>
    <div class="row">${def.map(token).join("")}</div>
    <div class="row">${gk.map(token).join("")}</div>
  </div>

  <div class="panel">
    <div class="panel-h">${MATCH.label}</div>
    <div class="score"><span class="s">${MATCH.hg}</span><span class="res">WON</span><span class="s">${MATCH.ag}</span></div>
    <div class="teams"><span>${MATCH.home}</span><span>${MATCH.away}</span></div>
    <div class="scorers"><span class="lab">SCORERS</span><br>${MATCH.scorers.join(" · ")}</div>
    <div class="motm">
      <span class="badge">MOTM</span>
      <div><div class="nm">${MATCH.motm.name} <span class="chip" style="background:${LFC_RED}">${MATCH.motm.era}</span></div><div class="nt">${MATCH.motm.note}</div></div>
      <span class="rt">${MATCH.motm.rating}</span>
    </div>
    <div class="cards">Cards — ${MATCH.cards}</div>
  </div>

  <div class="panel">
    <div class="panel-h">SEASON LEADERS</div>
    ${leaderRow("⚽ TOP SCORER", LEADERS.scorer)}
    ${leaderRow("🅰 MOST ASSISTS", LEADERS.assists)}
    ${leaderRow("⭐ PLAYER OF SEASON", LEADERS.pots)}
    ${leaderRow("🧤 GOLDEN GLOVE", LEADERS.glove)}
  </div>
  <div class="disc">${DISCIPLINE}</div>

  <div class="panel">
    <div class="panel-h">PREMIER LEAGUE · 38-0 (every club, home &amp; away)</div>
    <div class="fxgrid"><div>${colA.map(fixtureRow).join("")}</div><div>${colB.map(fixtureRow).join("")}</div></div>
  </div>

  <a class="cta" href="${SITE}/38-0">BUILD YOUR OWN XI →</a>
  <div class="cta-sub">Draft an all-time XI from 20 years of Premier League players — then simulate your season.</div>

  <div class="made">An all-time Liverpool XI built in YourScore 38-0, spanning FIFA editions 2006/07–2025/26.<br>Ratings, fixtures &amp; results are a simulation. · <a class="plain" href="${SITE}">yourscore.app</a></div>

</div>
</body>
</html>`;
}

mkdirSync(OUT, { recursive: true });
const file = join(OUT, "liverpool.html");
writeFileSync(file, build());
console.log(`✓ liverpool.html  →  ${SITE}/clubs/liverpool.html`);
console.log("og:", ogUrl());
