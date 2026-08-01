/**
 * Small helpers for reading fetch responses without the two failure modes that
 * actually bite in production.
 *
 * `res.json()` REJECTS on an empty or truncated body — it does not return null.
 * A request that is aborted mid-flight (the user taps back, a crawler disconnects,
 * the tab is backgrounded) can resolve with a 499 and no body, and the bare
 * `await res.json()` then throws a SyntaxError that escapes to the error boundary.
 * That was the single highest-volume production error in the app
 * (`Unexpected end of JSON input`, /38-0/wc/run/:id, 43 events).
 *
 * Note the ordering trap these encourage you to avoid: parsing the body BEFORE
 * checking `res.ok` means an error response with an empty body throws instead of
 * surfacing its status.
 */

/** Parse a response body as JSON, returning null instead of throwing when the
 *  body is empty, truncated, or not JSON at all. */
export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** True when a fetch rejection is the request being torn down rather than a real
 *  fault. Deliberately only AbortError: `fetch` also rejects with a TypeError for
 *  a genuine network failure, and swallowing every TypeError would hide real bugs. */
export function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === "AbortError";
}
