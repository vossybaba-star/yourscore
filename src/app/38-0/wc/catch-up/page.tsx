import { redirect } from "next/navigation";

/**
 * /38-0/wc/catch-up — RETIRED. The catch-up back-catalogue now lives inline on the World Cup
 * tab as the edition strip (WcEditionStrip): catch up on missed days, peek past results, and
 * see at a glance whether you're up to date. This path stays only to redirect old links there.
 */
export default function CatchUpRetired() {
  redirect("/38-0/wc");
}
