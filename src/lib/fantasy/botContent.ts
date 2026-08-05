/**
 * The bot newsroom — personas and a content library that emulate FPL-Twitter
 * commentary in the fantasy feed (founder, 4 Aug: "so many debates and takes").
 *
 * PLAIN module on purpose: no `server-only`, no pool import — the player pool is
 * passed in — so BOTH the cron tick (src/lib/fantasy/bots.ts) and the standalone
 * seeding script (scripts/fantasy/bots.ts) can use it.
 *
 * Ground rules for the voice (pre-season safe):
 *  - Opinions about players, prices and squad-building only — never invented
 *    match results, injuries or "news". The season hasn't kicked off.
 *  - Every persona is flagged is_seed (excluded from standings/prizes) with
 *    profiles.source = 'bot' so one query finds them and one delete removes them.
 *  - Every generated move carries payload.k (template + player ids) so the tick
 *    can dedupe against what a persona already posted.
 */

export interface BotPersona {
  key: string;
  username: string;
  name: string;
  avatar: string;
  /** Which content categories this persona posts, with weights. */
  cats: Partial<Record<BotCat, number>>;
  /** Days after BOT_LAUNCH_EPOCH_MS this persona starts posting. The accounts
   *  all exist from day one; the CAST grows over launch week (7 → 11 → 16) so
   *  the community reads as filling up, not switched on. */
  day: number;
  /** Writing style — the thing a reader should recognise before the name.
   *  caps "never" = lowercase starts, full stops mostly dropped; "proper" =
   *  full sentences left alone; default = the light roughen pass. */
  style?: { caps?: "never" | "proper" };
  /** Posting rhythm: hours of cooldown between posts (jittered ±30% by the
   *  tick) and the chance any given London day is a silent one. Together they
   *  make some accounts post twice a day and others vanish for days. */
  tempo: { cdH: number; offChance: number };
}
export type BotCat = "take" | "poll" | "player" | "banter" | "quiz" | "meta" | "casual";

/** Launch day for the bot cast — day 0 of the persona ramp. */
export const BOT_LAUNCH_EPOCH_MS = Date.parse("2026-08-04T00:00:00Z");

/** Until this moment the feed is in its GETTING-STARTED phase (founder, 5 Aug):
 *  people are joining, poking at the app and thinking out loud — mostly short,
 *  ordinary chatter, few polished discussion prompts. From the weekend the
 *  regular library takes back over. */
export const CHATTER_PHASE_UNTIL_MS = Date.parse("2026-08-08T06:00:00Z");

/** The personas allowed to act right now (ramp gate). */
export const activeBotPersonas = (nowMs: number): BotPersona[] =>
  BOT_PERSONAS.filter((p) => nowMs >= BOT_LAUNCH_EPOCH_MS + p.day * 864e5);

/** London wall-clock hour for a timestamp — the cast lives in one timezone and
 *  nobody posts at 4am. */
export function londonHour(nowMs: number): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date(nowMs)));
}

/** London calendar date (YYYY-MM-DD) — the unit of the per-persona day off. */
export function londonDay(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(nowMs));
}

/** Deterministic "is this persona taking today off?" — same answer all day, no
 *  state to store. */
export function personaDayOff(persona: BotPersona, nowMs: number): boolean {
  const s = `${persona.key}:${londonDay(nowMs)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967296) < persona.tempo.offChance;
}

/** A generated move, ready to insert as a fantasy_feed_events row. */
export interface BotMove {
  personaKey: string;
  type: "post" | "quiz_result";
  payload: Record<string, unknown>; // includes k (dedupe key)
}

export interface BotPoolPlayer {
  id: number;
  name: string;
  club: string;
  pos: "GK" | "DEF" | "MID" | "FWD";
  price: number; // £m
}

// ── The cast ──────────────────────────────────────────────────────────────────
// Original characters (not copies of real accounts): the archetypes every FPL
// timeline has. Handles read like real sign-ups, avatars from the fan pack.

// Identities follow the REAL sign-up patterns on the platform (founder, 5 Aug:
// "look at our users" — lowercase single words, name+digits, display name often
// just the username, no themed gimmick names). Behaviour, not the name, is what
// separates them: kev knee-jerks, marc talks structure, cally posts captaincy
// polls, tomo jokes, ellie argues in the comments.
export const BOT_PERSONAS: BotPersona[] = [
  // ── Day 0: the opening seven — the "day one" crowd, so they also carry the
  //    light early-community voice (meta: testing things, feature asks, 🫡).
  { key: "templetim", username: "marcr", name: "marcr", avatar: "/avatars/fan-01.webp",
    day: 0, cats: { take: 5, poll: 2, banter: 1, player: 1, casual: 2 },
    style: { caps: "proper" }, tempo: { cdH: 20, offChance: 0.25 } },
  { key: "kev", username: "jordo88", name: "Jordan", avatar: "/avatars/fan-04.webp",
    day: 0, cats: { take: 5, banter: 3, poll: 1, meta: 1, casual: 4 },
    tempo: { cdH: 5, offChance: 0.12 } },
  { key: "ellie", username: "ellieb14", name: "Ellie", avatar: "/avatars/fan-09.webp",
    day: 0, cats: { take: 5, poll: 2, casual: 3 },
    tempo: { cdH: 10, offChance: 0.2 } },
  { key: "nan", username: "suecarter", name: "suecarter", avatar: "/avatars/fan-11.webp",
    day: 0, cats: { banter: 4, take: 2, poll: 1, quiz: 1, meta: 1, casual: 2 },
    style: { caps: "proper" }, tempo: { cdH: 26, offChance: 0.35 } },
  { key: "banterfc", username: "tomo_9", name: "tomo", avatar: "/avatars/fan-12.webp",
    day: 0, cats: { banter: 6, poll: 1, quiz: 1, meta: 1, casual: 3 },
    style: { caps: "never" }, tempo: { cdH: 9, offChance: 0.2 } },
  { key: "sana", username: "sanak92", name: "sanaa", avatar: "/avatars/fan-14.webp",
    day: 0, cats: { player: 5, take: 3, poll: 1, casual: 2 },
    tempo: { cdH: 16, offChance: 0.3 } },
  { key: "cal", username: "cal_afc", name: "cally", avatar: "/avatars/fan-15.webp",
    day: 0, cats: { poll: 5, take: 3, banter: 1, meta: 1, casual: 2 },
    tempo: { cdH: 14, offChance: 0.3 } },
  // ── Day 2: four more voices join.
  { key: "dre", username: "dree_7", name: "dre", avatar: "/avatars/fan-02.webp",
    day: 2, cats: { take: 4, player: 4, poll: 1, banter: 1, casual: 2 },
    style: { caps: "never" }, tempo: { cdH: 18, offChance: 0.35 } },
  { key: "gaz", username: "gaz74", name: "gaz", avatar: "/avatars/fan-03.webp",
    day: 2, cats: { take: 5, player: 3, poll: 1, casual: 1 },
    tempo: { cdH: 22, offChance: 0.4 } },
  { key: "sam", username: "samlockett", name: "Sam Lockett", avatar: "/avatars/fan-05.webp",
    day: 2, cats: { take: 3, poll: 1, banter: 2, casual: 1 },
    style: { caps: "proper" }, tempo: { cdH: 30, offChance: 0.45 } },
  { key: "pete", username: "peteb_", name: "peteb", avatar: "/avatars/fan-08.webp",
    day: 2, cats: { take: 5, poll: 1, player: 2, casual: 2 },
    tempo: { cdH: 16, offChance: 0.3 } },
  // ── Day 4: the rest of the cast.
  { key: "barry", username: "bazwhu", name: "baz", avatar: "/avatars/fan-06.webp",
    day: 4, cats: { banter: 5, take: 2, poll: 1, casual: 3 },
    style: { caps: "never" }, tempo: { cdH: 12, offChance: 0.3 } },
  { key: "marta", username: "martaf", name: "marta", avatar: "/avatars/fan-07.webp",
    day: 4, cats: { take: 4, player: 3, poll: 1, casual: 1 },
    tempo: { cdH: 24, offChance: 0.4 } },
  { key: "wes", username: "wes0161", name: "wes", avatar: "/avatars/fan-10.webp",
    day: 4, cats: { banter: 4, take: 3, poll: 1, casual: 2 },
    tempo: { cdH: 20, offChance: 0.45 } },
  { key: "ces", username: "ces_10", name: "ces", avatar: "/avatars/fan-13.webp",
    day: 4, cats: { quiz: 5, take: 2, poll: 1, banter: 1, casual: 1 },
    tempo: { cdH: 18, offChance: 0.35 } },
  { key: "mo", username: "mo_hz", name: "mo", avatar: "/avatars/fan-16.webp",
    day: 4, cats: { player: 4, take: 4, poll: 1, banter: 1, casual: 2 },
    style: { caps: "never" }, tempo: { cdH: 15, offChance: 0.3 } },
];

// ── Random helpers (caller may inject a PRNG for deterministic backfills) ─────

type Rnd = () => number;
const pickFrom = <T>(rnd: Rnd, arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

/** Slot-filling context over the pool: hands out DISTINCT players per move. */
class Ctx {
  private used = new Set<number>();
  public ids: number[] = [];
  constructor(private pool: BotPoolPlayer[], private rnd: Rnd) {}
  private take(cands: BotPoolPlayer[]): BotPoolPlayer {
    const fresh = cands.filter((p) => !this.used.has(p.id));
    const p = pickFrom(this.rnd, fresh.length ? fresh : cands);
    this.used.add(p.id); this.ids.push(p.id);
    return p;
  }
  prem() { return this.take(this.pool.filter((p) => p.price >= 8.5 && p.pos !== "GK")); }
  premAtt() { return this.take(this.pool.filter((p) => p.price >= 8.5 && (p.pos === "MID" || p.pos === "FWD"))); }
  mid() { return this.take(this.pool.filter((p) => p.price >= 6.5 && p.price < 8.5 && p.pos !== "GK")); }
  cheap() { return this.take(this.pool.filter((p) => p.price <= 5.5 && p.pos !== "GK")); }
  enabler() { return this.take(this.pool.filter((p) => p.price <= 4.5)); }
  def() { return this.take(this.pool.filter((p) => p.pos === "DEF" && p.price >= 5)); }
  gk() { return this.take(this.pool.filter((p) => p.pos === "GK")); }
}

const money = (p: BotPoolPlayer) => `£${p.price.toFixed(1)}m`;

// ── The library ───────────────────────────────────────────────────────────────

interface Tpl {
  k: string;
  cat: BotCat;
  make: (c: Ctx, rnd: Rnd) => { text?: string; poll?: { question: string; options: string[] }; player?: number } | null;
}

const TAKES: Tpl[] = [
  { k: "trap", cat: "take", make: (c) => { const p = c.prem(); return { text: `${p.name} at ${money(p)} is the biggest trap in the game right now. Screenshot this.` }; } },
  { k: "dont-need", cat: "take", make: (c) => { const p = c.prem(); return { text: `Unpopular opinion: you don't need ${p.name}. That ${money(p)} builds you three proper mids and nobody's ready for that conversation.` }; } },
  { k: "template-prison", cat: "take", make: (c) => { const a = c.prem(), b = c.premAtt(); return { text: `The template is a prison. ${a.name}, ${b.name}, same XI everywhere you look. Where is the imagination?` }; } },
  { k: "fade-regret", cat: "take", make: (c) => { const p = c.mid(); return { text: `Everyone fading ${p.name} is going to be doing the walk of shame to the transfer screen by October. Some of us were here early.` }; } },
  { k: "double-up", cat: "take", make: (c) => { const p = c.mid(); return { text: `If you're not doubling up on ${p.club} you're not paying attention. ${p.name} is the way in.` }; } },
  { k: "price-value", cat: "take", make: (c) => { const a = c.mid(), b = c.prem(); return { text: `${a.name} at ${money(a)} does 80% of what ${b.name} does at ${money(b)}. Maths is free, people.` }; } },
  { k: "midprice-graveyard", cat: "take", make: (c) => { const p = c.mid(); return { text: `The ${money(p)} bracket is where FPL dreams go to die. ${p.name} will either win you your league or ruin your season. No in-between.` }; } },
  { k: "budget-gk", cat: "take", make: (c) => { const g = c.gk(); return { text: `Paying more than £4.5m for a keeper is financial self-harm. ${g.name} and move on with your life.` }; } },
  { k: "premium-def", cat: "take", make: (c) => { const d = c.def(); return { text: `Premium defenders are back. ${d.name} at ${money(d)} outscores half the mids people are agonising over. I said what I said.` }; } },
  { k: "three-premiums", cat: "take", make: (c) => { const a = c.prem(), b = c.premAtt(); return { text: `You cannot run ${a.name} AND ${b.name} and still have a bench that isn't made of cardboard. Pick one. Structure wins seasons.` }; } },
  { k: "eo-thinking", cat: "take", make: (c) => { const p = c.prem(); return { text: `If ${p.name} ends up in 60% of squads he's not a pick, he's insurance. You don't gain by owning him. You just stop losing. Think about it.` }; } },
  { k: "set-forget", cat: "take", make: (c) => { const p = c.mid(); return { text: `Hot take: the managers tinkering daily will finish below the ones who picked ${p.name} in July and went outside. Set it. Forget it.` }; } },
  { k: "rotation-risk", cat: "take", make: (c) => { const p = c.mid(); return { text: `${p.name} looks great until you remember what squad rotation does to people like us. Minutes are the only currency that matters.` }; } },
  { k: "one-season", cat: "take", make: (c) => { const p = c.cheap(); return { text: `Every season there's one ${money(p)} player who makes everyone who ignored him look silly. Writing it now: it's ${p.name}.` }; } },
  { k: "knee-jerk-pride", cat: "take", make: (c) => { const p = c.premAtt(); return { text: `Yes I've already rebuilt my squad four times. Yes ${p.name} is back in. No I will not be taking questions.` }; } },
  { k: "wildcard-hover", cat: "take", make: (c) => { const p = c.prem(); return { text: `Imagine wildcarding before a ball is kicked. Anyway here's my fifth draft this week, ${p.name} captain.` }; } },
  { k: "bench-philosophy", cat: "take", make: (c) => { const e = c.enabler(); return { text: `Your bench is not a museum. ${e.name} at ${money(e)} who plays beats a ${money(c.cheap())} name who doesn't. Playing minutes only.` }; } },
  { k: "club-bias", cat: "take", make: (c) => { const p = c.mid(); return { text: `Admit it: half of you own ${p.name} because you support ${p.club}, not because of any plan. Respect the honesty at least.` }; } },
  { k: "price-locked", cat: "take", make: (c) => { const p = c.premAtt(); return { text: `The longer you stare at ${p.name}'s price the more reasonable it looks. That's how they get you. ${money(p)}. For one player. Be serious.` }; } },
  { k: "differential-sermon", cat: "take", make: (c) => { const p = c.cheap(); return { text: `Nobody is talking about ${p.name} and that is EXACTLY why you should be. Low ownership is free rank, I don't make the rules.` }; } },
  { k: "talk-me-out", cat: "take", make: (c) => { const a = c.prem(), b = c.premAtt(); return { text: `Talk me out of ${a.name} AND ${b.name} in the same squad. You can't. That's the post.` }; } },
  { k: "eye-test", cat: "take", make: (c) => { const p = c.mid(); return { text: `The spreadsheet crowd won't like it but ${p.name} passes the eye test and that's enough for me. ${money(p)} well spent.` }; } },
  { k: "grudge", cat: "take", make: (c) => { const p = c.mid(); return { text: `${p.name} burned me last season and I don't care what the numbers say. Never again. This is a grudge squad and I'm at peace with it.` }; } },
  { k: "minutes-currency", cat: "take", make: (c) => { const a = c.cheap(), b = c.mid(); return { text: `${a.name} plays 90 every week. ${b.name} is better and plays 60. In this game you take the 90. Minutes are the whole ball game.` }; } },
];

const POLLS: Tpl[] = [
  { k: "first-captain", cat: "poll", make: (c) => { const a = c.premAtt(), b = c.premAtt(), d = c.premAtt(); return { poll: { question: "First captain of the season. Choose wisely.", options: [a.name, b.name, d.name, "Someone braver"] } }; } },
  { k: "one-spot", cat: "poll", make: (c) => { const a = c.mid(), b = c.mid(); return { poll: { question: `One spot left in midfield. ${money(a)} vs ${money(b)} — who's in?`, options: [a.name, b.name] } }; } },
  { k: "worth-it", cat: "poll", make: (c) => { const p = c.prem(); return { poll: { question: `${p.name} at ${money(p)}. Honest answers only.`, options: ["Essential", "Trap", "Wait and see"] } }; } },
  { k: "tinker-count", cat: "poll", make: () => ({ poll: { question: "How many times have you rebuilt your squad already?", options: ["0 — locked in", "1–5", "6–20", "I've lost count and my mind"] } }) },
  { k: "structure", cat: "poll", make: () => ({ poll: { question: "What's the right structure this season?", options: ["3 premiums, cheap bench", "2 premiums, mid-price spread", "No premiums, chaos", "Structure is a myth"] } }) },
  { k: "def-or-att", cat: "poll", make: (c) => { const d = c.def(), m = c.mid(); return { poll: { question: `Same money, one pick: ${d.name} (${money(d)}) or ${m.name} (${money(m)})?`, options: [d.name, m.name] } }; } },
  { k: "budget-punt", cat: "poll", make: (c) => { const a = c.cheap(), b = c.cheap(), e = c.enabler(); return { poll: { question: "Best budget punt in the game?", options: [a.name, b.name, e.name] } }; } },
  { k: "deadline-style", cat: "poll", make: () => ({ poll: { question: "Deadline day style check:", options: ["Sorted days before", "Final hour panic", "30 seconds to spare", "Missed it, again"] } }) },
  { k: "own-fave", cat: "poll", make: () => ({ poll: { question: "Do you pick players from the club you support?", options: ["Always, heart first", "Never, points only", "Only when it's justified", "Captain, every week"] } }) },
  { k: "quiz-or-luck", cat: "poll", make: () => ({ poll: { question: "What wins a fantasy league?", options: ["Football knowledge", "Ice-cold discipline", "Pure luck", "Group chat mind games"] } }) },
  { k: "keeper-spend", cat: "poll", make: (c) => { const g = c.gk(); return { poll: { question: `How much is too much for a keeper? ${g.name} owners look away.`, options: ["£4.0m max", "£4.5m sweet spot", "£5.0m+ if he's elite", "Whoever's left with £0.5m"] } }; } },
  { k: "chip-plan", cat: "poll", make: () => ({ poll: { question: "When does the first chip come out?", options: ["Early, no fear", "Save everything til spring", "The moment I panic", "What's a chip"] } }) },
];

const PLAYERS: Tpl[] = [
  { k: "spotlight-early", cat: "player", make: (c) => { const p = c.mid(); return { player: p.id, text: `Watch ${p.name} this season. ${money(p)}, proper role, and nobody's talking about him. Screenshot this.` }; } },
  { k: "spotlight-value", cat: "player", make: (c) => { const p = c.cheap(); return { player: p.id, text: `${p.name} at ${money(p)} might be the best value in the entire game. The spreadsheet doesn't lie.` }; } },
  { k: "spotlight-premium", cat: "player", make: (c) => { const p = c.prem(); return { player: p.id, text: `Fine. I'll say it. ${p.name} is worth every penny of ${money(p)} and I'm done pretending otherwise.` }; } },
  { k: "spotlight-shortlist", cat: "player", make: (c) => { const p = c.mid(); return { player: p.id, text: `${p.name} just went on the shortlist. Something's brewing at ${p.club} and I want to be early, not right.` }; } },
  { k: "spotlight-enabler", cat: "player", make: (c) => { const p = c.enabler(); return { player: p.id, text: `Your whole squad structure depends on finding one ${p.name}. ${money(p)}, plays every week, asks for nothing. Beautiful.` }; } },
  { k: "spotlight-fade", cat: "player", make: (c) => { const p = c.prem(); return { player: p.id, text: `I'm out on ${p.name} at ${money(p)} and it's going to age either brilliantly or horrifically. No middle ground. See you in May.` }; } },
];

const BANTER: Tpl[] = [
  { k: "vibes-squad", cat: "banter", make: () => ({ text: "My squad is 90% vibes, 10% budget defenders, and I've never felt more alive." }) },
  { k: "family", cat: "banter", make: () => ({ text: "Day 4 of staring at my fantasy squad instead of talking to my family. They understand. They have to." }) },
  { k: "gk-pain", cat: "banter", make: () => ({ text: "You haven't known true pain until your entire budget went on attackers and your keeper costs less than a meal deal." }) },
  { k: "group-chat", cat: "banter", make: () => ({ text: "League chat quiet now but wait until GW1 finishes and someone's captain blanks. Best entertainment on earth and it's free." }) },
  { k: "one-more-look", cat: "banter", make: () => ({ text: "\"Just one more look at my team\" — me, 45 minutes ago, still here, three transfers deep, ruined everything." }) },
  { k: "mate-league", cat: "banter", make: () => ({ text: "There's no bond stronger than a mini-league rivalry and no betrayal deeper than a friend copying your team. I know what you did." }) },
  { k: "pre-season-form", cat: "banter", make: () => ({ text: "Basing your entire squad on pre-season friendlies is astrology for football fans. Anyway, I've done it, we ride at dawn." }) },
  { k: "bench-curse", cat: "banter", make: (c) => { const p = c.cheap(); return { text: `Already know exactly how this goes: I bench ${p.name}, he hauls. I start him, he does absolutely nothing. The universe keeps receipts.` }; } },
  { k: "budget-left", cat: "banter", make: () => ({ text: "£0.5m left in the bank. Could've planned better. Won't. This is who I am." }) },
  { k: "spreadsheet", cat: "banter", make: () => ({ text: "Started a spreadsheet to pick my team. The spreadsheet now has 9 tabs, conditional formatting, and I'm further from a decision than ever." }) },
  { k: "deadline-dream", cat: "banter", make: () => ({ text: "Anyone else already had the nightmare where you miss the deadline with 11 in your starting XI injured? Just me? Cool cool cool." }) },
  { k: "knowledge-flex", cat: "banter", make: () => ({ text: "The quiz round in this app is dangerously addictive. Went in for one question, came out 20 minutes later a changed manager." }) },
  { k: "draft-number", cat: "banter", make: (_c, rnd) => { const n = 7 + Math.floor(rnd() * 34); return { text: `Draft ${n} is THE one. I can feel it. (I said this about draft ${Math.max(2, n - 5)} as well but this time it's different)` }; } },
  { k: "week-late", cat: "banter", make: () => ({ text: "The season starting a week late because of the World Cup just means seven extra days of tinkering. Dangerous for people like us." }) },
  { k: "zen-lie", cat: "banter", make: () => ({ text: "Last year I sold my best player the week before he went off. So this season I'm touching nothing. Total zen. (I've made six changes today)" }) },
  { k: "2am-bench", cat: "banter", make: () => ({ text: "We've reached the \"waking up at 2am to swap two bench players\" stage of pre season. No regrets. Some regrets." }) },
];

/** Getting-started chatter — the dominant voice until the weekend (founder,
 *  5 Aug): short, ordinary, half-formed. People are joining, poking at the
 *  app and thinking out loud. Some posts should be good; most should be
 *  ordinary; questions are allowed to get no answer. */
const CASUAL: Tpl[] = [
  { k: "cas-ripup", cat: "casual", make: () => ({ text: "nah I'm ripping this up again" }) },
  { k: "cas-no-prem", cat: "casual", make: (c) => { const p = c.prem(); return { text: `anyone actually going without ${p.name}?` }; } },
  { k: "cas-min62", cat: "casual", make: (c) => { const p = c.premAtt(); return { text: `${p.name} captain feels clever until minute 62` }; } },
  { k: "cas-rate-mid", cat: "casual", make: () => ({ text: "rate this midfield pls" }) },
  { k: "cas-05-left", cat: "casual", make: () => ({ text: "I have £0.5m left and no idea where to use it" }) },
  { k: "cas-suddenly", cat: "casual", make: (c) => { const p = c.mid(); return { text: `why is everyone suddenly on ${p.name}?` }; } },
  { k: "cas-bench-spot", cat: "casual", make: () => ({ text: "still can't decide my last bench spot. it doesn't matter. I know it doesn't matter" }) },
  { k: "cas-see-squads", cat: "casual", make: () => ({ text: "just realised you can see everyone's squads on here. dangerous" }) },
  { k: "cas-quiz-rated", cat: "casual", make: () => ({ text: "the quiz on here is rated btw" }) },
  { k: "cas-who-follow", cat: "casual", make: () => ({ text: "who do I follow on here for actual good takes" }) },
  { k: "cas-two-names", cat: "casual", make: (c) => { const a = c.enabler(), b = c.cheap(); return { text: `down to ${a.name} or ${b.name} for the last slot and I've been staring at it for 20 minutes` }; } },
  { k: "cas-lunch", cat: "casual", make: () => ({ text: "first proper look at the app on my lunch break. already made two changes" }) },
  { k: "cas-league-check", cat: "casual", make: () => ({ text: "is there a way to see who's already in my league or am I being slow" }) },
  { k: "cas-morning", cat: "casual", make: () => ({ text: "morning. changed my captain again. don't ask" }) },
  { k: "cas-overthink", cat: "casual", make: (c) => { const p = c.def(); return { text: `talked myself out of ${p.name} twice today. he's probably back in by tonight` }; } },
  { k: "cas-price-shock", cat: "casual", make: (c) => { const p = c.prem(); return { text: `${money(p)} for ${p.name}. actually laughed out loud` }; } },
  { k: "cas-38-0", cat: "casual", make: () => ({ text: "just lost a 38-0 run I had no business losing. not talking about it" }) },
  { k: "cas-h2h", cat: "casual", make: () => ({ text: "anyone up for a quiz head to head or is everyone still drafting" }) },
  { k: "cas-quiz-hard", cat: "casual", make: () => ({ text: "whoever wrote the rivalries quiz needs to apologise" }) },
];

/** The early-community voice — a NEW platform's opening week, used sparingly
 *  (low weights, day-0 personas only). Honest asks and mild criticism beat
 *  praise; nobody trusts a feed that loves its own app. */
const META: Tpl[] = [
  { k: "meta-hello", cat: "meta", make: () => ({ text: "New here. Came for the quiz, stayed because there's a whole fantasy game attached. Alright then 🫡" }) },
  { k: "meta-poll-test", cat: "meta", make: () => ({ text: "Testing the polls on here. If they work, I apologise in advance for the amount of them you're about to see." }) },
  { k: "meta-pin-rivals", cat: "meta", make: () => ({ text: "Feature request: let me pin my league rivals to the top of the feed so I can monitor their mistakes in real time." }) },
  { k: "meta-shame", cat: "meta", make: () => ({ text: "Half my league still hasn't picked a squad. This app should shame them harder, the gentle nudges are not working." }) },
  { k: "meta-day-ones", cat: "meta", make: () => ({ text: "Quiet in here for now but screenshot this feed when the season kicks off. Day ones will remember 🫡" }) },
  { k: "meta-early-badge", cat: "meta", make: () => ({ text: "Petition for some kind of badge for accounts that were here before GW1. We built this place (we posted a few polls)." }) },
];

/** Quiz brags need a real pack title (passed in from quiz_packs) so the tile
 *  points at something you can actually go and play. */
const QUIZ_SCORES: [number, number][] = [[8, 10], [9, 10], [10, 10], [7, 10], [9, 11], [10, 11], [11, 11], [8, 11]];

const ALL_TPLS: Tpl[] = [...TAKES, ...POLLS, ...PLAYERS, ...BANTER, ...META, ...CASUAL];

/** Template-key prefix → category, so the tick can pick a fitting reply for a
 *  post it only knows by its dedupe key. */
const CAT_BY_KEY = new Map<string, BotCat>(ALL_TPLS.map((t) => [t.k, t.cat]));
export const catOfTemplateKey = (k: string | undefined): BotCat | null =>
  k ? (CAT_BY_KEY.get(k.split(":")[0]) ?? (k.startsWith("quiz:") ? "quiz" : null)) : null;

/** Grammar variance so sixteen accounts don't share one copy editor — driven
 *  by the persona's style. caps "never": always drops the opening capital and
 *  usually the final full stop. caps "proper": text left alone. Default: the
 *  light random pass. Never touches player names (only the first character,
 *  apostrophes and the final character are in play). */
export function roughen(text: string, rnd: Rnd, style?: BotPersona["style"]): string {
  let t = text;
  if (style?.caps === "proper") return t;
  const never = style?.caps === "never";
  if ((never || rnd() < 0.18) && /^[A-Z][a-z]/.test(t)) t = t[0].toLowerCase() + t.slice(1);
  if ((never ? rnd() < 0.7 : rnd() < 0.12) && t.endsWith(".")) t = t.slice(0, -1);
  if (rnd() < 0.08 && /\b(\w+)'(\w+)\b/.test(t)) t = t.replace(/\b(\w+)'(\w+)\b/, "$1$2");
  return t;
}

// ── Generation ────────────────────────────────────────────────────────────────

function pickCat(persona: BotPersona, rnd: Rnd, allowQuiz: boolean, nowMs: number): BotCat {
  const entries = (Object.entries(persona.cats) as [BotCat, number][])
    .filter(([cat]) => allowQuiz || cat !== "quiz");
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rnd() * total;
  let cat = entries[entries.length - 1][0];
  for (const [c, w] of entries) { roll -= w; if (roll <= 0) { cat = c; break; } }
  // Getting-started phase: mostly short ordinary chatter, and a feed of
  // brand-new users doesn't open with a wall of tidy discussion polls.
  if (nowMs < CHATTER_PHASE_UNTIL_MS) {
    if (rnd() < 0.45) return "casual";
    if (cat === "poll" && rnd() < 0.7) return "casual";
  }
  return cat;
}

/**
 * Generate one move for a persona, avoiding dedupe keys the persona has already
 * used. `quizTitles` are real published quiz pack names; when empty, quiz brags
 * fall back to the knowledge-round shape. Returns null if nothing fresh fits.
 */
export function generateBotMove(
  persona: BotPersona,
  pool: BotPoolPlayer[],
  usedKeys: Set<string>,
  quizTitles: string[],
  rnd: Rnd = Math.random,
  allowQuiz = true,
  nowMs: number = Date.now(),
): BotMove | null {
  for (let attempt = 0; attempt < 12; attempt++) {
    const cat = pickCat(persona, rnd, allowQuiz && quizTitles.length > 0, nowMs);

    if (cat === "quiz") {
      const [correct, total] = pickFrom(rnd, QUIZ_SCORES);
      const title = pickFrom(rnd, quizTitles);
      const k = `quiz:${title}:${correct}`;
      if (usedKeys.has(k)) continue;
      return { personaKey: persona.key, type: "quiz_result", payload: { correct, total, title, game: "quiz", k } };
    }

    const tpls = ALL_TPLS.filter((t) => t.cat === cat);
    if (!tpls.length) continue;
    const tpl = pickFrom(rnd, tpls);
    const ctx = new Ctx(pool, rnd);
    const made = tpl.make(ctx, rnd);
    if (!made) continue;
    const k = `${tpl.k}:${ctx.ids.join("-")}`;
    if (usedKeys.has(k)) continue;

    const payload: Record<string, unknown> = { k };
    // Takes/banter/meta/casual get the persona's roughness pass; player
    // spotlights and poll questions stay clean (they sit next to structured UI).
    const roughCats: BotCat[] = ["take", "banter", "meta", "casual"];
    if (made.text) payload.text = roughCats.includes(cat) ? roughen(made.text, rnd, persona.style) : made.text;
    if (made.poll) payload.poll = made.poll;
    if (made.player != null) payload.player = made.player;
    return { personaKey: persona.key, type: "post", payload };
  }
  return null;
}

// ── Replies ───────────────────────────────────────────────────────────────────
// Short comments the personas drop under recent feed items. Grouped by what the
// TARGET is, so a reply can never contradict content it can't see: template
// posts get family-matched lines, structural events (quiz scores, squad
// reveals, polls) get lines grounded in what the card itself shows. Free-text
// posts from real users get reactions, never replies (a generic reply under a
// specific post is the fastest way to read as a bot).

const REPLY_AGREE = [
  "this. finally someone said it",
  "correct, no notes",
  "been saying this for weeks 🫡",
  "so true it hurts",
  "the only sensible post on this feed today",
  "hate that you're right",
  "sensible. suspiciously sensible",
];
const REPLY_DISAGREE = [
  "wild take. screenshotted for October 💀",
  "respectfully, no",
  "this will age like milk and I'm here for it",
  "the eye test says otherwise but go off",
  "bookmarking this so we can revisit in a month",
  "strong words from someone whose keeper costs £4.0m",
  "brave post. wrong, but brave",
];
const REPLY_BANTER = [
  "😭 too real",
  "why is this just me",
  "the accuracy 💀",
  "read this at 2am while editing my draft. anyway",
  "deleting this app (opening it again in ten minutes)",
];
const REPLY_PLAYER = [
  "shortlisted 👀",
  "he's in my draft, keep it quiet",
  "was early on him too, welcome",
  "price is right, the minutes worry me",
];
const REPLY_QUIZ = [
  "alright calm down 😭",
  "decent. the last one's a trap and you know it",
  "rematch when",
  "ok that's actually a good score and I hate it",
  "posting your scores now are we. bold",
  "fine I'll go beat it, give me ten minutes",
  "the speed bonus is doing some lifting there I reckon",
  "why don't you play me?",
  "play me then 👀",
  "name the quiz and the time",
];
const REPLY_SQUAD = [
  "bench is brave",
  "solid spine, the budget end scares me",
  "no notes on the front line. some notes on the back",
  "who gets the armband in this though",
  "seen worse. owned worse",
  "that defence is a leap of faith and I respect it",
  "midfield is doing all the heavy lifting here",
  "the template creeps in everywhere I look 👀",
  "premium heavy. brave or broke by October",
];
const REPLY_META = [
  "🫡",
  "day ones remember",
  "seconding this, someone build it",
];

const REPLY_BY_CAT: Partial<Record<BotCat, string[]>> = {
  banter: REPLY_BANTER, player: REPLY_PLAYER, meta: REPLY_META, quiz: REPLY_QUIZ,
};

// ── Drifters ──────────────────────────────────────────────────────────────────
// The 50 seed accounts double as one-line-a-day visitors, so the feed shows NEW
// names every day instead of the same cast on every scroll (founder, 5 Aug).
// A drifter says one short thing — or posts a real quiz score — and is gone.

const DRIFTER_LINES = [
  "this app is dangerous",
  "squad done. see everyone in august",
  "one more quiz then bed",
  "up at half seven doing football quizzes. fine",
  "first squad in. no notes",
  "why don't any of my friends have this yet",
  "found the fantasy bit. there goes the evening",
  "quiz first, squad after. priorities",
  "didn't mean to spend an hour on here but here we are",
  "new here, who's good to follow",
  "the gameday quiz is going to ruin my matchdays and I accept that",
  "just me or is picking a bench harder than picking the eleven",
];

/** Hash a string to [0,1) — used to pick the day's drifters deterministically. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/** One drifter move: usually a quiz score on a REAL pack, sometimes a one-liner.
 *  k is day-scoped so a drifter can never post twice in one day. */
export function generateDrifterMove(
  day: string, rnd: Rnd, quizTitles: string[],
): { type: "post" | "quiz_result"; payload: Record<string, unknown> } {
  if (quizTitles.length && rnd() < 0.55) {
    const [correct, total] = pickFrom(rnd, QUIZ_SCORES);
    const title = pickFrom(rnd, quizTitles);
    return { type: "quiz_result", payload: { correct, total, title, game: "quiz", k: `drift:${day}` } };
  }
  return { type: "post", payload: { text: pickFrom(rnd, DRIFTER_LINES), k: `drift:${day}` } };
}

export interface ReplyTarget {
  /** fantasy_feed_events.type of the target row. */
  type: string;
  /** The target's payload.k, when the author is a bot (template posts). */
  k?: string;
  /** Poll option labels, when the target is a poll post. */
  pollOptions?: string[];
}

/** A fitting one-liner for a feed item, or null when nothing safe fits. */
export function generateBotReply(target: ReplyTarget, rnd: Rnd = Math.random): string | null {
  if (target.type === "quiz_result") return pickFrom(rnd, REPLY_QUIZ);
  if (target.type === "squad_complete") return pickFrom(rnd, REPLY_SQUAD);
  if (target.type !== "post") return null;
  if (target.pollOptions?.length) {
    const opt = pickFrom(rnd, target.pollOptions);
    return pickFrom(rnd, [
      `${opt}, and it's not close`,
      `went ${opt}, no regrets`,
      `${opt}. next question`,
      `anyone not voting ${opt} is fooling themselves`,
    ]);
  }
  const cat = catOfTemplateKey(target.k);
  if (!cat) return null; // a real user's free-text post — react, don't reply
  if (cat === "take") return pickFrom(rnd, rnd() < 0.45 ? REPLY_AGREE : REPLY_DISAGREE);
  const lib = REPLY_BY_CAT[cat];
  return lib ? pickFrom(rnd, lib) : null;
}
