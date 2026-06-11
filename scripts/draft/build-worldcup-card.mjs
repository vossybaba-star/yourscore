/**
 * build-worldcup-card.mjs — shareable "World Cup Run" result card for marketing.
 *
 * The all-time World Cup XI (real ratings, 11 different nations, drafted from the
 * 38-0 pool) wins WC2026 unbeaten: 8 games, 8 wins (3 group + R32 + R16 + QF + SF +
 * Final). Record 8-0-0. Messi, Ronaldo & Mbappé up top.
 *
 * Output → public/clubs/worldcup.html  (live at /clubs/worldcup.html)
 * Run: node scripts/draft/build-worldcup-card.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public", "clubs");
const SITE = "https://yourscore.app";
const ACCENT = "#ffd700"; // trophy gold

// Nation identity for the chips (flag + 3-letter code + chip colour).
const NAT = {
  ARG: { flag: "🇦🇷", color: "#75aadb", text: "#0a0a0f" },
  POR: { flag: "🇵🇹", color: "#c8102e", text: "#fff" },
  FRA: { flag: "🇫🇷", color: "#0055a4", text: "#fff" },
  BEL: { flag: "🇧🇪", color: "#d4af37", text: "#0a0a0f" },
  GER: { flag: "🇩🇪", color: "#5a5a5a", text: "#fff" },
  CRO: { flag: "🇭🇷", color: "#d32f2f", text: "#fff" },
  NED: { flag: "🇳🇱", color: "#ff7f00", text: "#0a0a0f" },
  ESP: { flag: "🇪🇸", color: "#c60b1e", text: "#fff" },
  BRA: { flag: "🇧🇷", color: "#009c3b", text: "#fff" },
  ENG: { flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", color: "#e8e8ee", text: "#0a0a0f" },
  SVN: { flag: "🇸🇮", color: "#4d7fc4", text: "#fff" },
};

const LINE = { GK: "gk", RB: "def", CB: "def", LB: "def", CDM: "mid", CM: "mid", CAM: "mid", RW: "att", LW: "att", ST: "att" };
const LINE_COLOR = { gk: "#ffb800", def: "#4fc3f7", mid: "#00ff87", att: "#ff4757" };
const surname = (n) => n.split(" ").slice(-1)[0];
const firstName = (n) => n.split(" ").slice(0, -1).join(" ") || "";

// All-time World Cup XI (4-3-3) — real ratings, 11 different nations.
const XI = [
  { pos: "RW", name: "Lionel Messi",        nat: "ARG", ovr: 94 },
  { pos: "ST", name: "Cristiano Ronaldo",   nat: "POR", ovr: 94 },
  { pos: "LW", name: "Kylian Mbappé",       nat: "FRA", ovr: 91 },
  { pos: "CM", name: "Kevin De Bruyne",     nat: "BEL", ovr: 91 },
  { pos: "CM", name: "Toni Kroos",          nat: "GER", ovr: 90 },
  { pos: "CM", name: "Luka Modrić",         nat: "CRO", ovr: 89 },
  { pos: "RB", name: "Trent Alexander-Arnold", nat: "ENG", ovr: 87 },
  { pos: "CB", name: "Virgil van Dijk",     nat: "NED", ovr: 90 },
  { pos: "CB", name: "Sergio Ramos",        nat: "ESP", ovr: 90 },
  { pos: "LB", name: "Marcelo",             nat: "BRA", ovr: 88 },
  { pos: "GK", name: "Jan Oblak",           nat: "SVN", ovr: 91 },
];
// Multi-word surname display fix.
const DISPLAY = {
  "Virgil van Dijk": { first: "Virgil", sur: "Van Dijk" },
  "Kevin De Bruyne": { first: "Kevin", sur: "De Bruyne" },
};
const disFirst = (n) => DISPLAY[n]?.first ?? firstName(n);
const disSur = (n) => DISPLAY[n]?.sur ?? surname(n);

const REC = { w: 8, d: 0, l: 0, pts: 24, pos: 1, ovr: 92 };

// The road to the trophy — 8 games, all wins (3 group + R32 + R16 + QF + SF + Final).
const ROAD = [
  { stage: "GROUP STAGE",   opp: "Mexico",      natCode: null, flag: "🇲🇽", score: "3-0" },
  { stage: "GROUP STAGE",   opp: "Japan",       flag: "🇯🇵", score: "2-0" },
  { stage: "GROUP STAGE",   opp: "USA",         flag: "🇺🇸", score: "4-1" },
  { stage: "ROUND OF 32",   opp: "Nigeria",     flag: "🇳🇬", score: "2-0" },
  { stage: "ROUND OF 16",   opp: "Uruguay",     flag: "🇺🇾", score: "3-1" },
  { stage: "QUARTER-FINAL", opp: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", score: "2-1" },
  { stage: "SEMI-FINAL",    opp: "Spain",       flag: "🇪🇸", score: "2-0" },
  { stage: "FINAL 🏆",      opp: "Brazil",      flag: "🇧🇷", score: "3-2" },
];

const MATCH = {
  label: "THE FINAL · WC2026",
  hg: 3, ag: 2, result: "WON",
  home: "World XI", away: "Brazil 🇧🇷",
  scorers: ["Mbappé 22', 70'", "Messi 55'"],
  motm: { name: "Lionel Messi", nat: "ARG", rating: 9.6, note: "drove the Final, lifted the trophy" },
  cards: "🟨 2   🟥 0",
};
const LEADERS = {
  scorer: { name: "Kylian Mbappé", nat: "FRA", v: "8 goals" },
  assists: { name: "Kevin De Bruyne", nat: "BEL", v: "6 assists" },
  pots: { name: "Lionel Messi", nat: "ARG", v: "Golden Ball" },
  glove: { name: "Jan Oblak", nat: "SVN", v: "5 clean sheets" },
};
const BOOT = "Mbappé~8";
const POTS = "Messi~3~5";

function ogUrl() {
  const xi = XI.map((p) => `${p.pos}~${disSur(p.name)}~${p.ovr}`).join("|");
  const q = new URLSearchParams({
    w: REC.w, d: REC.d, l: REC.l, pts: REC.pts, pos: REC.pos, ovr: REC.ovr,
    mode: "Normal", inv: "1", boot: BOOT, pots: POTS, xi, wide: "1",
  });
  return `${SITE}/api/draft/season-og?${q.toString()}`;
}

function natChip(code) {
  const n = NAT[code];
  return `<span class="chip" style="background:${n.color};color:${n.text}">${n.flag} ${code}</span>`;
}
function token(p) {
  const lc = LINE_COLOR[LINE[p.pos] || "att"];
  const n = NAT[p.nat];
  return `
    <div class="tok">
      <div class="tok-pos" style="color:${lc}">${p.pos}</div>
      <div class="tok-circle" style="border-color:${lc}"><span class="tok-ovr">${p.ovr}</span></div>
      <div class="tok-first">${disFirst(p.name)}</div>
      <div class="tok-name">${disSur(p.name)}</div>
      <div class="tok-club" style="background:${n.color};color:${n.text}">${n.flag} ${p.nat}</div>
    </div>`;
}
function leaderRow(label, l) {
  return `<div class="lead"><div class="lead-label">${label}</div><div class="lead-name">${l.name} ${natChip(l.nat)}</div><div class="lead-val">${l.v}</div></div>`;
}
function roadRow(r) {
  return `<div class="rd">
    <span class="rd-stage">${r.stage}</span>
    <span class="rd-opp">${r.flag} ${r.opp}</span>
    <span class="rd-score">${r.score}</span>
    <span class="rd-res">W</span>
  </div>`;
}

function build() {
  const og = ogUrl();
  const att = XI.filter((p) => LINE[p.pos] === "att");
  const mid = XI.filter((p) => LINE[p.pos] === "mid");
  const def = XI.filter((p) => LINE[p.pos] === "def");
  const gk = XI.filter((p) => LINE[p.pos] === "gk");
  const title = "8-0-0 · WORLD CHAMPIONS · The all-time World Cup XI | YourScore 38-0";
  const desc = "We built the all-time World Cup XI in YourScore — Messi, Ronaldo & Mbappé, 11 nations — and won WC2026 unbeaten. 8 games, 8 wins. Think you can build better?";

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
  .tok-club { display:inline-block; margin-top:3px; font-size:9px; font-weight:800; padding:1px 5px; border-radius:4px; }
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
  .lead-label { font-size:11px; letter-spacing:1px; color:#8888aa; width:152px; flex-shrink:0; }
  .lead-name { font-weight:700; font-size:13px; flex:1; }
  .lead-val { font-family:'Anton'; font-size:14px; color:var(--accent); }
  .chip { display:inline-block; font-size:9px; font-weight:800; padding:1px 5px; border-radius:4px; vertical-align:middle; }
  .disc { text-align:center; font-size:12px; color:#8888aa; margin:4px 0 18px; }
  /* road to the trophy */
  .rd { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #181824; }
  .rd:last-child { border-bottom:0; }
  .rd-stage { font-size:10px; letter-spacing:1px; color:#8888aa; width:108px; flex-shrink:0; font-weight:700; }
  .rd-opp { flex:1; font-size:14px; font-weight:700; color:#fff; }
  .rd-score { font-family:'Anton'; font-size:17px; color:#fff; }
  .rd-res { width:18px; height:18px; border-radius:5px; background:#00ff87; color:#0a0a0f; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; }
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
    <div class="pill">38-0 · WORLD CUP RUN</div>
  </div>

  <div class="tier">★ WORLD CHAMPIONS ★</div>
  <div class="record">8-0-0</div>
  <div class="wdl">WON · DRAWN · LOST</div>
  <div class="meta">Won WC2026 · 8 games, 8 wins · Squad strength <b>${REC.ovr}</b></div>
  <div class="headline">The all-time World Cup XI<br>won it all. 🏆</div>
  <div class="sub">11 nations. One unbeatable team.<br>Messi, Ronaldo &amp; Mbappé up top.</div>

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
      <div><div class="nm">${MATCH.motm.name} ${natChip(MATCH.motm.nat)}</div><div class="nt">${MATCH.motm.note}</div></div>
      <span class="rt">${MATCH.motm.rating}</span>
    </div>
    <div class="cards">Cards — ${MATCH.cards}</div>
  </div>

  <div class="panel">
    <div class="panel-h">SEASON LEADERS</div>
    ${leaderRow("🥇 GOLDEN BOOT", LEADERS.scorer)}
    ${leaderRow("🅰 MOST ASSISTS", LEADERS.assists)}
    ${leaderRow("🏆 PLAYER OF TOURNAMENT", LEADERS.pots)}
    ${leaderRow("🧤 GOLDEN GLOVE", LEADERS.glove)}
  </div>
  <div class="disc">${DISCIPLINE_LINE}</div>

  <div class="panel">
    <div class="panel-h">ROAD TO THE TROPHY · 8-0</div>
    ${ROAD.map(roadRow).join("")}
  </div>

  <a class="cta" href="${SITE}/38-0/wc">START YOUR WORLD CUP RUN →</a>
  <div class="cta-sub">World Cup Run is live in 38-0 — draft your XI, pick your nation, chase the trophy.</div>

  <div class="made">An all-time World Cup XI built in YourScore 38-0's World Cup Run.<br>Ratings &amp; results are a simulation. · <a class="plain" href="${SITE}">yourscore.app</a></div>

</div>
</body>
</html>`;
}

const DISCIPLINE_LINE = "Discipline: 11🟨 · 0🟥 · only 4 goals conceded across the tournament";

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "worldcup.html"), build());
console.log(`✓ worldcup.html  →  ${SITE}/clubs/worldcup.html`);
console.log("og:", ogUrl());
