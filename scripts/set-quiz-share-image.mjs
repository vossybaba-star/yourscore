/**
 * Attach a hand-made social share image (the Twitter/X link "face") to a quiz
 * pack. Uploads a local image to the public `quiz-share` Supabase Storage bucket
 * and points quiz_packs.metadata.share_image at the resulting public URL.
 *
 * The per-quiz metadata layout (src/app/challenges/[slug]/layout.tsx) prefers
 * this image for og:image / twitter:image; if it's absent it falls back to the
 * auto-generated card at /api/og/quiz. So attaching is optional per quiz.
 *
 * The image is used EXACTLY as given (no cropping/resizing). Twitter's
 * summary_large_image wants 1200x630 (1.91:1) — the script WARNS if the file
 * isn't that size but never alters it.
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *
 * Two image kinds (‑‑type):
 *   share (default) — the Twitter/X link card. Ideal 1200x630 (1.91:1).
 *   cover           — the in-app card art (home featured row, /play cards, quiz
 *                     intro hero). Ideal 1536x1024 (3:2), clean artwork, no logo.
 *
 * Usage:
 *   node scripts/set-quiz-share-image.mjs --slug <slug> --image <path>                     # DRY RUN (share)
 *   node scripts/set-quiz-share-image.mjs --slug <slug> --image <path> --commit            # attach share card
 *   node scripts/set-quiz-share-image.mjs --slug <slug> --image <path> --type cover --commit  # attach in-app cover
 *   node scripts/set-quiz-share-image.mjs --pid  <id>   --image <path> --type cover --commit
 */

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const slug = flag("--slug");
const pid = flag("--pid");
const imagePath = flag("--image");
const TYPE = (flag("--type") || "share").toLowerCase(); // "share" (Twitter card) | "cover" (in-app art)
const COMMIT = args.includes("--commit");

const BUCKET = "quiz-share";

// Per-type spec: which metadata key, storage suffix, and ideal aspect ratio.
const SPEC = {
  share: { key: "share_image", suffix: "", idealW: 1200, idealH: 630, label: "Twitter card" },
  cover: { key: "cover_image", suffix: "-cover", idealW: 1536, idealH: 1024, label: "in-app cover (3:2)" },
}[TYPE];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// slugify — must match src/lib/utils.ts exactly (slug ⇄ pack name resolution).
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

// Minimal image dimension reader (warn-only): PNG, GIF, JPEG. Returns {w,h} or null.
function imageSize(buf) {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

if (!SPEC) fail(`--type must be "share" or "cover" (got "${TYPE}")`);
if (!imagePath) fail("--image <path> required");
if (!slug && !pid) fail("--slug <slug> or --pid <id> required");
if (!existsSync(imagePath)) fail(`image not found: ${imagePath}`);
if (!SUPABASE_URL) fail("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL");
if (COMMIT && !SERVICE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY required for --commit");

const buf = readFileSync(imagePath);
const ext = (extname(imagePath).slice(1) || "png").toLowerCase();
const contentType = MIME[ext];
if (!contentType) fail(`unsupported image type ".${ext}" (use png/jpg/webp/gif)`);

const dims = imageSize(buf);
const sizeKB = Math.round(buf.length / 1024);

console.log(`\nImage: ${imagePath}  (--type ${TYPE} · ${SPEC.label})`);
console.log(`  type=${contentType}  size=${sizeKB} KB  dimensions=${dims ? `${dims.w}x${dims.h}` : "unknown"}`);
if (dims) {
  const idealRatio = SPEC.idealW / SPEC.idealH;
  const ratio = dims.w / dims.h;
  // Same aspect ratio (within ~4%) fills the slot with no cropping, even if pixel size differs.
  if (Math.abs(ratio - idealRatio) / idealRatio > 0.04) {
    console.log(`  ⚠ Prefer ${SPEC.idealW}x${SPEC.idealH} (${idealRatio.toFixed(2)}:1). This is ${dims.w}x${dims.h} (${ratio.toFixed(2)}:1) — it may be cropped.`);
  }
}
if (TYPE === "share" && sizeKB > 5120) console.log(`  ⚠ ${sizeKB} KB is over Twitter's ~5 MB limit; the card may not render.`);

const supabase = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

// Resolve the pack (id, name, current metadata) by pid or slug.
async function resolvePack() {
  if (pid) {
    const { data } = await supabase.from("quiz_packs").select("id, name, metadata").eq("id", pid).maybeSingle();
    return data ?? null;
  }
  const { data: list } = await supabase.from("quiz_packs").select("id, name, metadata").eq("status", "published");
  return ((list ?? []).find((p) => slugify(p.name) === slug)) ?? null;
}

if (!COMMIT) {
  console.log(`\nDRY RUN — nothing uploaded or changed.`);
  console.log(`Target: ${pid ? `pid=${pid}` : `slug=${slug}`}`);
  console.log(`Would upload to bucket "${BUCKET}" and set metadata.share_image, then the link image goes live immediately.`);
  console.log(`Re-run with --commit to apply.`);
  process.exit(0);
}

const pack = await resolvePack();
if (!pack) fail(`no published pack found for ${pid ? `pid=${pid}` : `slug "${slug}"`}`);

const packSlug = slugify(pack.name);
const objectPath = `${packSlug}${SPEC.suffix}.${ext}`;

// Ensure the public bucket exists (idempotent).
const { data: buckets } = await supabase.storage.listBuckets();
if (!buckets?.some((b) => b.name === BUCKET)) {
  console.log(`\nCreating public bucket "${BUCKET}"…`);
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "6MB",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  });
  if (error) fail(`createBucket: ${error.message}`);
}

console.log(`\nUploading ${objectPath} → ${BUCKET}…`);
const { error: upErr } = await supabase.storage
  .from(BUCKET)
  .upload(objectPath, buf, { contentType, upsert: true, cacheControl: "3600" });
if (upErr) fail(`upload: ${upErr.message}`);

const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
// Cache-bust so re-attaching a new image for the same quiz isn't masked by CDN/Twitter caches.
const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

const newMeta = {
  ...(pack.metadata || {}),
  [SPEC.key]: publicUrl,
  [`${SPEC.key}_w`]: dims?.w,
  [`${SPEC.key}_h`]: dims?.h,
};
const { error: updErr } = await supabase
  .from("quiz_packs")
  .update({ metadata: newMeta, updated_at: new Date().toISOString() })
  .eq("id", pack.id);
if (updErr) fail(`update metadata: ${updErr.message}`);

console.log(`\n✓ Attached ${SPEC.label} to "${pack.name}"`);
console.log(`  image: ${publicUrl}`);
console.log(`  quiz:  https://yourscore.app/challenges/${packSlug}`);
if (TYPE === "share") {
  console.log(`\nLive now. Validate the unfurl: https://cards-dev.twitter.com/validator (paste the quiz URL).`);
} else {
  console.log(`\nLive now in-app: Home featured row, /play cards, and the quiz intro screen.`);
}
