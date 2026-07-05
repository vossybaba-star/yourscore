#!/usr/bin/env node
// THE daily-debate schedule. One debate per calendar date, written down right
// here — what you see below is exactly what ships on each day (UK time).
// A date with no entry keeps showing the most recent past debate.
//
//   node scripts/seed-debates.mjs           # sync the DB to this schedule
//   node scripts/seed-debates.mjs --list    # print the calendar + today's pick
//
// Editing is simple: add/move/remove rows, keep dates unique, re-run. Votes
// always stay attached to their debate. Editorial bar (founder): every debate
// must be REAL and SPECIFIC — an actual moment, player, rule or part of fan
// life — and must work for every fan, not just fans of the big clubs.

import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

const SCHEDULE = [
  { day: "2026-07-05", question: "Gazza's tears at Italia 90: the moment modern English football was born?", options: ["It changed everything", "Romanticised nonsense"] },
  { day: "2026-07-06", question: "Half-and-half scarves: harmless souvenir or a crime against football?", options: ["Crime", "Let people enjoy things"] },
  { day: "2026-07-07", question: "Canada in the last 16 for the first time ever — the story of this World Cup?", options: ["Story of the summer", "Wait for the final"] },
  { day: "2026-07-08", question: "The Hand of God: cheating, or the most Maradona thing that ever happened?", options: ["Pure cheating", "Genius, part of the game"] },
  { day: "2026-07-09", question: "Away tickets: cap them at £20 everywhere, like the fans keep asking?", options: ["Cap them now", "Clubs need the money"] },
  { day: "2026-07-10", question: "Messi still rewriting World Cup records at this one — the greatest final chapter any player has had?", options: ["Nothing will top it", "Prime Messi was better"] },
  { day: "2026-07-11", question: "Agüero 93:20 — the greatest single moment in Premier League history?", options: ["Untouchable", "Only if you're City"] },
  { day: "2026-07-12", question: "VAR millimetre offsides — armpits and toenails. Scrap the lines and trust the eye?", options: ["Scrap the lines", "Precision is fairness"] },
  { day: "2026-07-13", question: "Suárez's goal-line handball in 2010 sent Ghana home. Would you want your striker doing the same?", options: ["100% — take the red", "No, win it fair"] },
  { day: "2026-07-14", question: "A last-minute winner away from home: the best feeling football gives you?", options: ["Nothing beats it", "Beating your rivals does"] },
  { day: "2026-07-15", question: "48 teams at this World Cup: more fairytales like Canada, or a watered-down group stage?", options: ["More fairytales, keep it", "Go back to 32"] },
  { day: "2026-07-16", question: "Istanbul 2005: the greatest final football has ever seen?", options: ["Nothing comes close", "One mad half, overrated"] },
  { day: "2026-07-17", question: "Deadline day: the best day of the season or a made-for-TV circus?", options: ["Love it", "Total circus"] },
  { day: "2026-07-18", question: "Zidane's headbutt in the 2006 final: did it ruin his legacy?", options: ["Not one bit", "It cost France a World Cup"] },
  // World Cup final weekend — the final-to-end-all-finals debate
  { day: "2026-07-19", question: "The 2022 final — Messi vs Mbappé, 3-3, penalties. Best World Cup final ever played?", options: ["Best ever, easily", "Recency bias"] },
  { day: "2026-07-20", question: "Leicester winning the league at 5000/1: the biggest miracle in the history of team sport?", options: ["Never be topped", "Greece 2004 was bigger"] },
  { day: "2026-07-21", question: "Safe standing is back at grounds across the country. Should terraces return properly?", options: ["Bring them back", "Seats keep it safe"] },
  { day: "2026-07-22", question: "Henry's handball knocked Ireland out of the 2010 World Cup. Should FIFA have replayed it?", options: ["Replay it", "Harsh, but move on"] },
  { day: "2026-07-23", question: "Survival on the final day or a cup final at Wembley — which party is bigger?", options: ["Survival Sunday", "Wembley"] },
  { day: "2026-07-24", question: "Lampard's goal that never was, Bloemfontein 2010: did that shot change football more than any goal that counted?", options: ["It gave us goal-line tech", "England were beaten anyway"] },
  { day: "2026-07-25", question: "The 3pm Saturday blackout: still protecting lower-league crowds, or just stuck in the past?", options: ["Protect it", "Show every game"] },
  { day: "2026-07-26", question: "Beckham's red card in '98 — effigy burnings, front pages. Did the country go too far?", options: ["Way too far", "He cost them a World Cup"] },
  { day: "2026-07-27", question: "Five subs: good game management or the death of the underdog hanging on for 90 minutes?", options: ["Better football", "It helps the big squads"] },
  { day: "2026-07-28", question: "Roy Keane and the prawn sandwich brigade: was he right about modern crowds?", options: ["Dead right", "Out of touch"] },
  { day: "2026-07-29", question: "The Championship play-off final: the cruellest single game in football?", options: ["Cruellest there is", "A World Cup semi hurts more"] },
  { day: "2026-07-30", question: "Ronaldinho got a standing ovation at the Bernabéu in 2005. The greatest respect a rival has ever been shown?", options: ["Never see it again", "They'd do it for Messi too"] },
  { day: "2026-07-31", question: "Extra time is 30 minutes of exhausted walking. Straight to penalties instead?", options: ["Straight to pens", "Extra time earns it"] },
  { day: "2026-08-01", question: "Rooney's overhead kick in the Manchester derby: the best goal the Premier League has produced?", options: ["Yes, the best", "Henry vs United was better"] },
  { day: "2026-08-02", question: "Tuesday night away in the cup, 300 of you in the rain: the purest form of supporting?", options: ["That's real support", "Romantic nonsense"] },
  { day: "2026-08-03", question: "Shearer or Kane: England's greatest striker?", options: ["Shearer", "Kane"] },
  { day: "2026-08-04", question: "Wenger's Invincibles or Klopp's 99 points — the greater league season?", options: ["Invincible means invincible", "99 points is harder"] },
  { day: "2026-08-05", question: "Greece winning Euro 2004 with five goals in the knockouts: iconic or the tournament nobody wants again?", options: ["Iconic, that's football", "Never again please"] },
];

// Guard: one debate per date, no dupes.
{
  const days = SCHEDULE.map((d) => d.day);
  const qs = SCHEDULE.map((d) => d.question);
  if (new Set(days).size !== days.length) { console.error("duplicate dates in SCHEDULE"); process.exit(1); }
  if (new Set(qs).size !== qs.length) { console.error("duplicate questions in SCHEDULE"); process.exit(1); }
}

const ukToday = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

if (process.argv.includes("--list")) {
  for (const d of SCHEDULE) {
    const mark = d.day === ukToday ? "  ← TODAY" : d.day < ukToday ? "  (past)" : "";
    console.log(`${d.day}  ${d.question}${mark}`);
  }
  process.exit(0);
}

const { data: existing } = await db.from("debates").select("id, question, day, active");
const byQuestion = new Map((existing ?? []).map((d) => [d.question, d]));
const scheduled = new Set(SCHEDULE.map((d) => d.question));

// 1. Unschedule + deactivate rows that fell off the schedule (votes kept).
const stale = (existing ?? []).filter((d) => !scheduled.has(d.question) && (d.active || d.day));
if (stale.length) {
  const { error } = await db.from("debates").update({ active: false, day: null }).in("id", stale.map((d) => d.id));
  if (error) { console.error(error); process.exit(1); }
  console.log(`unscheduled ${stale.length} debates not in the calendar`);
}
// Clear dates on scheduled rows whose date changed (two-pass avoids unique collisions).
const moved = SCHEDULE.filter((d) => byQuestion.has(d.question) && byQuestion.get(d.question).day !== d.day);
if (moved.length) {
  const { error } = await db.from("debates").update({ day: null }).in("id", moved.map((d) => byQuestion.get(d.question).id));
  if (error) { console.error(error); process.exit(1); }
}

// 2. Upsert every scheduled debate with its date.
for (const d of SCHEDULE) {
  const row = byQuestion.get(d.question);
  const { error } = row
    ? await db.from("debates").update({ day: d.day, active: true, options: d.options }).eq("id", row.id)
    : await db.from("debates").insert({ question: d.question, options: d.options, day: d.day, active: true });
  if (error) { console.error(d.day, error.message); process.exit(1); }
}
console.log(`schedule synced: ${SCHEDULE.length} debates, ${SCHEDULE[0].day} → ${SCHEDULE[SCHEDULE.length - 1].day}`);
const today = SCHEDULE.find((d) => d.day === ukToday);
console.log(`today (${ukToday}): ${today ? today.question : "no entry — most recent past debate serves"}`);
