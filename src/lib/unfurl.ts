/**
 * Link unfurling (Social Phase 2b) — server-only. Given a URL, fetches the
 * page and pulls out enough to render a preview card: og:title/description/
 * image/site_name, falling back to <title> and to just the domain.
 *
 * SSRF guard is non-negotiable: this endpoint fetches a URL a signed-in user
 * hands it, so without a guard it's an open proxy onto our own private
 * network (metadata endpoints, internal services, localhost). Every hostname
 * — including every redirect hop — is resolved and checked against the
 * private/reserved ranges before we connect to it.
 *
 * Caching lives in `link_previews` (migration 250, NOT yet applied — every
 * DB call here is wrapped so a missing table degrades to fetch-without-cache
 * rather than throwing, per AC8).
 */
import "server-only";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  domain: string;
}

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_DAYS = 7;
const TITLE_MAX = 200;
const DESC_MAX = 300;
const URL_MAX = 600;

// ── SSRF guard ────────────────────────────────────────────────────────────

/** True for any IPv4 address in a private/reserved/loopback/link-local range. */
function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → refuse
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4) + broadcast
  return false;
}

/** True for any IPv6 address in a private/reserved/loopback/link-local range.
 *  Also unwraps IPv4-mapped addresses (::ffff:a.b.c.d) to the v4 check. */
function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  // fc00::/7 (unique local) — first 7 bits are 1111 110, i.e. first hex nibble fc or fd.
  const firstGroup = lower.split(":")[0];
  if (/^f[cd]/.test(firstGroup)) return true;
  // fe80::/10 (link-local).
  if (/^fe[89ab]/.test(firstGroup)) return true;
  return false;
}

function isPrivateIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip);
  return true; // not a recognisable IP → refuse rather than guess
}

export class UnfurlBlockedError extends Error {
  constructor(message: string) { super(message); }
}

/** Validate one hop's URL: http(s) only, and the host resolves to nothing
 *  private/reserved. Literal IP hosts are checked directly, before any DNS
 *  lookup even runs. Throws UnfurlBlockedError on any violation. */
async function assertSafeHop(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnfurlBlockedError("Only http/https links are supported");
  }
  // Node's URL.hostname keeps the brackets on an IPv6 literal ("[::1]") —
  // strip them before the IP check, or a bracketed literal falls through to
  // the DNS branch instead of being recognised and checked directly.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateIP(host)) throw new UnfurlBlockedError("That host isn't reachable");
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new UnfurlBlockedError("That host isn't reachable");
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnfurlBlockedError("Couldn't resolve that host");
  }
  if (!addresses.length || addresses.some((a) => isPrivateIP(a.address))) {
    throw new UnfurlBlockedError("That host isn't reachable");
  }
}

// ── fetch + parse ─────────────────────────────────────────────────────────

async function fetchWithGuard(startUrl: string): Promise<{ html: string | null; finalUrl: URL }> {
  let current = new URL(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeHop(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; YourScoreBot/1.0; +https://yourscore.app)" },
      });
    } finally {
      clearTimeout(timer);
    }
    // Manual redirect: fetch reports 3xx with a Location header rather than
    // following it — re-validate the NEXT hop before we ever connect to it.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { html: null, finalUrl: current };
      if (hop === MAX_REDIRECTS) throw new UnfurlBlockedError("Too many redirects");
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) return { html: null, finalUrl: current };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return { html: null, finalUrl: current };
    // Read at most MAX_BODY_BYTES — a preview only ever needs the <head>.
    const reader = res.body?.getReader();
    if (!reader) { return { html: await res.text(), finalUrl: current }; }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        chunks.push(value);
        if (total >= MAX_BODY_BYTES) { void reader.cancel().catch(() => {}); break; }
      }
    }
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    return { html, finalUrl: current };
  }
  throw new UnfurlBlockedError("Too many redirects");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function clean(s: string, max: number): string {
  return stripTags(decodeEntities(s)).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Tolerant meta-tag pull: matches either attribute order
 *  (property/name before or after content), single or double quotes. */
function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1] ?? null;
}

/** og:image must itself be an http(s) URL — never a data: URI or a relative
 *  path we'd have to trust the origin to resolve safely. */
function safeImageUrl(raw: string | null, base: URL): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().slice(0, URL_MAX);
  } catch { return null; }
}

function parseHtml(html: string, finalUrl: URL): LinkPreview {
  const title = metaContent(html, ["og:title", "twitter:title"]) ?? titleTag(html);
  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  const siteName = metaContent(html, ["og:site_name"]);
  const image = metaContent(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
  return {
    url: finalUrl.toString().slice(0, URL_MAX),
    title: title ? clean(title, TITLE_MAX) : null,
    description: description ? clean(description, DESC_MAX) : null,
    siteName: siteName ? clean(siteName, 100) : null,
    image: safeImageUrl(image, finalUrl),
    domain: finalUrl.hostname.replace(/^www\./, ""),
  };
}

// ── cache ─────────────────────────────────────────────────────────────────

function normalise(raw: string): string {
  try {
    const u = new URL(raw);
    return u.toString();
  } catch { return raw; }
}

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

interface CacheRow {
  url: string; title: string | null; description: string | null;
  site_name: string | null; image: string | null; fetched_at: string;
}

async function readCache(db: Db, hash: string): Promise<LinkPreview | null> {
  try {
    const { data, error } = await db.from("link_previews").select("*").eq("url_hash", hash).maybeSingle();
    if (error || !data) return null;
    const row = data as CacheRow;
    const ageMs = Date.now() - new Date(row.fetched_at).getTime();
    if (ageMs > CACHE_DAYS * 24 * 60 * 60 * 1000) return null;
    let domain = "";
    try { domain = new URL(row.url).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
    return {
      url: row.url, title: row.title, description: row.description,
      siteName: row.site_name, image: row.image, domain,
    };
  } catch {
    return null; // table absent / RLS surprise / transient — fall through to a live fetch
  }
}

async function writeCache(db: Db, hash: string, preview: LinkPreview): Promise<void> {
  try {
    await db.from("link_previews").upsert({
      url_hash: hash, url: preview.url, title: preview.title, description: preview.description,
      site_name: preview.siteName, image: preview.image, fetched_at: new Date().toISOString(),
    });
  } catch { /* cache is best-effort — the preview itself already succeeded */ }
}

/** Unfurl one URL: cached row if fresh, else a guarded live fetch + upsert.
 *  Never throws for an ordinary "couldn't unfurl this" outcome — returns a
 *  minimal {domain}-only preview instead, so the composer just shows less,
 *  not an error. Only genuinely bad input (not http/https, blocked host)
 *  throws UnfurlBlockedError, which the route turns into a 4xx. */
export async function unfurlUrl(db: Db, rawUrl: string): Promise<LinkPreview> {
  const trimmed = rawUrl.trim().slice(0, URL_MAX);
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new UnfurlBlockedError("Not a valid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnfurlBlockedError("Only http/https links are supported");
  }
  // Reject a literal private/reserved IP host up front — before touching DNS
  // or the cache — so it never even shows up as a cache key worth writing.
  await assertSafeHop(parsed);

  const normalised = normalise(trimmed);
  const hash = urlHash(normalised);
  const domain = parsed.hostname.replace(/^www\./, "");

  const cached = await readCache(db, hash);
  if (cached) return cached;

  try {
    const { html, finalUrl } = await fetchWithGuard(normalised);
    const preview = html ? parseHtml(html, finalUrl) : { url: normalised, title: null, description: null, siteName: null, image: null, domain };
    void writeCache(db, hash, preview);
    return preview;
  } catch (e) {
    if (e instanceof UnfurlBlockedError) throw e;
    // Fetch/timeout/parse failure — a minimal card beats an error toast.
    return { url: normalised, title: null, description: null, siteName: null, image: null, domain };
  }
}
