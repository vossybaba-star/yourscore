/**
 * /fantasy/plan — the transfer planner, framed as a monthly-competition cockpit.
 * The screen itself lives in the PlanAhead component (also embedded as the Squad
 * tab's "Plan" subtab); this route renders it standalone with its own chrome.
 */
import { PlanAhead } from "@/components/fantasy/PlanAhead";

export default function PlanPage() {
  return <PlanAhead />;
}
