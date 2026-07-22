import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/blog";

/**
 * AI crawlers are EXPLICITLY allowed (founder decision, Jul 9): we want
 * YourScore cited in AI answers, so don't rely on the blanket `*` rule —
 * name the bots. /admin stays off-limits to everyone.
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

/**
 * Link-preview crawlers MUST reach the OG image routes, and every one of those
 * lives under /api (og/*, draft/*-og, club-preview). A blanket `Disallow: /api/`
 * silently kills every social card — X, Facebook, LinkedIn, Slack, Telegram,
 * WhatsApp and Discord all honour robots.txt when fetching preview images, and
 * on Jul 10 it did exactly that: the debate and quiz tweets unfurled with no
 * image. These bots only ever GET, so the site minus /admin is safe for them.
 */
const SOCIAL_CRAWLERS = [
  "Twitterbot",
  "facebookexternalhit",
  "Facebot",
  "LinkedInBot",
  "Slackbot-LinkExpanding",
  "TelegramBot",
  "WhatsApp",
  "Discordbot",
  "redditbot",
  "Applebot",
];

/**
 * The OG/preview image endpoints, allowed ahead of the blanket /api/ disallow so
 * that a crawler which doesn't identify itself above (longest-match wins) can
 * still render a card. Everything else under /api stays closed.
 */
const OG_IMAGE_PATHS = [
  "/api/og/",
  "/api/club-preview",
  "/api/draft/og",
  "/api/draft/wc-og",
  "/api/draft/live-og",
  "/api/draft/promo-og",
  "/api/draft/season-og",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: SOCIAL_CRAWLERS,
        allow: "/",
        disallow: ["/admin/"],
      },
      {
        userAgent: AI_CRAWLERS,
        allow: ["/", ...OG_IMAGE_PATHS],
        disallow: ["/api/", "/admin/"],
      },
      {
        userAgent: "*",
        allow: ["/", ...OG_IMAGE_PATHS],
        disallow: ["/api/", "/admin/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
