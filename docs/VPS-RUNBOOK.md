# YourScore VPS Runbook — backup, restore, and the P0 landmines

**Purpose:** the entire business now runs on one Hetzner box (`94.130.229.19`). This is the
single point of failure. This runbook makes "VPS down" a ~30-minute restore instead of a
business outage, and captures the two live landmines that would break a clean rebuild.

Companion: [`scripts/vps-backup.sh`](../scripts/vps-backup.sh) (off-box config/state backup).
Loop-level context: [`docs/LOOP-STANDARD.md`](./LOOP-STANDARD.md).

---

## 1. What's on the box (the thing we're protecting)

| Layer | Detail | Replaceable? |
|---|---|---|
| Server | Hetzner **CPX32** (4 vCPU / 8 GB / 160 GB), Nuremberg, Ubuntu 24.04, IP `94.130.229.19` | yes (rebuild) |
| Runtime | Node 24.18 (`/usr/bin/node`), pnpm 11.10, ffmpeg 6.1.1, Playwright 1.61 chromium, `claude` CLI v2.1.204 (`~/.local/bin`) | yes (reinstall) |
| App | `/home/deploy/yourscore` + `/home/deploy/yourscore-videos` (git clones) | yes (re-clone) |
| **Secrets** | `~/yourscore/.env.local` — **57 vars, chmod 600, serves both repos** | **NO — irreplaceable** |
| **Schedule** | the `deploy` user crontab (~35 lines: quiz, health, x-*, reddit-*, content-*, ig-*, routines) | **NO — hand-built, not in git** |
| **Routines** | `/home/deploy/routines/` — `run-routine.sh` + copied SKILL.md prompts + `crontab.new` | **NO — copies, drift from laptop** |
| **Loop state** | dedup/liveness files the crons write: `scripts/data/launch-daily.ran`, `x-state.json`, `reddit-queue.json`, `reddit-state.json`, deadman traces | **partial — see §4 warning** |

**The insight:** almost everything is replaceable *except* the four bold rows. A backup that
captures those four turns a total-loss rebuild into a config-restore. That's what
`vps-backup.sh` grabs.

---

## 2. Backup strategy — two independent layers

### Layer A — Hetzner image backups (the whole disk, automated)
Enable **Backups** on the server in the Hetzner Cloud console (or `hcloud server enable-backup
<id>`). ~20% surcharge on the server price; keeps 7 rotating automated images. This is the
"restore the entire machine in a few clicks" safety net.

- **Also:** take a **manual snapshot before any risky change** (`hcloud server create-image
  --type snapshot`). Snapshots don't rotate out; label them (`pre-node-upgrade-2026-07`).
- **Stable IP:** attach a **Hetzner Floating IP** to the server and point everything at *that*,
  not the raw `94.130.229.19`. Then a rebuild onto a new server keeps the same IP — nothing
  downstream (reddit SSH target, VPS→app news ingest) breaks. Do this once; it's the biggest
  single resilience win. *(Founder action — small.)*

### Layer B — config/state backup (the irreplaceable bits, off-box)
Run `scripts/vps-backup.sh` from the laptop on a schedule (Vercel-cron or a laptop launchd
weekly). It SSHes in and pulls the four bold rows above into
`~/yourscore-backups/vps-<date>/`, encrypted-at-rest by living only on your machine. This is
what saves you if the Hetzner image itself is corrupt or you rebuild onto a fresh box.

> Why both: Layer A restores the *machine*; Layer B restores the *config* onto any machine
> (including a cheaper CAX ARM box later). Layer A alone ties you to Hetzner image health;
> Layer B alone means reinstalling runtimes by hand. Together = fast + portable.

---

## 3. Restore procedure (target: ~30 min)

### Fast path — Hetzner image (Layer A) exists
1. Console → server → **Backups/Snapshots → Rebuild from image** (or `hcloud server rebuild`).
2. If IP changed and you skipped the Floating IP: re-point the SSH target and the VPS→app
   ingest URL. (This is why the Floating IP matters.)
3. `ssh yourscore-vps 'crontab -l'` — confirm the schedule is intact; `systemctl status cron`.
4. Fire one health run manually: `ssh yourscore-vps 'cd ~/yourscore && node --env-file=.env.local scripts/health/check.mjs'` → expect the Telegram scorecard.
5. Done.

### Full rebuild — fresh box (image unusable, or moving to ARM)
Runs off Layer B backup + this list (derived from the Jul-2026 provisioning record):
1. `hcloud server create` → Ubuntu 24.04, add your SSH key, attach the Floating IP.
2. Create `deploy` user (uid 1000), sudo, ufw SSH-only, 2G swap, `timedatectl set-timezone Europe/London`.
3. Install runtimes: Node 24.x, `corepack enable && corepack prepare pnpm@11`, ffmpeg,
   `npx playwright install --with-deps chromium`, `claude` CLI.
4. Clone both repos into `/home/deploy/`. `pnpm install` in each.
5. **Restore from backup:** drop `.env.local` (chmod 600), the `routines/` dir, and the loop
   **state files** (§4) back into place.
6. **Apply the two landmine fixes (§5) — a fresh clone re-breaks without them.**
7. Restore the crontab: `crontab ~/routines/crontab.new` (staged file, avoids the auto-mode
   safety classifier — load it with a plain `crontab <file>`, never via the agent).
8. Health run (as above) → green scorecard = business back up.

---

## 4. ⚠️ The double-fire warning (loop-state on restore)

A restored box that **lost its state files can double-fire on first run**, because the dedup
keys live partly on disk:

- `scripts/data/launch-daily.ran` — if missing, the daily quiz can re-publish + **re-email**.
- `reddit-queue.json` / `reddit-state.json` — if missing, already-drafted threads re-draft.
- `x-state.json`, `x-queue.json` — if missing, already-approved tweets can re-queue.

**Restore these from the Layer-B backup before re-enabling the crontab**, OR gate the first
post-restore run (`FORCE` off, watch one cycle). This is the same class as the P1 email-dedup
gap in the Loop Standard — file-based dedup is fragile across rebuilds. *(Long-term: moving
these dedup keys into the DB, like `notification_log`, makes restore stateless.)*

---

## 5. The two P0 landmines — founder-action checklist

Both must be fixed for a clean rebuild to work, and both are live right now (per the migration
record; **verify they're still open**):

### Landmine 1 — VPS has no git credentials
The daily quiz routine commits `src/data/draft/wc-quiz.json` but `git push` fails (`could not
read Username for https://github.com`), so refreshed WC draft pools never reach prod.
- [ ] Create a GitHub **deploy key** (repo → Settings → Deploy keys → add, *allow write*) or a
      fine-grained PAT scoped to the repo.
- [ ] On the VPS, configure it (`git remote set-url` to SSH, add the key to `deploy`'s
      `~/.ssh`, or set `credential.helper store` with the PAT).
- [ ] Verify: `ssh yourscore-vps 'cd ~/yourscore && git push'` succeeds.
- *This is an access-control change — must be done by you, not an agent.*

### Landmine 2 — `sharp` is not on `main`
Quiz artwork works only because the VPS `package.json` is hand-patched; a clean re-clone or
`git checkout .` re-breaks it (the Jul-8 artwork crash).
- [ ] Cherry-pick / land commit `b59484f` (adds `sharp`) from `your-pl-xi/gate-generator` onto
      `main`. *(I can prepare this PR/commit — you push.)*
- [ ] After it's on `main`, the VPS working tree stops being a special snowflake.

> Note: the VPS working tree is permanently dirty (crons write `scripts/data/*.log`, `*.ran`,
> `x-*.json` into tracked paths), so `git pull`/`rebase` abort. Update single files with
> `git checkout origin/main -- <path>`. A rebuild is a good moment to `.gitignore` those
> written-into paths so the tree stays clean.

---

## 6. Recommended cadence
- **Layer A Backups:** enable once (automated daily). Manual snapshot before risky changes.
- **Layer B `vps-backup.sh`:** weekly, + on-demand before a rebuild. Keep the last ~8.
- **Restore drill:** once, now — actually run the fast-path restore onto a throwaway snapshot
  so the runbook is proven, not theoretical. An untested backup is not a backup.
