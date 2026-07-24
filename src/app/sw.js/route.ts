/**
 * /sw.js — the service worker, served from a route handler rather than as a
 * static file in public/.
 *
 * Two reasons it lives here instead of public/sw.js:
 *
 * 1. KILL SWITCH. Set SW_DISABLED=1 in Vercel and redeploy, and this route
 *    starts serving a worker whose only job is to delete its caches and
 *    unregister itself. Browsers re-fetch the worker script on navigation, so
 *    the self-destruct reaches every installed client on its own — including
 *    clients whose page a bad worker has broken, where no client-side
 *    unregister code would ever get to run. A service worker is the one thing
 *    you can ship that can lock users out of the site, so it needs an exit that
 *    does not depend on the app working.
 *
 * 2. CACHE VERSIONING. The cache name is stamped with the deploy id, so every
 *    deploy activates into a fresh cache and drops the previous one. A static
 *    worker file has no way to know it has been redeployed, and its cache would
 *    accumulate every build's chunks forever.
 *
 * What it caches: /_next/static/** and nothing else. Those filenames are
 * content-hashed and immutable, so cache-first can never serve something stale —
 * a changed file is a different URL. Measured on prod (2026-07-24), the /play
 * route pulls 422 kB across 22 of those requests on a cold start; the HTML
 * document itself is only 43 kB. The native app is a webview onto the live site
 * with no local bundle, so it paid that on every single cold start.
 *
 * What it deliberately does NOT touch: HTML documents and RSC payloads. Serving
 * a cached document would mean serving the RSC payload inlined in it — yesterday's
 * fixtures and leaderboards rendering as today's — and a stale document that
 * outlives its chunks is exactly how you get a ChunkLoadError with no way back.
 * Everything that is not /_next/static/ falls through untouched, so API routes,
 * Supabase, Sentry and the analytics pixels are not intercepted at all.
 */

export const dynamic = "force-dynamic";

/**
 * Identifies the running deploy. Vercel sets VERCEL_DEPLOYMENT_ID on every
 * deployment; the commit sha is the fallback, and "dev" covers local runs.
 */
function deployId(): string {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "dev"
  );
}

/**
 * Deletes everything this worker ever cached, then stands down.
 *
 * Note what it does NOT do: reload its clients. Navigating them from here would
 * mean a worker that reloads the page on activation, on a page that re-registers
 * a worker on every load — one browser disagreeing about when an activating
 * worker claims its clients turns that into a reload loop, in the exact
 * situation where the kill switch is the thing you are relying on. It doesn't
 * need to reload anything: this worker registers no fetch handler at all, so a
 * page still controlled by it already passes every request straight through.
 * The registration is gone by the next load.
 */
const SELF_DESTRUCT = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("ys-")).map((n) => caches.delete(n)));
    await self.registration.unregister();
  })());
});
`.trim();

function worker(version: string): string {
  return `
const CACHE = "ys-static-${version}";
const PREFIX = "/_next/static/";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Every other cache we own is from a previous deploy — its chunk hashes are
    // dead URLs now, so there is nothing to keep.
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith("ys-") && n !== CACHE).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Same-origin immutable build assets only. Anything else — documents, RSC
  // payloads, /api, Supabase, Sentry, pixels — is left entirely alone: no
  // respondWith call, so the browser handles it exactly as if we weren't here.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(PREFIX)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;

    const res = await fetch(req);
    // Opaque or failed responses are not worth storing, and storing a 404 for a
    // hashed asset would poison that URL for the life of the deploy.
    if (res && res.ok && res.status === 200) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  })());
});
`.trim();
}

export async function GET() {
  const disabled = process.env.SW_DISABLED === "1";
  const body = disabled ? SELF_DESTRUCT : worker(deployId());

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // no-store, so flipping SW_DISABLED reaches clients on their next update
      // check rather than up to 24h later.
      "Cache-Control": "no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
