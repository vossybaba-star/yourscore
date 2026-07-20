// The Quiz Battle CPU opponent — client-safe constants (no server imports).
// One dedicated auth user backs every CPU match (created 2026-07-03). It never
// earns global rank points (the answer route skips increment_profile_score for
// it), so it can't pollute leaderboards or the ready-to-play rail.
export const QUIZ_BOT_ID = "8b3660cc-ba29-409c-a6a6-5723bafa87a1";

// The CPU seat presents as a regular player persona, never as "CPU" (founder,
// 2026-07-18 — same disguise as 38-0's bot fallback). The persona is derived
// deterministically from the room id, so the find screen (server response),
// lobby, live header and scorecard all show the same name — and each match
// meets a different "player". The bot is still QUIZ_BOT_ID underneath: friend
// prompts, rank, league stats and the activity feed keep excluding it by id.
const CPU_PERSONA_NAMES = [
  "Marcus B", "kingkev7", "Tayo", "DannyG", "FinleyW", "Ade10", "Lewi",
  "Callum22", "Sofia M", "jrules", "BigMikee", "Zane", "ReeceP", "OllieJ",
  "franko", "Dre", "JamalX", "Harv", "Leo10", "Stefan K", "Kez", "TommyD",
  "Nia", "petey", "ShaunR", "Iso8", "MoSalahFan", "Griff", "EllaB", "Vinnie",
  "Kofi", "Jayden A",
];

function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The imaginary player occupying the CPU seat of a room. `seed` drives the
 *  generated avatar (PlayerAvatar) so the look varies per match too. */
export function cpuPersona(roomId: string): { name: string; seed: string } {
  return { name: CPU_PERSONA_NAMES[hash32(roomId) % CPU_PERSONA_NAMES.length], seed: `cpu:${roomId}` };
}

/** Lobby name that marks a room as instant-matchmade (vs hand-created). Lives
 *  here (not quiz-matchmaking.ts, which is server-only) so client pages can
 *  recognise these rooms — e.g. the lobby hides its invite code/QR for them. */
export const INSTANT_MATCH_NAME = "Instant Match";
