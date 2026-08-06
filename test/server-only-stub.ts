/**
 * Test-only stand-in for the `server-only` package.
 *
 * `server-only` throws on import by design, which is what stops a server module
 * being pulled into a client bundle. Under a plain `node --test` run there is no
 * bundler and no client boundary, so that throw just makes any test importing a
 * server module crash before it starts. Four test files were unrunnable for
 * exactly this reason (gameday-credit, gameweeks, scoutPicks, squadRating).
 *
 * `tsconfig.test.json` aliases `server-only` here, and ONLY that config does.
 * The real package stays in place for `next build` and for the app itself, so
 * the client-boundary guard is untouched in production.
 */
export {};
