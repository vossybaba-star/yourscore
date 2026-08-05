// Pure unit tests for feedRank.ts (Social Phase 5b, AC1). Not wired to CI —
// run manually: npx tsx --test src/lib/fantasy/feedRank.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreFeedEvent, rawEngagement, contentClassOf, applyDiversity, rankTop, type RankableEvent,
} from "./feedRank";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function ev(over: Partial<RankableEvent> & { actorId: string }): RankableEvent {
  return {
    actorId: over.actorId,
    type: over.type ?? "post",
    createdAt: over.createdAt ?? hoursAgo(0),
    reactions: over.reactions ?? [],
    commentCount: over.commentCount ?? 0,
    repostCount: over.repostCount ?? 0,
    poll: over.poll ?? null,
    image: over.image ?? null,
    images: over.images ?? null,
    gif: over.gif ?? null,
  };
}

test("scoreFeedEvent: weights reactions/comments/reposts 1/2/3", () => {
  const reactionsOnly = ev({ actorId: "a", reactions: [{ emoji: "❤️", count: 4 }] });
  const commentsOnly = ev({ actorId: "a", commentCount: 2 });
  const repostsOnly = ev({ actorId: "a", repostCount: 1 });
  // 4 reactions => 4; 2 comments*2 => 4; 1 repost*3 => 3 — all at age 0 (no decay).
  assert.equal(scoreFeedEvent(reactionsOnly, { now: NOW }), 4);
  assert.equal(scoreFeedEvent(commentsOnly, { now: NOW }), 4);
  assert.equal(scoreFeedEvent(repostsOnly, { now: NOW }), 3);
});

test("scoreFeedEvent: halves every 24h (time decay)", () => {
  const fresh = ev({ actorId: "a", reactions: [{ emoji: "❤️", count: 10 }], createdAt: hoursAgo(0) });
  const oneDayOld = ev({ actorId: "a", reactions: [{ emoji: "❤️", count: 10 }], createdAt: hoursAgo(24) });
  const twoDaysOld = ev({ actorId: "a", reactions: [{ emoji: "❤️", count: 10 }], createdAt: hoursAgo(48) });
  const sFresh = scoreFeedEvent(fresh, { now: NOW });
  const sOneDay = scoreFeedEvent(oneDayOld, { now: NOW });
  const sTwoDay = scoreFeedEvent(twoDaysOld, { now: NOW });
  assert.equal(sFresh, 10);
  assert.ok(Math.abs(sOneDay - 5) < 1e-9, `expected ~5, got ${sOneDay}`);
  assert.ok(Math.abs(sTwoDay - 2.5) < 1e-9, `expected ~2.5, got ${sTwoDay}`);
});

test("scoreFeedEvent: followed author gets 1.25x, only when a viewer is present", () => {
  const post = ev({ actorId: "followed-guy", reactions: [{ emoji: "❤️", count: 8 }] });
  const noViewer = scoreFeedEvent(post, { now: NOW });
  const viewerNotFollowing = scoreFeedEvent(post, { now: NOW, followedIds: new Set(["someone-else"]) });
  const viewerFollowing = scoreFeedEvent(post, { now: NOW, followedIds: new Set(["followed-guy"]) });
  assert.equal(noViewer, 8);
  assert.equal(viewerNotFollowing, 8);
  assert.equal(viewerFollowing, 10); // 8 * 1.25
});

test("rawEngagement: unweighted sum, no decay, no follow boost", () => {
  const post = ev({ actorId: "a", reactions: [{ emoji: "❤️", count: 2 }, { emoji: "🔥", count: 1 }], commentCount: 3, repostCount: 1, createdAt: hoursAgo(100) });
  assert.equal(rawEngagement(post), 2 + 1 + 3 + 1);
});

test("contentClassOf: squad_complete is its own class, ahead of everything else", () => {
  assert.equal(contentClassOf(ev({ actorId: "a", type: "squad_complete" })), "squad");
});

test("contentClassOf: non-post system events are system-activity", () => {
  for (const type of ["transfer", "captain", "chip", "haul", "rank_jump", "squad_update", "shortlist_add", "quiz_result"]) {
    assert.equal(contentClassOf(ev({ actorId: "a", type })), "system-activity", type);
  }
});

test("contentClassOf: a post splits into poll / media / text", () => {
  assert.equal(contentClassOf(ev({ actorId: "a", type: "post", poll: { question: "q" } })), "poll");
  assert.equal(contentClassOf(ev({ actorId: "a", type: "post", image: "x.jpg" })), "media");
  assert.equal(contentClassOf(ev({ actorId: "a", type: "post", images: ["x.jpg"] })), "media");
  assert.equal(contentClassOf(ev({ actorId: "a", type: "post", gif: { mp4: "x.mp4" } })), "media");
  assert.equal(contentClassOf(ev({ actorId: "a", type: "post" })), "text");
});

test("applyDiversity: never places 3 consecutive posts by the same author", () => {
  // Four posts by "a" (varied content class, so the class rule never binds
  // here — this test isolates the author rule) plus one each by "b" and "c".
  // Pigeonhole check: 4 a's need at least 2 separators to keep every run <=2
  // (a,a,X,a,a,X) — b and c supply exactly that, so this IS solvable.
  const ranked = [
    ev({ actorId: "a", type: "post" }),
    ev({ actorId: "a", type: "post", image: "1.jpg" }),
    ev({ actorId: "a", type: "haul" }),
    ev({ actorId: "a", type: "post", poll: { question: "x" } }),
    ev({ actorId: "b", type: "post" }),
    ev({ actorId: "c", type: "post" }),
  ];
  const out = applyDiversity(ranked);
  assert.equal(out.length, ranked.length, "diversity must never drop an item");
  for (let i = 0; i + 2 < out.length; i++) {
    const same = out[i].actorId === out[i + 1].actorId && out[i + 1].actorId === out[i + 2].actorId;
    assert.ok(!same, `3 consecutive same-author posts at index ${i}`);
  }
  // Both "b" and "c" must have been pulled forward to break up the run.
  assert.ok(out.some((e) => e.actorId === "b"));
  assert.ok(out.some((e) => e.actorId === "c"));
});

test("applyDiversity: never places 3 consecutive posts of the same content class", () => {
  const ranked = [
    ev({ actorId: "a", type: "post", image: "1.jpg" }),
    ev({ actorId: "b", type: "post", image: "2.jpg" }),
    ev({ actorId: "c", type: "post", image: "3.jpg" }),
    ev({ actorId: "d", type: "post", image: "4.jpg" }),
    ev({ actorId: "e", type: "post" }), // text — the only non-media post
  ];
  const out = applyDiversity(ranked);
  assert.equal(out.length, ranked.length);
  for (let i = 0; i + 2 < out.length; i++) {
    const c0 = contentClassOf(out[i]), c1 = contentClassOf(out[i + 1]), c2 = contentClassOf(out[i + 2]);
    assert.ok(!(c0 === c1 && c1 === c2), `3 consecutive ${c0} at index ${i}`);
  }
});

test("applyDiversity: demotes (reorders) rather than dropping — output is a permutation of the input", () => {
  const ranked = [ev({ actorId: "a" }), ev({ actorId: "a" }), ev({ actorId: "a" }), ev({ actorId: "b" }), ev({ actorId: "c" })];
  const out = applyDiversity(ranked);
  assert.equal(out.length, ranked.length);
  const inIds = ranked.map((e) => e).sort();
  const outIds = out.map((e) => e).sort();
  assert.deepEqual(outIds, inIds, "every original object must still be present exactly once");
});

test("applyDiversity: degenerate case (everything same author) never infinite-loops and keeps every item", () => {
  const ranked = Array.from({ length: 8 }, () => ev({ actorId: "only-author" }));
  const out = applyDiversity(ranked);
  assert.equal(out.length, 8);
});

test("rankTop: higher score sorts first, subject to the diversity pass", () => {
  const a1 = ev({ actorId: "a", type: "post", reactions: [{ emoji: "❤️", count: 100 }] });
  const a2 = ev({ actorId: "a", type: "post", image: "x.jpg", reactions: [{ emoji: "❤️", count: 90 }] });
  const a3 = ev({ actorId: "a", type: "haul", reactions: [{ emoji: "❤️", count: 80 }] }); // distinct class from a1/a2
  const b1 = ev({ actorId: "b", type: "post", reactions: [{ emoji: "❤️", count: 1 }] });
  const out = rankTop([b1, a3, a1, a2], { now: NOW });
  // a1/a2 (highest two) lead; a3 (3rd consecutive "a") must be demoted below b1.
  assert.equal(out[0].actorId, "a");
  assert.equal(out[1].actorId, "a");
  assert.equal(out[2].actorId, "b", "b1 should be pulled forward ahead of a's 3rd consecutive post");
});
