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
}
export type BotCat = "take" | "poll" | "player" | "banter" | "quiz";

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

export const BOT_PERSONAS: BotPersona[] = [
  { key: "templetim", username: "templetim", name: "Template Tim", avatar: "/avatars/fan-01.webp",
    cats: { take: 5, poll: 3, banter: 1, player: 1 } },
  { key: "dre", username: "differentialdre", name: "Dre ✨", avatar: "/avatars/fan-02.webp",
    cats: { take: 4, player: 4, poll: 2, banter: 1 } },
  { key: "gaz", username: "xg_gaz", name: "Gaz", avatar: "/avatars/fan-03.webp",
    cats: { take: 5, player: 3, poll: 2 } },
  { key: "kev", username: "kneejerkkev", name: "Knee Jerk Kev", avatar: "/avatars/fan-04.webp",
    cats: { take: 5, banter: 3, poll: 2 } },
  { key: "sam", username: "setforgetsam", name: "Sam 🔒", avatar: "/avatars/fan-05.webp",
    cats: { take: 3, poll: 2, banter: 2 } },
  { key: "barry", username: "benchpointsbarry", name: "Barry", avatar: "/avatars/fan-06.webp",
    cats: { banter: 5, take: 2, poll: 1 } },
  { key: "marta", username: "minutesmarta", name: "Marta", avatar: "/avatars/fan-07.webp",
    cats: { take: 4, player: 3, poll: 2 } },
  { key: "pete", username: "pricewatchpete", name: "Pete 📈", avatar: "/avatars/fan-08.webp",
    cats: { take: 5, poll: 2, player: 2 } },
  { key: "ellie", username: "eo_ellie", name: "Ellie", avatar: "/avatars/fan-09.webp",
    cats: { take: 5, poll: 3 } },
  { key: "wes", username: "wildcardwes", name: "Wes 🃏", avatar: "/avatars/fan-10.webp",
    cats: { banter: 4, take: 3, poll: 1 } },
  { key: "nan", username: "fpl_nan", name: "FPL Nan 🍪", avatar: "/avatars/fan-11.webp",
    cats: { banter: 4, take: 3, poll: 2, quiz: 1 } },
  { key: "banterfc", username: "banter_fc", name: "Banter FC", avatar: "/avatars/fan-12.webp",
    cats: { banter: 6, poll: 2, quiz: 1 } },
  { key: "ces", username: "quizzyces", name: "Ces 🧠", avatar: "/avatars/fan-13.webp",
    cats: { quiz: 5, take: 2, poll: 2, banter: 1 } },
  { key: "sana", username: "scoutsana", name: "Sana", avatar: "/avatars/fan-14.webp",
    cats: { player: 5, take: 3, poll: 2 } },
  { key: "cal", username: "captaincal", name: "Cal", avatar: "/avatars/fan-15.webp",
    cats: { poll: 5, take: 3, banter: 2 } },
  { key: "mo", username: "bargain_mo", name: "Mo", avatar: "/avatars/fan-16.webp",
    cats: { player: 4, take: 4, poll: 1, banter: 1 } },
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
  { k: "mate-league", cat: "banter", make: () => ({ text: "There's no bond stronger than a mini-league rivalry and no betrayal deeper than your mate copying your team. I know what you did." }) },
  { k: "pre-season-form", cat: "banter", make: () => ({ text: "Basing your entire squad on pre-season friendlies is astrology for football fans. Anyway, I've done it, we ride at dawn." }) },
  { k: "bench-curse", cat: "banter", make: (c) => { const p = c.cheap(); return { text: `Already know exactly how this goes: I bench ${p.name}, he hauls. I start him, he does absolutely nothing. The universe keeps receipts.` }; } },
  { k: "budget-left", cat: "banter", make: () => ({ text: "£0.5m left in the bank. Could've planned better. Won't. This is who I am." }) },
  { k: "spreadsheet", cat: "banter", make: () => ({ text: "Started a spreadsheet to pick my team. The spreadsheet now has 9 tabs, conditional formatting, and I'm further from a decision than ever." }) },
  { k: "deadline-dream", cat: "banter", make: () => ({ text: "Anyone else already had the nightmare where you miss the deadline with 11 in your starting XI injured? Just me? Cool cool cool." }) },
  { k: "knowledge-flex", cat: "banter", make: () => ({ text: "The quiz round in this app is dangerously addictive. Went in for one question, came out 20 minutes later a changed manager." }) },
];

/** Quiz brags need a real pack title (passed in from quiz_packs) so the tile
 *  points at something you can actually go and play. */
const QUIZ_SCORES: [number, number][] = [[8, 10], [9, 10], [10, 10], [7, 10], [9, 11], [10, 11], [11, 11], [8, 11]];

const ALL_TPLS: Tpl[] = [...TAKES, ...POLLS, ...PLAYERS, ...BANTER];

// ── Generation ────────────────────────────────────────────────────────────────

function pickCat(persona: BotPersona, rnd: Rnd, allowQuiz: boolean): BotCat {
  const entries = (Object.entries(persona.cats) as [BotCat, number][])
    .filter(([cat]) => allowQuiz || cat !== "quiz");
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rnd() * total;
  for (const [cat, w] of entries) { roll -= w; if (roll <= 0) return cat; }
  return entries[entries.length - 1][0];
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
): BotMove | null {
  for (let attempt = 0; attempt < 12; attempt++) {
    const cat = pickCat(persona, rnd, allowQuiz && quizTitles.length > 0);

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
    if (made.text) payload.text = made.text;
    if (made.poll) payload.poll = made.poll;
    if (made.player != null) payload.player = made.player;
    return { personaKey: persona.key, type: "post", payload };
  }
  return null;
}
