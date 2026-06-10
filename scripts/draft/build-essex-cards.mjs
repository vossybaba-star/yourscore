/**
 * build-essex-cards.mjs — generates 3 shareable 38-0 "season result" landing pages
 * for the Essex Senior League outreach (Stansted / Saffron Walden / Woodford Town).
 * Players are MIXED across the three clubs, exactly like a real 38-0 draft pool.
 *
 * Output → public/essex/{relegated,mid-table,champions}.html
 * Served at /essex/<slug>.html. Each page:
 *   - renders the full scorecard (XI + first names + ratings + match stats),
 *   - lists a full 38-game ESL fixture list (home & away vs all 20 clubs),
 *   - sets og:image to the REAL /api/draft/season-og endpoint so links unfurl,
 *   - CTAs straight to /38-0 so a viewer goes from tweet → page → playing.
 *
 * Run: node scripts/draft/build-essex-cards.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public", "essex");
const SITE = "https://yourscore.app";

// ── Club identity (chip colour + short code) ─────────────────────────────────
const CLUB = {
  STD: { name: "Stansted FC",        code: "STD", color: "#e63946" },
  SWT: { name: "Saffron Walden Town", code: "SWT", color: "#e8b400" },
  WFD: { name: "Woodford Town",      code: "WFD", color: "#4361ee" },
};

// Every club in the 2025-26 Essex Senior League Premier Division (20 clubs →
// a 38-game home-and-away season). Source: Wikipedia, 2025-26 ESL.
const ESL_CLUBS = [
  "Athletic Newham", "Barking", "Basildon United", "Benfleet", "Buckhurst Hill",
  "Frenford", "Great Wakering Rovers", "Hackney Wick", "Halstead Town",
  "Harwich & Parkeston", "Hullbridge Sports", "Ilford", "Little Oakley", "Romford",
  "Saffron Walden Town", "Soul Tower Hamlets", "Sporting Bengal United",
  "West Essex", "White Ensign", "Woodford Town",
];

// Position → line (drives the pitch colour, same mapping the app uses).
const LINE = { GK: "gk", RB: "def", CB: "def", LB: "def", RWB: "def", LWB: "def", CDM: "mid", CM: "mid", CAM: "mid", RW: "att", LW: "att", ST: "att" };
const LINE_COLOR = { gk: "#ffb800", def: "#4fc3f7", mid: "#00ff87", att: "#ff4757" };

const surname = (n) => n.split(" ").slice(-1)[0];
const firstName = (n) => n.split(" ").slice(0, -1).join(" ");

// ── Scoreline pools (deterministic, index-cycled — no Math.random) ───────────
const WIN_SCORES = ["2-0", "3-1", "1-0", "2-1", "4-0", "3-0", "2-0", "5-1", "1-0", "3-2", "4-1", "2-0"];
const DRAW_SCORES = ["1-1", "2-2", "0-0", "1-1", "2-2", "3-3"];
const LOSS_SCORES = ["0-1", "1-2", "0-2", "1-3", "0-1", "2-3", "0-3", "1-2"];

/**
 * Build a 38-fixture season vs all 20 ESL clubs: 20 home games + 18 away games
 * (so every club appears, total = 38). Results are spread to match the record.
 */
function buildFixtures(w, d, l) {
  const fx = [];
  ESL_CLUBS.forEach((c) => fx.push({ opp: c, ha: "H" }));
  ESL_CLUBS.slice(0, 18).forEach((c) => fx.push({ opp: c, ha: "A" }));

  // Spread W/D/L across the 38 slots so the run reads naturally (not all losses
  // bunched at the end). Distribute draws then losses at evenly-spaced indices.
  const N = fx.length; // 38
  const results = Array(N).fill("W");
  const placed = new Set();
  const spread = (count, mark) => {
    for (let i = 0; i < count; i++) {
      let idx = Math.round(((i + 0.5) * N) / count) % N;
      while (placed.has(idx)) idx = (idx + 1) % N;
      placed.add(idx);
      results[idx] = mark;
    }
  };
  spread(l, "L");
  spread(d, "D");

  let wc = 0, dc = 0, lc = 0;
  return fx.map((f, i) => {
    const res = results[i];
    let score;
    if (res === "W") score = WIN_SCORES[wc++ % WIN_SCORES.length];
    else if (res === "D") score = DRAW_SCORES[dc++ % DRAW_SCORES.length];
    else score = LOSS_SCORES[lc++ % LOSS_SCORES.length];
    // Scorelines are written our-goals-first, so gf/ga map directly.
    const [gf, ga] = score.split("-");
    return { ...f, res, gf, ga, md: i + 1 };
  });
}

// ── The three scorecards ─────────────────────────────────────────────────────
const CARDS = [
  {
    slug: "relegated", tier: "RELEGATED", accent: "#ff4757",
    headline: "A season to forget", sub: "The wheels came off. One to learn from.",
    w: 5, d: 7, l: 26, pts: 22, pos: 22, ovr: 71,
    xi: [
      { pos: "RW", name: "Joshua Darby",        club: "STD", ovr: 73 },
      { pos: "ST", name: "Charlie Noakes",      club: "SWT", ovr: 72 },
      { pos: "LW", name: "Marcus Painter",      club: "WFD", ovr: 71 },
      { pos: "CM", name: "Jacob Noble",         club: "STD", ovr: 72 },
      { pos: "CM", name: "Tashan Richmond",     club: "WFD", ovr: 70 },
      { pos: "CM", name: "Lee Hursit",          club: "SWT", ovr: 71 },
      { pos: "RB", name: "Miles Mitchel-Nelson",club: "WFD", ovr: 69 },
      { pos: "CB", name: "Charlie Adams",       club: "STD", ovr: 74 },
      { pos: "CB", name: "Eli Benoit",          club: "WFD", ovr: 68 },
      { pos: "LB", name: "David Limber",        club: "STD", ovr: 67 },
      { pos: "GK", name: "Tom Middlehurst",     club: "SWT", ovr: 70 },
    ],
    match: {
      label: "MATCHDAY 31 · RELEGATION SIX-POINTER",
      hg: 1, ag: 4, result: "LOST",
      home: "Our XI", away: "Top of the table",
      scorers: ["Noakes 38' (pen)"],
      motm: { name: "Tom Middlehurst", club: "SWT", rating: 7.2, note: "9 saves on a long night" },
      cards: "🟨 4   🟥 1 (Benoit, 64')",
    },
    leaders: {
      scorer: { name: "Charlie Noakes", club: "SWT", v: "9 goals" },
      assists: { name: "Joshua Darby", club: "STD", v: "5 assists" },
      pots: { name: "Jacob Noble", club: "STD", v: "6.8 avg" },
      glove: { name: "Tom Middlehurst", club: "SWT", v: "3 clean sheets" },
    },
    discipline: "Discipline: 71🟨 · 6🟥 · 58 goals conceded",
    boot: "C. Noakes~9", potsParam: "J. Noble~3~5",
  },
  {
    slug: "mid-table", tier: "MID-TABLE", accent: "#ffb800",
    headline: "A solid mid-table finish", sub: "Respectable. Flirted with the play-offs.",
    w: 17, d: 11, l: 10, pts: 62, pos: 8, ovr: 80,
    xi: [
      { pos: "RW", name: "Finley Gregory",  club: "STD", ovr: 82 },
      { pos: "ST", name: "Rio Glean",       club: "WFD", ovr: 83 },
      { pos: "LW", name: "Tom Head",        club: "SWT", ovr: 80 },
      { pos: "CM", name: "George Pullen",   club: "STD", ovr: 83 },
      { pos: "CM", name: "Sam Owusu",       club: "WFD", ovr: 80 },
      { pos: "CAM", name: "Jamie Hursit",   club: "SWT", ovr: 81 },
      { pos: "RB", name: "Emmanuel Okunja", club: "SWT", ovr: 78 },
      { pos: "CB", name: "John Clarke",     club: "STD", ovr: 81 },
      { pos: "CB", name: "Dion Johnson",    club: "WFD", ovr: 80 },
      { pos: "LB", name: "Sam Deering",     club: "SWT", ovr: 82 },
      { pos: "GK", name: "Manny Agboola",   club: "WFD", ovr: 80 },
    ],
    match: {
      label: "MATCHDAY 19 · vs THE LEAGUE LEADERS",
      hg: 3, ag: 2, result: "WON",
      home: "Our XI", away: "League leaders",
      scorers: ["Glean 12', 67'", "Gregory 81'"],
      motm: { name: "Rio Glean", club: "WFD", rating: 9.1, note: "two goals, ran the line ragged" },
      cards: "🟨 1   🟥 0",
    },
    leaders: {
      scorer: { name: "Rio Glean", club: "WFD", v: "21 goals" },
      assists: { name: "Jamie Hursit", club: "SWT", v: "12 assists" },
      pots: { name: "George Pullen", club: "STD", v: "7.8 avg" },
      glove: { name: "Manny Agboola", club: "WFD", v: "13 clean sheets" },
    },
    discipline: "Discipline: 41🟨 · 2🟥 · 39 goals conceded",
    boot: "R. Glean~21", potsParam: "J. Hursit~6~12",
  },
  {
    slug: "champions", tier: "CHAMPIONS", accent: "#00ff87",
    headline: "37-1-0. Champions.", sub: "One draw away from Invincible. Almost perfect.",
    w: 37, d: 1, l: 0, pts: 112, pos: 1, ovr: 90,
    xi: [
      { pos: "RW", name: "Micah Jackson",   club: "WFD", ovr: 90 },
      { pos: "ST", name: "Roman Campbell",  club: "SWT", ovr: 92 },
      { pos: "LW", name: "George O'Connor", club: "STD", ovr: 89 },
      { pos: "CM", name: "Ricky Modeste",   club: "SWT", ovr: 90 },
      { pos: "CM", name: "James Jewers",    club: "WFD", ovr: 89 },
      { pos: "CAM", name: "George Pullen",  club: "STD", ovr: 88 },
      { pos: "RB", name: "Tom Millett",     club: "STD", ovr: 86 },
      { pos: "CB", name: "Junior Luke",     club: "SWT", ovr: 89 },
      { pos: "CB", name: "Enock Soganile",  club: "WFD", ovr: 87 },
      { pos: "LB", name: "Connor Tyrell",   club: "WFD", ovr: 86 },
      { pos: "GK", name: "Jake Anderson",   club: "SWT", ovr: 87 },
    ],
    match: {
      label: "MATCHDAY 38 · TITLE SEALED",
      hg: 5, ag: 0, result: "WON",
      home: "Our XI", away: "Mid-table side",
      scorers: ["Campbell 8', 24', 55' (hat-trick)", "Jackson 40'", "O'Connor 72'"],
      motm: { name: "Roman Campbell", club: "SWT", rating: 9.6, note: "hat-trick to clinch the title" },
      cards: "🟨 0   🟥 0",
    },
    leaders: {
      scorer: { name: "Roman Campbell", club: "SWT", v: "41 goals" },
      assists: { name: "Micah Jackson", club: "WFD", v: "19 assists" },
      pots: { name: "Ricky Modeste", club: "SWT", v: "8.6 avg" },
      glove: { name: "Jake Anderson", club: "SWT", v: "27 clean sheets" },
    },
    discipline: "Discipline: 19🟨 · 0🟥 · 11 goals conceded",
    boot: "R. Campbell~41", potsParam: "R. Modeste~6~19",
  },
];

// ── og:image via the real season-og endpoint (so X unfurls the broadcast card) ─
function ogUrl(c) {
  const xi = c.xi.map((p) => `${p.pos}~${surname(p.name)}~${p.ovr}`).join("|");
  const q = new URLSearchParams({
    w: c.w, d: c.d, l: c.l, pts: c.pts, pos: c.pos, ovr: c.ovr,
    mode: "Normal", boot: c.boot, pots: c.potsParam, xi, wide: "1",
  });
  return `${SITE}/api/draft/season-og?${q.toString()}`;
}

// ── Render one player token on the pitch (now with first name) ───────────────
function token(p) {
  const line = LINE[p.pos] || "att";
  const lc = LINE_COLOR[line];
  const club = CLUB[p.club];
  return `
    <div class="tok">
      <div class="tok-pos" style="color:${lc}">${p.pos}</div>
      <div class="tok-circle" style="border-color:${lc}"><span class="tok-ovr">${p.ovr}</span></div>
      <div class="tok-first">${firstName(p.name)}</div>
      <div class="tok-name">${surname(p.name)}</div>
      <div class="tok-club" style="background:${club.color}">${club.code}</div>
    </div>`;
}

const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

function leaderRow(label, l) {
  return `<div class="lead"><div class="lead-label">${label}</div><div class="lead-name">${l.name} <span class="chip" style="background:${CLUB[l.club].color}">${CLUB[l.club].code}</span></div><div class="lead-val">${l.v}</div></div>`;
}

const RES_COLOR = { W: "#00ff87", D: "#ffb800", L: "#ff4757" };
function fixtureRow(f) {
  return `<div class="fx">
    <span class="fx-md">${f.md}</span>
    <span class="fx-ha">${f.ha}</span>
    <span class="fx-opp">${f.opp}</span>
    <span class="fx-score">${f.gf}-${f.ga}</span>
    <span class="fx-res" style="background:${RES_COLOR[f.res]}">${f.res}</span>
  </div>`;
}

function page(c) {
  const og = ogUrl(c);
  const att = c.xi.filter((p) => LINE[p.pos] === "att");
  const mid = c.xi.filter((p) => LINE[p.pos] === "mid");
  const def = c.xi.filter((p) => LINE[p.pos] === "def");
  const m = c.match;
  const fixtures = buildFixtures(c.w, c.d, c.l);
  const half = Math.ceil(fixtures.length / 2);
  const colA = fixtures.slice(0, half), colB = fixtures.slice(half);
  const title = `${c.w}-${c.d}-${c.l} · ${c.tier} · YourScore 38-0`;
  const desc = "Built from Stansted, Saffron Walden & Woodford Town players in YourScore 38-0. Think you can build better? Draft your XI and simulate your season.";

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
  :root { --accent:${c.accent}; }
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
  .record { font-family:'Anton'; font-size:78px; line-height:.95; text-align:center; margin-top:4px; }
  .wdl { text-align:center; font-size:11px; letter-spacing:3px; color:#8888aa; margin-top:2px; }
  .meta { text-align:center; margin-top:12px; font-size:15px; color:#cfcfe6; }
  .meta b { color:var(--accent); }
  .headline { text-align:center; font-family:'Anton'; font-size:22px; margin-top:14px; }
  .sub { text-align:center; color:#9a9ab5; font-size:13px; margin-top:2px; }
  .pitch { margin:20px 0; border-radius:18px; padding:22px 6px; background:
      repeating-linear-gradient(0deg,#12351f,#12351f 40px,#0f2c19 40px,#0f2c19 80px);
      border:1px solid #1d3a28; box-shadow:inset 0 0 60px #00000055; }
  .row { display:flex; justify-content:space-evenly; margin:12px 0; }
  .tok { width:80px; text-align:center; }
  .tok-pos { font-size:10px; font-weight:800; letter-spacing:1px; }
  .tok-circle { width:50px; height:50px; margin:2px auto 0; border-radius:50%; border:2.5px solid; background:#0c1a12cc;
      display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px #00000066; }
  .tok-ovr { font-family:'Anton'; font-size:21px; }
  .tok-first { font-size:10px; color:#a9c6b5; margin-top:4px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tok-name { font-size:12px; font-weight:700; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tok-club { display:inline-block; margin-top:3px; font-size:9px; font-weight:800; color:#0a0a0f; padding:1px 6px; border-radius:4px; }
  .panel { background:#111119; border:1px solid #20202e; border-radius:16px; padding:16px; margin-bottom:14px; }
  .panel-h { font-family:'Anton'; font-size:13px; letter-spacing:2px; color:#8888aa; margin-bottom:12px; }
  .score { display:flex; align-items:center; justify-content:center; gap:16px; }
  .score .s { font-family:'Anton'; font-size:46px; }
  .score .res { font-size:11px; font-weight:800; letter-spacing:2px; padding:4px 10px; border-radius:999px; }
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
  .lead-label { font-size:11px; letter-spacing:1px; color:#8888aa; width:128px; flex-shrink:0; }
  .lead-name { font-weight:700; font-size:13px; flex:1; }
  .lead-val { font-family:'Anton'; font-size:15px; color:var(--accent); }
  .chip { display:inline-block; font-size:9px; font-weight:800; color:#0a0a0f; padding:1px 5px; border-radius:4px; vertical-align:middle; }
  .disc { text-align:center; font-size:12px; color:#8888aa; margin:4px 0 18px; }
  /* fixtures */
  .fxgrid { display:grid; grid-template-columns:1fr 1fr; gap:0 16px; }
  .fx { display:flex; align-items:center; gap:6px; padding:5px 0; border-bottom:1px solid #181824; font-size:12px; }
  .fx-md { color:#56566e; width:18px; text-align:right; flex-shrink:0; font-variant-numeric:tabular-nums; }
  .fx-ha { color:#8888aa; font-weight:800; width:12px; flex-shrink:0; }
  .fx-opp { flex:1; color:#cfcfe6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .fx-score { font-weight:800; color:#fff; font-variant-numeric:tabular-nums; }
  .fx-res { width:16px; height:16px; border-radius:4px; color:#0a0a0f; font-size:10px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  @media (max-width:480px){ .fxgrid{ grid-template-columns:1fr; } }
  .cta { display:block; text-decoration:none; text-align:center; background:#00ff87; color:#062013;
      font-family:'Anton'; font-size:24px; letter-spacing:.5px; padding:18px; border-radius:18px; box-shadow:0 8px 28px #00ff8744; }
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

  <div class="tier">${c.tier}</div>
  <div class="record">${c.w}-${c.d}-${c.l}</div>
  <div class="wdl">WON · DRAWN · LOST</div>
  <div class="meta">Finished <b>${ordinal(c.pos)}</b> · <b>${c.pts}</b> pts · Squad strength <b>${c.ovr}</b></div>
  <div class="headline">${c.headline}</div>
  <div class="sub">${c.sub}</div>

  <div class="pitch">
    <div class="row">${att.map(token).join("")}</div>
    <div class="row">${mid.map(token).join("")}</div>
    <div class="row">${def.map(token).join("")}</div>
    <div class="row">${c.xi.filter((p) => LINE[p.pos] === "gk").map(token).join("")}</div>
  </div>

  <div class="panel">
    <div class="panel-h">${m.label}</div>
    <div class="score">
      <span class="s">${m.hg}</span>
      <span class="res" style="background:${m.result === "WON" ? "#00ff8722" : m.result === "LOST" ? "#ff475722" : "#ffb80022"};color:${m.result === "WON" ? "#00ff87" : m.result === "LOST" ? "#ff4757" : "#ffb800"}">${m.result}</span>
      <span class="s">${m.ag}</span>
    </div>
    <div class="teams"><span>${m.home}</span><span>${m.away}</span></div>
    <div class="scorers"><span class="lab">SCORERS</span><br>${m.scorers.join(" · ")}</div>
    <div class="motm">
      <span class="badge">MOTM</span>
      <div><div class="nm">${m.motm.name} <span class="chip" style="background:${CLUB[m.motm.club].color}">${CLUB[m.motm.club].code}</span></div><div class="nt">${m.motm.note}</div></div>
      <span class="rt">${m.motm.rating}</span>
    </div>
    <div class="cards">Cards — ${m.cards}</div>
  </div>

  <div class="panel">
    <div class="panel-h">SEASON LEADERS</div>
    ${leaderRow("⚽ TOP SCORER", c.leaders.scorer)}
    ${leaderRow("🅰 MOST ASSISTS", c.leaders.assists)}
    ${leaderRow("⭐ PLAYER OF SEASON", c.leaders.pots)}
    ${leaderRow("🧤 GOLDEN GLOVE", c.leaders.glove)}
  </div>
  <div class="disc">${c.discipline}</div>

  <div class="panel">
    <div class="panel-h">ESL SEASON · 38 FIXTURES (vs all 20 clubs)</div>
    <div class="fxgrid">
      <div>${colA.map(fixtureRow).join("")}</div>
      <div>${colB.map(fixtureRow).join("")}</div>
    </div>
  </div>

  <a class="cta" href="${SITE}/38-0">BUILD YOUR OWN XI →</a>
  <div class="cta-sub">Pick from Stansted, Saffron Walden, Woodford &amp; more — then simulate your season.</div>

  <div class="made">XI drafted from real Stansted FC, Saffron Walden Town &amp; Woodford Town players.<br>Ratings, fixtures &amp; results are a YourScore 38-0 simulation. · <a class="plain" href="${SITE}">yourscore.app</a></div>

</div>
</body>
</html>`;
}

mkdirSync(OUT, { recursive: true });
for (const c of CARDS) {
  const file = join(OUT, `${c.slug}.html`);
  writeFileSync(file, page(c));
  console.log(`✓ ${c.slug}.html  →  ${SITE}/essex/${c.slug}.html`);
}
console.log("\nDone. 3 cards written to public/essex/");
