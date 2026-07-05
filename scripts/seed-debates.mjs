#!/usr/bin/env node
// Seed the daily-debate bank. Idempotent AND authoritative: questions in this
// list are inserted if missing; active debates NOT in this list are
// deactivated (votes kept). Rotation is date-seeded over active rows (see
// src/lib/debate.ts), so this file is the schedule.
//
//   node scripts/seed-debates.mjs           # sync the bank to this list
//   node scripts/seed-debates.mjs --list    # show the bank + today's pick
//
// Editorial bar (founder, Jul 5): every debate must be REAL and SPECIFIC — an
// actual moment, player, rule or part of fan life — and must work for every
// fan, not just fans of the big clubs. No abstract hypotheticals.

import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

const DEBATES = [
  // ── This World Cup (real 2026 storylines from our own daily coverage) ──
  { question: "Canada in the last 16 for the first time ever — the story of this World Cup?", options: ["Story of the summer", "Wait for the final"] },
  { question: "Messi still rewriting World Cup records at this one — the greatest final chapter any player has had?", options: ["Nothing will top it", "Prime Messi was better"] },
  { question: "48 teams at this World Cup: more fairytales like Canada, or a watered-down group stage?", options: ["More fairytales, keep it", "Go back to 32"] },

  // ── Real moments, argued forever ──
  { question: "The Hand of God: cheating, or the most Maradona thing that ever happened?", options: ["Pure cheating", "Genius, part of the game"] },
  { question: "Istanbul 2005: the greatest final football has ever seen?", options: ["Nothing comes close", "One mad half, overrated"] },
  { question: "Suárez's goal-line handball in 2010 sent Ghana home. Would you want your striker doing the same?", options: ["100% — take the red", "No, win it fair"] },
  { question: "Zidane's headbutt in the 2006 final: did it ruin his legacy?", options: ["Not one bit", "It cost France a World Cup"] },
  { question: "Agüero 93:20 — the greatest single moment in Premier League history?", options: ["Untouchable", "Only if you're City"] },
  { question: "Leicester winning the league at 5000/1: the biggest miracle in the history of team sport?", options: ["Never be topped", "Greece 2004 was bigger"] },
  { question: "Henry's handball knocked Ireland out of the 2010 World Cup. Should FIFA have replayed it?", options: ["Replay it", "Harsh, but move on"] },
  { question: "Lampard's goal that never was, Bloemfontein 2010: did that shot change football more than any goal that counted?", options: ["It gave us goal-line tech", "England were beaten anyway"] },
  { question: "Gazza's tears at Italia 90: the moment modern English football was born?", options: ["It changed everything", "Romanticised nonsense"] },
  { question: "Beckham's red card in '98 — effigy burnings, front pages. Did the country go too far?", options: ["Way too far", "He cost them a World Cup"] },
  { question: "Roy Keane and the prawn sandwich brigade: was he right about modern crowds?", options: ["Dead right", "Out of touch"] },
  { question: "Ronaldinho got a standing ovation at the Bernabéu in 2005. The greatest respect a rival has ever been shown?", options: ["Never see it again", "They'd do it for Messi too"] },
  { question: "Rooney's overhead kick in the Manchester derby: the best goal the Premier League has produced?", options: ["Yes, the best", "Henry vs United was better"] },
  { question: "The 2022 final — Messi vs Mbappé, 3-3, penalties. Best World Cup final ever played?", options: ["Best ever, easily", "Recency bias"] },
  { question: "Wenger's Invincibles or Klopp's 99 points — the greater league season?", options: ["Invincible means invincible", "99 points is harder"] },
  { question: "Shearer or Kane: England's greatest striker?", options: ["Shearer", "Kane"] },
  { question: "Greece winning Euro 2004 with five goals in the knockouts: iconic or the tournament nobody wants again?", options: ["Iconic, that's football", "Never again please"] },

  // ── Rules & the modern game (real, affects every fan) ──
  { question: "VAR millimetre offsides — armpits and toenails. Scrap the lines and trust the eye?", options: ["Scrap the lines", "Precision is fairness"] },
  { question: "The 3pm Saturday blackout: still protecting lower-league crowds, or just stuck in the past?", options: ["Protect it", "Show every game"] },
  { question: "Safe standing is back at grounds across the country. Should terraces return properly?", options: ["Bring them back", "Seats keep it safe"] },
  { question: "Away tickets: cap them at £20 everywhere, like the fans keep asking?", options: ["Cap them now", "Clubs need the money"] },
  { question: "Five subs: good game management or the death of the underdog hanging on for 90 minutes?", options: ["Better football", "It helps the big squads"] },
  { question: "Extra time is 30 minutes of exhausted walking. Straight to penalties instead?", options: ["Straight to pens", "Extra time earns it"] },

  // ── Fan life (every club, every level) ──
  { question: "Deadline day: the best day of the season or a made-for-TV circus?", options: ["Love it", "Total circus"] },
  { question: "A last-minute winner away from home: the best feeling football gives you?", options: ["Nothing beats it", "Beating your rivals does"] },
  { question: "Survival on the final day or a cup final at Wembley — which party is bigger?", options: ["Survival Sunday", "Wembley"] },
  { question: "The Championship play-off final: the cruellest single game in football?", options: ["Cruellest there is", "A World Cup semi hurts more"] },
  { question: "Tuesday night away in the cup, 300 of you in the rain: the purest form of supporting?", options: ["That's real support", "Romantic nonsense"] },
  { question: "Half-and-half scarves: harmless souvenir or a crime against football?", options: ["Crime", "Let people enjoy things"] },
];

const { data: existing } = await db.from("debates").select("id, question, active");
const have = new Map((existing ?? []).map((d) => [d.question, d]));
const wanted = new Set(DEBATES.map((d) => d.question));

if (process.argv.includes("--list")) {
  const active = (existing ?? []).filter((d) => d.active);
  const uk = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const day = Math.floor(Date.parse(`${uk}T00:00:00Z`) / 86_400_000);
  console.log(`bank: ${existing?.length ?? 0} (${active.length} active), today's index: ${active.length ? day % active.length : "-"}`);
  process.exit(0);
}

// 1. Deactivate active debates that fell out of the list (keeps their votes).
const stale = (existing ?? []).filter((d) => d.active && !wanted.has(d.question));
if (stale.length) {
  const { error } = await db.from("debates").update({ active: false }).in("id", stale.map((d) => d.id));
  if (error) { console.error(error); process.exit(1); }
  console.log(`deactivated ${stale.length} stale debates`);
}

// 2. Reactivate any listed debate that was previously deactivated.
const revive = DEBATES.filter((d) => have.get(d.question)?.active === false);
if (revive.length) {
  const { error } = await db.from("debates").update({ active: true }).in("id", revive.map((d) => have.get(d.question).id));
  if (error) { console.error(error); process.exit(1); }
  console.log(`reactivated ${revive.length}`);
}

// 3. Insert what's missing.
const missing = DEBATES.filter((d) => !have.has(d.question));
if (missing.length) {
  const { error } = await db.from("debates").insert(missing);
  if (error) { console.error(error); process.exit(1); }
  console.log(`seeded ${missing.length} new debates`);
}
console.log(`bank synced: ${DEBATES.length} active`);
