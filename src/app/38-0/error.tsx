"use client";

// Error boundary for the whole 38-0 game surface (draft, wc, live match, team,
// season). A crash here recovers locally instead of taking down the app.
import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} title="This game hit a snag" message="Something went wrong loading 38-0. Try again, or head home." />;
}
