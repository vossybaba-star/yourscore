import { redirect } from "next/navigation";

// Folded into the seamless Scout page (founder, 2 Aug) with Shortlist pre-selected.
export default function ScoutShortlistRedirect() {
  redirect("/fantasy/news?tab=shortlist");
}
