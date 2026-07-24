/**
 * EDITORIAL GATE — is this fact something we'd put in a football quiz?
 *
 * Every other gate in the factory asks whether a fact is TRUE. This one asks whether it
 * BELONGS. They are different questions, and we only learned that the hard way: a Newcastle
 * rivalries run surfaced
 *
 *   "In March 2002, a pre-arranged clash between Sunderland's 'Seaburn Casuals' and Newcastle's
 *    'Gremlins' hooligan firms ... some of the worst football-related fighting ever seen in the
 *    UK, with the ringleaders jailed for four years."
 *
 * which passed every check we had, correctly: Wikipedia is a trusted tier-2 source, the fact is
 * true, it is fixed in time, and it is genuinely about the derby. The source gate asks where a
 * fact came from, never whether it should be asked as a question. "Which firm did Newcastle's
 * Gremlins fight in 2002?" is not a quiz question anyone wants to see.
 *
 * This runs at the FACT stage, not the question stage, because facts-first means one bad fact
 * spawns two or three questions — cheaper and safer to kill it before authoring.
 *
 * DELIBERATELY CONSERVATIVE ABOUT FALSE POSITIVES. Football writing is full of violent idiom —
 * teams are "crushed", strikers "fire" shots, defences get "killed off", ties are "sudden
 * death". Matching bare words like "killed" or "fire" would bin legitimate history, so every
 * pattern here is phrase-level and anchored to the real-world sense. When in doubt the rule is:
 * a pattern must be one that a match report would never produce by accident.
 *
 * Every drop is logged with the matched term (the founder's call) so it stays visible whether
 * this is over-reaching.
 */

/**
 * Each rule is [label, regex]. Labels group the log output so an over-eager rule is obvious.
 * All patterns are matched case-insensitively against the fact text.
 */
const RULES = [
  // ── Crowd violence and hooliganism ──────────────────────────────────────────
  // "clash" alone is match-report idiom ("a top-of-the-table clash") — it must be tied to
  // people fighting, not teams meeting.
  ["hooliganism", /\bhooligan|\bfirms?\b(?=[^.]*\bfought\b)|\bfootball[- ]related (?:violence|fighting)|\bcrowd (?:trouble|violence|disorder)|\brioting?\b|\bpitched battle/i],
  ["hooliganism", /\bpre-arranged (?:clash|fight|meeting)|\bfought with\b|\brunning battles/i],

  // ── Deaths and disasters ────────────────────────────────────────────────────
  // Anchored: "was/were killed", "killed in", never bare "killed" ("killed off the tie").
  ["tragedy", /\b(?:was|were|been) killed\b|\bkilled in the\b|\bfatalit|\bdeath toll\b|\bmourn/i],
  ["tragedy", /\b(?:air )?disaster\b|\bhillsborough\b|\bheysel\b|\bmunich air\b|\bbradford (?:city )?fire\b|\bstadium fire\b/i],
  // "died" is essentially never idiomatic in football writing the way "killed" is.
  ["tragedy", /\bdied\b|\bpassed away\b|\bposthumous/i],
  // Crush: "crushed 5-0" is a scoreline, so require the crowd-safety sense.
  ["tragedy", /\bcrush barrier|\bwere crushed\b|\bfatal crush|\bcrowd crush/i],

  // ── Crime and courts ────────────────────────────────────────────────────────
  ["crime", /\bjailed\b|\bimprison|\bin prison\b|\bconvict(?:ed|ion)\b|\bsentenced to\b|\bfound guilty\b|\bcourt case\b|\bon trial\b/i],
  ["crime", /\barrested\b|\bcharged with\b|\bpleaded guilty\b|\bfraud\b|\bmoney laundering\b|\bmatch[- ]fixing\b|\bbribery\b/i],

  // ── Discrimination and abuse ────────────────────────────────────────────────
  ["abuse", /\bracist\b|\bracism\b|\bracial abuse\b|\bhomophobic\b|\bsectarian\b|\bdiscriminat/i],
  ["abuse", /\bsexual (?:abuse|assault|misconduct)\b|\bdomestic (?:abuse|violence)\b|\bassaulted\b|\bgrooming\b/i],

  // ── Doping, betting and off-pitch scandal ───────────────────────────────────
  // A plain "ban" is a normal suspension — only the scandal senses are dropped.
  ["scandal", /\bdoping\b|\bfailed a drugs? test\b|\bperformance[- ]enhancing\b|\bcocaine\b|\bdrugs? ban\b/i],
  ["scandal", /\bbetting scandal\b|\bgambling ban\b|\billegal betting\b/i],

  // ── Serious injury ──────────────────────────────────────────────────────────
  // Career-ending and life-threatening only. Routine injury is ordinary football content.
  ["injury", /\bcareer[- ]ending\b|\bcardiac arrest\b|\bcollapsed on the pitch\b|\blife[- ]support\b|\bcoma\b|\bbroken (?:leg|neck|skull)\b/i],
];

/**
 * Judge one fact. Returns null if it's fine, or { label, term } describing why it's out.
 */
export function editorialVerdict(factText) {
  const text = String(factText ?? "");
  for (const [label, re] of RULES) {
    const m = text.match(re);
    if (m) return { label, term: m[0].trim() };
  }
  return null;
}

/**
 * Split a fact list into what we'll author from and what we won't.
 * Returns { kept, dropped } where each dropped entry carries its reason for the log.
 */
export function applyEditorialGate(facts) {
  const kept = [];
  const dropped = [];
  for (const f of facts ?? []) {
    const verdict = editorialVerdict(f?.fact);
    if (verdict) dropped.push({ fact: f, ...verdict });
    else kept.push(f);
  }
  return { kept, dropped };
}

/** One-line-per-drop summary for the run log — the founder asked to see what's being binned. */
export function editorialReport(dropped) {
  if (!dropped.length) return null;
  const byLabel = {};
  for (const d of dropped) (byLabel[d.label] ??= []).push(d);
  const lines = [];
  for (const [label, ds] of Object.entries(byLabel)) {
    lines.push(`   ✂ ${label} (${ds.length}):`);
    for (const d of ds) lines.push(`       "${d.term}" — ${String(d.fact.fact).slice(0, 88)}…`);
  }
  return lines.join("\n");
}
