import { test } from "node:test";
import assert from "node:assert/strict";
import { blocks, priorityOf } from "./notifyPriority";

test("club news is breaking, scheduled sends are routine", () => {
  assert.equal(priorityOf("club-news:Arsenal:abc123"), "breaking");
  assert.equal(priorityOf("daily-game-push:2026-08-05"), "routine");
  assert.equal(priorityOf("daily-debate-push:2026-08-05"), "routine");
  assert.equal(priorityOf("pl-briefing:2026-08-05"), "routine");
});

test("an unknown key is routine, never breaking", () => {
  // Guessing "breaking" would let some unrelated system silence real news.
  assert.equal(priorityOf("some-future-thing:1"), "routine");
});

test("the game reminder no longer silences breaking news", () => {
  // The exact case reported: reminder at 11:30, club news blocked until 15:30.
  assert.equal(blocks("daily-game-push:2026-08-05", "breaking"), false);
  assert.equal(blocks("daily-debate-push:2026-08-05", "breaking"), false);
});

test("breaking news still spaces itself, and still blocks routine", () => {
  assert.equal(blocks("club-news:Arsenal:abc", "breaking"), true);
  assert.equal(blocks("club-news:Arsenal:abc", "routine"), true);
  assert.equal(blocks("daily-game-push:x", "routine"), true);
});
