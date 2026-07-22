/**
 * Global realtime kill switch.
 *
 * Set to `false` to stop the app opening any Supabase Realtime channels. This is a
 * load-shedding lever for incidents: under the World Cup launch surge the Nano
 * instance's Disk IO budget was exhausted and it became unresponsive; thousands of
 * clients retrying realtime subscriptions piled reconnect load onto the dying box.
 * Disabling realtime removes that churn so the instance can recover / accept a
 * compute upgrade.
 *
 * Env-backed so the lever can be pulled from Vercel env vars without a code
 * change: set NEXT_PUBLIC_REALTIME_ENABLED=false and redeploy (still a deploy,
 * but no commit under incident pressure). Defaults ON when unset.
 */
export const REALTIME_ENABLED = process.env.NEXT_PUBLIC_REALTIME_ENABLED !== "false";
