# 38-0 — X (Twitter) Ads Campaign

**Product:** 38-0 / Draft XI (YourScore) — football draft game. Live: `yourscore.app/38-0`
**Hub modes:** World Cup Run (solo WC2026 campaign), Live H2H multiplayer, Premier League XI
**Goal:** signups / installs · **Budget:** ~£480/mo (£16/day) · **Window:** WC2026 (~11 Jun – 19 Jul 2026)
**Status quo:** one boosted post performing well (high engagement) — this is the proven creative.

---

## 🚀 LAUNCHED (9 Jun 2026)

**X_Traffic_Prospecting_2026-06** — campaign ID `41588936` — **Active**.
- Objective: Website traffic (Link clicks) · Auto bid · all placements · Optimize-targeting ON.
- **2-day burst: Jun 9 → Jun 11 2026**, then auto-stops (end date set per ad group).
- Budget **$126/day ≈ £100/day**: ad group *Prospecting — UK+IE* (UK+Ireland) **$94/day** +
  *Prospecting — US* (United States) **$32/day**.
- Creative: the Head-to-Head post `2064106664735752600` used **as-is** (keeps its ~25k views +
  engagement as social proof; has the t.co→yourscore.app link in-text).
- **Funding:** Mastercard ••8086 (Default Credit Card). NOTE: the builder auto-selects funding
  source `1cb4a0` (a FixedSpendFundingInstrument) which **errors on publish** — must manually
  switch the Funding source to the Mastercard credit card before publishing.

**Watch / next:**
- After Jun 11 it stops. Decide: revert to the steady ~$63/day plan or extend.
- Stand up the **remarketing** campaign once `6by0y` fills past X's ~100-user min (re-check Size).
- Switch prospecting to **Sales / Sign-up** optimization once the signup event has ~30–50 signals.
- This simplified builder has no interest/keyword/follower-lookalike targeting — prospecting is
  broad UK+IE/US + X auto-optimization. For true "similar audience" lookalikes, use the classic flow.

---

## DONE THIS SESSION (9 Jun 2026)

- **Signup conversion tracking — SHIPPED TO PROD + verified live (commit `9e8ab44` on main):**
  - `src/components/analytics/SignupPixel.tsx` (new) — fires X event `tw-p6vxh-p6vxj`
    (the Lead Generation Tracker) once on `?signup=1`, then strips the flag (no double-count).
  - `src/app/auth/callback/route.ts` — tags brand-new users with `?signup=1` (reuses the
    existing `isFirstSignIn`). Covers Google OAuth + magic-link + email signup (all hit callback).
  - `src/app/layout.tsx` — mounts `<SignupPixel/>`. Base twq pixel already present.
  - Verified: tsc ✓ lint ✓ prod build ✓. On prod, `/?signup=1` strips the param (component ran)
    and twq (a function) received the event call. Base beacons reach X — Site visits last-recorded
    ticked from my loads.
  - **Pending:** the Lead tracker still reads Inactive in Events manager — X processing lag for
    custom conversions, not a failure. Flips Active as the event processes / first real signups land.
  - Optional env override: `NEXT_PUBLIC_X_SIGNUP_EVENT_ID` (defaults to the hardcoded id).
- **Audience built:** "38-0 — All website visitors" · ID `6by0y` · Website activity · pixel
  `p6vxh` · all visitors. Status Processing — fills as the pixel collects.
- **Engagement audience:** NOT a standalone audience on X (Create-audience only offers List /
  Website activity). Engager + follower-lookalike targeting is applied at the **ad-group level**
  when the campaign is built.
- **Remarketing campaign scaffolded (couldn't save — see blockers):** campaign
  `X_Conv_Remarketing_Signup_2026-06`, objective **Sales**, conversion event **Sign up — Lead /
  Sign-up** (selectable despite Inactive). Geo/budget/audience/creative not yet set.

---

## BLOCKERS — need YOU before any campaign can launch

1. **Billing — card re-authorization (HARD STOP, you must do this).** X Billing shows: *"Your
   payment method needs to be re-authorized. We've upgraded our payment system. Please add your
   card again to continue running campaigns."* The old iOS quick-promote runs on a fixed-spend
   instrument that can't back an Ads-Manager campaign — attempting one errors with
   *"FixedSpendFundingInstrument that is already used."* → **X Ads → Billing → Re-authorize card.**
   (Claude cannot enter card details.)
2. **Remarketing audience still processing (NOT a data problem).** The pixel has ~2 days of data
   and an X website audience backfills from retained pixel events — so the pool reflects those 2
   days. "38-0 — All website visitors" (`6by0y`) just isn't usable *yet* because (a) it's still
   **Processing** — X's initial build of a new audience takes several hours (up to ~24h) even with
   existing data, Size shows "-" until done; and (b) once built it must clear X's **~100-user
   minimum** to be targetable. Re-check in a few hours / tomorrow for the Size. No action needed.

## Reordered launch sequence (once billing is fixed)

1. **You:** re-authorize the card in Billing.
2. **Launch PROSPECTING first** (cold) — lookalikes/interests + the hot creative
   (`2064106664735752600`). This drives signups AND fills the website-visitor pool. Geo + budget
   below.
3. **Launch REMARKETING ~1–2 weeks later** — once `6by0y` crosses the targetable threshold. The
   draft is already scaffolded (Sales → Sign up event).

## Decisions — CONFIRMED

- **Geo:** majority **UK + Ireland**, small slice **US**. (≈75/25 — see budget table.)
- **Budget:** **$63/day** total (account bills USD).

---

## ACCOUNT AUDIT — verified in X Ads Manager (9 Jun 2026)

Ad account: **BitPulseX** · `18ce55r8gmx` · handle **@Yourscore_App_** (display "Play 38-0 on YourScore.App")

**Live campaigns (all quick-promotes from the iOS app — wrong objective for signups):**
| Campaign | ID | Objective | Dates | Result |
|----------|-----|-----------|-------|--------|
| Quick promote · iOS · Head to Head | 41585818 | **Reach** | Jun 9–14 | $1.94 · 8,108 impr · CPM $0.24 · 13 link clicks ← the hot one |
| Quick promote · iOS · Start a league | 41571589 | **Reach** | Jun 8–13 | minimal |
| Engage | 38237470 | Engagements | since Feb 2025 | old |

> These optimize for **Reach/Engagement, not signups** — cheap impressions but no signup intent.
> They DO seed the remarketing pool though. Keep them running short-term (cheap engagement →
> warm audience), but the real signup volume must come from the new conversion campaigns below.

**Audiences:** EMPTY — zero custom audiences exist. Everything in §1 is net-new.

**Events / pixel (`p6vxh`):**
- ✅ `Landing page views` + `Site visits` — Auto-created, **Active**, firing today.
- ⚠️ `Purchase` / `Lead` / `Download` / `Add to cart` trackers — all created but **INACTIVE**,
  never recorded a single event (snippet not placed on site).

**Strong existing posts to promote (organic, @Yourscore_App_):**
| Post ID | Date | Angle | Destination |
|---------|------|-------|-------------|
| `2064308141873824118` | Jun 9 | Video — "live commentary + full post-match analysis" | Media/video |
| `2064073128184012961` | Jun 8 | "Free to play — YourScore.app/38-0" #Football #PremierLeague | **Website** ← best for signups |
| `2064117012289462345` | Jun 8 | "🔴 LIVE head-to-head — real-time vs friends or random queue" | **Website** |

---

## 0. Blocker — fix before optimizing for signups

Pixel `p6vxh` IS live and the base auto-events fire. What's missing: **no conversion event is
active**. Consequences:
- Can't optimize for "signup" → only Site Visits / Reach available.
- Can't build a converter-exclusion audience → wasting spend on people who already signed up.
- Website-visitor remarketing still works (base tag collects), but is untyped (all visitors only).

**Action — activate ONE event for signup (don't create a new one, the tracker already exists):**
- Use the existing **`Lead Generation Tracker`** (type Lead) — or `Download Tracker` if you treat
  it as an app install. It's Inactive only because its event snippet isn't on the site yet.
- Events manager → that tracker → `</>` (view code) → place the event fire on the **signup-success**
  route/page. Base pixel is already loaded site-wide, so this is just the one event call.
- It flips to Active on the first real signup. Then it's selectable as the campaign goal + can back
  a converter-exclusion audience.

Until the signup event reports data: run campaigns on **Website Traffic** (optimize Site Visits).
Switch both campaigns to **Website Conversions → Sign up (Lead)** the day the event records.

---

## 1. Audiences to build now (populate while you set up)

Build these in X Ads → Tools → Audiences. Engagement audiences backfill retroactively; the
website tag starts collecting from today — build now so pools are warm at launch.

| # | Audience | Source | Use |
|---|----------|--------|-----|
| A1 | **Post + account engagers, 90d** | Engagement audience on the @account / the boosted post | Remarketing (warm) |
| A2 | **Website visitors, 30–90d** | X website tag (all visitors) | Remarketing (warm) |
| A3 | **Lookalike of A1** | "Similar to" expansion off engagers | Prospecting (similar) |
| A4 | **Follower look-alikes** | Followers of: @OfficialFPL, @FotMob, @FabrizioRomano, big-club accounts, @FIFAWorldCup | Prospecting (cold) |
| X1 | **Existing signups (exclude)** | Email/device list upload OR signup-event audience | Exclusion on ALL ad groups |

> X1 is the cheapest win — exclude existing users everywhere so you never pay to re-acquire them.
> Quick version: upload a hashed email list of current users today; replace with the event-based
> audience once the signup event is live.

---

## 2. Campaign structure (2 campaigns — do NOT fragment further at this budget)

```
X_Conv_Remarketing_Signup_2026Q3        ← warm, high efficiency
  ├─ AG-RM1: A1 Post/account engagers (90d)   [exclude X1]
  └─ AG-RM2: A2 Website visitors (30–90d)      [exclude X1]

X_Conv_Prospecting_Signup_2026Q3        ← growth, feeds the remarketing pool
  ├─ AG-PR1: A3 Lookalike of engagers          [exclude X1, A1, A2]
  └─ AG-PR2: A4 Follower-lookalikes + interest [exclude X1, A1, A2]
        interests/keywords: world cup 2026, fantasy football, FPL,
        football draft, build your XI, soccer game
```

Exclusions matter: prospecting excludes the warm pools so the two campaigns don't bid against
each other for the same person.

---

## 3. Budget — $63/day (account bills USD; ≈ £50). Geo: majority UK+IE, small US.

**Phase 1 — now (prospecting only; remarketing audience still processing):** all $63 to prospecting,
split by geo into two ad groups so the UK/IE majority is enforced:

| Ad group | Geo | Daily | Share |
|----------|-----|-------|-------|
| Prospecting — UK+IE | United Kingdom + Ireland | **$47** | ~75% |
| Prospecting — US | United States | **$16** | ~25% |

**Phase 2 — once `6by0y` is targetable (~hours/days):** carve out remarketing:

| Campaign / group | Daily |
|------------------|-------|
| Prospecting UK+IE | $38 |
| Prospecting US | $13 |
| Remarketing (all-geo site visitors) | $12 |

Bid: Auto bid to start. Reassess day 7 — shift toward the lowest cost-per-signup geo/group.

- Bid: start **autobid** (X has little signal at this spend). Move to target-cost only after ~50 conversions.
- Reassess day 7–10. Shift budget toward whichever ad group has the lowest cost-per-signup.
- WC tailwind: front-load — if early signs are good, push prospecting harder *during* the group stage when football attention peaks. Don't sit on budget; the window closes 19 Jul.

---

## 4. Creative

**Anchor = promote the EXISTING winning post by its post ID** (don't recreate it — keeping the real
post preserves its like/repost/reply counts = built-in social proof). Promote it across both
remarketing ad groups and PR2.

**Add 2–3 WC2026-hook variants** (test against the anchor; angle is the biggest lever):

1. *World Cup hook* — "The World Cup starts this week. Draft your nation's XI and play their real
   path to the final. → yourscore.app/38-0"
2. *Mechanic/curiosity* — "Pick a nation. Draft a locked XI. Win the group, survive the knockouts,
   lift the trophy. Solo. Free. → /38-0"
3. *H2H/social* — "Challenge a mate to a live two-half match. Draft, swap at half-time, settle it. ⚡"
4. *Proof-led (if you have a number)* — "[N] managers already drafted their World Cup squad. Your turn."

Spec: ≥2 creatives per ad group (avoid single-ad fatigue). Captions if any video. CTA → `/38-0`.
Make sure the landing page matches the ad's mode (WC ads → WC Run page `/38-0/wc`).

---

## 5. Launch sequence

1. **Add the `Sign up` conversion event** (§0). ← do first
2. Build audiences A1–A4 + exclusion X1 (§1).
3. Confirm the winning post's **post ID**; load the WC-hook variants.
4. Launch both campaigns on **Website Traffic** (if event not yet reporting) or **Website
   Conversions/Sign up** (if it is). Frequency-cap remarketing ~3–5x/week.
5. Pre-launch check: landing loads <3s on mobile, UTMs on, exclusions applied, budgets right.
6. **Day 7 review:** cost-per-signup by ad group, CTR, frequency (fatigue), top/bottom creative.
   Cut losers, shift budget to winners, refresh the tired creative.

---

## 6. What I need from you to finalize

Account, handle, pixel, post IDs all confirmed from the audit above. Remaining decisions:

- **Signup event:** want me to draft the exact event-fire snippet for the signup-success route
  (using the existing Lead tracker) so the `p6vxh` pixel records signups? I can find the route in
  the `~/yourscore` codebase and give you the drop-in code.
- **Anchor creative:** promote `2064073128184012961` ("Free to play — YourScore.app/38-0",
  website destination) as the signup anchor + the Jun 9 video for engagement/remarketing? Or pick
  a different post.
- **Want me to build it?** I can drive X Ads Manager to create the audiences (A1–A4 + exclusion)
  and the two campaigns. Each irreversible step (publishing campaigns, spending budget) I'll
  confirm with you before clicking.
