import fs from "node:fs/promises";
import path from "node:path";
import { signUnsubToken } from "./unsubToken";

/**
 * Load a lifecycle email HTML file from /emails/lifecycle and substitute tokens.
 *
 * Tokens use the {{token_name}} convention. Any unsubstituted token will throw
 * at send time — assert all tokens are filled before calling resend.
 *
 * Usage:
 *   const html = await renderEmail("01-welcome", {
 *     PAUSE_URL: "https://yourscore.app/settings/email?pause=all",
 *     UNSUB_URL: "https://yourscore.app/settings/email?unsub=all",
 *   });
 */
export async function renderEmail(
  templateName: string,
  tokens: Record<string, string | number>,
): Promise<string> {
  const filePath = path.join(process.cwd(), "emails", "lifecycle", `${templateName}.html`);
  let html = await fs.readFile(filePath, "utf-8");

  for (const [key, value] of Object.entries(tokens)) {
    html = html.replaceAll(`{{${key}}}`, String(value));
  }

  // Catch any unsubstituted tokens — fail loud, not silent.
  const missing = html.match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) {
    throw new Error(
      `Email template "${templateName}" has unsubstituted tokens: ${Array.from(new Set(missing)).join(", ")}`,
    );
  }

  return html;
}

/**
 * Build the standard pause/unsubscribe URLs for a given user + scope.
 * Scope is the league or tournament the email relates to, or "all" for global.
 */
export function buildFooterUrls(userId: string, scope: string = "all") {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
  // Signed token, not the raw user id — see lib/email/unsubToken. The id alone is
  // published by public endpoints, so it could never authorise a suppression.
  const t = encodeURIComponent(signUnsubToken(userId));
  const s = encodeURIComponent(scope);
  return {
    PAUSE_URL: `${base}/settings/email?pause=${s}&t=${t}`,
    UNSUB_URL: `${base}/settings/email?unsub=all&t=${t}`,
  };
}

/**
 * RFC 8058 one-click unsubscribe headers — surfaces Gmail/Yahoo's native "Unsubscribe"
 * button and is required for bulk senders. The List-Unsubscribe URL accepts a POST
 * (handled by /api/email/unsubscribe) so the provider can opt the user out directly.
 */
export function listUnsubscribeHeaders(userId: string): Record<string, string> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
  const t = encodeURIComponent(signUnsubToken(userId));
  return {
    "List-Unsubscribe": `<${base}/api/email/unsubscribe?t=${t}&unsub=all>, <mailto:unsubscribe@yourscore.app?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
