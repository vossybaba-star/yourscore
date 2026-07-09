import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/blog";

/**
 * AI crawlers are EXPLICITLY allowed (founder decision, Jul 9): we want
 * YourScore cited in AI answers, so don't rely on the blanket `*` rule —
 * name the bots. Public routes only; /api and /admin stay off-limits to all.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
        disallow: ["/api/", "/admin/"],
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
