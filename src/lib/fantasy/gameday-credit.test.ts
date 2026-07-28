import { test } from "node:test";
import assert from "node:assert/strict";
import { gamedayEarn } from "./gameday-credit";
import { creditsForRound, raisePending } from "./engine";

/**
 * Integration test for the gameday → fantasy credit sweep, run against a faithful
 * in-memory fake of the Supabase query surface gamedayEarn actually uses. This
 * exercises the REAL function — the parts the pure unit tests can't reach: the
 * metadata.gameday match (the bridge fix), first-gameday-only, override-upward,
 * squad-holders-only, and the version CAS.
 */

// ── a tiny fake Supabase client ──────────────────────────────────────────────
// Supports exactly the chains gamedayEarn calls: select/gte/lte/order/range/in
// for reads, and update(...).eq(...).eq(...).select() for the CAS write. Awaiting
// any chain runs it against the seeded tables; an update mutates matched rows
// in place (matched === passed the version eq too, so the CAS is real).
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  class Q {
    table: string;
    preds: ((r: Row) => boolean)[] = [];
    ord: { col: string; asc: boolean } | null = null;
    mutation: Row | null = null;
    constructor(table: string) { this.table = table; }
    select() { return this; }
    gte(col: string, v: unknown) { this.preds.push((r) => (r[col] as number) >= (v as number)); return this; }
    lte(col: string, v: unknown) { this.preds.push((r) => (r[col] as number) <= (v as number)); return this; }
    eq(col: string, v: unknown) { this.preds.push((r) => r[col] === v); return this; }
    in(col: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[col])); return this; }
    order(col: string, opt: { ascending: boolean }) { this.ord = { col, asc: opt.ascending }; return this; }
    range() { return this; }
    update(patch: Row) { this.mutation = patch; return this; }
    then(resolve: (v: { data: Row[]; error: null }) => void) { resolve(this.run()); }
    run() {
      let rows = tables[this.table].filter((r) => this.preds.every((p) => p(r)));
      if (this.ord) {
        const { col, asc } = this.ord;
        rows = [...rows].sort((a, b) =>
          a[col]! < b[col]! ? (asc ? -1 : 1) : a[col]! > b[col]! ? (asc ? 1 : -1) : 0);
      }
      if (this.mutation) {
        for (const r of rows) Object.assign(r, this.mutation);
        return { data: rows.map((r) => ({ version: r.version })), error: null };
      }
      return { data: rows, error: null };
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => new Q(t) as any } as any;
}

const GW = { gw: 900, season: "T", mode: "live", window_start: "2025-11-08", window_end: "2025-11-10", deadline: null, status: "locked", sm_season_id: 0 };
const at = (id: string, user: string, pack: string, correct: number, hh: string) =>
  ({ id, user_id: user, pack_id: pack, correct_count: correct, completed_at: `2025-11-08T${hh}:00:00Z` });

test("gamedayEarn: first gameday quiz counts, not the best; halftime packs are ignored (bridge fix)", async () => {
  const squads = [{ user_id: "u1", pending_credits: 1, pending_gameday_done: false, version: 1, pending_source: "round" }];
  const db = fakeDb({
    quiz_packs: [
      { id: "p_gd", metadata: { gameday: {} } },      // a real gameday pack
      { id: "p_ht", metadata: { halftime: {} } },     // the DEAD key — must be ignored
      { id: "p_x", metadata: null },
    ],
    quiz_attempts: [
      at("a_ht", "u1", "p_ht", 11, "09"), // earliest, but halftime → excluded before first-of
      at("a1", "u1", "p_gd", 6, "10"),    // FIRST gameday (6 → 2)
      at("a2", "u1", "p_gd", 11, "11"),   // later, higher (11 → 4) → must be ignored
    ],
    fantasy_squads: squads,
  });

  const r = await gamedayEarn(db, GW);
  assert.equal(r.updated, 1);
  assert.equal(squads[0].pending_credits, raisePending(1, creditsForRound(6)), "tray = max(1, first quiz=2) = 2");
  assert.equal(squads[0].pending_credits, 2, "NOT 4 (the higher second) and NOT the halftime pack");
  assert.equal(squads[0].pending_gameday_done, true, "the gameday slot locked for the cycle");
  assert.equal(squads[0].pending_source, "gameday", "gameday now leads the tray (2 > 1)");
});

test("gamedayEarn: raises an empty tray, and a bombed quiz still locks the slot", async () => {
  const squads = [
    { user_id: "a", pending_credits: 0, pending_gameday_done: false, version: 1, pending_source: null },
    { user_id: "b", pending_credits: 0, pending_gameday_done: false, version: 1, pending_source: null },
  ];
  const db = fakeDb({
    quiz_packs: [{ id: "p", metadata: { gameday: {} } }],
    quiz_attempts: [at("a1", "a", "p", 9, "10"), at("b1", "b", "p", 2, "10")],
    fantasy_squads: squads,
  });
  await gamedayEarn(db, GW);
  assert.equal(squads[0].pending_credits, 3, "9/11 → 3 into an empty tray");
  assert.equal(squads[1].pending_credits, 0, "2/11 → 0, but…");
  assert.equal(squads[1].pending_gameday_done, true, "…the first quiz still spends the slot");
});

test("gamedayEarn: squad-holders only, and an already-spent slot is left alone", async () => {
  const squads = [{ user_id: "done", pending_credits: 4, pending_gameday_done: true, version: 1, pending_source: "gameday" }];
  const db = fakeDb({
    quiz_packs: [{ id: "p", metadata: { gameday: {} } }],
    quiz_attempts: [
      at("n1", "noSquad", "p", 11, "10"), // plays gameday, no fantasy squad → untouched
      at("d1", "done", "p", 11, "10"),    // slot already done → skipped, no double count
    ],
    fantasy_squads: squads,
  });
  const r = await gamedayEarn(db, GW);
  assert.equal(r.updated, 0, "nobody updated");
  assert.equal(squads[0].pending_credits, 4, "the done squad is untouched");
});
