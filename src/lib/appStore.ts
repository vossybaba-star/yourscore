/**
 * The App Store links, in one place.
 *
 * Pulled out of AppMomentPrompt.tsx because the halftime email fallback needs
 * the download link too, and that runs server-side — importing a "use client"
 * component to read a string would drag a React component into the release path.
 * Two hard-coded copies of the app id is how one of them goes stale.
 */

export const IOS_APP_ID = "6773626424";
export const APP_STORE_URL = `https://apps.apple.com/gb/app/yourscore/id${IOS_APP_ID}`;
export const APP_STORE_REVIEW_URL = `https://apps.apple.com/app/id${IOS_APP_ID}?action=write-review`;
