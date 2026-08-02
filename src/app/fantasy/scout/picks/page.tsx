import { redirect } from "next/navigation";

// The Scout sections are one seamless page now (founder, 2 Aug); this route folds
// into it with the Picks tab pre-selected.
export default function ScoutPicksRedirect() {
  redirect("/fantasy/news?tab=picks");
}
