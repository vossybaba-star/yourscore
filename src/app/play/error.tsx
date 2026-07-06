"use client";

// Error boundary for the multiplayer lobby/game (play/[roomId] etc.) — the most
// realtime-heavy surface, so a subscription/render crash recovers here.
import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} title="This game hit a snag" message="Something went wrong in the game. Try again, or head home." />;
}
