/**
 * bots.ts — the FPL-Twitter persona accounts for the fantasy feed.
 *
 * Creates the 16 personas from src/lib/fantasy/botContent.ts as real accounts
 * (auth user + profile with source='bot', is_seed=true, a proper @username and
 * a valid squad), and can backfill an opening stretch of posts/polls/reactions
 * so the feed reads like a live timeline from the first visit. The hourly cron
 * (/api/cron/fantasy-bots) keeps them talking after that.
 *
 *   ./scripts/fantasy/bots.sh --dry            # show what would happen
 *   ./scripts/fantasy/bots.sh                  # create the persona accounts
 *   ./scripts/fantasy/bots.sh --backfill 40    # + 40 posts over the past 36h
 *   ./scripts/fantasy/bots.sh --with-quiz      # allow quiz_result rows (needs mig 248 + deployed renderer)
 *   ./scripts/fantasy/bots.sh --seed-handles   # give the old seed accounts usernames
 *   ./scripts/fantasy/bots.sh --teardown       # remove every bot + their rows
 *
 * GUARDRAIL (same as seed-users.ts): no fabricated points or ranks, and the
 * voice never invents match results or news — see botContent.ts.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { validateSquad, smartDefaults, BASELINE_CREDITS_PER_GW, type PoolPlayer } from "../../src/lib/fantasy/engine";
import { solvePreset, PRESETS, type PresetPlayer } from "../../src/lib/fantasy/presets";
import { BOT_PERSONAS, activeBotPersonas, generateBotMove, londonHour, type BotPoolPlayer } from "../../src/lib/fantasy/botContent";

const DRY = process.argv.includes("--dry");
const TEARDOWN = process.argv.includes("--teardown");
const SEED_HANDLES = process.argv.includes("--seed-handles");
const WITH_QUIZ = process.argv.includes("--with-quiz");
const backfillArg = process.argv.indexOf("--backfill");
const BACKFILL = backfillArg >= 0 ? Number(process.argv[backfillArg + 1]) : 0;
const BOT_DOMAIN = "bots.yourscore.app";

// Deterministic PRNG (mulberry32, same as seed-users) so a re-run reasons the same.
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260804);
const shuffle = <T>(arr: T[]): T[] => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

interface PoolFile { players: { id: number; smId: number; name: string; club: string; clubId: number; pos: PoolPlayer["pos"]; price: number }[] }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Teardown: bots only (source='bot') — the 50 seed accounts are untouched ─
  if (TEARDOWN) {
    const { data: botRows } = await db.from("profiles").select("id").eq("source", "bot");
    const ids = ((botRows ?? []) as { id: string }[]).map((b) => b.id);
    console.log(`Tearing down ${ids.length} bot accounts…`);
    if (ids.length && !DRY) {
      await db.from("fantasy_feed_poll_votes").delete().in("user_id", ids);
      await db.from("fantasy_feed_likes").delete().in("user_id", ids);
      await db.from("fantasy_feed_events").delete().in("actor_id", ids); // votes/likes on their posts cascade
      await db.from("user_follows").delete().in("follower_id", ids);
      await db.from("user_follows").delete().in("followee_id", ids);
      await db.from("fantasy_squads").delete().in("user_id", ids);
      await db.from("profiles").delete().in("id", ids);
      for (const id of ids) { try { await db.auth.admin.deleteUser(id); } catch { /* already gone */ } }
    }
    console.log(DRY ? "[DRY] no deletes." : "Teardown done.");
    return;
  }

  // ── Seed handles: usernames for the original 50 seed accounts ──────────────
  // The feed now renders @handles (Twitter grammar); seeds were created with
  // username null and would read as handle-less accounts forever.
  if (SEED_HANDLES) {
    const { data: seeds } = await db.from("profiles")
      .select("id, display_name, username").eq("is_seed", true).eq("source", "seed");
    const { data: allNames } = await db.from("profiles").select("username").not("username", "is", null);
    const taken = new Set(((allNames ?? []) as { username: string | null }[])
      .map((r) => (r.username ?? "").toLowerCase()).filter(Boolean));
    let set = 0;
    for (const s of (seeds ?? []) as { id: string; display_name: string | null; username: string | null }[]) {
      if (s.username) continue; // already has one
      const base = (s.display_name ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 18);
      if (base.length < 2) continue;
      let handle = base;
      let bump = 0;
      while (taken.has(handle.toLowerCase()) && bump < 50) handle = `${base}${Math.floor(rnd() * 99) + 1}`.slice(0, 20), bump++;
      if (taken.has(handle.toLowerCase())) continue;
      taken.add(handle.toLowerCase());
      set++;
      if (DRY) { if (set <= 8) console.log(`  ${s.display_name} → @${handle}`); continue; }
      const { error } = await db.from("profiles").update({ username: handle }).eq("id", s.id);
      if (error) console.error(`  ! ${s.display_name}: ${error.message}`);
    }
    console.log(`${DRY ? "[DRY] " : ""}Handles set for ${set} seed accounts.`);
    return;
  }

  // ── Create the personas (idempotent — existing usernames are kept) ─────────
  const poolFile = JSON.parse(readFileSync(join(process.cwd(), "src/data/fantasy/pool.json"), "utf8")) as PoolFile;
  const enginePool: PoolPlayer[] = poolFile.players.map((p) => ({
    id: p.id, smId: p.smId, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos,
    priceTenths: Math.round(p.price * 10),
  }));
  const contentPool: BotPoolPlayer[] = poolFile.players.map((p) => ({ id: p.id, name: p.name, club: p.club, pos: p.pos, price: p.price }));
  const presetPool: PresetPlayer[] = enginePool.map((p) => ({ id: p.id, pos: p.pos, clubId: p.clubId, priceTenths: p.priceTenths }));
  const premiums = shuffle(enginePool.filter((p) => p.priceTenths >= 90)).map((p) => p.id);

  const { data: existingBots } = await db.from("profiles").select("id, username").eq("source", "bot");
  const existingByUsername = new Map(((existingBots ?? []) as { id: string; username: string | null }[])
    .map((b) => [b.username ?? "", b.id]));

  const botIdByKey = new Map<string, string>();
  let createdCount = 0;
  for (let i = 0; i < BOT_PERSONAS.length; i++) {
    const persona = BOT_PERSONAS[i];
    const existing = existingByUsername.get(persona.username);
    if (existing) { botIdByKey.set(persona.key, existing); continue; }

    if (DRY) { console.log(`  would create @${persona.username} (${persona.name})`); continue; }

    // A valid squad so the persona's profile looks like a real manager's.
    const shape = PRESETS[i % PRESETS.length];
    const anchors = shuffle(premiums).slice(0, 1 + Math.floor(rnd() * 2));
    let squadRow: Record<string, unknown> | null = null;
    try {
      const picks = solvePreset(shape, presetPool, 1000, anchors);
      const squad = validateSquad(picks, enginePool);
      const sel = smartDefaults(squad, enginePool);
      squadRow = {
        picks: squad.picks, bank_tenths: squad.bankTenths, credits: BASELINE_CREDITS_PER_GW,
        xi: sel.xi, bench: sel.bench, captain: sel.captain, vice: sel.vice,
        created_gw: 1, version: 0, chip_log: [],
      };
    } catch (e) { console.error(`  ! squad invalid for ${persona.name}: ${(e as Error).message}`); }

    const email = `bot-${persona.key}@${BOT_DOMAIN}`;
    const { data: userRes, error: uErr } = await db.auth.admin.createUser({
      email, password: `Bot!${Math.floor(rnd() * 1e9)}aZ`, email_confirm: true,
      user_metadata: { display_name: persona.name, is_seed: true },
    });
    if (uErr || !userRes?.user) { console.error(`  ! createUser failed for ${persona.name}: ${uErr?.message}`); continue; }
    const uid = userRes.user.id;

    const createdAt = new Date(Date.now() - Math.floor(rnd() * 20 + 3) * 864e5).toISOString();
    const { error: pErr } = await db.from("profiles").upsert({
      id: uid, display_name: persona.name, username: persona.username,
      avatar_url: persona.avatar, is_seed: true, source: "bot", notifications_opt_in: false, created_at: createdAt,
    });
    if (pErr) { console.error(`  ! profile failed for ${persona.name}: ${pErr.message}`); continue; }

    if (squadRow) {
      const { error: sErr } = await db.from("fantasy_squads").upsert({ user_id: uid, ...squadRow }, { onConflict: "user_id" });
      if (sErr) console.error(`  ! squad row failed for ${persona.name}: ${sErr.message}`);
    }
    botIdByKey.set(persona.key, uid);
    createdCount++;
    process.stdout.write(".");
  }
  if (createdCount) process.stdout.write("\n");
  console.log(`${DRY ? "[DRY] " : ""}Personas ready: ${DRY ? BOT_PERSONAS.length : botIdByKey.size} (${createdCount} new).`);

  // Bots follow each other + a spread of seed accounts, so their profiles carry
  // believable counts and their posts surface in seeds' Following feeds.
  if (!DRY && createdCount) {
    const botIds = Array.from(botIdByKey.values());
    const { data: seedRows } = await db.from("profiles").select("id").eq("is_seed", true).eq("source", "seed");
    const seedIds = ((seedRows ?? []) as { id: string }[]).map((s) => s.id);
    const follows: { follower_id: string; followee_id: string }[] = [];
    for (const b of botIds) {
      for (const o of shuffle(botIds.filter((x) => x !== b)).slice(0, 3 + Math.floor(rnd() * 5))) follows.push({ follower_id: b, followee_id: o });
      for (const s of shuffle(seedIds).slice(0, 2 + Math.floor(rnd() * 6))) follows.push({ follower_id: b, followee_id: s });
      // And some seeds follow the loud accounts back.
      for (const s of shuffle(seedIds).slice(0, 4 + Math.floor(rnd() * 10))) follows.push({ follower_id: s, followee_id: b });
    }
    const { error: fErr } = await db.from("user_follows").upsert(follows, { onConflict: "follower_id,followee_id" });
    console.log(fErr ? `  ! follows: ${fErr.message}` : `Follow edges: ${follows.length}`);
  }

  // ── Backfill an opening stretch of content ─────────────────────────────────
  if (BACKFILL > 0) {
    const { data: packRows } = await db.from("quiz_packs").select("title, name").eq("status", "published").limit(40);
    const quizTitles = WITH_QUIZ
      ? ((packRows ?? []) as { title: string | null; name: string | null }[]).map((p) => p.title ?? p.name).filter((t): t is string => !!t)
      : []; // without mig 248 + the deployed renderer, quiz_result rows would 500 the insert / render as noise

    const usedKeys = new Set<string>();
    const { data: prior } = await db.from("fantasy_feed_events")
      .select("payload").in("actor_id", Array.from(botIdByKey.values())).limit(600);
    for (const e of (prior ?? []) as { payload: { k?: string } | null }[]) if (e.payload?.k) usedKeys.add(e.payload.k);

    const rows: { actor_id: string; type: string; gw: null; payload: Record<string, unknown>; created_at: string }[] = [];
    // Backfill only speaks with the personas whose ramp day has arrived — a
    // day-0 feed written by all 16 would undo the gradual-arrival story.
    const rampActive = activeBotPersonas(Date.now());
    const personasLooped = shuffle([...rampActive, ...rampActive, ...rampActive]);
    for (const persona of personasLooped) {
      if (rows.length >= BACKFILL) break;
      const actorId = botIdByKey.get(persona.key);
      if (!actorId) continue;
      const move = generateBotMove(persona, contentPool, usedKeys, quizTitles, rnd, WITH_QUIZ, Date.now());
      if (!move) continue;
      usedKeys.add(String(move.payload.k));
      // Spread over the past 36h, denser toward now (a feed that "warmed up"),
      // resampled until it lands in London waking hours — nobody posts at 4am.
      let stamp = 0;
      for (let tries = 0; tries < 20; tries++) {
        const ageMs = Math.floor(Math.pow(rnd(), 1.6) * 36 * 60 * 60 * 1000);
        stamp = Date.now() - ageMs;
        const h = londonHour(stamp);
        if (h >= 7 && h < 23) break;
      }
      rows.push({ actor_id: actorId, type: move.type, gw: null, payload: move.payload, created_at: new Date(stamp).toISOString() });
    }
    console.log(`${DRY ? "[DRY] " : ""}Backfill: ${rows.length} moves${WITH_QUIZ ? " (quiz allowed)" : ""}.`);
    if (DRY) {
      for (const r of rows.slice(0, 10)) console.log(`  [${r.type}] ${JSON.stringify(r.payload).slice(0, 110)}`);
    } else if (rows.length) {
      const { data: inserted, error: eErr } = await db.from("fantasy_feed_events").insert(rows).select("id, actor_id, type, payload");
      if (eErr) { console.error(`  ! backfill insert: ${eErr.message}`); return; }

      // Engagement between the personas so nothing sits on zero: reactions on
      // most posts, votes on every poll.
      const botIds = Array.from(botIdByKey.values());
      const EMOJI = ["😂", "👀", "🔥", "👏", "❤️", "😭"];
      const likeRows: { event_id: string; user_id: string; emoji: string }[] = [];
      const voteRows: { event_id: string; user_id: string; option_index: number }[] = [];
      // Lopsided on purpose: over half of posts get NOTHING, most of the rest
      // one stray reaction, the odd post collects a cluster on 1–2 emojis.
      for (const ev of (inserted ?? []) as { id: string; actor_id: string; type: string; payload: { poll?: { options?: unknown[] } } }[]) {
        const others = shuffle(botIds.filter((b) => b !== ev.actor_id));
        const r = rnd();
        const nLikes = r < 0.55 ? 0 : r < 0.85 ? 1 : 3 + Math.floor(rnd() * 5); // 0 | 1 | 3–7
        const cluster = nLikes > 1 ? shuffle([...EMOJI]).slice(0, 2) : EMOJI;
        for (const b of others.slice(0, nLikes))
          likeRows.push({ event_id: ev.id, user_id: b, emoji: cluster[Math.floor(rnd() * cluster.length)] });
        const options = ev.payload?.poll?.options;
        if (Array.isArray(options) && options.length) {
          const favoured = Math.floor(rnd() * options.length);
          const nVotes = rnd() < 0.2 ? 6 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 4);
          for (const b of others.slice(0, nVotes))
            voteRows.push({ event_id: ev.id, user_id: b, option_index: rnd() < 0.65 ? favoured : Math.floor(rnd() * options.length) });
        }
      }
      if (likeRows.length) await db.from("fantasy_feed_likes").upsert(likeRows, { onConflict: "event_id,user_id", ignoreDuplicates: true });
      if (voteRows.length) await db.from("fantasy_feed_poll_votes").upsert(voteRows, { onConflict: "event_id,user_id", ignoreDuplicates: true });
      console.log(`Engagement: ${likeRows.length} reactions, ${voteRows.length} poll votes.`);
    }
  }

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
