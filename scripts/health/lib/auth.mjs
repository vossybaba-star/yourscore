/**
 * auth.mjs — sign the health bot in and build the cookies the app's
 * @supabase/ssr server client expects, so a plain fetch() (and Playwright)
 * can call authed API routes exactly like a logged-in browser.
 *
 * Cookie format (verified against @supabase/ssr 0.10.x, node_modules/
 * @supabase/ssr/dist/main/cookies.js): value = "base64-" + base64url(JSON of
 * the session), stored under sb-<project-ref>-auth-token, split into .0/.1/…
 * chunks when the URI-encoded value exceeds 3180 chars.
 *
 * ⚠ If @supabase/ssr gets a MAJOR version bump, re-verify this format — the
 * journeys layer failing with 401s after a dependency upgrade is the symptom.
 */

import { createClient } from "@supabase/supabase-js";

const MAX_CHUNK_SIZE = 3180;

/** Ported verbatim from @supabase/ssr utils/chunker.js (createChunks). */
function createChunks(key, value, chunkSize = MAX_CHUNK_SIZE) {
  let encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= chunkSize) return [{ name: key, value }];
  const chunks = [];
  while (encodedValue.length > 0) {
    let encodedChunkHead = encodedValue.slice(0, chunkSize);
    const lastEscapePos = encodedChunkHead.lastIndexOf("%");
    if (lastEscapePos > chunkSize - 3) encodedChunkHead = encodedChunkHead.slice(0, lastEscapePos);
    let valueHead = "";
    while (encodedChunkHead.length > 0) {
      try {
        valueHead = decodeURIComponent(encodedChunkHead);
        break;
      } catch (error) {
        if (error instanceof URIError && encodedChunkHead.at(-3) === "%" && encodedChunkHead.length > 3) {
          encodedChunkHead = encodedChunkHead.slice(0, encodedChunkHead.length - 3);
        } else {
          throw error;
        }
      }
    }
    chunks.push(valueHead);
    encodedValue = encodedValue.slice(encodedChunkHead.length);
  }
  return chunks.map((value2, i) => ({ name: `${key}.${i}`, value: value2 }));
}

/**
 * Sign in with HEALTH_BOT_EMAIL/PASSWORD and return:
 *   { userId, cookieHeader, cookies: [{name, value}] }
 * cookieHeader goes straight into a fetch `Cookie:` header; the cookies array
 * feeds Playwright's context.addCookies.
 */
export async function signInBot() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.HEALTH_BOT_EMAIL;
  const password = process.env.HEALTH_BOT_PASSWORD;
  if (!url || !anon || !email || !password) throw new Error("HEALTH_BOT_EMAIL/PASSWORD or Supabase env missing");

  const supa = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`bot sign-in failed: ${error.message}`);
  const session = data.session;
  if (!session?.access_token) throw new Error("bot sign-in returned no session");

  const ref = new URL(url).hostname.split(".")[0];
  const cookieName = `sb-${ref}-auth-token`;
  const encoded = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const cookies = createChunks(cookieName, encoded);

  return {
    userId: data.user.id,
    cookies,
    cookieHeader: cookies.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; "),
  };
}
