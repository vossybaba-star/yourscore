import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";

// POST { url } → brand kit (name, color, logo, wallpaper) pulled from a venue's
// site. Claude (Opus 4.8) reads the page and picks the right assets — far better
// than tag-scraping on messy sites; regex/meta extraction is the fallback when no
// ANTHROPIC_API_KEY is set or the model call fails. Admin-only (it spends the key
// + fetches arbitrary external sites). Mirrors ~/yourscore-club-preview/server.mjs.

export const runtime = "nodejs";

function normalizeUrl(input: string): URL | null {
  let s = (input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { return new URL(s); } catch { return null; }
}
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "0.0.0.0" || h === "::1") return true;
  return false;
}
function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? (tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null) : null;
}
function linkHref(html: string, relNeedle: string): string | null {
  const re = new RegExp(`<link[^>]+rel=["'][^"']*${relNeedle}[^"']*["'][^>]*>`, "gi");
  const tag = html.match(re)?.[0];
  return tag?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
}
function absUrl(base: URL, maybe: string | null): string | null {
  if (!maybe) return null;
  try { return new URL(maybe, base).toString(); } catch { return null; }
}
function decodeEntities(s: string | null): string | null {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|#39);/g, (_, n) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ", ndash: "–", mdash: "—" } as Record<string, string>)[n] ?? "");
}
function cleanName(raw: string | null): string | null {
  if (!raw) return null;
  const dec = decodeEntities(raw)!;
  const first = dec.split(/\s+[|\-–—·•]\s+/)[0].trim();
  return (first || dec).slice(0, 40) || null;
}
function regexExtract(html: string, base: URL) {
  const name =
    cleanName(metaContent(html, "og:site_name")) ??
    cleanName(metaContent(html, "application-name")) ??
    cleanName(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null) ??
    cleanName(base.hostname.replace(/^www\./, ""));
  const wallpaper = absUrl(base, metaContent(html, "og:image")) ?? absUrl(base, metaContent(html, "twitter:image"));
  const logo =
    absUrl(base, linkHref(html, "apple-touch-icon")) ??
    absUrl(base, metaContent(html, "og:logo")) ??
    absUrl(base, linkHref(html, "icon")) ??
    `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=256`;
  const rawColor = metaContent(html, "theme-color") ?? metaContent(html, "msapplication-TileColor");
  const color = rawColor && /^#?[0-9a-fA-F]{3,6}$/.test(rawColor.trim()) ? rawColor.trim().replace(/^#/, "") : null;
  return { name, color, logo, wallpaper };
}
function collectCandidates(html: string, base: URL): string[] {
  const urls = new Set<string>();
  const push = (u: string | null | undefined) => { if (!u) return; const a = absUrl(base, u); if (a && /^https?:/.test(a) && !/^data:/.test(u)) urls.add(a); };
  Array.from(html.matchAll(/<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon|image_src)[^"']*["'][^>]*>/gi))
    .forEach((m) => push(m[0].match(/href=["']([^"']+)["']/i)?.[1]));
  for (const p of ["og:image", "og:logo", "twitter:image"]) push(metaContent(html, p));
  Array.from(html.slice(0, 60000).matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).forEach((m) => push(m[1]));
  return Array.from(urls).slice(0, 30);
}

async function fetchPage(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/124 Safari/537.36", accept: "text/html" },
    });
    if (!res.ok) throw new Error(`Site responded ${res.status}`);
    return { html: (await res.text()).slice(0, 600000), base: new URL(res.url || url) };
  } finally {
    clearTimeout(t);
  }
}

async function enrichAI(html: string, base: URL, apiKey: string) {
  const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html.slice(0, 20000)).slice(0, 18000);
  const candidates = collectCandidates(html, base);
  const SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["name", "logo_url", "wallpaper_url", "brand_color"],
    properties: { name: { type: "string" }, logo_url: { type: "string" }, wallpaper_url: { type: "string" }, brand_color: { type: "string" } },
  };
  const prompt =
    `Extract brand assets for a marketing mockup of this venue's page.\n\n` +
    `Rules:\n- name: the venue's real display name, cleanly decoded (no HTML entities, drop trailing site descriptors like " – Drinks and Table football" or " | Home").\n` +
    `- logo_url: the squarish brand mark/crest/icon (prefer apple-touch-icon, a header logo <img>, or og:logo). NOT a wide photo. Absolute URL from the candidates or head. "" if none.\n` +
    `- wallpaper_url: a large atmospheric hero/interior photo that sets the mood (often og:image). NOT the logo. Absolute URL. "" if none.\n` +
    `- brand_color: primary brand colour as 6 hex digits, no '#'. Use theme-color/CSS if present, else infer from the brand. "" if unsure.\n\n` +
    `Base origin: ${base.origin}\n\nCandidate image URLs:\n${candidates.join("\n") || "(none found)"}\n\nHTML <head>:\n${head}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: ctrl.signal,
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-opus-4-8", max_tokens: 600,
      system: "You extract brand assets (name, logo, wallpaper, colour) from a website's HTML for a venue marketing mockup. Be precise; never invent URLs not present in the input.",
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    }),
  }).finally(() => clearTimeout(t));
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = (data.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "{}";
  const out = JSON.parse(text);
  const cleanUrl = (u: string) => (u && u.trim() ? absUrl(base, u.trim()) : null);
  const color = (out.brand_color || "").trim().replace(/^#/, "");
  return {
    name: (out.name || "").trim() || null,
    logo: cleanUrl(out.logo_url),
    wallpaper: cleanUrl(out.wallpaper_url),
    color: /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(color) ? color : null,
  };
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: { url?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const target = normalizeUrl(body.url ?? "");
  if (!target || (target.protocol !== "https:" && target.protocol !== "http:")) {
    return NextResponse.json({ error: "Enter a valid website or domain" }, { status: 400 });
  }
  if (isBlockedHost(target.hostname)) return NextResponse.json({ error: "That host isn't allowed" }, { status: 400 });

  let page;
  try {
    page = await fetchPage(target.toString());
  } catch {
    const alt = new URL(target.toString());
    alt.hostname = alt.hostname.startsWith("www.") ? alt.hostname.slice(4) : "www." + alt.hostname;
    if (!isBlockedHost(alt.hostname)) {
      try { page = await fetchPage(alt.toString()); } catch { return NextResponse.json({ error: "Could not reach that site" }, { status: 422 }); }
    } else {
      return NextResponse.json({ error: "Could not reach that site" }, { status: 422 });
    }
  }
  const { html, base } = page;

  const fb = regexExtract(html, base);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const ai = await enrichAI(html, base, apiKey);
      return NextResponse.json({
        name: ai.name || fb.name, color: ai.color || fb.color,
        logo: ai.logo || fb.logo, wallpaper: ai.wallpaper || fb.wallpaper,
        source: base.origin, via: "ai",
      });
    } catch { /* fall through to regex */ }
  }
  return NextResponse.json({ ...fb, source: base.origin, via: "regex" });
}
