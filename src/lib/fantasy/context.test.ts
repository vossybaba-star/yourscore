/**
 * The club-identity test.
 *
 * This exists because of a bug that did not throw, did not log, and looked right
 * on screen: the fixture ticker keys clubs by SportMonks id and the player pool
 * keys them by FPL id, both small integers in the same range. Joining them gave
 * Chelsea Tottenham's fixtures and Liverpool Manchester United's, on the transfer
 * screen, silently. Nothing about the output looked wrong unless you knew the
 * real fixture list.
 *
 * So the contract under test is not "the mapping works" but "every club in the
 * pool resolves to a run BY NAME, and a club that doesn't resolve takes the whole
 * ticker down with it".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clubKey } from "./clubKey";

// The 20 names SportMonks served for 2026/27, verbatim from the built feed doc.
const SPORTMONKS_NAMES = [
  "Sunderland", "Tottenham Hotspur", "Liverpool", "Manchester City", "Fulham",
  "Everton", "Manchester United", "Aston Villa", "Chelsea", "Arsenal",
  "Newcastle United", "Hull City", "Crystal Palace", "AFC Bournemouth",
  "Nottingham Forest", "Leeds United", "Brighton & Hove Albion", "Ipswich Town",
  "Coventry City", "Brentford",
];

// The 20 names the FPL-built pool uses for the same clubs.
const POOL_NAMES = [
  "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Chelsea",
  "Coventry City", "Crystal Palace", "Everton", "Fulham", "Hull City",
  "Ipswich Town", "Leeds", "Liverpool", "Man City", "Man Utd", "Newcastle",
  "Nott'm Forest", "Spurs", "Sunderland",
];

test("every pool club name resolves to a SportMonks club name", () => {
  const smKeys = new Set(SPORTMONKS_NAMES.map(clubKey));
  const missing = POOL_NAMES.filter((n) => !smKeys.has(clubKey(n)));
  assert.deepEqual(missing, [], `unmapped pool clubs: ${missing.join(", ")}`);
});

test("the mapping is one-to-one — no two clubs collapse onto the same key", () => {
  const keys = POOL_NAMES.map(clubKey);
  assert.equal(new Set(keys).size, POOL_NAMES.length, "two pool clubs share a key");
  const smKeys = SPORTMONKS_NAMES.map(clubKey);
  assert.equal(new Set(smKeys).size, SPORTMONKS_NAMES.length, "two SportMonks clubs share a key");
});

test("the specific pairs that silently crossed over", () => {
  // Each of these was wrong in production for the length of one screenshot.
  assert.equal(clubKey("Chelsea"), clubKey("Chelsea"));
  assert.notEqual(clubKey("Chelsea"), clubKey("Tottenham Hotspur"));
  assert.equal(clubKey("Spurs"), clubKey("Tottenham Hotspur"));
  assert.equal(clubKey("Man Utd"), clubKey("Manchester United"));
  assert.equal(clubKey("Man City"), clubKey("Manchester City"));
  assert.equal(clubKey("Bournemouth"), clubKey("AFC Bournemouth"));
  assert.equal(clubKey("Nott'm Forest"), clubKey("Nottingham Forest"));
  assert.equal(clubKey("Brighton"), clubKey("Brighton & Hove Albion"));
  assert.equal(clubKey("Newcastle"), clubKey("Newcastle United"));
  assert.equal(clubKey("Leeds"), clubKey("Leeds United"));
});
