// The /versus route. The hub itself lives in VersusHub.tsx so the Play tab can
// import the embeddable <VersusHub/> — a Next page module may only export the
// page (default) + route config, not extra components, so the shared code moved
// out and this file just renders the standalone version.
import { VersusStandalone } from "./VersusHub";

export default function VersusPage() {
  return <VersusStandalone />;
}
