"use client";

// Error boundary for the Versus hub (debates, challenges, matchmaking).
import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} />;
}
