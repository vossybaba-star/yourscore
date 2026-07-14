/**
 * Refresh player display names in the gates question pool — names only.
 *
 * The gates pool was built with FPL's web_name, so questions read "Merino",
 * "Wood", "Kroupi.Jr" with no first names. The fantasy squad screen and the
 * question screen must call the same player the same thing, so both pools run the
 * ONE rule in scripts/lib/player-name.mjs.
 *
 * Rewrites, in place:
 *   - questions[].options[].label   (the answer buttons)
 *   - questions[].meta              (KEYED BY LABEL — must be rekeyed in step)
 *   - questions[].prompt            (only where it embeds a player's name)
 *   - currentPlayers[].name
 *
 * Safety: an option's label is only rewritten when its id maps to an FPL element
 * whose CURRENT name matches that label — so option ids that aren't players
 * (clubs, seasons, years) are left strictly alone.
 *
 *   node scripts/gates/refresh-names.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { displayName } from "../lib/player-name.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const poolPath = join(root, "src/data/gates/pool.json");

const pool = JSON.parse(readFileSync(poolPath, "utf8"));
const boot = JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
const byId = new Map(boot.elements.map((e) => [e.id, e]));

/** old label → new label, but ONLY for ids that really are this FPL player. */
const rename = new Map();
for (const e of boot.elements) {
  const next = displayName(e);
  if (next && next !== e.web_name) rename.set(e.id, { from: e.web_name, to: next });
}

/** Classic-trivia options come from SportMonks history, which abbreviates ("R. Keane").
 *  Their option ids are NOT FPL ids, so the rule above rightly won't touch them.
 *  Every player gets a first name — including the historical ones. */
const HISTORICAL = {
  "R. Keane": "Roy Keane",
  "B. McCarthy": "Benni McCarthy",
};

let labels = 0, metas = 0, prompts = 0, names = 0, historical = 0;

for (const q of pool.questions ?? []) {
  const localMap = new Map(); // old label → new label, for this question's meta/prompt

  for (const o of q.options ?? []) {
    if (HISTORICAL[o.label]) {
      localMap.set(o.label, HISTORICAL[o.label]);
      o.label = HISTORICAL[o.label];
      historical++;
      continue;
    }
    const r = rename.get(o.id);
    // Only touch it if the stored label IS that player's old name — never guess.
    if (!r || o.label !== r.from) continue;
    localMap.set(o.label, r.to);
    o.label = r.to;
    labels++;
  }

  // meta is keyed by the option label — rekey in lockstep or the lookup dies.
  if (q.meta && localMap.size) {
    const next = {};
    for (const [k, v] of Object.entries(q.meta)) next[localMap.get(k) ?? k] = v;
    q.meta = next;
    metas++;
  }

  // Some prompts embed a player's name ("Which club did X play for…").
  if (typeof q.prompt === "string" && localMap.size) {
    let p = q.prompt;
    for (const [from, to] of localMap) {
      // Word-boundary replace so "Wood" can't eat "Woodman".
      const re = new RegExp(`(?<![\\p{L}])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu");
      p = p.replace(re, to);
    }
    if (p !== q.prompt) { q.prompt = p; prompts++; }
  }
}

for (const p of pool.currentPlayers ?? []) {
  const r = rename.get(p.id);
  if (r && p.name === r.from) { p.name = r.to; names++; }
}

writeFileSync(poolPath, JSON.stringify(pool));
console.log(`✅ gates pool: ${labels} option labels · ${historical} historical · ${metas} meta blocks rekeyed · ${prompts} prompts · ${names} currentPlayers`);
