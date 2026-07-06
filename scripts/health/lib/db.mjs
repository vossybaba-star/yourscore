/**
 * db.mjs — service-role Supabase client for the health checker.
 * Same pattern as scripts/launch-daily.mjs / scripts/segments.mjs.
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
  process.exit(1);
}

export const supa = createClient(URL, KEY, { auth: { persistSession: false } });

/** Today's date string (YYYY-MM-DD) in the app's home timezone. */
export const todayUK = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

/** Current hour (0-23) in Europe/London, for time-of-day leniency windows. */
export const hourUK = () =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()));
