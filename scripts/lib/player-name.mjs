/**
 * ONE naming rule, shared by every pool we build (fantasy squad pool + gates
 * question pool). Both surfaces show the same player, so they must agree.
 *
 * The rule: what fans actually call him — FIRST NAME + THE SURNAME WE KNOW HIM BY.
 *   "David Raya"      not "David Raya Martín" (full legal name)
 *   "Dominic Solanke" not "Solanke"           (bare surname)
 *   "Casemiro"        not "Carlos Casimiro"   (mononym — a surname makes it worse)
 *
 * FPL gives three fields: first_name, second_name (the full legal surname chain)
 * and web_name (the known-as form, but abbreviated: "A.Becker", "Bruno G.",
 * "Raya"). web_name tells us WHICH name we know him by; second_name supplies its
 * full spelling and accents.
 *
 * Two things are NOT derivable from the data, so they are curated below:
 *   1. Mononym vs surname. FPL stores "Casemiro" (a mononym) and "Gittens" (a
 *      surname needing a first name) identically. ALLOWED_MONONYMS is the list of
 *      players we genuinely know by one name; anyone else single-named is a bug.
 *   2. "Bruno G." (→ Bruno Guimarães) and "Ederson M." (→ just Ederson) have the
 *      same shape. The default expands the initial; OVERRIDES fixes the rest.
 * assertNames() below fails the build if a NEW single-name player appears, so
 * this can never silently regress when FPL adds players.
 */

/** Keyed by FPL web_name. The final say — bypasses all rules. */
export const OVERRIDES = {
  "Ederson M.": "Ederson", // known by first name alone, not "Ederson Moraes"
  Rodrigo: "Rodri", // FPL first_name is literally "Rodrigo 'Rodri'"
  Gana: "Idrissa Gueye", // FPL's "Gana" is his middle name; we know him by his surname
  "Kroupi.Jr": "Junior Kroupi",
  Taty: "Taty Castellanos", // Valentín "Taty" Castellanos — the nickname is the first name
  "J.Palhinha": "João Palhinha", // full first name is "João Maria"; nobody says the Maria
  "Seung soo": "Seung-Soo Park", // FPL puts his GIVEN name in web_name; Park is the surname
  "Ortega Moreno": "Stefan Ortega", // second surname is never used
};

/** Players genuinely known by a single name — the name we'd shout at the telly.
 *  Anything single-named and NOT here is a naming bug, not a mononym.
 *  Matched against FPL web_name, and short-circuits every rule below. */
export const ALLOWED_MONONYMS = new Set([
  "Rodri", "Casemiro", "Evanilson", "Rayan", "Beto", "Savinho", "Morato",
  "Estêvão", "Igor", "Florentino", "Antony", "Richarlison", "Joelinton",
  "Vitinha", "Palhinha", "Fabinho", "Jorginho", "Ederson",
  "John", "Murillo", "Pablo", "Kevin", "André",
  // NB: "Thiago" is deliberately NOT here — Brentford's is known as Igor Thiago.
]);

// Latin letters that NFD does not decompose (Turkish ı, Nordic ø, Polish ł …).
const FOLD = { ı: "i", İ: "i", ø: "o", Ø: "o", đ: "d", Đ: "d", ł: "l", Ł: "l", ß: "ss", æ: "ae", œ: "oe" };
const deaccent = (s) =>
  (s ?? "").replace(/[ıİøØđĐłŁßæœ]/g, (c) => FOLD[c] ?? c).normalize("NFD").replace(/[̀-ͯ]/g, "");
const key = (s) => deaccent(s).toLowerCase().replace(/[^a-z]/g, "");

/** second_name → comparable tokens. Splits on spaces AND hyphens, because FPL
 *  stores "Solanke-Mitchell" / "Bynoe-Gittens" and fans use only one half. */
const nameTokens = (s) => (s ?? "").trim().split(/[\s-]+/).filter(Boolean);

/** Strip FPL's initial cruft: "P.M.Sarr" → "Sarr", "Tóth.A" → "Tóth",
 *  "Kroupi.Jr" → "Kroupi". Returns the substantive name part. */
function stripInitials(web) {
  const parts = web.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return web.trim();
  // Keep the longest part — initials and "Jr" are short, the real name is not.
  return parts.reduce((a, b) => (b.length > a.length ? b : a), "");
}

// Dutch/Portuguese/Spanish nobiliary particles — part of the surname, never dropped.
const PARTICLES = new Set(["van", "von", "de", "del", "der", "den", "dos", "da", "di", "du", "le", "la", "el", "e"]);

/** Surname to append when a player is known by his FIRST name (Virgil, Raúl).
 *  Particle surnames stay whole ("van Dijk"). A two-part Spanish surname uses the
 *  FIRST (paternal) one — "Jiménez Rodríguez" → Jiménez, "Pino Santos" → Pino.
 *  Long Portuguese chains use the LAST — "Mota Veiga de Carvalho e Silva" → Silva. */
function surnameOf(second) {
  const toks = (second ?? "").trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return "";
  const joined = toks.join(" ");
  // A SHORT particle surname is one name and stays whole: "van Dijk", "de Ligt",
  // "van de Ven". A long particle chain is a Brazilian legal name, not a surname:
  // "dos Santos Magalhães" → Magalhães.
  if (PARTICLES.has(toks[0].toLowerCase())) {
    return toks.length <= 3 && joined.length <= 14 ? joined : toks.at(-1);
  }
  if (toks.length === 2) return toks[0]; // Spanish paternal surname: "Jiménez Rodríguez" → Jiménez
  return toks.at(-1);
}

/** @param {{first_name?:string, second_name?:string, web_name?:string}} e FPL element */
export function displayName(e) {
  const web = (e.web_name ?? "").trim();
  if (OVERRIDES[web]) return OVERRIDES[web];
  // Genuine one-name players short-circuit everything — no rule may bolt a surname on.
  if (ALLOWED_MONONYMS.has(web)) return web;

  const first = (e.first_name ?? "").trim();
  const second = (e.second_name ?? "").trim();
  const firstToks = first.split(/\s+/).filter(Boolean);
  const firstTok = firstToks[0] ?? "";
  // Compound given names ("Jan Paul", "Jean-Philippe") are part of how we know him.
  const given = firstToks.length === 2 && first.length <= 12 ? first : firstTok;
  const secondToks = nameTokens(second);
  // Prefer second_name's spelling (correct accents: "Bayındır" over web's "Bayindir").
  // Match the WHOLE surname first ("Lewis-Skelly" is one name), then its parts
  // ("Solanke" is the half of "Solanke-Mitchell" that fans actually use).
  const matchSecond = (k) =>
    (key(second) === key(k) ? second : undefined) ?? secondToks.find((t) => key(t) === key(k));
  const inFirst = (k) => firstToks.some((t) => key(t) === key(k));

  // "Bruno G." / "Ederson M." — trailing surname initial. Expand it.
  let m = web.match(/^(.+?)\s+([A-Za-z])\.$/);
  if (m) {
    const surname = secondToks.find((t) => key(t).startsWith(key(m[2])));
    return surname ? `${m[1]} ${surname}` : m[1];
  }

  // Anything with a dot is an FPL abbreviation: "A.Becker" (initial + surname),
  // "P.M.Sarr", "E.Le Fée", "Tóth.A" — and "O.Dango", where the initial is the
  // SURNAME and the remainder is the FIRST name. Work out which half we're holding.
  if (web.includes(".")) {
    const core = stripInitials(web);
    if (inFirst(core)) {
      // The abbreviated half is his GIVEN name, not his surname.
      // "L.Guilherme" (first "Luis Guilherme") is already the full known name.
      if (firstToks.length === 2) return first;
      // "O.Dango" (first "Dango") and "Jocelin.T" (first "Djiamgone Jocelin Ta",
      // second "Bi") → the known name is that given name plus the real surname.
      if (second) return `${core} ${second}`.trim();
    }
    const bare = web.replace(/^(?:[A-Za-z]\.)+/, "").replace(/\.[A-Za-z]{1,2}$/, "").trim();
    const surname = matchSecond(core) ?? (bare && !bare.includes(".") ? bare : core);
    return given ? `${given} ${surname}`.trim() : surname;
  }

  if (/\s/.test(web)) {
    // Already a full known name — it carries the given name. Covers both "Marc Guiu"
    // and Brazilian compound givens that ARE the known name ("Douglas Luiz",
    // "João Pedro", "Igor Jesus"): FPL has already made the call, don't second-guess it.
    if (inFirst(web.split(/\s+/)[0])) return web;
    // A multi-word SURNAME on its own ("Van den Berg", "Bruun Larsen", "Iling Jr")
    // — FPL dropped the first name. Put it back, preferring second_name's casing
    // ("van den Berg", not "Van den Berg").
    const surname =
      matchSecond(web) ??
      (key(secondToks[0] ?? "") === key(web.split(/\s+/)[0]) ? second : web);
    return `${given} ${surname}`.trim();
  }

  // web_name IS the surname ("Raya", "Saka", "Solanke" ← "Solanke-Mitchell").
  const asSurname = matchSecond(web);
  if (asSurname) return `${given} ${asSurname}`.trim();

  // web_name is his given name ("Alysson" ← "Alysson Edward Franco") → keep it and
  // add the surname we'd actually use. Length of the legal first name is irrelevant.
  if (key(web) === key(firstTok)) return `${web} ${surnameOf(second)}`.trim();

  // web_name is a LATER token of the first name ("Thiago" ← "Igor Thiago") → the
  // full first name is how he's known.
  if (inFirst(web) && firstToks.length <= 2) return first;

  // web_name matches NEITHER the first nor the second name, and he isn't a known
  // mononym — FPL's web_name is unreliable here (it lists Enock Agyei as "Boateng").
  // Trust the legal name over it rather than import a different player's name.
  return [first, second].filter(Boolean).join(" ").trim() || web;
}

/** Build-time guard: no player may end up single-named unless we've said so.
 *  Called by the pool builders; throws so a bad pool can never ship. */
export function assertNames(rows) {
  const bad = rows.filter(
    (r) => !/\s/.test(r.name) && !ALLOWED_MONONYMS.has(r.name) && (r.minutes ?? 0) >= 450,
  );
  const dotted = rows.filter((r) => /\./.test(r.name));
  const problems = [];
  if (dotted.length) problems.push(`names still containing an abbreviation dot: ${dotted.map((r) => r.name).join(", ")}`);
  if (bad.length) {
    problems.push(
      `single-name regulars not in ALLOWED_MONONYMS (add them there if genuine, else fix the rule): ${bad
        .map((r) => `${r.name} (${r.club})`)
        .join(", ")}`,
    );
  }
  if (problems.length) throw new Error(`player-name: ${problems.join(" | ")}`);
}
