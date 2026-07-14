# YourScore — UI First-Impressions & Content Review (agency-style)

**Date:** 2026-07-13 · **Scope:** what a cold visitor actually sees — live production
(yourscore.app), browsed logged-out on a 375×812 mobile viewport with a desktop spot-check.
Surfaces walked: landing, /play (Solo + Leaderboards), quiz catalogue, /38-0 hub, WC
Mastermind picker, /debate, /how-it-works, /blog + a post, /auth/sign-in.
**Method:** screenshot-and-read pass, agency-review lens: 5-second test, message clarity,
truthfulness of what's displayed, freshness, visual consistency, funnel logic. Six days
before the World Cup final, so freshness is judged harshly — that's the window.

---

## The 5-second verdict

**The product looks like a real game — dark, lime, confident, mobile-native. The first
screen sells "38-0. DRAFT YOUR BEST XI." clearly and the primary CTA goes straight into
play, not a form. That's better than most funded consumer apps.**

But the layer *underneath* the hero is where a new visitor decides whether this is a real,
alive product — and that layer currently works against you in three ways:

1. **The site shows things that aren't true.** A fake "live match" teaser for a feature
   that doesn't exist, a scoring system on /how-it-works that isn't the real one, a
   "lose and rebuild" rule that was retired, league example cards dated three weeks ago.
2. **The flagship moment has visible defects.** The World Cup Mastermind title clips its
   last letter on a standard phone; the landing has a full blank screen mid-scroll; the
   most important daily quiz cards are emoji placeholders sitting next to gorgeous poster
   art.
3. **The story is one week from expiring.** Every surface still sells the World Cup as
   the reason to be here, with no visible finale moment or "what's next" — the exact
   cliff the July 11 product audit called P0.

---

## What's genuinely working (keep)

- **Hero hierarchy** — one message, one dominant CTA ("Draft your XI"), play-first not
  signup-first. The glow treatment makes the primary action unmissable.
- **The 38-0 hub and Mastermind picker** are the strongest screens in the product: clear
  mode cards, the "one go a day / climbs the season board" framing, the catch-up strip.
- **/debate** is fresh (today's debate, dated correctly), one-tap votable as a guest —
  the lowest-friction thing on the site.
- **The quiz Leaderboards tab is real social proof**: 389 players, 34 quizzes, "YOURSCORE
  VERIFIED · LIVE", real usernames. This is the most credible screen on the site — and
  it's hidden behind a secondary tab.
- **Blog posts** are technically clean (FAQ accordions, one UTM'd deep-link, the new
  fantasy waitlist capture on every post).
- **Sign-in page** is the right shape: Apple-first, "Free forever", Terms/Privacy linked.
- **Poster-art quiz covers** (Messi vs Ronaldo, WC 2026 Big Kickoff) look premium.

---

## Findings — Severity A: the site says things that aren't true

A prize-paying, "verified ✓"-branded product cannot afford fiction on its public pages.

1. **Fabricated "live match" teaser, twice.** The landing's mock league card shows
   "England vs France · 67' — 2 watching →" and the leagues section promises "See who's
   live in a match right now." Live-match play is explicitly not live (gated on the
   mobile launch). A curious visitor who signs up looking for this finds nothing.
2. **/how-it-works teaches a scoring system that doesn't exist.** "Answer in 0–15s
   +200 pts / 15–30s +150 / 30–45s +100 / 3 correct in a row ×2 bonus" and "45s to answer
   each question." The real engine: 30s window, ×2 inside 6s, +50 streak bonus. The
   landing was corrected on Jul 12; this page still carries the old fiction — and it's
   the page you link people to when they ask how it works.
3. **Retired game rule still sold as current.** Landing step 02: "Win and swap a player,
   **lose and rebuild**." Stale-team was retired; the actual loop is now win→swap,
   loss→go again / redraft-a-position (shipped today). The public explainer contradicts
   the live game.
4. **The leagues narrative describes the old product.** "Pick your matches… Brazil vs
   Argentina · Jun 20 · +340 pts earned" reads as match-based points. Leagues actually
   aggregate quiz + 38-0 play. A convert who creates a league expecting match-picking
   will not find it.
5. **Demo leaderboard reads as fake data.** "The Mates — Marcus/Priya/Jamie/Zach, 6 games
   played" appears three times (landing ×2, how-it-works). Illustrative mocks are fine,
   but nothing labels them as examples — and they sit one tab away from a real board with
   389 real players that would do the same job honestly.
6. **£100 prize copy needs a decision.** The £25 giveaway was retired today as "not
   live." The £100 season-board promise still exists in signed-in surfaces and the daily
   tweet copy. If it's live, the *public* WC board and Mastermind picker never mention it
   (missed hook); if it isn't, it's the same false-promise class as the £25. One or the
   other — currently it's ambiguous everywhere.
7. **No Privacy/Terms in the footer.** The landing footer is Home / Quiz / 38-0 / How it
   works / Challenges / Join a league / Create a league / Contact. Five ad pixels fire on
   load and there's no visible privacy link outside the sign-in page. Legal pages exist —
   they're just not linked where regulators and app reviewers look first.

## Findings — Severity B: visible defects at first touch

8. **"WORLD CUP MASTERMIN" — the flagship card clips its own name** on a 375px screen,
   the last letter hidden behind the pitch graphic. This is the hero of the daily loop.
9. **A full blank viewport mid-landing.** Between the speed-scoring demo and the
   countdown section there's an entire empty screen of grid background on mobile. On a
   scroll-through, the page appears to have ended — anyone who stops there never sees the
   countdown, final CTA or footer.
10. **Header buttons wrap on mobile.** "Sign In" / "Sign Up" render as two-line buttons
    on 375px — cramped on the very first paint. Desktop header meanwhile runs THREE
    competing CTAs (Sign In, Sign Up, Create a league).
11. **Mobile tab bar on desktop.** The Home/Quiz/38-0 bottom nav renders pinned to the
    bottom of a 1280px desktop window — reads as unfinished on a big screen.
12. **Daily quiz cards look like placeholders.** Today's two featured dailies show plain
    emoji tiles (⚔️, 🏆) directly above rich poster-art covers. The newest, most
    important content looks the cheapest. (They're also mislabeled "All-Time Records" —
    the daily World Cup quizzes carry the wrong category chip across the catalogue.)
13. **Logo inconsistency.** The sign-in page renders the wordmark inside a white box;
    the header everywhere else is clean white-on-dark.

## Findings — Severity C: message & positioning

14. **Two competing identities in the title tags.** Landing: "The Home of Football
    Gaming." Every other page: "Football Knowledge Game." Pick one (the second one is the
    locked positioning).
15. **"38-0." is unexplained at first touch.** The brand-name-as-headline works for fans
    who know, but nothing on the first screen decodes it; the explanation ("a 38-game
    unbeaten season") first appears inside game copy. One clause under the hero fixes it.
16. **First-screen redundancy + choice overload.** "Draft your XI" appears three times
    (headline echo, subline, button); four stacked CTAs (Draft / Sign Up / Join a league
    / Get the app) before any proof. "Join a league" is a cold-visitor dead-end (needs a
    code); "Get the app" next to "No app needed" is contradictory on one screen.
17. **Vocabulary drift on public pages.** "Football Challenges" card and "Challenges" nav
    item vs the locked "Quiz" naming used in-product. "P4P" appears with no expansion
    until deep in the leagues section.
18. **The real social proof is buried.** 389 players on a verified board, 72 quiz games,
    a daily debate with real votes — none of it on the landing, which instead shows the
    fictional "The Mates" table. Real numbers beat mock screenshots every time.

## Findings — Severity D: freshness (the 6-day window)

19. **June dates all over a July page.** Example fixtures "Jun 20 / Jun 24 / Jun 27",
    catalogue copy "The tournament is here — test your knowledge before the group stages
    unfold" (dated 8 Jun, shown mid-semifinals), how-it-works demo "World Cup 2026 ·
    Opening Day." The tournament is at its climax and the site reads like it hasn't
    noticed.
20. **"THE CUP IS LIVE" fossilizes on Jul 20.** The countdown block has no post-final
    state; the finale (Jul 19) is the single biggest content moment of the season and no
    surface builds toward it — no "final in 6 days," no finale board countdown, no
    champion moment staged.
21. **Post-WC vacuum remains the #1 strategic risk** (unchanged from the Jul 11 audit):
    every default surface, the daily push, the Discover cards and the quiz series are
    WC-fueled with the fantasy launch ~4 weeks away. The waitlist capture (live today) is
    the only bridge currently in place.

---

## Scorecard

| Dimension | Grade | One line |
|---|---|---|
| First 5 seconds (mobile) | **B+** | Clear promise, one strong CTA; minor header wrap |
| Visual design language | **A−** | Confident, consistent dark/lime system; the poster art is genuinely premium |
| Truthfulness of displayed content | **D** | Fake live-match, fictional scoring page, retired rules, unlabeled mock data |
| Content freshness | **C−** | June dates & "Opening Day" during the semis; no finale arc |
| Message clarity / positioning | **B−** | Strong hook, but two taglines, unexplained brand name, vocab drift |
| Funnel logic | **B** | Play-first is right; CTA overload up top, real proof buried, league promise mismatched |
| Trust & compliance surface | **C** | Verified board is excellent; no footer legal links, prize ambiguity |

---

## Decisions (founder walkthrough, 13 Jul pm)

- Tagline → **"The Home of Football Gaming"** everywhere — APPROVED, shipped.
- #2 /how-it-works scoring → **top-line only**, no explicit point tables — APPROVED, shipped.
- #8 Mastermind title clip — APPROVED, shipped (fluid clamp).
- Fix item 4 (footer Privacy/Terms) — APPROVED, shipped (+ Blog link).
- Fix item 5 (£100 copy) — **NO CHANGE** (founder ruling).
- Fix item 6 (finale staging) — APPROVED, shipped (WcFinaleStrip on WC picker + board).
- Remaining items — pending founder approve/decline.

## What I'd fix, in order

**This week (before the final — small, copy-level):**
1. /how-it-works: real scoring table (mirror the landing fix), 30s not 45s, kill
   "Opening Day" demo. Half a day.
2. Landing: remove/re-label the fabricated live-match teaser ("2 watching →"), fix
   "lose and rebuild" → the real loop, refresh the three June fixture cards or make them
   evergreen, fix the blank section and the header wrap. One day.
3. Mastermind title clip on mobile. Trivial.
4. Footer: add Privacy / Terms links. Trivial.
5. Decide the £100 line: either promote it publicly on the board pages or retire the
   remaining copy like the £25.
6. Stage the finale: a "final in N days" strip on the WC surfaces + the board-freeze /
   champion announcement as the week's content event. This doubles as audit item #1's
   first half.

**Next two weeks:**
7. Replace mock "The Mates" data with real numbers (389 players, live board rows,
   today's debate) — honest social proof.
8. One title tag, one tagline ("Football knowledge" positioning), "Quiz" not
   "Challenges" on public nav.
9. Daily-quiz cover art parity (posters for dailies, fix the "All-Time Records"
   mislabel) and a first-screen clause decoding "38-0."
10. Desktop pass: hide the mobile tab bar ≥ md, consolidate the header CTAs.
11. Landing league section rewritten around what leagues actually are (quiz + 38-0
    points, one table) — and re-anchor the whole page for the post-WC story when the
    cutover ships.
