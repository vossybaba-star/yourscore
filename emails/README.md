# YourScore — Email Templates

Branded HTML email templates for lifecycle moments + Supabase Auth.

## File structure

```
emails/
├── _skeleton.html                  # Reference skeleton (not deployed)
├── lifecycle/                      # Triggered by app events — wire up via your ESP
│   ├── 01-welcome.html
│   ├── 02-first-quiz.html
│   ├── 03-first-league-created.html
│   ├── 04-league-invite.html
│   ├── 05-pre-match-nudge.html
│   ├── 06-post-match-recap.html
│   ├── 07-weekly-digest.html
│   ├── 08-top-of-league.html
│   ├── 09-first-member-joins.html
│   └── 10-tournament-wrap.html
└── README.md                       # this file

supabase/templates/                 # Supabase Auth transactional — point Supabase here
├── confirmation.html
├── magic_link.html
├── recovery.html
├── email_change.html
├── reauthentication.html
└── invite.html
```

## Brand tokens (locked from `tailwind.config.ts`)

| Token | Value | Used for |
|---|---|---|
| bg | `#0a0a0f` | Email body bg |
| surface | `#12121e` | Card / block bg |
| green | `#00ff87` | Primary CTA, accent numbers |
| amber | `#ffb800` | Streak / warning highlights |
| danger | `#ff4757` | Reserved for future "overtaken" email |
| text | `#ffffff` | Primary copy |
| muted | `#8888aa` | Footer + secondary |
| border | `rgba(255,255,255,0.08)` | Dividers, card borders |

**Fonts:** Bebas Neue (display) + DM Sans (body), loaded from Google Fonts with Impact / Helvetica fallbacks for clients that block web fonts (Outlook).

## Frequency policy

| Email | Cap |
|---|---|
| 01–04, 08–10 | Once per user, ever |
| 05 (pre-match) | Once per fixture the user opted into; tournament-wide opt-in also supported |
| 06 (post-match) | Once per fixture the user played in |
| 07 (weekly digest) | Max 1 per week, Sunday evening, only during a live tournament |
| 09 (first member) | Once per league the user created |

Every email footer includes a "Pause emails" link scoped to the league/tournament source plus a global unsubscribe.

---

## Lifecycle emails — subjects, previews, tokens

### 01 · Welcome
- **Trigger:** First signup (any auth method)
- **Subject:** `You're in. Now let's see what you actually know.`
- **Preview:** `Pick a club. Test your knowledge. Two minutes flat.`
- **Tokens:** `{{PAUSE_URL}}` `{{UNSUB_URL}}`

### 02 · First quiz completed
- **Trigger:** User finishes their first Challenge attempt
- **Subject:** `{{score}} / 2000. {{p4p}}% accuracy. Now beat your mates.`
- **Preview:** `Send the quiz to the group chat. See who actually knows their club.`
- **Tokens:** `{{score}}` `{{p4p}}` `{{streak}}` `{{club}}`

### 03 · First league created
- **Trigger:** User creates a league for the first time
- **Subject:** `{{league_name}} is live. Now invite your mates.`
- **Preview:** `Code: {{league_code}}. Drop it in the group chat.`
- **Tokens:** `{{league_name}}` `{{league_code}}` `{{league_url}}` `{{whatsapp_share_url}}`

### 04 · League invite received
- **Trigger:** User added to a league by someone else
- **Subject:** `{{inviter_name}} added you to {{league_name}}.`
- **Preview:** `Live questions during matches. Points stack all season.`
- **Tokens:** `{{inviter_name}}` `{{league_name}}` `{{league_url}}` `{{member_count}}` `{{top1_name}}` `{{top1_score}}` `{{top2_name}}` `{{top2_score}}` `{{top3_name}}` `{{top3_score}}`

### 05 · Pre-match nudge
- **Trigger:** ~60–90 min before kickoff of a fixture the user opted into
- **Subject:** `{{home}} v {{away}} kicks off in 1 hour.`
- **Preview:** `{{league_name}} is ready. Tap once to confirm you're in.`
- **Tokens:** `{{home}}` `{{away}}` `{{tournament}}` `{{kickoff}}` `{{league_name}}` `{{join_url}}` `{{skip_url}}`

### 06 · Post-match recap
- **Trigger:** ~30 min after a fixture the user played in ends
- **Subject:** `{{user_score}} pts. {{rank_in_league}} in {{league_name}}.`
- **Preview:** `{{p4p}}% accuracy. Biggest streak: {{streak}}.`
- **Tokens:** `{{home}}` `{{away}}` `{{home_score}}` `{{away_score}}` `{{user_score}}` `{{p4p}}` `{{streak}}` `{{rank_in_league}}` `{{rank_delta}}` `{{league_name}}` `{{league_url}}` `{{top1_name}}` `{{top1_score}}` `{{top2_name}}` `{{top2_score}}` `{{top3_name}}` `{{top3_score}}` `{{next_fixture}}` `{{next_fixture_url}}`

### 07 · Weekly digest
- **Trigger:** Sunday evening during a live tournament (cron job, single send)
- **Subject:** `Your week: {{week_score}} pts.`
- **Preview:** `{{matches_played}} matches, {{week_p4p}}% accuracy. Biggest next week: {{next_big_fixture}}.`
- **Tokens:** `{{week_score}}` `{{matches_played}}` `{{week_p4p}}` `{{best_match}}` `{{league1_name}}` `{{league1_rank}}` `{{league2_name}}` `{{league2_rank}}` `{{next_big_fixture}}` `{{next_big_url}}` `{{standings_url}}`

### 08 · First time topping a league
- **Trigger:** First time user's row hits #1 in any league
- **Subject:** `{{league_name}}: You're #1.`
- **Preview:** `Send the screenshot to the group chat. Twist the knife.`
- **Tokens:** `{{league_name}}` `{{user_score}}` `{{p4p}}` `{{league_url}}` `{{whatsapp_share_url}}` `{{next_fixture}}`

### 09 · First member joins
- **Trigger:** First other person joins a league the user created
- **Subject:** `{{joiner_name}} just joined {{league_name}}.`
- **Preview:** `Two down. Now bring in the rest of the group chat.`
- **Tokens:** `{{joiner_name}}` `{{league_name}}` `{{league_code}}` `{{league_url}}` `{{whatsapp_share_url}}`

### 10 · Tournament wrap-up
- **Trigger:** After the final match of a tournament the user played in
- **Subject:** `Your {{tournament}}, ranked.`
- **Preview:** `{{total_score}} pts. {{p4p}}% accuracy. {{matches_played}} matches. Here's your year.`
- **Tokens:** `{{tournament}}` `{{total_score}}` `{{p4p}}` `{{matches_played}}` `{{best_streak}}` `{{best_match}}` `{{final_rank}}` `{{league_name}}` `{{whatsapp_share_url}}` `{{next_tournament}}`

---

## Supabase Auth templates — subjects + variables

These use **Supabase's Go template syntax** (`{{ .ConfirmationURL }}` with the leading dot), not the `{{token}}` style used in lifecycle emails.

| Template | Suggested subject | Supabase variables |
|---|---|---|
| `confirmation.html` | Confirm your email | `{{ .ConfirmationURL }}` |
| `magic_link.html` | Your YourScore sign-in link | `{{ .ConfirmationURL }}` |
| `recovery.html` | Reset your YourScore password | `{{ .ConfirmationURL }}` |
| `email_change.html` | Confirm your new email | `{{ .ConfirmationURL }}` `{{ .Email }}` `{{ .NewEmail }}` |
| `reauthentication.html` | Your YourScore confirmation code | `{{ .Token }}` |
| `invite.html` | You're invited to YourScore | `{{ .ConfirmationURL }}` |

### Deploy to Supabase — option A (config.toml, recommended)

Add to `supabase/config.toml`:

```toml
[auth.email.template.confirmation]
subject = "Confirm your email"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.magic_link]
subject = "Your YourScore sign-in link"
content_path = "./supabase/templates/magic_link.html"

[auth.email.template.recovery]
subject = "Reset your YourScore password"
content_path = "./supabase/templates/recovery.html"

[auth.email.template.email_change]
subject = "Confirm your new email"
content_path = "./supabase/templates/email_change.html"

[auth.email.template.reauthentication]
subject = "Your YourScore confirmation code"
content_path = "./supabase/templates/reauthentication.html"

[auth.email.template.invite]
subject = "You're invited to YourScore"
content_path = "./supabase/templates/invite.html"
```

Then push: `supabase config push` (or your normal CLI deploy step).

### Deploy to Supabase — option B (dashboard)

1. Open Supabase dashboard → **Authentication** → **Email Templates**
2. For each template, paste the contents of the matching file and set the subject line above
3. Save each

> ⚠️ Dashboard edits do not sync to git. If you go this route, you'll need to keep `supabase/templates/` in sync manually. **Option A is the recommended path.**

---

## Deploying lifecycle emails (ESP-agnostic)

The lifecycle templates use `{{token}}` style placeholders. To use them with any ESP:

### Resend
```ts
import { Resend } from 'resend'
import fs from 'fs'

const html = fs.readFileSync('emails/lifecycle/02-first-quiz.html', 'utf-8')
  .replaceAll('{{score}}', String(score))
  .replaceAll('{{p4p}}', String(p4p))
  .replaceAll('{{streak}}', String(streak))
  .replaceAll('{{club}}', club)
  .replaceAll('{{PAUSE_URL}}', pauseUrl)
  .replaceAll('{{UNSUB_URL}}', unsubUrl)

await resend.emails.send({
  from: 'YourScore <hello@yourscore.app>',
  to: user.email,
  subject: `${score} pts. ${p4p}% accuracy. Now beat your mates.`,
  html,
})
```

### Postmark / Loops / Mailgun
Same idea — load the file, replace tokens, send. For higher-volume use, upload each template to the ESP once and reference by template ID, passing the token map as the variables payload.

### Recommended trigger source
- **01, 02, 03, 08, 09** — fire from your Next.js API routes when the event happens
- **04** — fire from the league-membership insert (DB trigger → edge function, or app-level on insert)
- **05** — Vercel cron pulling fixtures from `matches` table, joining with `room_players` (or whatever the opt-in table is post-rooms)
- **06** — match-end webhook from the admin panel, or a poller on `matches.status = 'completed'`
- **07** — Vercel cron, Sunday 18:00 UTC, only when an active tournament exists
- **10** — fires after the final fixture of a `tournament` is marked complete

---

## Token replacement pattern

Lifecycle templates use `{{token_name}}` consistently. Replace with `String.replaceAll` or your ESP's templating engine. Tokens that appear in every email:

- `{{PAUSE_URL}}` — link to pause emails for this league/tournament
- `{{UNSUB_URL}}` — global unsubscribe link from your ESP

Build these URLs server-side with signed tokens so they work without auth.

---

## Testing

1. **Preview in browser:** `open emails/lifecycle/06-post-match-recap.html` — renders close to Gmail's view
2. **Cross-client check:** Run each through [Litmus](https://litmus.com) or [Email on Acid](https://www.emailonacid.com) before launch. Critical clients to check: Gmail (web, iOS, Android), Apple Mail (iOS, macOS), Outlook 2016+ (desktop dark-mode handling differs)
3. **Dark-mode safety:** All templates are already dark — Gmail's auto-invert leaves dark templates alone, so no light variant is needed
4. **Token coverage:** Before sending, assert every `{{...}}` placeholder has been replaced — leftover `{{` in production = embarrassing

---

## Future / out of scope for this round

- Drip / re-engagement emails (no-league after 3 days, etc.) — deliberately not built; revisit after data on dropoff
- "You've been overtaken in a league" — needs a per-league-per-week digest pattern to avoid spam
- New Challenge dropped for {your club} — requires club affinity signal
- Sponsored content slots (for future pub sponsorship tier)
