/**
 * Legacy /fantasy/feed — the feed is now the Social tab. Redirect so old
 * deep-links (the launch push, shared links) land on /fantasy/social, which the
 * nav also lights up.
 */
import { redirect } from "next/navigation";

export default function FantasyFeedRedirect() {
  redirect("/fantasy/social");
}
