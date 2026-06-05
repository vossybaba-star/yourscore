import fs from "node:fs/promises";
import path from "node:path";

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
  const u = encodeURIComponent(userId);
  const s = encodeURIComponent(scope);
  return {
    PAUSE_URL: `${base}/settings/email?pause=${s}&u=${u}`,
    UNSUB_URL: `${base}/settings/email?unsub=all&u=${u}`,
  };
}
