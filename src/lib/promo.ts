/**
 * Promotional levers — every prize surface reads from here so a promotion can
 * be switched off with ONE env var and a redeploy, not a code hunt.
 *
 * The £25 daily share-to-enter giveaway (4 surfaces: solo quiz results, WC run
 * result, 38-0 live match result, season scorecard) previously hardcoded its
 * copy with no off-switch — after the World Cup it would silently become either
 * an unbudgeted liability or a false promise. Set
 * NEXT_PUBLIC_DAILY_GIVEAWAY=false in Vercel to retire every surface at once.
 */
export const DAILY_GIVEAWAY_ENABLED = process.env.NEXT_PUBLIC_DAILY_GIVEAWAY !== "false";
