import { isNative } from "@/lib/native";

// Native haptic feedback for game moments. No-op on web and a silent no-op if the
// plugin is missing (so the app keeps working before the next TestFlight rebuild).
// Lazy import keeps @capacitor/haptics out of the web bundle.
export type Haptic = "select" | "correct" | "wrong" | "win";

export async function haptic(kind: Haptic): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    switch (kind) {
      case "select":
        await Haptics.impact({ style: ImpactStyle.Light });
        break;
      case "correct":
        await Haptics.notification({ type: NotificationType.Success });
        break;
      case "wrong":
        await Haptics.notification({ type: NotificationType.Warning });
        break;
      case "win":
        // A double success beat reads as celebratory.
        await Haptics.notification({ type: NotificationType.Success });
        break;
    }
  } catch {
    /* plugin not in this build yet — ignore */
  }
}
