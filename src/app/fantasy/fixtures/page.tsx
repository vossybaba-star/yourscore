import { redirect } from "next/navigation";

// Fixtures are a tab on the Scout now (founder, 3 Aug) — the standalone "News &
// insights" page was a dead-end you couldn't get back to Plan from. Fold it in.
export default function FantasyFixtures() {
  redirect("/fantasy/news?tab=fixtures");
}
