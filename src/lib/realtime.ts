/**
 * Global realtime kill switch.
 *
 * Set to `false` to stop the app opening any Supabase Realtime channels. This is a
 * load-shedding lever for incidents: under the World Cup launch surge the Nano
 * instance's Disk IO budget was exhausted and it became unresponsive; thousands of
 * clients retrying realtime subscriptions piled reconnect load onto the dying box.
 * Disabling realtime removes that churn so the instance can recover / accept a
 * compute upgrade. Flip back to `true` (and redeploy) once compute is scaled up.
 */
export const REALTIME_ENABLED = true;
