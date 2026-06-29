/**
 * x-engage.mjs — find viral football tweets and draft a REPLY or QUOTE so we ride their reach.
 *
 * APPROVAL-GATED: this only queues drafts and pushes them to Telegram with buttons. NOTHING
 * posts without your tap (engagement with other accounts is the riskiest thing we do, so it is
 * never auto-posted). On approval, x-telegram's poller posts it AS a reply/quote of the target.
 *
 * Usage:
 *   node --env-file=.env.local scripts/x-engage.mjs           # search, draft, push up to 3
 *   node --env-file=.env.local scripts/x-engage.mjs --dry      # show drafts, save/push nothing
 *   node --env-file=.env.local scripts/x-engage.mjs --n 2      # how many to surface
 */
import { PATHS, loadJSON, saveJSON, searchViral, draftEngagement, charLen, shortId } from "./lib/x-watch.mjs";

const DRY = process.argv.includes("--dry");
const flag = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const WANT = parseInt(flag("--n", "3"), 10); // surface up to this many (the high bar may yield fewer)
const TG = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
if (!TG || !CHAT) { console.error("✗ Missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID"); process.exit(1); }

// A few angles so we cover the day's big moments without leaning on one query.
const QUERIES = [
  'World Cup OR "round of 32" OR "round of 16" OR knockouts',
  "Messi OR Mbappe OR Modric OR Haaland OR Ronaldo OR Yamal",
  "Canada OR USA OR Brazil OR Argentina OR England OR France World Cup",
];

const tg = (m, b) => fetch(`https://api.telegram.org/bot${TG}/${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const draftButtons = (id) => ({ inline_keyboard: [
  [{ text: "✅ Post", callback_data: `post:${id}` }],
  [{ text: "💬 Reword / Feedback", callback_data: `fb:${id}` }],
  [{ text: "✏️ Edit", callback_data: `edit:${id}` }, { text: "🗑 Decline", callback_data: `skip:${id}` }],
] });

const queue = loadJSON(PATHS.queue, []);
const state = loadJSON(PATHS.state, {});
state.engage ??= { done: [] };
const seen = new Set([...queue.map((d) => d.engage?.targetId).filter(Boolean), ...(state.engage.done || [])]);

// Gather targets across queries, dedupe by tweet id, drop ones we've already considered.
const byId = new Map();
for (const q of QUERIES) {
  try { for (const t of await searchViral({ query: q, minFollowers: 80000, max: 100 })) if (!byId.has(t.id)) byId.set(t.id, t); }
  catch (e) { console.error(`search "${q.slice(0, 28)}…": ${e.message}`); }
}
const targets = [...byId.values()].filter((t) => !seen.has(t.id)).sort((a, b) => b.eng - a.eng);
console.log(`${targets.length} fresh viral target(s). Drafting until ${WANT} usable…\n`);

let made = 0;
for (const t of targets) {
  if (made >= WANT) break;
  let d; try { d = await draftEngagement(t); } catch (e) { console.error(`@${t.handle}: ${e.message}`); continue; }
  state.engage.done.push(t.id); // mark considered (so we don't redraft it next run)
  if (!d.usable || !d.text) { console.log(`  @${t.handle} skip (${d.reason || "not usable"})`); continue; }
  const draftChars = charLen(d.text);
  if (draftChars > 280) { console.log(`  @${t.handle} skip (over 280)`); continue; }
  const id = "eng" + shortId(t.id);
  const draft = {
    id, status: "pending", createdAt: new Date().toISOString(), origin: "x-engage",
    source: { username: t.handle, name: t.name, url: t.url, tweetId: t.id },
    engage: { kind: d.kind, targetId: t.id, targetUrl: t.url, targetHandle: t.handle, targetText: t.text.slice(0, 220) },
    draft: d.text, draftChars, why: d.reason,
  };
  console.log(`  [${d.kind}] ${id} → @${t.handle} (${(t.followers / 1000).toFixed(0)}k, eng ${t.eng})\n    them: ${t.text.replace(/\n/g, " ").slice(0, 90)}\n    us:   ${d.text.replace(/\n/g, " ")}`);
  made++;
  // Just QUEUE it. The x-telegram poller trickles drafts to Telegram one at a time (engagement
  // jumps the queue since it's time-sensitive), so they never arrive in a clump.
  if (!DRY) queue.push(draft);
}

if (state.engage.done.length > 500) state.engage.done = state.engage.done.slice(-500); // keep bounded
if (!DRY) { saveJSON(PATHS.queue, queue); saveJSON(PATHS.state, state); }
console.log(`\n${DRY ? "🛑 DRY — nothing saved/pushed" : made + " engagement draft(s) queued (the poller trickles them to Telegram)"}`);
