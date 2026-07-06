"use client";

// Error boundary for match views (match/[id]).
import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} title="This match hit a snag" message="Something went wrong loading the match. Try again, or head home." />;
}
