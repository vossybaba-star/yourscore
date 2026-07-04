#!/usr/bin/env node
// Seed the daily-debate bank. Idempotent: matches on question text, inserts
// what's missing, never duplicates, never touches votes. Rotation is
// date-seeded over active rows (see src/lib/debate.ts) so seeding is all the
// "scheduling" there is.
//
//   node scripts/seed-debates.mjs           # seed / top up
//   node scripts/seed-debates.mjs --list    # show the bank + today's pick

import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

// Fan voice: questions you'd actually argue about with friends. No right
// answers, no editorial tone, options short enough for a thumb.
const DEBATES = [
  { question: "Is Haaland already one of the greats?", options: ["Yes, already", "Needs a World Cup", "Not even close"] },
  { question: "Prime Ronaldinho or prime Neymar?", options: ["Ronaldinho", "Neymar"] },
  { question: "Would prime Gerrard get in this Liverpool side?", options: ["Walks in", "On the bench"] },
  { question: "Messi at this World Cup: still the best on the pitch?", options: ["Still him", "Torch has passed"] },
  { question: "England: brilliant squad or brilliant excuses?", options: ["It's coming home", "Same old story"] },
  { question: "Better derby: Manchester or North London?", options: ["Manchester", "North London"] },
  { question: "Was Leicester 15/16 the greatest league season ever?", options: ["Nothing tops it", "Invincibles clear"] },
  { question: "VAR: fixed football or ruined it?", options: ["Fixed it", "Ruined it", "Needs one more go"] },
  { question: "Scholes, Lampard or Gerrard?", options: ["Scholes", "Lampard", "Gerrard"] },
  { question: "Pep at a relegation club: does he keep them up?", options: ["Comfortably", "Goes down playing out from the back"] },
  { question: "Best Premier League striker ever?", options: ["Henry", "Shearer", "Agüero", "Someone else"] },
  { question: "Would prime Roy Keane survive in today's game?", options: ["Red card every week", "Player of the season"] },
  { question: "Zidane or Ronaldo Nazário: who was more special?", options: ["Zidane", "R9"] },
  { question: "A World Cup or three Champions Leagues?", options: ["World Cup", "Three UCLs"] },
  { question: "Is the Champions League anthem better than the trophy?", options: ["The anthem hits different", "Trophy, obviously"] },
  { question: "Ronaldo's header vs Messi's dribble: which YouTube rabbit hole?", options: ["CR7 headers", "Messi dribbles"] },
  { question: "Better free kick: Beckham vs Greece or Roberto Carlos vs France?", options: ["Beckham", "Roberto Carlos"] },
  { question: "One clause in every contract: no passing back to the keeper. Better game?", options: ["Instantly better", "Chaos, keep it"] },
  { question: "Would you take a 60-cap England career or one iconic World Cup goal?", options: ["The career", "The moment"] },
  { question: "Fergie time: real or myth?", options: ["Absolutely real", "Myth and paranoia"] },
  { question: "Is a 30-yard screamer worth more than a hat-trick of tap-ins?", options: ["The screamer", "Three's three"] },
  { question: "Modern fullbacks: the best players on the pitch?", options: ["The engine of everything", "Failed wingers"] },
  { question: "Kane's England legacy: legend or nearly-man?", options: ["Legend regardless", "Needs a trophy"] },
  { question: "Penalties: the fairest way to settle it?", options: ["Pure drama, keep it", "Cruel lottery"] },
  { question: "Better atmosphere: Champions League night or a relegation six-pointer?", options: ["UCL night", "Six-pointer"] },
  { question: "Would prime Puyol stop today's forwards?", options: ["Pockets them all", "Pace kills him"] },
  { question: "The World Cup group stage: best fortnight in football?", options: ["Nothing beats it", "Knockouts or nothing"] },
  { question: "Grealish or Foden in your five-a-side team?", options: ["Grealish", "Foden"] },
  { question: "Golden boot or clean-sheet record: which says more?", options: ["Goals win games", "Defences win titles"] },
  { question: "If your club wins the league but your rival wins the UCL, good season?", options: ["Great season", "Ruined"] },
];

const { data: existing } = await db.from("debates").select("id, question, active");
const have = new Set((existing ?? []).map((d) => d.question));
const missing = DEBATES.filter((d) => !have.has(d.question));

if (process.argv.includes("--list")) {
  const active = (existing ?? []).filter((d) => d.active);
  const uk = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const day = Math.floor(Date.parse(`${uk}T00:00:00Z`) / 86_400_000);
  console.log(`bank: ${existing?.length ?? 0} (${active.length} active), today's index: ${active.length ? day % active.length : "-"}`);
  process.exit(0);
}

if (missing.length === 0) {
  console.log(`bank already complete (${existing?.length ?? 0} debates)`);
} else {
  const { error } = await db.from("debates").insert(missing);
  if (error) { console.error(error); process.exit(1); }
  console.log(`seeded ${missing.length} debates (bank now ${(existing?.length ?? 0) + missing.length})`);
}
