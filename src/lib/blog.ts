/**
 * Blog content loader — reads MDX files from content/blog/*.mdx at build time.
 *
 * No CMS: a post is one .mdx file with frontmatter (title, description, date,
 * tags, optional ogImage, draft). Everything downstream (index, post pages,
 * sitemap, RSS, OG images) is statically rendered from this module, so
 * publishing = commit a file to content/blog/ and deploy.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type BlogFaqItem = { q: string; a: string };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD) — used for sorting, display, JSON-LD and RSS. */
  date: string;
  tags: string[];
  ogImage?: string;
  /**
   * Optional FAQ (frontmatter `faq:` list of {q, a}). Drives BOTH the rendered
   * FAQ section at the end of the post and FAQPage JSON-LD — one source, so the
   * schema always matches visible content (a Google requirement).
   */
  faq: BlogFaqItem[];
  content: string;
};

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

export const SITE_URL = "https://yourscore.app";

/** All published (non-draft) posts, newest first. */
export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const posts: BlogPost[] = [];
  for (const file of fs.readdirSync(BLOG_DIR)) {
    if (!file.endsWith(".mdx")) continue;
    const slug = file.replace(/\.mdx$/, "");
    const raw = fs.readFileSync(path.join(BLOG_DIR, file), "utf8");
    const { data, content } = matter(raw);

    if (data.draft === true) continue;
    if (!data.title || !data.date) {
      // A malformed post shouldn't take prod deploys down with it — skip loudly.
      console.warn(`[blog] skipping ${file}: missing required frontmatter (title, date)`);
      continue;
    }

    posts.push({
      slug,
      title: String(data.title),
      description: String(data.description ?? ""),
      date: toIsoDate(data.date),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      ogImage: data.ogImage ? String(data.ogImage) : undefined,
      faq: Array.isArray(data.faq)
        ? data.faq
            .filter((item) => item && item.q && item.a)
            .map((item) => ({ q: String(item.q), a: String(item.a) }))
        : [],
      content,
    });
  }

  return posts.sort((a, b) =>
    a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)
  );
}

export function getPost(slug: string): BlogPost | null {
  return getAllPosts().find((p) => p.slug === slug) ?? null;
}

/** gray-matter parses unquoted YAML dates into Date objects — normalise both forms. */
function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** "2026-07-09" → "9 July 2026" (UK editorial style, matches the fan-facing voice). */
export function formatPostDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
