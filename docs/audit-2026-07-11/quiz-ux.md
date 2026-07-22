# Quiz Game (/play) — End-to-End UX Audit

**Terminology check: clean.** No user-facing "Room"/"IQ" strings in quiz surfaces. One stale nav reference (#16).

## P0

**1. A multiplayer game stalls forever if the host backgrounds their phone, refreshes, or leaves — no server watchdog.**
Question advance is a client-side setTimeout on the host device only (/play/[roomId]/page.tsx:358-371, 520-524), and /api/room/next hard-rejects non-hosts (api/room/next/route.ts:34). No cron/server fallback. On mobile, backgrounding suspends JS timers — a host glancing at WhatsApp freezes the round for every player indefinitely ("Next question incoming…" forever). **Fix:** allow any member (or a service cron sweeping question_events past closes_at + grace) to call next; host gate should be an optimization, not a requirement.

## P1

**2. Refresh/rejoin mid-question never restores the live question — host refresh stalls the room.**
Initial load never calls fetchAndShowQuestion for the in-flight event (/play/[roomId]/page.tsx:420-434); recovery only on a rooms UPDATE (451-459). Reloader sits in "Next question incoming…" up to 20s; if the host reloads, closesAt is null → no advance scheduled → with #1, permanent stall. **Fix:** on load with status live, fetchAndShowQuestion(current_question_idx + 1); host reschedules from event closes_at.

**3. No connection-loss handling in the live game.**
.subscribe() with no status callback (/play/[roomId]/page.tsx:500), no CHANNEL_ERROR/TIMED_OUT handling, no resubscribe, no reconnecting UI, no visibilitychange refetch (zero visibility handlers in any quiz flow). Socket drops → player silently stops receiving questions. **Fix:** handle subscribe status; on reconnect/visibility restore, refetch room + current event.

**4. Signed-out users opening a game link get an infinite spinner.**
Room page load effect early-returns when !user (391) but loading stays true; render spins on loading || userLoading (673) — guests hitting /play/{id} see a spinner forever; the "sign in to answer" prompt (1127) is unreachable. **Fix:** read-only room view with sign-in CTA (mirror /versus/find guest gate, find/page.tsx:180-190).

**5. "SIGN UP & SAVE SCORE" doesn't save the score.**
(Same as acquisition finding — challenges/[slug]/page.tsx:1242-1244; run lives only in React state; lands back on pack intro.) **Fix:** stash answerLog + pack id in localStorage; submit via /api/quiz/solo-complete on return.

**6. Correct answers ship to the client (CDN-cached, world-readable) while first-attempt leaderboards, the WC daily series, and the £25 giveaway hang off those scores.**
/api/challenges/pack returns full questions incl. answer, edge-cached a day (api/challenges/pack/route.ts:20-26); grading is client-side (challenges/[slug]/page.tsx:638, h2h/[id]/page.tsx:284 — h2h reads quiz_packs.questions straight from the browser, 258-266); /api/quiz/solo-complete "re-grades" from client-supplied letters + elapsedMs. Club-league events already do this right (answers never sent). **Fix:** for competitive packs, serve answer-less questions + server grading like club events; keep cached route for casual practice only.

**7. Mid-game answer failures are completely silent.**
QuestionCard.handleSelect catch resets selected/reveal with no message (QuestionCard.tsx:53-55); /api/answer returns meaningful states ("Question closed", "Already answered", 429). Player taps at the buzzer, choice un-highlights, never learns if they scored. **Fix:** inline state ("Too late" / "Connection hiccup, retrying…"), auto-retry idempotent failures once.

## P2

**8. Solo/Multiplayer mental model fossil: hidden "Multiplayer" panel in /play reachable only by ?join=CODE deep link, with broken tab state.**
Toggle offers Solo | Leaderboards (play/page.tsx:658-676) yet a full multiplayer panel (challenge inbox, Create Game, Join with Code, Open Lobbies) renders when ?join=CODE sets mainTab="multiplayer" (541-547, 861-970) — neither toggle highlighted; tap away and it's gone forever. Open-lobby browsing + turns inbox effectively orphaned. YOURSCORE.md §9 still says "sub-tabs Solo + Multiplayer". **Fix:** real third tab, or fold into Versus and reduce ?join= to the join sheet; update canon doc.

**9. Any visitor to a live/finished room link is silently enrolled as a player.**
Unconditional upsert into room_members (431) regardless of status. Spectator inflates players.length → "2/3 answered" never completes → early advance (478) never fires; room drags at full 20s/question. **Fix:** only upsert while status === "lobby" (and below max_players); spectator view otherwise.

**10. "FIND AN OPPONENT — instantly" ends in a manual lobby; a matched human can wait on a stranger forever.**
Matchmaking creates rooms status "lobby" with the claimer as host (quiz-matchmaking.ts:103-120, 150-152). After "Opponent found → ENTER LOBBY", user must tap Start vs a CPU/shadow; a paired human waiter sees "Waiting for host…" with no timeout/escape. **Fix:** auto-start instant-match rooms (3-2-1 countdown); non-host fallback after ~20s.

**11. The scoring explainer lies: "Instant 1,000 / ~5s 775 / ~10s 550" vs engine max 200–600/question.**
Hardcoded intro tiles (challenges/[slug]/page.tsx:868-879) vs scoring.ts cap of 100×difficulty×2; h2h accept page uses total_questions * 1000 as max (h2h/[id]/page.tsx:684) → decent runs show "12% of max". **Fix:** compute tiles from maxPointsForDifficulty + SPEED_TIERS; use challenge.max_score for the h2h bar.

**12. £25 giveaway overlay auto-hijacks the results screen 700ms in.**
challenges/[slug]/page.tsx:622-630 auto-opens on every first render of results incl. guests/practice, covering the reward moment; fires alongside share sheet + notify prompt. **Fix:** keep the inline WIN £25 card (1138), drop the auto-open or delay to first interaction.

**13. Solo/h2h timers keep charging while backgrounded; scoring window invisible during play.**
useGameLoop anchors Date.now() with no visibility pause (lib/useGameLoop.ts:34-41) — a notification glance drops you Lightning → Very Slow. Timer colors flip at 5s/10s (challenges/[slug]/page.tsx:69-73), not the real 6s/12s/18s/24s band edges. **Fix:** pause/clamp on visibilitychange; tint at real band boundaries.

**14. Quitting a multiplayer game unhandled: documented ragequit penalty exists nowhere; abandoned opponent gets no signal.**
RAGEQUIT_PENALTY (−100) defined (scoring.ts:216), documented in §5A, zero call sites. Leaver goes quiet; remaining player waits 20s/question vs a ghost. **Fix:** detect departure (presence or missed-2 heuristic), "opponent left — finishing solo", early advance; apply the penalty or delete it from scoring.ts + docs.

**15. Accepting an h2h challenge offers Google-only sign-in.**
"YOU'VE BEEN CHALLENGED" renders <SignInWithGoogle> alone (h2h/[id]/page.tsx:773); prod auth has Apple + email. iPhone users at the hottest acquisition moment have no Apple path. **Fix:** link full /auth/sign-in?next=/h2h/{id} under the Google button.

## P3

**16. Stale nav copy in join-code error:** "Go to Play > Head-to-Head to start a new match" (play/page.tsx:355) — section doesn't exist. Say "Go to Versus → Find an opponent."

**17. /play/new step-2 pack picker is a bare alphabetical text list** (play/new/page.tsx:224-247) vs the rich cover pickers elsewhere; ~110 packs, no search. Reuse the /versus/quiz library component.

**18. Lobby "Start" button doubles as status label:** enabled from 1 player while reading "Waiting for players (1/2 min)" (787-789) — accidental solo starts. Split status from action or disable below 2 with explicit "start anyway".

**19. Browser-back mid-solo-quiz silently destroys the run** — Quit has window.confirm (947-953) but no back/gesture protection. History guard or persisted in-progress state.

### What's genuinely good
Guest → first solo question is 3 taps with a strong intro; the completed-game scorecard is one of the tightest loops in the app; empty states all exist with CTAs; join errors individually mapped. Biggest risk cluster: **live-multiplayer resilience** (1-3, 7, 9, 14) — happy path polished, nearly every deviation dead-ends the game.
