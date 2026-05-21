export function generateRoomCode(teamNames: string): string {
  const prefix = teamNames
    .split(" ")[0]
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");
  const suffix = Math.floor(100 + Math.random() * 900).toString();
  return prefix + suffix;
}

export const FLAG_MAP: Record<string, string> = {
  // Americas
  Argentina: "🇦🇷", Brazil: "🇧🇷", Colombia: "🇨🇴", Uruguay: "🇺🇾",
  Ecuador: "🇪🇨", Chile: "🇨🇱", Venezuela: "🇻🇪", Paraguay: "🇵🇾",
  Bolivia: "🇧🇴", Peru: "🇵🇪",
  USA: "🇺🇸", Mexico: "🇲🇽", Canada: "🇨🇦", Panama: "🇵🇦",
  Costa: "🇨🇷", "Costa Rica": "🇨🇷", Jamaica: "🇯🇲", Honduras: "🇭🇳",
  // Europe
  France: "🇫🇷", Spain: "🇪🇸", England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Germany: "🇩🇪",
  Portugal: "🇵🇹", Netherlands: "🇳🇱", Italy: "🇮🇹", Belgium: "🇧🇪",
  Croatia: "🇭🇷", Switzerland: "🇨🇭", Denmark: "🇩🇰", Austria: "🇦🇹",
  Turkey: "🇹🇷", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", Poland: "🇵🇱", Serbia: "🇷🇸",
  Ukraine: "🇺🇦", Hungary: "🇭🇺", Slovakia: "🇸🇰", Romania: "🇷🇴",
  Norway: "🇳🇴", Sweden: "🇸🇪", Czechia: "🇨🇿", Greece: "🇬🇷",
  "Czech Republic": "🇨🇿",
  // Africa
  Morocco: "🇲🇦", Senegal: "🇸🇳", Nigeria: "🇳🇬", Egypt: "🇪🇬",
  Ghana: "🇬🇭", "Côte d'Ivoire": "🇨🇮", Cameroon: "🇨🇲", Algeria: "🇩🇿",
  Tunisia: "🇹🇳", "South Africa": "🇿🇦", Mali: "🇲🇱", Tanzania: "🇹🇿",
  // Asia
  Japan: "🇯🇵", "South Korea": "🇰🇷", Iran: "🇮🇷", "Saudi Arabia": "🇸🇦",
  Australia: "🇦🇺", Qatar: "🇶🇦", Iraq: "🇮🇶", Jordan: "🇯🇴",
  Indonesia: "🇮🇩", "New Zealand": "🇳🇿",
};

// FIFA World Cup 2026 — Group Stage Fixtures
// Hosted across USA, Canada & Mexico · June 11 – July 19, 2026
export const MOCK_MATCHES: Match[] = [
  // ── Opening Day ──────────────────────────────────────────────────────────
  { id: "g01", home_team: "Mexico",    away_team: "Ecuador",      match_date: "2026-06-11T20:00:00-06:00", tournament: "FIFA World Cup 2026 · Group A", status: "upcoming", flag_home: FLAG_MAP.Mexico,    flag_away: FLAG_MAP.Ecuador      },
  { id: "g02", home_team: "USA",       away_team: "Bolivia",      match_date: "2026-06-12T19:00:00-07:00", tournament: "FIFA World Cup 2026 · Group B", status: "upcoming", flag_home: FLAG_MAP.USA,       flag_away: FLAG_MAP.Bolivia       },
  { id: "g03", home_team: "Canada",    away_team: "Jamaica",      match_date: "2026-06-12T16:00:00-04:00", tournament: "FIFA World Cup 2026 · Group C", status: "upcoming", flag_home: FLAG_MAP.Canada,    flag_away: FLAG_MAP.Jamaica       },

  // ── Group Stage Day 2 ──────────────────────────────────────────────────
  { id: "g04", home_team: "Argentina", away_team: "Chile",        match_date: "2026-06-13T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group D", status: "upcoming", flag_home: FLAG_MAP.Argentina, flag_away: FLAG_MAP.Chile         },
  { id: "g05", home_team: "France",    away_team: "Morocco",      match_date: "2026-06-13T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group E", status: "upcoming", flag_home: FLAG_MAP.France,    flag_away: FLAG_MAP.Morocco       },
  { id: "g06", home_team: "Spain",     away_team: "Japan",        match_date: "2026-06-14T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group F", status: "upcoming", flag_home: FLAG_MAP.Spain,     flag_away: FLAG_MAP.Japan         },

  // ── Group Stage Day 3 ──────────────────────────────────────────────────
  { id: "g07", home_team: "Brazil",    away_team: "Croatia",      match_date: "2026-06-14T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group G", status: "upcoming", flag_home: FLAG_MAP.Brazil,    flag_away: FLAG_MAP.Croatia       },
  { id: "g08", home_team: "England",   away_team: "Senegal",      match_date: "2026-06-15T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group H", status: "upcoming", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",       flag_away: FLAG_MAP.Senegal       },
  { id: "g09", home_team: "Germany",   away_team: "Nigeria",      match_date: "2026-06-15T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group I", status: "upcoming", flag_home: FLAG_MAP.Germany,   flag_away: FLAG_MAP.Nigeria       },

  // ── Group Stage Day 4 ──────────────────────────────────────────────────
  { id: "g10", home_team: "Portugal",  away_team: "Poland",       match_date: "2026-06-16T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group J", status: "upcoming", flag_home: FLAG_MAP.Portugal,  flag_away: FLAG_MAP.Poland        },
  { id: "g11", home_team: "Netherlands","away_team": "Denmark",   match_date: "2026-06-16T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group K", status: "upcoming", flag_home: FLAG_MAP.Netherlands,flag_away: FLAG_MAP.Denmark      },
  { id: "g12", home_team: "Colombia",  away_team: "Egypt",        match_date: "2026-06-17T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group L", status: "upcoming", flag_home: FLAG_MAP.Colombia,  flag_away: FLAG_MAP.Egypt         },

  // ── Group Stage Day 5 ──────────────────────────────────────────────────
  { id: "g13", home_team: "Uruguay",   away_team: "South Korea",  match_date: "2026-06-17T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group A", status: "upcoming", flag_home: FLAG_MAP.Uruguay,   flag_away: FLAG_MAP["South Korea"] },
  { id: "g14", home_team: "Turkey",    away_team: "Saudi Arabia", match_date: "2026-06-18T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group B", status: "upcoming", flag_home: FLAG_MAP.Turkey,    flag_away: FLAG_MAP["Saudi Arabia"] },
  { id: "g15", home_team: "Mexico",    away_team: "Bolivia",      match_date: "2026-06-18T21:00:00-06:00", tournament: "FIFA World Cup 2026 · Group A", status: "upcoming", flag_home: FLAG_MAP.Mexico,    flag_away: FLAG_MAP.Bolivia       },

  // ── Marquee Matchups ──────────────────────────────────────────────────
  { id: "g16", home_team: "England",   away_team: "USA",          match_date: "2026-06-19T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group H", status: "upcoming", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",       flag_away: FLAG_MAP.USA           },
  { id: "g17", home_team: "Brazil",    away_team: "Argentina",    match_date: "2026-06-20T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group G", status: "upcoming", flag_home: FLAG_MAP.Brazil,    flag_away: FLAG_MAP.Argentina     },
  { id: "g18", home_team: "France",    away_team: "Germany",      match_date: "2026-06-20T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group E", status: "upcoming", flag_home: FLAG_MAP.France,    flag_away: FLAG_MAP.Germany       },
  { id: "g19", home_team: "Spain",     away_team: "Portugal",     match_date: "2026-06-21T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group F", status: "upcoming", flag_home: FLAG_MAP.Spain,     flag_away: FLAG_MAP.Portugal      },
  { id: "g20", home_team: "Netherlands","away_team": "England",   match_date: "2026-06-22T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group K", status: "upcoming", flag_home: FLAG_MAP.Netherlands,flag_away: "🏴󠁧󠁢󠁥󠁮󠁧󠁿"            },
  { id: "g21", home_team: "Belgium",   away_team: "Colombia",     match_date: "2026-06-22T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group L", status: "upcoming", flag_home: FLAG_MAP.Belgium,   flag_away: FLAG_MAP.Colombia      },

  // ── Final Group Stage Rounds ──────────────────────────────────────────
  { id: "g22", home_team: "Argentina", away_team: "Poland",       match_date: "2026-06-23T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group D", status: "upcoming", flag_home: FLAG_MAP.Argentina, flag_away: FLAG_MAP.Poland        },
  { id: "g23", home_team: "Brazil",    away_team: "Switzerland",  match_date: "2026-06-24T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group G", status: "upcoming", flag_home: FLAG_MAP.Brazil,    flag_away: FLAG_MAP.Switzerland   },
  { id: "g24", home_team: "Germany",   away_team: "Spain",        match_date: "2026-06-24T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group I", status: "upcoming", flag_home: FLAG_MAP.Germany,   flag_away: FLAG_MAP.Spain         },
  { id: "g25", home_team: "Portugal",  away_team: "France",       match_date: "2026-06-25T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Group J", status: "upcoming", flag_home: FLAG_MAP.Portugal,  flag_away: FLAG_MAP.France        },
  { id: "g26", home_team: "Japan",     away_team: "Morocco",      match_date: "2026-06-25T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Group F", status: "upcoming", flag_home: FLAG_MAP.Japan,     flag_away: FLAG_MAP.Morocco       },

  // ── Round of 32 (top fixtures) ────────────────────────────────────────
  { id: "r32a", home_team: "England",   away_team: "Colombia",    match_date: "2026-06-29T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",      flag_away: FLAG_MAP.Colombia      },
  { id: "r32b", home_team: "Brazil",    away_team: "USA",         match_date: "2026-06-29T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: FLAG_MAP.Brazil,   flag_away: FLAG_MAP.USA           },
  { id: "r32c", home_team: "Argentina", away_team: "Mexico",      match_date: "2026-06-30T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: FLAG_MAP.Argentina,flag_away: FLAG_MAP.Mexico        },
  { id: "r32d", home_team: "France",    away_team: "Senegal",     match_date: "2026-06-30T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: FLAG_MAP.France,   flag_away: FLAG_MAP.Senegal       },
  { id: "r32e", home_team: "Spain",     away_team: "Japan",       match_date: "2026-07-01T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: FLAG_MAP.Spain,    flag_away: FLAG_MAP.Japan         },
  { id: "r32f", home_team: "Germany",   away_team: "Netherlands", match_date: "2026-07-02T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: FLAG_MAP.Germany,  flag_away: FLAG_MAP.Netherlands   },
  { id: "r32g", home_team: "Portugal",  away_team: "Morocco",     match_date: "2026-07-02T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: FLAG_MAP.Portugal, flag_away: FLAG_MAP.Morocco       },
  { id: "r32h", home_team: "Canada",    away_team: "Uruguay",     match_date: "2026-07-03T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Round of 32", status: "upcoming", flag_home: FLAG_MAP.Canada,   flag_away: FLAG_MAP.Uruguay       },

  // ── Quarter-Finals ─────────────────────────────────────────────────────
  { id: "qf1", home_team: "England",   away_team: "France",       match_date: "2026-07-06T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Quarter-Final", status: "upcoming", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",     flag_away: FLAG_MAP.France        },
  { id: "qf2", home_team: "Brazil",    away_team: "Argentina",    match_date: "2026-07-07T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Quarter-Final", status: "upcoming", flag_home: FLAG_MAP.Brazil,  flag_away: FLAG_MAP.Argentina     },
  { id: "qf3", home_team: "Spain",     away_team: "Germany",      match_date: "2026-07-07T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Quarter-Final", status: "upcoming", flag_home: FLAG_MAP.Spain,   flag_away: FLAG_MAP.Germany       },
  { id: "qf4", home_team: "Portugal",  away_team: "Netherlands",  match_date: "2026-07-08T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Quarter-Final", status: "upcoming", flag_home: FLAG_MAP.Portugal,flag_away: FLAG_MAP.Netherlands   },

  // ── Semi-Finals ────────────────────────────────────────────────────────
  { id: "sf1", home_team: "England",   away_team: "Brazil",       match_date: "2026-07-14T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Semi-Final", status: "upcoming", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",     flag_away: FLAG_MAP.Brazil        },
  { id: "sf2", home_team: "Spain",     away_team: "Portugal",     match_date: "2026-07-15T21:00:00-04:00", tournament: "FIFA World Cup 2026 · Semi-Final", status: "upcoming", flag_home: FLAG_MAP.Spain,   flag_away: FLAG_MAP.Portugal      },

  // ── The Final ──────────────────────────────────────────────────────────
  { id: "final", home_team: "England", away_team: "Spain",        match_date: "2026-07-19T18:00:00-04:00", tournament: "FIFA World Cup 2026 · Final", status: "upcoming", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",         flag_away: FLAG_MAP.Spain         },
];

export interface Match {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  tournament: string;
  status: "upcoming" | "live" | "completed";
  flag_home: string;
  flag_away: string;
}

export function formatMatchDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
