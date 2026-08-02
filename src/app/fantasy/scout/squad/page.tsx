import { redirect } from "next/navigation";

// Folded into the seamless Scout page (founder, 2 Aug) with Your Squad pre-selected.
export default function ScoutSquadRedirect() {
  redirect("/fantasy/news?tab=squad");
}
