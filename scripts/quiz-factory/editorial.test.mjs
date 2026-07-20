import { test } from "node:test";
import assert from "node:assert/strict";
import { editorialVerdict, applyEditorialGate, editorialReport } from "./editorial.mjs";

const drops = (s) => editorialVerdict(s);
const keeps = (s) => editorialVerdict(s) === null;

// ── The fact that caused this gate to exist ───────────────────────────────────
test("drops the Newcastle hooligan-firm fact that passed every other check", () => {
  const v = drops(
    "In March 2002, a pre-arranged clash between Sunderland's 'Seaburn Casuals' and Newcastle's 'Gremlins' hooligan firms near the North Shields Ferry terminal was described as some of the worst football-related fighting ever seen in the UK, with the ringleaders jailed for four years."
  );
  assert.ok(v, "must be dropped");
  assert.equal(v.label, "hooliganism");
});

// ── FALSE POSITIVES: ordinary football writing that must survive ──────────────
// This block is the point of the file. A gate that bins real history is worse than no gate,
// because it fails silently and the bank just quietly gets thinner.
test("keeps violent football IDIOM — the whole false-positive risk", () => {
  assert.ok(keeps("Newcastle United crushed Sunderland 5-1 at St James' Park in the 2010/11 Premier League season."));
  assert.ok(keeps("Alan Shearer fired a shot into the top corner against Everton in the 1996/97 Premier League season."));
  assert.ok(keeps("Arsenal killed off the tie with a second goal in the 2005/06 Champions League quarter-final."));
  assert.ok(keeps("The 2005 FA Cup final between Arsenal and Manchester United was decided on penalties."));
  assert.ok(keeps("Liverpool faced Chelsea in a top-of-the-table clash in the 2008/09 Premier League season."));
  assert.ok(keeps("Peter Beardsley scored a hat-trick as Newcastle beat Sunderland 3-1 on New Year's Day 1985."));
});

test("keeps a routine suspension — a ban is not a scandal", () => {
  assert.ok(keeps("Roy Keane was banned for three matches after being sent off against Manchester City in the 2001/02 Premier League season."));
  assert.ok(keeps("Newcastle United were banned from signing players during one transfer window."));
});

test("keeps ordinary injury news", () => {
  assert.ok(keeps("Michael Owen missed part of the 2005/06 season through injury after a broken metatarsal."));
});

test("keeps 'Munich' when it means the German club, not the crash", () => {
  assert.ok(keeps("Manchester United beat Bayern Munich in the 1999 Champions League final at the Camp Nou."));
});

// ── TRUE POSITIVES by category ────────────────────────────────────────────────
test("drops crowd violence", () => {
  assert.equal(drops("A Tyne-Wear derby at St James' Park in 1901 was abandoned after rioting broke out.").label, "hooliganism");
  assert.equal(drops("The match was marred by crowd trouble in the away end.").label, "hooliganism");
});

test("drops deaths and stadium disasters", () => {
  assert.equal(drops("The Hillsborough disaster occurred during the 1989 FA Cup semi-final.").label, "tragedy");
  assert.equal(drops("Eight Manchester United players died in the Munich air disaster in 1958.").label, "tragedy");
  assert.equal(drops("Fifty-six supporters were killed in the Bradford City fire in 1985.").label, "tragedy");
});

test("drops crime and court outcomes", () => {
  assert.equal(drops("The club's former chairman was convicted of fraud in 2003.").label, "crime");
  assert.equal(drops("Two supporters were arrested after the 2002 derby.").label, "crime");
});

test("drops discrimination and abuse", () => {
  assert.equal(drops("The striker was subjected to racist abuse during the 2019/20 Premier League season.").label, "abuse");
});

test("drops doping and betting scandal, and career-ending injury", () => {
  assert.equal(drops("The midfielder failed a drugs test in the 1994/95 season.").label, "scandal");
  assert.equal(drops("His career-ending injury came in the 2002/03 Premier League season.").label, "injury");
  assert.equal(drops("The goalkeeper suffered a cardiac arrest during the match.").label, "injury");
});

// ── The list API ──────────────────────────────────────────────────────────────
test("applyEditorialGate splits and explains", () => {
  const facts = [
    { fact: "Newcastle United won the 1969 Inter-Cities Fairs Cup." },
    { fact: "Ringleaders of the 2002 hooligan clash were jailed for four years." },
    { fact: "Newcastle beat Sunderland 5-1 in October 2010." },
  ];
  const { kept, dropped } = applyEditorialGate(facts);
  assert.equal(kept.length, 2);
  assert.equal(dropped.length, 1);
  assert.ok(dropped[0].term);
  assert.match(editorialReport(dropped), /hooliganism/);
});

test("editorialReport is null when nothing was dropped", () => {
  assert.equal(editorialReport([]), null);
});

test("tolerates missing or malformed facts", () => {
  assert.equal(editorialVerdict(undefined), null);
  assert.deepEqual(applyEditorialGate(null), { kept: [], dropped: [] });
});
