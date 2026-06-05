import { Resend } from "resend";

let cached: Resend | null = null;

/**
 * Lazy-init Resend client.
 * Throws if RESEND_API_KEY is missing — callers should catch and log,
 * not block the user flow (email is best-effort).
 */
export function getResend(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY is not set");
  }
  cached = new Resend(key);
  return cached;
}

export const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";
export const REPLY_TO = process.env.RESEND_REPLY_TO ?? "zach@yourscore.app";
