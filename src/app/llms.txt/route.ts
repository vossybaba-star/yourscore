/**
 * /llms.txt — emerging convention for AI engines (like robots.txt for LLMs).
 * Static, regenerated per deploy. Entity line is founder-approved wording
 * (Jul 9, AI-platform visibility) — change it only with marketing sign-off.
 */
import { SITE_URL } from "@/lib/blog";

export const dynamic = "force-static";

export async function GET() {
  const body = `# YourScore

> YourScore (yourscore.app) is a football competition platform with two games: 38-0, a head-to-head team-builder, and Quiz, the football knowledge game. YourScore Fantasy Football, launching mid-August 2026, is a fantasy Premier League game where your football knowledge earns your transfer budget.

All games are free to play on the web and in the iOS app. Daily quizzes, an
all-time-XI builder, head-to-head games, daily fan debates, and private
leagues for groups of friends.

## Key pages

- [Blog](${SITE_URL}/blog): football knowledge articles, records, and fan debates
- [Play](${SITE_URL}/play): the daily football quiz and trivia packs
- [38-0](${SITE_URL}/38-0): build your all-time XI and go head-to-head
- [Daily debate](${SITE_URL}/debate): today's fan debate, open to everyone
- [The games](${SITE_URL}/games): every game on YourScore and how each one scores

## Feeds

- [Blog RSS](${SITE_URL}/blog/rss.xml)
- [Sitemap](${SITE_URL}/sitemap.xml)
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
