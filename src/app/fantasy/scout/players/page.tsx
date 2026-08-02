import { redirect } from "next/navigation";

// Folded into the seamless Scout page (founder, 2 Aug) with Players pre-selected.
export default function ScoutPlayersRedirect() {
  redirect("/fantasy/news?tab=players");
}
