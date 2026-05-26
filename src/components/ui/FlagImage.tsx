/**
 * FlagImage — renders a real country flag from flagcdn.com.
 * Falls back to a plain circle if the team isn't mapped.
 */

const FLAG_CODES: Record<string, string> = {
  // British nations (special codes)
  England:        "gb-eng",
  Scotland:       "gb-sct",
  Wales:          "gb-wls",
  "Northern Ireland": "gb-nir",

  // Europe
  France:         "fr",
  Germany:        "de",
  Spain:          "es",
  Portugal:       "pt",
  Netherlands:    "nl",
  Italy:          "it",
  Belgium:        "be",
  Croatia:        "hr",
  Serbia:         "rs",
  Denmark:        "dk",
  Switzerland:    "ch",
  Poland:         "pl",
  Ukraine:        "ua",
  Turkey:         "tr",
  Austria:        "at",
  Sweden:         "se",
  Norway:         "no",
  Finland:        "fi",
  Greece:         "gr",
  Hungary:        "hu",
  Romania:        "ro",
  Slovakia:       "sk",
  Slovenia:       "si",
  Albania:        "al",
  Georgia:        "ge",
  Czechia:        "cz",
  "Czech Republic": "cz",

  // South America
  Brazil:         "br",
  Argentina:      "ar",
  Uruguay:        "uy",
  Colombia:       "co",
  Chile:          "cl",
  Peru:           "pe",
  Ecuador:        "ec",
  Venezuela:      "ve",
  Paraguay:       "py",
  Bolivia:        "bo",

  // North & Central America / Caribbean
  USA:            "us",
  Mexico:         "mx",
  Canada:         "ca",
  Jamaica:        "jm",
  Honduras:       "hn",
  Panama:         "pa",
  "Costa Rica":   "cr",
  "El Salvador":  "sv",
  Cuba:           "cu",
  Haiti:          "ht",
  Trinidad:       "tt",
  "Trinidad and Tobago": "tt",

  // Africa
  Morocco:        "ma",
  Senegal:        "sn",
  Nigeria:        "ng",
  Ghana:          "gh",
  "South Africa": "za",
  Cameroon:       "cm",
  "Ivory Coast":  "ci",
  "Côte d'Ivoire": "ci",
  Tunisia:        "tn",
  Egypt:          "eg",
  Algeria:        "dz",
  Mali:           "ml",
  Zambia:         "zm",
  Zimbabwe:       "zw",
  Kenya:          "ke",

  // Asia & Middle East
  Japan:          "jp",
  "South Korea":  "kr",
  Iran:           "ir",
  Australia:      "au",
  Qatar:          "qa",
  "Saudi Arabia": "sa",
  China:          "cn",
  India:          "in",
  Iraq:           "iq",
  Jordan:         "jo",
  Bahrain:        "bh",
  UAE:            "ae",
  Kuwait:         "kw",
  Oman:           "om",
  Indonesia:      "id",
  Thailand:       "th",
  Vietnam:        "vn",
  Philippines:    "ph",
  Uzbekistan:     "uz",
  Tajikistan:     "tj",

  // Others
  "New Zealand":  "nz",
  Iceland:        "is",
  Israel:         "il",
  Russia:         "ru",
};

interface FlagImageProps {
  team: string;
  /** Pixel size for display (square container). Default 40. */
  size?: number;
  className?: string;
}

export function FlagImage({ team, size = 40, className = "" }: FlagImageProps) {
  const code = FLAG_CODES[team];
  // Pick the smallest flagcdn width that's still ≥ 2× display size (for retina)
  const srcWidth = size <= 20 ? 40 : size <= 40 ? 80 : size <= 80 ? 160 : 320;

  if (!code) {
    // Fallback: coloured circle with first letter
    return (
      <div
        className={`flex items-center justify-center rounded-sm font-bold text-white flex-shrink-0 ${className}`}
        style={{
          width: size,
          height: size * 0.67,
          background: "rgba(255,255,255,0.1)",
          fontSize: size * 0.35,
        }}
      >
        {team[0]}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w${srcWidth}/${code}.png`}
      alt={`${team} flag`}
      width={size}
      height={Math.round(size * 0.67)}
      className={`object-cover rounded-sm flex-shrink-0 ${className}`}
      style={{ display: "block" }}
      loading="lazy"
    />
  );
}

/** Inline helper — same as FlagImage but renders as a larger square-ish block for hero use */
export function FlagImageLarge({ team, size = 56 }: { team: string; size?: number }) {
  return <FlagImage team={team} size={size} />;
}
