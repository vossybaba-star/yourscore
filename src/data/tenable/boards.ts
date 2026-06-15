/**
 * Football Tenable — weekly boards.
 *
 * Each board is a verified "top 10" list. `week` orders them; the highest week
 * with a board is "this week's drop". Content verified June 2026 against each
 * board's `source`. The engine only needs exactly 10 answers per board.
 *
 * ⚠️ Football facts move (a striker passes someone on an all-time list). Re-check
 * each board's `source` before it goes out as a live weekly.
 */

import type { TenableBoard } from "@/lib/tenable/types";

export const BOARDS: TenableBoard[] = [
  {
    slug: "pl-top-scorers",
    week: 1,
    category: "Premier League all-time top scorers",
    subtitle: "Men's Premier League, 1992–2026",
    source: "https://www.premierleague.com/stats/all-time",
    lukeScore: 8,
    lukeQuote: "Eight out of ten. I'd have got Defoe if you'd given me ten more seconds, you muppet.",
    answers: [
      { rank: 1, label: "Alan Shearer", detail: "260 goals", accept: ["shearer", "alan shearer", "alan"] },
      { rank: 2, label: "Harry Kane", detail: "213 goals", accept: ["kane", "harry kane", "harry"] },
      { rank: 3, label: "Wayne Rooney", detail: "208 goals", accept: ["rooney", "wayne rooney", "wazza", "wayne"] },
      { rank: 4, label: "Mohamed Salah", detail: "193 goals", accept: ["salah", "mohamed salah", "mo salah", "momo"] },
      { rank: 5, label: "Andrew Cole", detail: "187 goals", accept: ["cole", "andy cole", "andrew cole", "andy"] },
      { rank: 6, label: "Sergio Agüero", detail: "184 goals", accept: ["aguero", "agüero", "sergio aguero", "kun", "kun aguero"] },
      { rank: 7, label: "Frank Lampard", detail: "177 goals", accept: ["lampard", "frank lampard", "lamps", "frank"] },
      { rank: 8, label: "Thierry Henry", detail: "175 goals", accept: ["henry", "thierry henry", "titi", "thierry"] },
      { rank: 9, label: "Robbie Fowler", detail: "163 goals", accept: ["fowler", "robbie fowler", "robbie"] },
      { rank: 10, label: "Jermain Defoe", detail: "162 goals", accept: ["defoe", "jermain defoe", "jermaine defoe", "jermain"] },
    ],
  },
  {
    slug: "most-expensive-transfers",
    week: 2,
    category: "The 10 most expensive transfers ever",
    subtitle: "Men's football, by reported fee (€)",
    source: "https://en.wikipedia.org/wiki/List_of_most_expensive_association_football_transfers",
    lukeScore: 6,
    lukeQuote: "Six. In my defence, half these fees are just Chelsea panic-buying. Don't @ me.",
    answers: [
      { rank: 1, label: "Neymar", detail: "€222m — Barcelona → PSG, 2017", accept: ["neymar", "neymar jr", "neymar junior"] },
      { rank: 2, label: "Kylian Mbappé", detail: "€180m — Monaco → PSG, 2018", accept: ["mbappe", "mbappé", "kylian mbappe", "kylian"] },
      { rank: 3, label: "Alexander Isak", detail: "€144.5m — Newcastle → Liverpool, 2025", accept: ["isak", "alexander isak", "alex isak"] },
      { rank: 4, label: "João Félix", detail: "€126m — Benfica → Atlético, 2019", accept: ["felix", "félix", "joao felix", "joão félix"] },
      { rank: 5, label: "Enzo Fernández", detail: "€121m — Benfica → Chelsea, 2023", accept: ["enzo", "fernandez", "fernández", "enzo fernandez", "enzo fernández"] },
      { rank: 6, label: "Antoine Griezmann", detail: "€120m — Atlético → Barcelona, 2019", accept: ["griezmann", "antoine griezmann", "grizi", "antoine"] },
      { rank: 7, label: "Philippe Coutinho", detail: "€118.4m — Liverpool → Barcelona, 2018", accept: ["coutinho", "philippe coutinho", "phil coutinho", "philippe"] },
      { rank: 8, label: "Jack Grealish", detail: "€117.7m — Aston Villa → Man City, 2021", accept: ["grealish", "jack grealish", "jack"] },
      { rank: 9, label: "Florian Wirtz", detail: "€117.5m — Leverkusen → Liverpool, 2025", accept: ["wirtz", "florian wirtz", "florian"] },
      { rank: 10, label: "Declan Rice", detail: "€116.5m — West Ham → Arsenal, 2023", accept: ["rice", "declan rice", "declan"] },
    ],
  },
  {
    slug: "most-international-goals",
    week: 3,
    category: "Top 10 men's international goalscorers ever",
    subtitle: "Men's senior internationals, all nations",
    source: "https://en.wikipedia.org/wiki/List_of_men%27s_footballers_with_50_or_more_international_goals",
    lukeScore: 7,
    lukeQuote: "Seven. Mokhtar Dahari? Course I knew him. Knew him better than you, anyway.",
    answers: [
      { rank: 1, label: "Cristiano Ronaldo", detail: "143 goals · Portugal", accept: ["ronaldo", "cristiano", "cristiano ronaldo", "cr7"] },
      { rank: 2, label: "Lionel Messi", detail: "117 goals · Argentina", accept: ["messi", "lionel messi", "leo messi", "leo", "lionel"] },
      { rank: 3, label: "Ali Daei", detail: "108 goals · Iran", accept: ["daei", "ali daei"] },
      { rank: 4, label: "Sunil Chhetri", detail: "95 goals · India", accept: ["chhetri", "sunil chhetri", "sunil"] },
      { rank: 5, label: "Romelu Lukaku", detail: "90 goals · Belgium", accept: ["lukaku", "romelu lukaku", "romelu", "rom"] },
      { rank: 6, label: "Mokhtar Dahari", detail: "89 goals · Malaysia", accept: ["dahari", "mokhtar dahari", "mokhtar"] },
      { rank: 7, label: "Robert Lewandowski", detail: "89 goals · Poland", accept: ["lewandowski", "robert lewandowski", "lewa", "robert"] },
      { rank: 8, label: "Ali Mabkhout", detail: "85 goals · UAE", accept: ["mabkhout", "ali mabkhout"] },
      { rank: 9, label: "Ferenc Puskás", detail: "84 goals · Hungary", accept: ["puskas", "puskás", "ferenc puskas", "ferenc"] },
      { rank: 10, label: "Godfrey Chitalu", detail: "79 goals · Zambia", accept: ["chitalu", "godfrey chitalu", "godfrey"] },
    ],
  },
  {
    slug: "england-most-caps",
    week: 4,
    category: "Most-capped England men's players ever",
    subtitle: "England men's senior internationals",
    source: "https://www.englandfootball.com/articles/2022/Aug/22/england-mens-senior-all-time-record-appearances-international-caps",
    lukeScore: 9,
    lukeQuote: "Nine! Forgot Billy Wright. My nan's gonna disown me for that one.",
    answers: [
      { rank: 1, label: "Peter Shilton", detail: "125 caps", accept: ["shilton", "peter shilton", "shilts", "peter"] },
      { rank: 2, label: "Wayne Rooney", detail: "120 caps", accept: ["rooney", "wayne rooney", "wazza", "wayne"] },
      { rank: 3, label: "David Beckham", detail: "115 caps", accept: ["beckham", "david beckham", "becks", "david"] },
      { rank: 4, label: "Steven Gerrard", detail: "114 caps", accept: ["gerrard", "steven gerrard", "stevie g", "stevie gerrard", "steven"] },
      { rank: 5, label: "Harry Kane", detail: "114 caps", accept: ["kane", "harry kane", "harry"] },
      { rank: 6, label: "Bobby Moore", detail: "108 caps", accept: ["moore", "bobby moore", "bobby"] },
      { rank: 7, label: "Ashley Cole", detail: "107 caps", accept: ["ashley cole", "a cole", "ashley"] },
      { rank: 8, label: "Bobby Charlton", detail: "106 caps", accept: ["charlton", "bobby charlton", "sir bobby charlton", "sir bobby"] },
      { rank: 9, label: "Frank Lampard", detail: "106 caps", accept: ["lampard", "frank lampard", "lamps", "frank"] },
      { rank: 10, label: "Billy Wright", detail: "105 caps", accept: ["wright", "billy wright", "billy"] },
    ],
  },
  {
    slug: "most-pl-appearances",
    week: 5,
    category: "Most Premier League appearances ever",
    subtitle: "Men's Premier League, 1992–2026",
    source: "https://theanalyst.com/articles/most-premier-league-appearances",
    lukeScore: 7,
    lukeQuote: "Seven. Phil Neville got more games than your whole life's got main characters.",
    answers: [
      { rank: 1, label: "James Milner", detail: "658 apps", accept: ["milner", "james milner"] },
      { rank: 2, label: "Gareth Barry", detail: "653 apps", accept: ["barry", "gareth barry", "gareth"] },
      { rank: 3, label: "Ryan Giggs", detail: "632 apps", accept: ["giggs", "ryan giggs", "ryan"] },
      { rank: 4, label: "Frank Lampard", detail: "609 apps", accept: ["lampard", "frank lampard", "lamps", "frank"] },
      { rank: 5, label: "David James", detail: "572 apps", accept: ["david james", "calamity james"] },
      { rank: 6, label: "Gary Speed", detail: "535 apps", accept: ["speed", "gary speed", "gary"] },
      { rank: 7, label: "Emile Heskey", detail: "516 apps", accept: ["heskey", "emile heskey", "emile"] },
      { rank: 8, label: "Mark Schwarzer", detail: "514 apps", accept: ["schwarzer", "mark schwarzer", "mark"] },
      { rank: 9, label: "Jamie Carragher", detail: "508 apps", accept: ["carragher", "jamie carragher", "carra", "jamie"] },
      { rank: 10, label: "Phil Neville", detail: "505 apps", accept: ["phil neville", "p neville", "phil"] },
    ],
  },
  {
    slug: "most-cl-appearances",
    week: 6,
    category: "Most Champions League appearances ever",
    subtitle: "European Cup / Champions League era",
    source: "https://www.si.com/soccer/who-has-the-most-champions-league-appearances-of-all-time",
    lukeScore: 6,
    lukeQuote: "Six, and four of them are just Real Madrid lads. Rigged competition, this.",
    answers: [
      { rank: 1, label: "Cristiano Ronaldo", detail: "183 apps", accept: ["ronaldo", "cristiano", "cristiano ronaldo", "cr7"] },
      { rank: 2, label: "Iker Casillas", detail: "177 apps", accept: ["casillas", "iker casillas", "iker"] },
      { rank: 3, label: "Lionel Messi", detail: "163 apps", accept: ["messi", "lionel messi", "leo messi", "leo", "lionel"] },
      { rank: 4, label: "Thomas Müller", detail: "158 apps", accept: ["muller", "müller", "thomas muller", "thomas müller", "thomas"] },
      { rank: 5, label: "Karim Benzema", detail: "152 apps", accept: ["benzema", "karim benzema", "karim"] },
      { rank: 6, label: "Toni Kroos", detail: "151 apps", accept: ["kroos", "toni kroos", "toni"] },
      { rank: 7, label: "Xavi", detail: "151 apps", accept: ["xavi", "xavi hernandez", "xavi hernández"] },
      { rank: 8, label: "Manuel Neuer", detail: "147 apps", accept: ["neuer", "manuel neuer", "manuel"] },
      { rank: 9, label: "Raúl", detail: "142 apps", accept: ["raul", "raúl", "raul gonzalez", "raúl gonzález"] },
      { rank: 10, label: "Sergio Ramos", detail: "142 apps", accept: ["ramos", "sergio ramos", "sergio"] },
    ],
  },
];

/**
 * This week's board. In production this maps to a real weekly schedule (e.g.
 * highest `week` that has gone live). For the prototype we feature the
 * PL-top-scorers board — the cleanest, most recognizable first impression.
 */
export function currentBoard(): TenableBoard {
  return BOARDS[0];
}

export function boardBySlug(slug: string): TenableBoard | undefined {
  return BOARDS.find((b) => b.slug === slug);
}
