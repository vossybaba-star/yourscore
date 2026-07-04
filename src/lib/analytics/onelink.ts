// AppsFlyer OneLink builder for invites/shares.
//
// Wrapping an invite URL in a OneLink lets AppsFlyer attribute the install it drives
// (K-factor, paid→organic uplift) and deferred-deep-link the new user into the exact
// screen. This is the measurement backbone for virality.
//
// INERT until configured. With the env vars below unset — which is the case until the
// OneLink template + its onelink.me subdomain exist AND a native build ships the
// Associated Domains entitlement for that subdomain — buildInviteLink() returns the
// plain yourscore.app URL, so every existing share keeps working exactly as today.
// Rolling OneLink out is then a single env-var flip (+ the native build), with no code
// change at the call sites.

const SUBDOMAIN = process.env.NEXT_PUBLIC_ONELINK_SUBDOMAIN; // e.g. "yourscore.onelink.me"
const TEMPLATE_ID = process.env.NEXT_PUBLIC_ONELINK_TEMPLATE; // OneLink template shortlink id
const WEB_ORIGIN = "https://yourscore.app";

/**
 * Build a shareable invite link for `path` (an in-app path beginning with "/").
 * Returns a OneLink URL once configured, otherwise the plain web URL (unchanged
 * behaviour). `surface` tags which product surface the invite came from; `channel`
 * optionally tags the share channel. Both flow into AppsFlyer attribution.
 */
export function buildInviteLink(
  path: string,
  opts: { surface: string; channel?: string },
): string {
  const origin = typeof window !== "undefined" ? window.location.origin : WEB_ORIGIN;
  const plain = `${origin}${path}`;
  if (!SUBDOMAIN || !TEMPLATE_ID) return plain; // not configured → plain URL

  const u = new URL(`https://${SUBDOMAIN}/${TEMPLATE_ID}`);
  u.searchParams.set("deep_link_value", path); // routed to in-app on open (see onDeepLink)
  u.searchParams.set("af_web_dp", `${WEB_ORIGIN}${path}`); // web fallback (no app installed)
  u.searchParams.set("pid", "user_invite"); // media source = organic user invite
  u.searchParams.set("af_channel", opts.channel ?? opts.surface);
  u.searchParams.set("c", opts.surface); // campaign = surface
  u.searchParams.set("deep_link_sub1", opts.surface);
  return u.toString();
}
