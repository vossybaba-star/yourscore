import { redirect } from "next/navigation";

/**
 * /how-it-works — kept as a permanent redirect to /games.
 *
 * The page became the Games page (founder, 23 Jul). The old URL has inbound
 * links from the blog layout, the league-join page, the sitemap and llms.txt,
 * plus whatever is out in the wild, so the route stays and forwards rather
 * than 404ing anyone who followed a link from before the rename.
 */
export default function HowItWorksRedirect() {
  redirect("/games");
}
