import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import { avatarPalette, avatarInitial } from "@/lib/avatar";

/**
 * The YourScore player card — a FUT-style badge, but rated on being a YourScore
 * player rather than on any one game. Every game feeds the same six attributes,
 * so a new game raises your card without needing its own slot on the page.
 */

export type Attributes = {
  KNO: number; // accuracy — how often you're right
  PAC: number; // decision speed
  WIN: number; // record against other people
  CON: number; // turning up
  RNG: number; // how much of YourScore you play
  SOC: number; // competing with people you know
};

export const ATTRIBUTE_LABELS: Record<keyof Attributes, string> = {
  KNO: "Knowledge",
  PAC: "Pace",
  WIN: "Winning",
  CON: "Consistency",
  RNG: "Range",
  SOC: "Social",
};

type Tier = { key: string; label: string; from: string; to: string; edge: string; ink: string; dim: string };

// Four rungs. The jump between them is the thing worth chasing, so the palettes
// are deliberately far apart rather than a smooth ramp.
const TIERS: Tier[] = [
  { key: "icon",   label: "ICON",   from: "#1b2f0b", to: "#050806", edge: "#aeea00", ink: "#ffffff", dim: "#b6d374" },
  { key: "gold",   label: "GOLD",   from: "#6b5619", to: "#1a1508", edge: "#ffc233", ink: "#ffffff", dim: "#d9b96e" },
  { key: "silver", label: "SILVER", from: "#4d545a", to: "#1e2224", edge: "#c6d0da", ink: "#ffffff", dim: "#b3bdc7" },
  { key: "bronze", label: "BRONZE", from: "#553c23", to: "#241a12", edge: "#c98f52", ink: "#f6e6d4", dim: "#c9a077" },
];

export function tierFor(ovr: number): Tier {
  if (ovr >= 90) return TIERS[0];
  if (ovr >= 75) return TIERS[1];
  if (ovr >= 60) return TIERS[2];
  return TIERS[3];
}

/**
 * Badge silhouette on a 300×420 canvas: flat shoulders, straight sides down to
 * y=312, then a taper to a rounded point. Drawn as an SVG path rather than a CSS
 * clip-path so the edge can carry a real stroke — clip-path cuts the border off
 * along with the shape.
 *
 * Everything readable lives ABOVE y=312, in the straight-sided zone. Text placed
 * inside the taper looks off-centre even when it's mathematically centred,
 * because the shrinking silhouette reads as the frame.
 */
const SHIELD =
  "M16 3 L284 3 C292 3 297 8 297 16 L297 344 C297 362 288 374 274 381 L158 415 C152 417 148 417 142 415 L26 381 C12 374 3 362 3 344 L3 16 C3 8 8 3 16 3 Z";

// The avatar is the hero of the card, so it gets the room to act like it.
// Module-scope because the profile page overlays the picker on exactly this
// circle — two copies of these numbers would drift the moment one changed.
const AV = { cx: 201, cy: 106, r: 65 };

/**
 * Where the avatar sits as a percentage of the card box, for positioning an
 * interactive overlay on top of the (non-interactive) SVG.
 */
export const AVATAR_FRAME = {
  left: `${((AV.cx - AV.r) / 300) * 100}%`,
  top: `${((AV.cy - AV.r) / 420) * 100}%`,
  width: `${((AV.r * 2) / 300) * 100}%`,
  height: `${((AV.r * 2) / 420) * 100}%`,
};

/** Stat rows are mirrored about the centre line so the block is optically even. */
const ROWS: [keyof Attributes, keyof Attributes][] = [
  ["KNO", "RNG"],
  ["PAC", "CON"],
  ["WIN", "SOC"],
];

export function PlayerCard({
  userId,
  name,
  avatarUrl,
  ovr,
  archetype,
  club,
  attributes,
  width = 300,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  ovr: number;
  archetype: string;
  club: string | null;
  attributes: Attributes;
  /** Rendered width in px. Everything is a viewBox unit, so this scales the
   *  whole card — the profile shows it small, a share card would use full size. */
  width?: number;
}) {
  const tier = tierFor(ovr);
  const crest = club ? getTeamBadgeUrlSync(club) : null;
  const pal = avatarPalette(userId || name);
  const uid = `pc-${tier.key}`;

  // Stat block geometry. Mirror the rendered BLOCK about x=150, never the anchor
  // positions — that was the earlier bug. The number is right-anchored (content
  // extends LEFT of its x) while the label is left-anchored (content extends
  // RIGHT), so simply adding 150 to each anchor pushed the right column's label
  // out to x=287 against a 297 edge: a 70px left margin against a 10px right one.
  //
  // Derived instead from the block itself, so the two sides are equal by
  // construction and stay equal if the type sizes change:
  const NUM_W = 23; // two digits at 27px Bebas
  const LAB_W = 35; // three caps at 16px DM Sans + tracking (WIN/RNG are widest)
  const GAP = 8; // number → label
  const CLEAR = 20; // column → centre divider
  const COL_W = NUM_W + GAP + LAB_W;
  // Measured in-browser, not guessed: RNG/CON/SOC render ~2px wider than
  // KNO/PAC/WIN, so a geometrically centred block still has its INK centre right
  // of 150. Nudging both columns equally keeps the internal spacing and lands the
  // outer margins even — 60.4 left vs 60.3 right.
  const SHIFT = -2;
  const LEFT_X = 150 - CLEAR - COL_W + SHIFT;
  const RIGHT_X = 150 + CLEAR + SHIFT;

  const NUM_R = { left: LEFT_X + NUM_W, right: RIGHT_X + NUM_W };
  const LAB_L = { left: LEFT_X + NUM_W + GAP, right: RIGHT_X + NUM_W + GAP };
  const ROW_Y = [274, 306, 338];


  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: width, aspectRatio: "300 / 420" }}>
      <svg viewBox="0 0 300 420" className="w-full h-full block" role="img" aria-label={`${name}, ${ovr} rated ${archetype}`}>
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" stopColor={tier.from} />
            <stop offset="72%" stopColor={tier.to} />
          </linearGradient>
          <clipPath id={`${uid}-clip`}>
            <circle cx={AV.cx} cy={AV.cy} r={AV.r} />
          </clipPath>
        </defs>

        <path d={SHIELD} fill={`url(#${uid}-bg)`} stroke={tier.edge} strokeWidth="2.5" />

        {/* Identity column — rating, role, allegiance, reading top-down. */}
        <text x="60" y="82" textAnchor="middle" fill={tier.edge} style={{ font: "400 52px var(--font-bebas), sans-serif" }}>
          {ovr}
        </text>
        <text
          x="60"
          y="103"
          textAnchor="middle"
          fill={tier.edge}
          style={{ font: "500 13px var(--font-dm-sans), sans-serif", letterSpacing: "0.09em" }}
        >
          {archetype}
        </text>
        <line x1="42" y1="117" x2="78" y2="117" stroke={tier.edge} strokeOpacity="0.4" strokeWidth="1.5" />

        {crest ? (
          <image href={crest} x="33" y="127" width="54" height="54" preserveAspectRatio="xMidYMid meet" />
        ) : (
          // No club picked yet reads as "choose one" rather than a missing asset.
          <g>
            <circle cx="60" cy="154" r="24" fill="none" stroke={tier.edge} strokeOpacity="0.4" strokeDasharray="4 4" />
            <text x="60" y="163" textAnchor="middle" fill={tier.edge} fillOpacity="0.65" style={{ font: "400 24px var(--font-dm-sans), sans-serif" }}>
              +
            </text>
          </g>
        )}

        {/* The disc and the monogram fallback are SVG, but a real photo is an
            HTML <img> layered over the card (below). A cross-origin URL inside
            an SVG <image href> renders as a broken tile — Google account photos
            are on 3,367 of our profiles, so that path has to work. */}
        {avatarUrl ? (
          <circle cx={AV.cx} cy={AV.cy} r={AV.r} fill="rgba(0,0,0,0.3)" />
        ) : (
          <>
            <defs>
              <linearGradient id={`${uid}-av`} x1="0" y1="0" x2="0.5" y2="1">
                <stop offset="0%" stopColor={pal.from} />
                <stop offset="100%" stopColor={pal.to} />
              </linearGradient>
            </defs>
            <circle cx={AV.cx} cy={AV.cy} r={AV.r} fill={`url(#${uid}-av)`} />
            <text x={AV.cx} y={AV.cy + 24} textAnchor="middle" fill={pal.fg} style={{ font: "400 60px var(--font-bebas), sans-serif" }}>
              {avatarInitial(name)}
            </text>
            <circle cx={AV.cx} cy={AV.cy} r={AV.r} fill="none" stroke={tier.edge} strokeOpacity="0.45" strokeWidth="2" />
          </>
        )}

        <text
          x="150"
          y="234"
          textAnchor="middle"
          fill={tier.ink}
          style={{ font: "400 32px var(--font-bebas), sans-serif", letterSpacing: "0.05em" }}
        >
          {name.length > 14 ? `${name.slice(0, 13).toUpperCase()}…` : name.toUpperCase()}
        </text>
        <line x1="46" y1="250" x2="254" y2="250" stroke={tier.edge} strokeOpacity="0.35" strokeWidth="1.5" />
        <line x1="150" y1="261" x2="150" y2="349" stroke={tier.edge} strokeOpacity="0.22" strokeWidth="1.5" />

        {ROWS.map(([l, r], i) => (
          <g key={l}>
            <text x={NUM_R.left} y={ROW_Y[i]} textAnchor="end" fill={tier.ink} style={{ font: "400 27px var(--font-bebas), sans-serif" }}>
              {attributes[l]}
            </text>
            <text x={LAB_L.left} y={ROW_Y[i]} fill={tier.dim} style={{ font: "500 16px var(--font-dm-sans), sans-serif", letterSpacing: "0.05em" }}>
              {l}
            </text>
            <text x={NUM_R.right} y={ROW_Y[i]} textAnchor="end" fill={tier.ink} style={{ font: "400 27px var(--font-bebas), sans-serif" }}>
              {attributes[r]}
            </text>
            <text x={LAB_L.right} y={ROW_Y[i]} fill={tier.dim} style={{ font: "500 16px var(--font-dm-sans), sans-serif", letterSpacing: "0.05em" }}>
              {r}
            </text>
          </g>
        ))}
      </svg>

      {avatarUrl && (
        <div
          className="absolute rounded-full overflow-hidden pointer-events-none"
          style={{ ...AVATAR_FRAME, border: `2px solid ${tier.edge}73` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl} alt="" className="w-full h-full" style={{ objectFit: "cover", display: "block" }} />
        </div>
      )}
    </div>
  );
}
