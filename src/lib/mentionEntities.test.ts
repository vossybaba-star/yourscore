import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMentionEntities, MAX_MENTION_ENTITIES } from "./mentionEntities";

// A tiny ownerOf builder — mirrors what resolveUsernames returns (lowercased
// handle -> {id, username}), without touching a real DB.
function owners(pairs: [string, { id: string; username: string }][]) {
  return new Map(pairs.map(([h, u]) => [h, u]));
}

test("buildMentionEntities: a valid entity (in text, userId matches current owner) is kept", () => {
  const text = "Nice one @Bob";
  const submitted = [{ userId: "u1", usernameSnapshot: "Bob" }];
  const ownerOf = owners([["bob", { id: "u1", username: "Bob" }]]);
  const out = buildMentionEntities(text, submitted, ownerOf);
  assert.deepEqual(out, [{ userId: "u1", usernameSnapshot: "Bob" }]);
});

test("buildMentionEntities: an entity whose handle isn't in the text is dropped", () => {
  const text = "no handle here at all";
  const submitted = [{ userId: "u1", usernameSnapshot: "Bob" }];
  const ownerOf = owners([["bob", { id: "u1", username: "Bob" }]]);
  const out = buildMentionEntities(text, submitted, ownerOf);
  assert.deepEqual(out, []);
});

test("buildMentionEntities: a stale tag (username reassigned since pick time) is dropped, never re-attributed", () => {
  const text = "hey @bob";
  // The client tagged u1 as "bob", but the current owner of "bob" is u2 —
  // ownerOf doesn't even know about u1 anymore (a genuine rename-away), so
  // the handle resolves to nothing rather than falling back to the wrong id.
  const submitted = [{ userId: "u1", usernameSnapshot: "bob" }];
  const ownerOf = owners([]); // "bob" no longer resolves to u1 at all
  const out = buildMentionEntities(text, submitted, ownerOf);
  assert.deepEqual(out, []);
});

test("buildMentionEntities: a stale tag falls back to the CURRENT owner, same as an untagged handle", () => {
  const text = "hey @bob";
  const submitted = [{ userId: "u1", usernameSnapshot: "bob" }]; // stale — bob is now u2
  const ownerOf = owners([["bob", { id: "u2", username: "bob" }]]);
  const out = buildMentionEntities(text, submitted, ownerOf);
  assert.deepEqual(out, [{ userId: "u2", usernameSnapshot: "bob" }]);
});

test("buildMentionEntities: cap enforced at MAX_MENTION_ENTITIES", () => {
  const handles = Array.from({ length: 12 }, (_, i) => `user${i}`);
  const text = handles.map((h) => `@${h}`).join(" ");
  const submitted = handles.map((h) => ({ userId: `id-${h}`, usernameSnapshot: h }));
  const ownerOf = owners(handles.map((h) => [h, { id: `id-${h}`, username: h }] as const));
  const out = buildMentionEntities(text, submitted, ownerOf);
  assert.equal(out.length, MAX_MENTION_ENTITIES);
  assert.equal(MAX_MENTION_ENTITIES, 10);
});

test("buildMentionEntities: merges a tagged entity with an untagged regex handle in the same text", () => {
  const text = "cc @alice and @bob";
  const submitted = [{ userId: "u-alice", usernameSnapshot: "alice" }]; // bob never picked from autocomplete
  const ownerOf = owners([
    ["alice", { id: "u-alice", username: "alice" }],
    ["bob", { id: "u-bob", username: "bob" }],
  ]);
  const out = buildMentionEntities(text, submitted, ownerOf);
  assert.deepEqual(out, [
    { userId: "u-alice", usernameSnapshot: "alice" },
    { userId: "u-bob", usernameSnapshot: "bob" },
  ]);
});

test("buildMentionEntities: no handles in text -> empty, regardless of what was submitted", () => {
  const out = buildMentionEntities("nothing to see here", [{ userId: "u1", usernameSnapshot: "bob" }], owners([]));
  assert.deepEqual(out, []);
});

test("buildMentionEntities: a malformed submitted entry (missing fields) is ignored, not thrown", () => {
  const text = "hey @bob";
  const submitted = [{ userId: "u1" }, { usernameSnapshot: "bob" }, null, "garbage", 42];
  const ownerOf = owners([["bob", { id: "u1", username: "bob" }]]);
  const out = buildMentionEntities(text, submitted as unknown, ownerOf);
  // None of the malformed entries validate as the submitted tag, but the
  // handle is still real, so it falls back to resolving fresh.
  assert.deepEqual(out, [{ userId: "u1", usernameSnapshot: "bob" }]);
});
