import type { MetadataRoute } from "next";
import { getAllPosts, SITE_URL } from "@/lib/blog";

/**
 * First sitemap for yourscore.app — public marketing/editorial surfaces only.
 * App surfaces behind auth (or that only make sense signed-in) stay out.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, priority: 1 },
    { url: `${SITE_URL}/play`, priority: 0.9 },
    { url: `${SITE_URL}/38-0`, priority: 0.9 },
    { url: `${SITE_URL}/how-it-works`, priority: 0.8 },
    { url: `${SITE_URL}/debate`, priority: 0.7 },
    { url: `${SITE_URL}/leaderboard`, priority: 0.6 },
    { url: `${SITE_URL}/blog`, priority: 0.8 },
    { url: `${SITE_URL}/privacy`, priority: 0.2 },
    { url: `${SITE_URL}/terms`, priority: 0.2 },
    { url: `${SITE_URL}/support`, priority: 0.3 },
  ];

  const postRoutes: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.date,
    priority: 0.6,
  }));

  return [...staticRoutes, ...postRoutes];
}
