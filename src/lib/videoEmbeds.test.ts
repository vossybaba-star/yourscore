// Pure unit tests for videoEmbeds.ts (Social video build 2D). Not wired to
// CI — run manually: npx tsx --test src/lib/videoEmbeds.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveYouTube, youTubeEmbedUrl, youTubeThumbUrl, YOUTUBE_ID_RE } from "./videoEmbeds";

const ID = "dQw4w9WgXcQ"; // 11 chars, real YouTube id shape

test("resolveYouTube: watch?v= shape", () => {
  assert.deepEqual(resolveYouTube(`https://www.youtube.com/watch?v=${ID}`), { videoId: ID });
  assert.deepEqual(resolveYouTube(`https://youtube.com/watch?v=${ID}&t=30s`), { videoId: ID });
  assert.deepEqual(resolveYouTube(`https://m.youtube.com/watch?v=${ID}`), { videoId: ID });
});

test("resolveYouTube: youtu.be short link", () => {
  assert.deepEqual(resolveYouTube(`https://youtu.be/${ID}`), { videoId: ID });
  assert.deepEqual(resolveYouTube(`https://youtu.be/${ID}?t=5`), { videoId: ID });
});

test("resolveYouTube: shorts", () => {
  assert.deepEqual(resolveYouTube(`https://www.youtube.com/shorts/${ID}`), { videoId: ID });
});

test("resolveYouTube: embed", () => {
  assert.deepEqual(resolveYouTube(`https://www.youtube.com/embed/${ID}`), { videoId: ID });
});

test("resolveYouTube: rejects malformed ids", () => {
  assert.equal(resolveYouTube("https://www.youtube.com/watch?v=short"), null);
  assert.equal(resolveYouTube("https://www.youtube.com/watch?v=" + "x".repeat(12)), null);
  assert.equal(resolveYouTube("https://www.youtube.com/watch?v=bad!id#### "), null);
  assert.equal(resolveYouTube("https://youtu.be/short"), null);
  assert.equal(resolveYouTube(`https://www.youtube.com/shorts/${"y".repeat(10)}`), null);
});

test("resolveYouTube: rejects non-YouTube hosts and non-video pages", () => {
  assert.equal(resolveYouTube(`https://vimeo.com/${ID}`), null);
  assert.equal(resolveYouTube("https://www.youtube.com/"), null);
  assert.equal(resolveYouTube("https://www.youtube.com/channel/UC123"), null);
  assert.equal(resolveYouTube("https://www.youtube.com/results?search_query=x"), null);
  assert.equal(resolveYouTube("not a url at all"), null);
  assert.equal(resolveYouTube("javascript:alert(1)"), null);
});

test("resolveYouTube: rejects a lookalike host", () => {
  assert.equal(resolveYouTube(`https://youtube.com.evil.example/watch?v=${ID}`), null);
  assert.equal(resolveYouTube(`https://notyoutube.com/watch?v=${ID}`), null);
});

test("youTubeEmbedUrl / youTubeThumbUrl: build the expected privacy-enhanced URLs", () => {
  assert.equal(youTubeEmbedUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}?playsinline=1`);
  assert.equal(youTubeThumbUrl(ID), `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
});

test("YOUTUBE_ID_RE: exported for server-side re-validation", () => {
  assert.ok(YOUTUBE_ID_RE.test(ID));
  assert.ok(!YOUTUBE_ID_RE.test("../../etc/passwd"));
  assert.ok(!YOUTUBE_ID_RE.test(""));
});
