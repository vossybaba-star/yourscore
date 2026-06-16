import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";

// POST { url } → best-effort brand kit pulled from a pub/venue/brand's own site,
// so the Club League mockup can be generated "for real" from just their domain.
// Returns { name, color, logo, wallpaper } — any field may be null; the generator
// page lets the operator fill gaps and override. Admin-only (it fetches arbitrary
// external sites server-side).

function normalizeUrl(input: string): URL | null {
  let s = (input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

// Block obvious SSRF targets (this fetches operator-supplied hosts).
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
  if (!tag) return null;
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
}

function linkHref(html: string, relNeedle: string): string | null {
  const re = new RegExp(`<link[^>]+rel=["'][^"']*${relNeedle}[^"']*["'][^>]*>`, "gi");
  const tag = html.match(re)?.[0];
  return tag?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
}

function absUrl(base: URL, maybe: string | null): string | null {
  if (!maybe) return null;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return null;
  }
}

function cleanName(raw: string | null): string | null {
  if (!raw) return null;
  // Take the strongest chunk before a separator (" | Home", " - The Best Pub").
  const first = raw.split(/\s+[|\-–—·•]\s+/)[0].trim();
  return (first || raw).slice(0, 40) || null;
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const target = normalizeUrl(body.url ?? "");
  if (!target || (target.protocol !== "https:" && target.protocol !== "http:")) {
    return NextResponse.json({ error: "Enter a valid website or domain" }, { status: 400 });
  }
  if (isBlockedHost(target.hostname)) {
    return NextResponse.json({ error: "That host isn't allowed" }, { status: 400 });
  }

  let html = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(target.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept: "text/html",
      },
    });
    clearTimeout(t);
    if (!res.ok) {
      return NextResponse.json({ error: `Site responded ${res.status}` }, { status: 422 });
    }
    html = (await res.text()).slice(0, 600_000);
  } catch {
    return NextResponse.json({ error: "Could not reach that site" }, { status: 422 });
  }

  const base = new URL(target.toString());

  const name =
    cleanName(metaContent(html, "og:site_name")) ??
    cleanName(metaContent(html, "application-name")) ??
    cleanName(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null) ??
    cleanName(base.hostname.replace(/^www\./, ""));

  const wallpaper =
    absUrl(base, metaContent(html, "og:image")) ??
    absUrl(base, metaContent(html, "twitter:image"));

  const logo =
    absUrl(base, linkHref(html, "apple-touch-icon")) ??
    absUrl(base, metaContent(html, "og:logo")) ??
    absUrl(base, linkHref(html, "icon")) ??
    `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=256`;

  const rawColor =
    metaContent(html, "theme-color") ?? metaContent(html, "msapplication-TileColor");
  const color = rawColor && /^#?[0-9a-fA-F]{3,6}$/.test(rawColor.trim())
    ? rawColor.trim().replace(/^#/, "")
    : null;

  return NextResponse.json({
    name,
    color,
    logo,
    wallpaper,
    source: base.origin,
  });
}
