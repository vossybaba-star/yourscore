# Social repurpose pipeline (track → reword → review → post)

Tracks football X accounts, rewords their tweets into **original** YourScore posts
(no @mention/credit), and — after **your** approval — posts them from **@Yourscore_App_**.

All creds are already in `.env.local` (`X_API_*` for read+write as @Yourscore_App_,
`ANTHROPIC_API_KEY` for rewording). Always run with `node --env-file=.env.local`.

## 1. Pick the accounts
Edit `scripts/data/x-watchlist.json`:

```json
{
  "defaults": { "perRun": 3 },
  "accounts": [
    { "username": "FabrizioRomano", "note": "transfer breaking news — keep the urgency, make it ours" },
    { "username": "OptaJoe",        "note": "stats account — lead with the number" }
  ]
}
```
- `username` — handle without the `@`.
- `note` — optional, steers the reword voice for that account.
- `perRun` — max **new** tweets pulled per account per run.

## 2. Track + reword (writes drafts, posts nothing)
```bash
node --env-file=.env.local scripts/x-track.mjs            # all accounts
node --env-file=.env.local scripts/x-track.mjs --account FabrizioRomano
node --env-file=.env.local scripts/x-track.mjs --dry      # preview, don't save
```
Only tweets newer than the last run are processed (cursor in `data/x-state.json`),
and each source tweet is queued at most once. Drafts land in `data/x-queue.json` as `pending`.

## 3. Review + publish
```bash
node --env-file=.env.local scripts/x-queue.mjs list                 # pending + approved
node --env-file=.env.local scripts/x-queue.mjs show 8837121         # full draft + source
node --env-file=.env.local scripts/x-queue.mjs edit 8837121 "..."   # rewrite the draft
node --env-file=.env.local scripts/x-queue.mjs approve 8837121      # (or: approve --all)
node --env-file=.env.local scripts/x-queue.mjs post --dry           # preview exactly what fires
node --env-file=.env.local scripts/x-queue.mjs post                 # publish approved → @Yourscore_App_
node --env-file=.env.local scripts/x-queue.mjs prune                # clear posted/rejected
```
`post` only ever fires drafts you've **approved**. Over-280 drafts are blocked until edited.

## Design decisions (founder, Jun 2026)
- **Approval-gated** — nothing auto-posts.
- **Original take, no @mention/credit** of the source account.
- **Posts from @Yourscore_App_** only.
- Reword stays accurate to the source, keeps rumour hedges, won't invent facts.
  Transfer news still warrants a human glance before posting (that's the gate).

## No "AI look" — enforced, not just requested
The reword prompt forbids AI-tell punctuation, and `sanitize()` in `lib/x-watch.mjs`
**guarantees** it in code — run on every draft at reword, at `edit`, and one last time
right before `post`. It:
- kills the long dash (em/en/figure/minus) — the #1 tell — turning it into a single
  spaced hyphen ` - ` (ASCII hyphens in `1-0` / `head-to-head` are left alone);
- straightens curly quotes/apostrophes, turns the `…` glyph into `...`, strips bullets
  and arrow symbols, and normalises non-breaking/exotic spaces;
- keeps emojis (the house style now requires at least one per tweet).
Unit-tested (14/14). A hand-edited `x-queue.json` can't sneak a symbol past the post gate.

## Schedule — ONE proposal per scan (current)
`app.yourscore.x-propose` runs `scripts/x-propose.mjs` then `x-telegram.mjs push`. Each
fire scans the accounts and proposes the **single biggest unused story** to Telegram.
One tweet per scan, never a batch.

- **Morning (overnight catch-up):** 08:00, 08:30, 09:00, 09:30, 10:00 BST.
- **Afternoon/evening (live):** 15:00, 16:30, 18:00, 19:30, 21:00 BST.
- "Best" = highest engagement (likes + 2x retweets + replies) within the last 18h,
  newest as tiebreak. Dedup is by source tweet id against the whole queue, so nothing
  is proposed twice and **declined ones never return**.
- Only fires while the Mac is awake; a missed slot runs once on next wake.

```bash
bash scripts/x-propose-run.sh                        # propose one now
node --env-file=.env.local scripts/x-propose.mjs --dry   # preview the pick, save nothing
launchctl unload ~/Library/LaunchAgents/app.yourscore.x-propose.plist  # pause
launchctl load -w ~/Library/LaunchAgents/app.yourscore.x-propose.plist # resume
```
Change times by editing `StartCalendarInterval` in the plist, then unload + load.
(The old batch `x-track`/`x-evening-run.sh` and the `x-drip` auto-poster are retired/disabled.)

## Telegram review + GIF (the approval surface)
Drafts are reviewed from your phone via Telegram bot **@Yourscor_bot**. Posting only
happens when you tap; GIFs are supported by uploading a file (the X API can't reach the
in-app GIF picker).

- Each scan proposes one draft to Telegram with **✅ Post · 🎬 Add GIF · ✏️ Edit · 🗑 Decline**.
- **Edit:** tap ✏️, then reply with the new wording → it replaces the draft and re-shows the buttons.
- **Add a GIF:** tap 🎬, then forward a GIF or paste a Giphy/Tenor link → it attaches,
  then tap **✅ Post with this GIF**.
- `app.yourscore.x-telegram-poll` (launchd, every 60s) processes your taps within a minute.

```bash
node --env-file=.env.local scripts/x-telegram.mjs push            # push new pending drafts
node --env-file=.env.local scripts/x-telegram.mjs push <id>       # push a specific draft
node --env-file=.env.local scripts/x-telegram.mjs poll            # process taps now (manual)
```
GIF attaches via `uploadAnimated()` in `lib/x-watch.mjs` (chunked upload: `tweet_gif`
for .gif, `tweet_video` for the mp4s Telegram sends). One GIF per tweet, no GIF+image mix.

**Posting rule (founder): every tweet is checked before posting. NO auto-posting.**
The `x-drip` auto-poster is DISABLED. The only way a tweet goes live is tapping "✅ Post"
in Telegram. Do not re-enable the drip without the founder asking.

## Files
| File | Tracked? | Purpose |
|---|---|---|
| `scripts/lib/x-watch.mjs` | yes | shared X read/write + reword helpers |
| `scripts/x-track.mjs` | yes | fetch + reword + enqueue |
| `scripts/x-queue.mjs` | yes | review + post CLI |
| `scripts/data/x-watchlist.json` | yes | the accounts you track |
| `scripts/data/x-queue.json` | no (gitignored) | the draft queue |
| `scripts/data/x-state.json` | no (gitignored) | per-account cursors + id cache |
