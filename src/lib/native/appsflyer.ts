import { isNative } from "@/lib/native";

// AppsFlyer (MMP) — TRUE mobile install attribution for the native app. The web
// "download" tracking (trackDownload) only measures intent; this attributes the
// actual App Store install to the ad that drove it (X, Meta, …) and reports it
// back for optimisation. Account: support@yourscore.app. Dev key is a CLIENT key
// (designed to ship inside the app binary).
//
// IMPORTANT: this only works once the native pod is installed (`npx cap sync ios`)
// AND a NEW build is shipped to the App Store — the SDK can't attribute on the
// current live build. No-ops entirely on web (isNative() === false).
const APPSFLYER_DEV_KEY = "4Shcr2gp6aPNYd82RTidSX";
const IOS_APP_ID = "6773626424"; // App Store ID, numbers only (not "id6773626424")

let initialised = false;

/**
 * Start the AppsFlyer SDK on native launch. Records the install + session, which
 * is what lets ad-driven installs get attributed. Safe + idempotent; no-op on web.
 */
export async function initAppsFlyer(): Promise<void> {
  if (!isNative() || initialised) return;
  initialised = true;
  try {
    const { AppsFlyer } = await import("appsflyer-capacitor-plugin");
    await AppsFlyer.initSDK({
      devKey: APPSFLYER_DEV_KEY,
      appID: IOS_APP_ID,
      isDebug: false,
      registerConversionListener: true,
      registerOnDeepLink: true,
      // Wait for the ATT decision before the first session fires so IDFA-based
      // attribution works once an ATT prompt is added (see Info.plist TODO).
      waitForATTUserAuthorization: 60,
    });
  } catch (e) {
    initialised = false;
    console.warn("[appsflyer] initSDK failed", e);
  }
}

/**
 * Log an in-app event to AppsFlyer (no-op on web). Lets ad campaigns optimise
 * toward real actions (signup, play), not just installs.
 */
export async function afLogEvent(
  eventName: string,
  eventValue: Record<string, unknown> = {},
): Promise<void> {
  if (!isNative()) return;
  try {
    const { AppsFlyer } = await import("appsflyer-capacitor-plugin");
    await AppsFlyer.logEvent({ eventName, eventValue });
  } catch (e) {
    console.warn("[appsflyer] logEvent failed", e);
  }
}
