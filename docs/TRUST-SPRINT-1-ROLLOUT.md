# Trust Sprint 1 — rollout and rollback

Audited commit: `30844f8`. Branch: `fix/trust-sprint1`.

The ordering below is not optional. Migration 262 revokes columns that the
**currently deployed** client reads straight from the browser. Applying it before
the app deploy takes H2H play, the live match quiz and the challenge pack
pickers down for every user.

---

## The exposure being closed

Four independent routes to a quiz's answer key, all verified against production
before any change was written:

| Route | Evidence | Closed by |
|---|---|---|
| `GET /api/challenges/pack` | Plain `curl https://yourscore.app/api/challenges/pack?slug=arsenal` with no key, no cookie, returns 20 questions each with `"answer"`. CDN-cached one hour. | Application change (answers stripped from the response) |
| `quiz_packs.questions` | anon key, 449 published packs, `answer` embedded per question | Migration 262 |
| `questions.answer` | anon key, 35,744 rows (3,211 `status=active`) | Migration 262 |
| `quiz_attempts.answers` | anon key, 2,694 of 2,695 rows; `selected` + `correct` per question reconstructs a played pack's key on its own | Migration 262 |

The first one is the important one to understand: it is **not** an RLS problem.
That route already uses the service-role client, so revoking database grants
would have left it wide open while the sprint's own acceptance criteria read as
passed. It needed an application fix.

Fifth, narrower: `h2h_challenges.challenger_answers` / `opponent_answers` are
world-readable once a challenge completes. Null on every current row, so nothing
is leaking today, but it is closed in 262 for the same reason.

Separately, `comments` rows with `subject_type = 'fantasy_feed'` were readable by
anon (39 rows returned) and insertable by any signed-in user regardless of the
Fantasy launch allowlist. Closed by migration 261.

---

## Deployment order

### Step 0 — before touching anything

Take a database backup (Supabase dashboard → Database → Backups → on-demand), or
confirm today's automatic backup exists. Migration 262 changes grants only, no
data, so the backup is belt and braces rather than the primary safety net; the
real safety net is `262_rollback_revoke_answer_key_columns.sql`.

### Step 1 — apply migration 261 (safe immediately, no deploy needed)

`261_comments_fantasy_feed_gate.sql` tightens the comments read policy.

Safe to run against production before the app ships, because **no application
read path depends on that policy**: `GET /api/comments` reads every row through
the service client (`src/app/api/comments/route.ts`), so guests keep seeing
comments on public surfaces exactly as they do now. The policy governs direct
PostgREST access only, which is the hole.

Verify after applying:

```bash
# expect 0 rows
curl -s "$SUPABASE_URL/rest/v1/comments?select=id&subject_type=eq.fantasy_feed&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"

# expect rows still returned (public discussion surfaces unaffected)
curl -s "$SUPABASE_URL/rest/v1/comments?select=id&subject_type=eq.debate&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

Then load a Social post detail page **signed out** and confirm replies still
render (they come through the service-role API, so they should).

### Step 2 — deploy the application

Merge and let Vercel deploy. This is the step that must land before 262.

What changes for users:
- The pack loader stops shipping answers. Answering now costs one round trip;
  the tap still registers instantly and the correct/incorrect styling lands when
  the response returns.
- H2H reads its questions from a participation-checked server route.
- The live match quiz and the multiplayer recovery fallback read questions
  through server routes instead of the browser client.
- Community accounts carry a "YourScore community account" label.

### Step 3 — verify the deploy before revoking anything

All of these must pass **on production** with the new code live and 262 **not
yet applied**:

1. Play a solo quiz start to finish signed out. Correct and incorrect answers
   both style correctly; the wrong-answer reveal still shows the right option;
   the final score saves.
2. Play the same quiz signed in. Score appears on the pack leaderboard.
3. Open an existing completed H2H result page. Both sides' picks render.
4. Start and complete an H2H challenge as the opponent.
5. Open a live match quiz page if one is running, or a multiplayer room.
6. Open the challenge pack picker from Versus and from a league. Question counts
   show.
7. Confirm no answer in any network response:
   ```bash
   curl -s "https://yourscore.app/api/challenges/pack?slug=arsenal" | grep -c '"answer"'
   # expect 0
   ```

If any of 1 to 6 fail, stop. Do not apply 262. Fix forward or revert the deploy.

### Step 4 — apply migration 262 — ✅ APPLIED 2026-08-06

Applied to production and verified. Results:

- All four answer paths now return `401 / 42501` to the public key: pack
  questions, the question bank's `answer` column, attempt answer logs, and h2h
  per question picks.
- Legitimate reads unaffected: pack names and metadata, question text and
  options, leaderboard scores, and h2h share card scores all still return.
- Gameplay re-verified on production AFTER the revoke, in a browser at 375px:
  a full 20 question run start to finish, correct answers scoring (+113 on a
  correct pick), wrong answers revealing the right option, FULL TIME screen with
  score and accuracy, and the pack leaderboard still rendering on reload.
- Tap to verdict measured at **462ms** on production including a transatlantic
  hop, so lower for a UK player.


Only once step 3 is fully green.

```
supabase/migrations/262_revoke_answer_key_columns.sql
```

Rebuilds the SELECT grants on `quiz_packs`, `questions`, `quiz_attempts` and
`h2h_challenges` column by column, omitting the sensitive ones. `service_role`
is untouched, so every server route keeps working.

### Step 5 — run the security probes

```bash
pnpm test
```

The probes in `src/lib/security/` assert that the anon key cannot read any of
the four answer paths, plus two controls that already passed before this sprint
(league chat comments closed, room snapshots answer-free) to prove the probe
itself works.

### Step 6 — re-verify gameplay after the revoke

Repeat step 3's checks 1 to 6. A column revoke can only break a read the app
still makes, so anything that survived step 3 and fails here points at a path
the audit missed. Roll back grants (below) if so.

---

## Rollback

**Application:** revert the deploy in Vercel. Safe at any point, because the old
client only needs the grants that exist until step 4.

**Migration 262:** run `262_rollback_revoke_answer_key_columns.sql`. Restores the
plain table-level SELECT for anon and authenticated.

This re-opens the answer-key exposure. If it is run, treat every published pack's
key as compromised for the window it was open, and plan a question rotation
rather than assuming scores from that period are clean.

**Migration 261:** to revert, re-create the policy from
`209_fantasy_league_chat.sql`. There is no reason to expect this to be needed;
no application path reads through it.

---

## Known follow-on risks, not fixed in this sprint

1. **A column added to any of the four tables later will not be readable by
   anon/authenticated until it is added to the grant list in 262.** This is the
   safe default and it is deliberate, but it will surprise whoever adds the
   column. Symptom: a PostgREST 403 mentioning the new column name.
2. **`rooms.answers_json` does not exist in production.** It appears in the
   generated types (`src/types/database.ts`) and looked like a live leak via
   `src/app/play/[roomId]/page.tsx`'s browser-side `.from("rooms").select("*")`.
   Checked directly: `select count(answers_json) from rooms` errors with
   `42703: column "answers_json" does not exist`. So there is nothing to drop;
   the generated types are simply stale and should be regenerated. Recorded here
   because the stale type is what made it look like a risk in the first place.
3. **Completed H2H answer logs** are withheld from the browser by 262 and served
   by the participation-checked route instead. The share-link use case (a
   signed-out viewer opening someone's result) still shows scores, since those
   columns stay granted, but no longer the per-question picks.
4. **The Fantasy launch allowlist remains app-layer only.** Migration 261 sets
   the durable boundary at "signed in", matching `fantasy_feed_events`. It does
   not encode the 4-id allowlist, which is documented in `flag.ts` as a
   visibility gate rather than a security boundary and is due to be lifted.

---

## CI workflow: needs a token with `workflow` scope

`.github/workflows/ci.yml` is written and verified locally (`pnpm test`, `pnpm lint`
and `pnpm build` all pass against it) but is **not in this branch**. Pushing it was
rejected:

```
refusing to allow an OAuth App to create or update workflow
.github/workflows/ci.yml without `workflow` scope
```

Add it yourself, either through the GitHub web UI (Add file → Create new file →
`.github/workflows/ci.yml`) or from a local shell whose credentials carry the
`workflow` scope. The file content is below verbatim.

Once it is in, every PR runs install (frozen lockfile) → `pnpm test:ci` → `pnpm lint`
→ `pnpm build`, and fails the job on any of them. The suite is green today
(609 tests, 601 pass, 0 fail, 8 skipped), so it will not be red on arrival. The
8 skips are the anon-key security probes, which skip when Supabase env vars are
absent and therefore stay green in CI without secrets.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test-lint-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Must run before actions/setup-node's pnpm cache step below — that
      # step needs pnpm already on PATH to resolve the store path it caches.
      - uses: pnpm/action-setup@v4
        with:
          version: 11

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Test
        run: pnpm test:ci

      - name: Lint
        run: pnpm lint

      - name: Build
        run: pnpm build
        env:
          # Dummy, non-functional values — never the real project. The build
          # only needs these two to be a syntactically valid URL/string (they
          # feed straight into @supabase/ssr's client constructor); nothing
          # in `next build` performs an external write, and with fake
          # credentials it categorically cannot reach the real database.
          # Every other NEXT_PUBLIC_* var in this app falls back safely
          # (`?? "https://yourscore.app"` or an `if (id)` guard) when unset,
          # so none of them are needed here.
          NEXT_PUBLIC_SUPABASE_URL: https://ci-placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-anon-key-not-real
```


---

## Postscript: 262 broke H2H, and the fix

Applying 262 took every H2H challenge link down. `src/app/h2h/[id]/page.tsx`
fetched the challenge with `select("*")`. Under column level grants PostgREST
rejects the WHOLE query with 42501 rather than omitting the columns you
withheld, so the row came back null and the page fell to its not found branch.
Every link read "Challenge expired or not found".

Two things made it slower to spot than it should have been. The verification in
Step 3 replayed a solo quiz but never opened an H2H link. And the first
challenge used to reproduce it was ALSO genuinely expired, which shows the same
copy for a completely different reason.

**Rule for any future column revoke: grep for `select("*")` on that table in
client code first.** A star select requests every column, including ones added
later.

Mitigation was a single statement, applied within minutes:

```sql
grant select on public.h2h_challenges to anon, authenticated;
```

Quiz answer keys were unaffected throughout; packs, the question bank and
attempt logs stayed locked.

The real fix shipped in PR #93: explicit column list on the page, and both
sides' per question picks moved onto `/api/h2h/[id]/questions`, which already
checks participation and completeness. The h2h column revoke was then re
applied and verified end to end:

- Completed challenge, signed in as a participant: scores, question by question
  review and both players' picks all render.
- Same page signed out: scores still render so share links work, review
  correctly withheld.
- Awaiting opponent challenge: accept screen renders.
- `select(*)` and the two answer columns both return 401 to the public key.
