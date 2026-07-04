# AppsFlyer measurement — event taxonomy + SKAN schema

Owner: growth/eng. Last updated: 2026-07-03.

This is the single source of truth for what YourScore measures in AppsFlyer and the
exact SKAN conversion schema to apply. Read this before touching the SKAN Conversion
Studio config or adding AppsFlyer events.

## 1. In-app event taxonomy (SHIPPED in code 2026-07-03)

All events are logged via the native AppsFlyer SDK. Because the iOS app is a remote-URL
wrapper of yourscore.app, these fire from ordinary web code running inside the app;
they no-op on pure web (`isNative() === false`). Central helpers live in
`src/lib/analytics/appsflyerEvents.ts`.

| Event | Params | Fires from |
|---|---|---|
| `af_complete_registration` | `af_registration_method`, `converted_from_guest` | `SignupPixel.tsx` |
| `af_tutorial_completion` | `af_success` | `NativeOnboarding.tsx` (auth + guest paths) |
| `play_game` | `game` | `trackGame.ts` (existing) |
| `game_complete` | `game`, `mode`, `competition`, `result`, `score`, `is_shadow` | `trackGame.ts` (central) |
| `first_game_complete` | same as game_complete; **once per device** | `trackGame.ts` (central) |
| `versus_matchmake` | `game`, `opponent_type` (human/shadow/cpu), `pack_id` | `versus/find/page.tsx` |
| `af_invite` | `surface` (scorecard/shadow-revenge/league/h2h/live-result/lobby), `af_invite_channel` | `trackShare` (central) |
| `league_create` / `league_join` | `league_type` (38-0/general) | 5 league surfaces |
| `push_opt_in` | — (once per device) | `push.ts` post-grant |

`first_game_complete` is the **activation milestone** — the single best "this install is a
real player" signal. It and `af_invite` (virality) are the linchpins of the SKAN schema below.

Deliberately NOT logged: a daily-streak event (no consecutive-day counter exists in the
product; derive the daily habit from `game_complete{mode:"world_cup_daily"}` + native
retention) and a `session_return` event (AppsFlyer's native sessions/retention already
cover D1/D7/D30 by source).

## 2. SKAN conversion schema — DIAGNOSIS + TARGET

### Current live config (as of 2026-06-18) — BROKEN for a free app
SKAN 4.0 "active", but it's a **revenue industry template**:
- Fine values 0–31 → `af_skad_revenue` bands; 32–63 → `af_attribution_flag`.
- Coarse: high=$1–2 revenue, medium=$0–1, low=app-open.

YourScore has **no revenue events**, so `af_skad_revenue` is always $0 → every install
collapses to conversion value 0–1. iOS SKAN campaigns (Meta/TikTok) get no usable quality
signal. **This must be replaced with the engagement schema below.**

### Target: engagement schema (APPLY when the §1 events are live in a shipped build)
Do NOT apply before then: the events must be flowing to AppsFlyer, and AppsFlyer advises
against re-saving the SKAN config within ~a month of the last change (data-consistency /
campaign learning). Applying early = installs still collapse to 0 AND you burn the window.

Measurement mode: **Engagement** (milestone ladder), not Revenue.

**Window 1 (0–48h) — fine value = highest activation milestone reached:**
| Fine value | Milestone |
|---|---|
| 0 | install only |
| 1 | `af_app_opened` (opened post-install) |
| 2 | `af_complete_registration` |
| 3 | `first_game_complete` ← activation |
| 4 | `game_complete` counter ≥ 2 |
| 5 | `game_complete` counter ≥ 3 |
| 6 | `game_complete` counter ≥ 5 |
| 7 | `versus_matchmake` (played multiplayer/versus) |
| 8 | `af_invite` (sent an invite — viral) |
| 9 | `league_join` OR `league_create` |
| 10 | high-value: `af_invite` AND `game_complete` ≥ 3 |

**Coarse (low-volume / privacy-thresholded installs):**
- low = install / open only (fine 0–1)
- medium = registered or activated (fine 2–3)
- high = engaged: 2+ games / versus / invite / league (fine 4+)

**Window 2 (3–7d):** D3–D7 retention — `af_app_opened` count in-window + any `game_complete`.
**Window 3 (8–35d):** D7+ retention — returned & played in-window (sticky player).

This gives Meta/TikTok SKAN a real quality gradient (activated → retained → viral) to
optimize toward instead of $0 revenue.

## 3. OneLink (virality attribution)

Goal: attribute installs driven by an invite (K-factor, paid→organic uplift) and deferred-
deep-link the new user into the exact screen.

### Code — DONE 2026-07-03 (inert until configured)
- `src/lib/analytics/onelink.ts` → `buildInviteLink(path, {surface, channel})`. Returns a
  OneLink URL when the env vars below are set, else the plain yourscore.app URL (so today's
  shares are byte-for-byte unchanged). Rollout = flip the env vars, no call-site changes.
- Deferred-deep-link routing: `appsflyer.ts` init now adds an `AFConstants.UDL_CALLBACK`
  listener that routes `deep_link_value` (an in-app path) via `window.location`.
- Wired at the two person-to-person invite surfaces (highest install intent): 38-0 WC H2H
  and 38-0 Live H2H "Share link". Remaining surfaces (scorecard `/g/[id]`, league invites,
  shadow-revenge, season) to migrate the same way — wrap the shared URL in `buildInviteLink`.

### Remaining — NEXT BUILD (native + dashboard + env)
1. **Dashboard:** OneLink Management → create a template. Pick a subdomain (suggest
   `yourscore.onelink.me`). Configure: iOS app id6773626424 + App Store fallback, web
   fallback `https://yourscore.app{deep_link_value}`, and the deep-link behaviour.
2. **Native (build-gated):** add the chosen `*.onelink.me` (and `applinks:yourscore.app`)
   to the iOS **Associated Domains** entitlement + AASA so OneLinks open the app directly
   (Universal Links). Without this, OneLinks only route via the store/web — no direct open.
3. **Env:** set `NEXT_PUBLIC_ONELINK_SUBDOMAIN` (e.g. `yourscore.onelink.me`) and
   `NEXT_PUBLIC_ONELINK_TEMPLATE` (the template's shortlink id) in `.env.local` + Vercel.
4. Ship the build → verify an invite install attributes to `pid=user_invite` and lands on
   the right screen.

## 4. Cohort report + activation audiences

Both are **data-gated**: the §1 events must be flowing to AppsFlyer (i.e. after the next
build ships and real installs generate them) before the event columns / audience rules can
reference them. Set up once data appears — specs below make it one-pass.

### Cohort & Retention saved view (`/cohort/overview#appIds=id6773626424`)
- Rows: Media source → Campaign → Creative (`af_ad`).
- Metric: retention (D1/D7/D30) + events-per-user for `first_game_complete`, `game_complete`,
  `af_invite`.
- Read: "which channel brings players who play/return", not just cheap installs.

### Audiences (`/audiences`) → sync to Meta + TikTok
1. **Installed, never played** — installs with 0 `first_game_complete` in 3d → suppress from
   acquisition / re-engage.
2. **Played once, lapsed** — `first_game_complete` ≥1 AND `game_complete` <2 AND no session in
   3d → retargeting.
3. **High-value (lookalike seed)** — `af_invite` ≥1 OR `game_complete` ≥5 → push as the
   lookalike seed to Meta/TikTok (beats the email-list seed).
4. **Guest, never registered** — session ≥1 AND 0 `af_complete_registration` → convert.
