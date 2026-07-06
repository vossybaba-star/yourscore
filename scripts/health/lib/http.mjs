/**
 * http.mjs — fetch wrapper for the health checker.
 *
 * Every probe gets a hard timeout (AbortSignal) and one retry on transient
 * failures (network error, 5xx, 429) so a single blip doesn't page the founder.
 * 4xx responses are returned as-is — they're a real answer, not a blip.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const BASE =
  process.env.HEALTH_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://yourscore.app";

/**
 * Request `url` (absolute, or a path resolved against BASE).
 * Returns { status, ms, text, json } — json is null when the body isn't JSON.
 * Throws only when both attempts fail at the network level or time out.
 */
export async function req(url, { method = "GET", body, headers = {}, cookie, timeoutMs = 10_000, retries = 1 } = {}) {
  const target = url.startsWith("http") ? url : BASE + url;
  const opts = {
    method,
    headers: {
      "user-agent": "YourScoreHealthCheck/1.0",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "follow",
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(target, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
      const ms = Date.now() - started;
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON — fine for HTML pages */ }
      if ((res.status >= 500 || res.status === 429) && attempt < retries) { await sleep(2000); continue; }
      return { status: res.status, ms, text, json };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(2000);
    }
  }
  throw new Error(`${method} ${target}: ${lastErr?.name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : lastErr?.message}`);
}
