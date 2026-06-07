# YourScore — Project Instructions

## READ THIS FIRST
**[`YOURSCORE.md`](./YOURSCORE.md) is the single source of truth for what YourScore is.**
Read it before answering any product question or referencing any feature. It defines the
product, the game modes, the league model, scoring, and — importantly — **what has been
discontinued or shelved**. When it conflicts with any other doc or with older memory,
`YOURSCORE.md` wins.

`PRODUCT.md`, `MARKETING_BRIEF.md`, `MOBILE.md`, `STORE_LISTING.md`, and
`~/Downloads/yourscore-build-doc.md` are **historical** — they contain stale/discontinued
features. Do not treat them as current scope.

## Quick facts (see YOURSCORE.md for detail)
- **What it is:** football-knowledge competition app. Tagline: "Your football knowledge. Ranked." (say "knowledge", not "IQ").
- **Audience:** consumer friend-groups (the goal) + pubs (acquisition channel now, Pub Leagues later).
- **Platform:** native iOS/Android primary, wrapping the web app at **yourscore.app** (not `.gg`).
- **Locked vocabulary:** a **Game** = one play-through. A **Lobby** = where players group up before a Multiplayer game (NOT "Room"). Lobby types: **Private / Public / 1v1**. Say "football knowledge", never "IQ".
- **Ways to play:** Live matches · Multiplayer (Lobby types: Private / Public / 1v1) · Solo challenges. Custom Quiz Builder feeds multiplayer Quiz packs.
- **Leagues:** compile a group's results; two separate boards per league — **Live** (live matches) vs **Offline** (multiplayer incl. 1v1; solo lighter, TBD). Points never mix.
- **Discontinued:** WhatsApp API notifications; **shelved:** sponsored rooms. **Avoid "Room"/"IQ".**
- **Not built yet:** Friends, public profiles, hints system, Apple sign-in (Google + email/password + magic link are live).
- **Note:** `rooms*` tables = Lobbies (rename pending).

## Debugging errors — CHECK SENTRY FIRST
Before reading any source files or querying the DB to investigate a bug, always hit
the Sentry API for live error events. The read token is in `.env.local` as
`SENTRY_READ_TOKEN`. Org slug: `yourscore-qx`, project slug: `javascript-nextjs`.

```bash
# Recent issues (last 24h)
SENTRY_READ_TOKEN=$(grep SENTRY_READ_TOKEN .env.local | cut -d= -f2) && \
curl -s "https://de.sentry.io/api/0/projects/yourscore/javascript-nextjs/issues/?limit=10&statsPeriod=24h" \
  -H "Authorization: Bearer $SENTRY_READ_TOKEN" | \
  jq '[.[] | {id, title, culprit, count: .count, lastSeen, firstSeen}]'

# Events for a specific issue (get stack trace + context)
SENTRY_READ_TOKEN=$(grep SENTRY_READ_TOKEN .env.local | cut -d= -f2) && \
curl -s "https://de.sentry.io/api/0/issues/<ISSUE_ID>/events/?limit=3&full=true" \
  -H "Authorization: Bearer $SENTRY_READ_TOKEN" | \
  jq '[.[] | {message, datetime, exception: .exception.values[0].stacktrace.frames[-3:]}]'
```

This gives stack traces, request context, and user info in ~5 seconds — far faster
than file-reading + DB queries. Do this before anything else when investigating an error.

## After changing the product
Update `YOURSCORE.md` in the same session, bump its "Confirmed" date, then run
`graphify update .` to keep the knowledge graph current.
