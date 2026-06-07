#!/usr/bin/env node
/**
 * Draft XI — dataset builder.
 *
 * Normalises the curated backbone (iconic Premier League team-seasons, real
 * players, hand-tuned overalls) into the shipped pool at
 * src/data/draft/player-seasons.json. Each spin deals one (club, season) bucket,
 * so curating whole legendary squads means every spin is an authentic,
 * recognisable team to draft from.
 *
 * Hybrid-ready: if a SoFIFA-derived CSV exists at scripts/draft/data/players.csv
 * (columns: name,club,season,position,overall) it is merged in for breadth.
 * Curated overalls win on conflict. Run: `node scripts/draft/build-dataset.mjs`.
 *
 * Canonical positions: GK RB CB LB RWB LWB CDM CM CAM RW LW ST
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const OUT = join(ROOT, "src", "data", "draft", "player-seasons.json");
const CSV = join(__dirname, "data", "players.csv");

// ── Curated backbone: iconic PL team-seasons ────────────────────────────────
// [name, position, overall] per player. Overalls hand-tuned so marquee names feel
// right; legends 88-94, stars 84-89, solid pros 78-84.
const TEAM_SEASONS = [
  { club: "Arsenal", season: "2003/04", players: [
    ["Jens Lehmann","GK",85],["Lauren","RB",82],["Sol Campbell","CB",87],["Kolo Touré","CB",84],
    ["Ashley Cole","LB",85],["Patrick Vieira","CM",90],["Gilberto Silva","CDM",84],
    ["Robert Pirès","LW",88],["Freddie Ljungberg","RW",85],["Dennis Bergkamp","CAM",90],["Thierry Henry","ST",94],
  ]},
  { club: "Manchester United", season: "1998/99", players: [
    ["Peter Schmeichel","GK",90],["Gary Neville","RB",83],["Jaap Stam","CB",88],["Ronny Johnsen","CB",80],
    ["Denis Irwin","LB",83],["David Beckham","RW",89],["Roy Keane","CM",90],["Paul Scholes","CM",88],
    ["Ryan Giggs","LW",89],["Andy Cole","ST",85],["Dwight Yorke","ST",86],
  ]},
  { club: "Manchester United", season: "2007/08", players: [
    ["Edwin van der Sar","GK",87],["Wes Brown","RB",80],["Rio Ferdinand","CB",89],["Nemanja Vidić","CB",88],
    ["Patrice Evra","LB",85],["Cristiano Ronaldo","RW",93],["Michael Carrick","CM",84],["Paul Scholes","CM",86],
    ["Ji-sung Park","LW",81],["Wayne Rooney","ST",89],["Carlos Tevez","ST",87],
  ]},
  { club: "Liverpool", season: "2019/20", players: [
    ["Alisson","GK",90],["Trent Alexander-Arnold","RB",87],["Virgil van Dijk","CB",91],["Joe Gomez","CB",81],
    ["Andrew Robertson","LB",87],["Fabinho","CDM",85],["Jordan Henderson","CM",84],["Georginio Wijnaldum","CM",83],
    ["Mohamed Salah","RW",90],["Sadio Mané","LW",89],["Roberto Firmino","ST",86],
  ]},
  { club: "Manchester City", season: "2022/23", players: [
    ["Ederson","GK",89],["Kyle Walker","RB",84],["Rúben Dias","CB",88],["John Stones","CB",84],
    ["Nathan Aké","LB",82],["Rodri","CDM",89],["Kevin De Bruyne","CAM",91],["İlkay Gündoğan","CM",85],
    ["Bernardo Silva","RW",87],["Jack Grealish","LW",84],["Erling Haaland","ST",91],
  ]},
  { club: "Manchester City", season: "2017/18", players: [
    ["Ederson","GK",86],["Kyle Walker","RB",84],["Vincent Kompany","CB",85],["Nicolás Otamendi","CB",83],
    ["Fernandinho","CDM",85],["Kevin De Bruyne","CM",90],["David Silva","CAM",88],
    ["Raheem Sterling","RW",85],["Leroy Sané","LW",84],["Sergio Agüero","ST",89],["Gabriel Jesus","ST",83],
  ]},
  { club: "Chelsea", season: "2004/05", players: [
    ["Petr Čech","GK",88],["Paulo Ferreira","RB",80],["John Terry","CB",88],["Ricardo Carvalho","CB",86],
    ["William Gallas","LB",84],["Claude Makélélé","CDM",86],["Frank Lampard","CM",89],
    ["Arjen Robben","RW",86],["Damien Duff","LW",84],["Didier Drogba","ST",87],["Eiður Guðjohnsen","ST",81],
  ]},
  { club: "Chelsea", season: "2009/10", players: [
    ["Petr Čech","GK",87],["Branislav Ivanović","RB",83],["John Terry","CB",87],["Ricardo Carvalho","CB",84],
    ["Ashley Cole","LB",86],["John Obi Mikel","CDM",80],["Frank Lampard","CM",88],["Michael Ballack","CM",84],
    ["Florent Malouda","LW",83],["Nicolas Anelka","ST",84],["Didier Drogba","ST",88],
  ]},
  { club: "Leicester City", season: "2015/16", players: [
    ["Kasper Schmeichel","GK",82],["Danny Simpson","RB",75],["Wes Morgan","CB",78],["Robert Huth","CB",78],
    ["Christian Fuchs","LB",77],["N'Golo Kanté","CDM",85],["Danny Drinkwater","CM",78],
    ["Riyad Mahrez","RW",85],["Marc Albrighton","LW",75],["Jamie Vardy","ST",84],["Shinji Okazaki","ST",77],
  ]},
  { club: "Tottenham Hotspur", season: "2016/17", players: [
    ["Hugo Lloris","GK",85],["Kyle Walker","RB",83],["Toby Alderweireld","CB",86],["Jan Vertonghen","CB",85],
    ["Danny Rose","LB",81],["Victor Wanyama","CDM",81],["Mousa Dembélé","CM",83],["Christian Eriksen","CAM",86],
    ["Dele Alli","CAM",84],["Son Heung-min","LW",84],["Harry Kane","ST",88],
  ]},
  { club: "Blackburn Rovers", season: "1994/95", players: [
    ["Tim Flowers","GK",82],["Henning Berg","CB",80],["Colin Hendry","CB",81],["Graeme Le Saux","LB",81],
    ["Tim Sherwood","CM",80],["Stuart Ripley","RW",77],["Jason Wilcox","LW",76],
    ["Chris Sutton","ST",84],["Alan Shearer","ST",90],
  ]},
  { club: "Newcastle United", season: "1995/96", players: [
    ["Pavel Srníček","GK",78],["Warren Barton","RB",77],["Philippe Albert","CB",81],["John Beresford","LB",76],
    ["Rob Lee","CM",80],["David Batty","CDM",80],["David Ginola","LW",86],["Peter Beardsley","CAM",84],
    ["Les Ferdinand","ST",86],["Faustino Asprilla","ST",84],
  ]},
  { club: "Manchester United", season: "1993/94", players: [
    ["Peter Schmeichel","GK",88],["Paul Parker","RB",79],["Steve Bruce","CB",82],["Gary Pallister","CB",83],
    ["Denis Irwin","LB",82],["Andrei Kanchelskis","RW",83],["Paul Ince","CM",84],["Roy Keane","CM",86],
    ["Ryan Giggs","LW",85],["Eric Cantona","CAM",90],["Mark Hughes","ST",84],
  ]},
  { club: "Arsenal", season: "1997/98", players: [
    ["David Seaman","GK",86],["Lee Dixon","RB",80],["Tony Adams","CB",87],["Martin Keown","CB",83],
    ["Nigel Winterburn","LB",80],["Ray Parlour","RW",80],["Patrick Vieira","CM",86],["Emmanuel Petit","CDM",84],
    ["Marc Overmars","LW",86],["Dennis Bergkamp","CAM",89],["Nicolas Anelka","ST",82],
  ]},
  { club: "Liverpool", season: "2013/14", players: [
    ["Simon Mignolet","GK",80],["Glen Johnson","RB",80],["Martin Škrtel","CB",81],["Daniel Agger","CB",81],
    ["Jon Flanagan","LB",73],["Steven Gerrard","CDM",87],["Jordan Henderson","CM",81],["Philippe Coutinho","CAM",84],
    ["Raheem Sterling","RW",80],["Luis Suárez","ST",89],["Daniel Sturridge","ST",84],
  ]},
  { club: "Chelsea", season: "2016/17", players: [
    ["Thibaut Courtois","GK",88],["César Azpilicueta","CB",85],["David Luiz","CB",83],["Gary Cahill","CB",82],
    ["Victor Moses","RWB",80],["Marcos Alonso","LWB",81],["N'Golo Kanté","CDM",87],["Nemanja Matić","CM",83],
    ["Pedro","RW",83],["Eden Hazard","LW",89],["Diego Costa","ST",86],
  ]},
  { club: "Manchester City", season: "2011/12", players: [
    ["Joe Hart","GK",85],["Micah Richards","RB",80],["Vincent Kompany","CB",86],["Joleon Lescott","CB",81],
    ["Gaël Clichy","LB",81],["Yaya Touré","CM",87],["Gareth Barry","CDM",81],["David Silva","CAM",87],
    ["Samir Nasri","RW",83],["Carlos Tevez","ST",86],["Sergio Agüero","ST",88],
  ]},
  { club: "Arsenal", season: "2022/23", players: [
    ["Aaron Ramsdale","GK",83],["Ben White","RB",82],["William Saliba","CB",84],["Gabriel Magalhães","CB",84],
    ["Oleksandr Zinchenko","LB",82],["Thomas Partey","CDM",84],["Martin Ødegaard","CAM",87],["Granit Xhaka","CM",83],
    ["Bukayo Saka","RW",86],["Gabriel Martinelli","LW",84],["Gabriel Jesus","ST",84],
  ]},
  { club: "Liverpool", season: "2008/09", players: [
    ["Pepe Reina","GK",85],["Álvaro Arbeloa","RB",80],["Jamie Carragher","CB",84],["Daniel Agger","CB",81],
    ["Fábio Aurélio","LB",78],["Javier Mascherano","CDM",85],["Xabi Alonso","CM",86],["Steven Gerrard","CAM",89],
    ["Dirk Kuyt","RW",81],["Albert Riera","LW",78],["Fernando Torres","ST",89],
  ]},
  { club: "Tottenham Hotspur", season: "2022/23", players: [
    ["Hugo Lloris","GK",83],["Cristian Romero","CB",84],["Eric Dier","CB",81],["Ben Davies","CB",79],
    ["Pedro Porro","RWB",81],["Ivan Perišić","LWB",82],["Pierre-Emile Højbjerg","CDM",82],["Rodrigo Bentancur","CM",82],
    ["Dejan Kulusevski","RW",83],["Son Heung-min","LW",87],["Harry Kane","ST",89],
  ]},
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const POSITIONS = new Set(["GK","RB","CB","LB","RWB","LWB","CDM","CM","CAM","RW","LW","ST"]);

function slugify(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const seasonSlug = (s) => s.replace("/", "-");

function normalize(name, club, season, position, overall, curated) {
  if (!POSITIONS.has(position)) throw new Error(`bad position ${position} for ${name}`);
  const clubSlug = slugify(club);
  const id = `${slugify(name)}-${clubSlug}-${seasonSlug(season)}`;
  return { id, name, club, clubSlug, season, position, overall: Math.round(overall), curated };
}

// ── Build curated set ───────────────────────────────────────────────────────
const byId = new Map();
for (const ts of TEAM_SEASONS) {
  for (const [name, position, overall] of ts.players) {
    const p = normalize(name, ts.club, ts.season, position, overall, true);
    byId.set(p.id, p); // curated wins on dup id
  }
}

// ── Optional CSV backbone merge (curated wins on conflict) ──────────────────
let csvAdded = 0;
if (existsSync(CSV)) {
  const rows = readFileSync(CSV, "utf8").trim().split(/\r?\n/);
  const header = rows.shift().split(",").map((h) => h.trim().toLowerCase());
  const col = (r, k) => r[header.indexOf(k)]?.trim();
  for (const line of rows) {
    const r = line.split(",");
    const position = (col(r, "position") || "").toUpperCase();
    if (!POSITIONS.has(position)) continue;
    try {
      const p = normalize(col(r, "name"), col(r, "club"), col(r, "season"), position, Number(col(r, "overall")), false);
      if (!byId.has(p.id)) { byId.set(p.id, p); csvAdded++; }
    } catch { /* skip malformed row */ }
  }
}

const players = [...byId.values()].sort((a, b) => b.overall - a.overall);

// ── Spinnable buckets: (club, season) with enough players to draft from ─────
const bucketMap = new Map();
for (const p of players) {
  const key = `${p.clubSlug}__${seasonSlug(p.season)}`;
  if (!bucketMap.has(key)) bucketMap.set(key, { club: p.club, clubSlug: p.clubSlug, season: p.season, playerIds: [] });
  bucketMap.get(key).playerIds.push(p.id);
}
const MIN_BUCKET = 4; // never deal a club-season too thin to draft from
const buckets = [...bucketMap.values()].filter((b) => b.playerIds.length >= MIN_BUCKET);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: csvAdded > 0 ? "curated+csv" : "curated",
  counts: { players: players.length, buckets: buckets.length, csvAdded },
  players,
  buckets,
}, null, 0) + "\n");

console.log(`Draft XI dataset: ${players.length} player-seasons, ${buckets.length} spinnable buckets (${csvAdded} from CSV).`);
console.log(`Wrote ${OUT}`);
