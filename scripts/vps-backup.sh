#!/bin/bash
# vps-backup.sh — Layer-B backup: pull the IRREPLACEABLE bits off the Hetzner VPS
# to the laptop, so a full rebuild onto any fresh box is a config-restore, not a
# reconstruction from memory. See docs/VPS-RUNBOOK.md.
#
# Captures: .env.local (57 secrets), the deploy+root crontabs, the routines/ dir
# (headless-Claude prompts + run-routine.sh + crontab.new), the loop STATE files
# that dedup depends on (*.ran / *.json — NOT logs), and a runtime versions manifest.
#
# Run from the laptop:   bash scripts/vps-backup.sh
# Schedule (laptop):     weekly launchd, or before any VPS rebuild.
#
# Boundary: this pulls production secrets to ~/yourscore-backups (chmod 600, laptop
# only). It makes no changes on the VPS. Do not commit the backups dir.

set -uo pipefail

VPS="yourscore-vps"                         # ~/.ssh/config alias → root@94.130.229.19
DEPLOY_HOME="/home/deploy"
STAMP="$(date '+%Y-%m-%d_%H%M')"
DEST="$HOME/yourscore-backups/vps-$STAMP"
KEEP=8                                       # retain this many most-recent backups

mkdir -p "$DEST"
echo "→ backing up $VPS to $DEST"

# 0. reachability
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS" true 2>/dev/null; then
  echo "🔴 cannot reach $VPS over SSH — aborting (nothing written)"; rmdir "$DEST" 2>/dev/null
  exit 1
fi

# 1. secrets (the single most irreplaceable file)
if scp -q "$VPS:$DEPLOY_HOME/yourscore/.env.local" "$DEST/env.local.bak" 2>/dev/null; then
  chmod 600 "$DEST/env.local.bak"
  echo "  ✓ .env.local ($(grep -c '=' "$DEST/env.local.bak") vars)"
else
  echo "  🔴 .env.local MISSING — this is the critical file, investigate"
fi

# 2. crontabs (the hand-built schedule, not in git)
ssh "$VPS" "crontab -u deploy -l" > "$DEST/deploy.crontab" 2>/dev/null \
  && echo "  ✓ deploy crontab ($(grep -cvE '^\s*#|^\s*$' "$DEST/deploy.crontab") jobs)" \
  || echo "  ⚠ deploy crontab empty/unreadable"
ssh "$VPS" "crontab -l" > "$DEST/root.crontab" 2>/dev/null || true

# 3. routines dir + loop STATE files (dedup/liveness), excluding logs
ssh "$VPS" "cd $DEPLOY_HOME && tar czf - \
    routines \
    yourscore/scripts/data/*.ran \
    yourscore/scripts/data/*.json \
    yourscore/scripts/data/*.state \
    2>/dev/null" > "$DEST/state.tgz" 2>/dev/null
if [ -s "$DEST/state.tgz" ]; then
  echo "  ✓ routines + loop-state → state.tgz ($(du -h "$DEST/state.tgz" | cut -f1))"
else
  echo "  ⚠ state.tgz empty — check remote paths"
fi

# 4. runtime versions manifest (rebuild reference)
ssh "$VPS" 'bash -lc "
  echo os:      \$(lsb_release -ds 2>/dev/null)
  echo node:    \$(node -v 2>/dev/null)
  echo pnpm:    \$(pnpm -v 2>/dev/null)
  echo ffmpeg:  \$(ffmpeg -version 2>/dev/null | head -1)
  echo claude:  \$(sudo -u deploy /home/deploy/.local/bin/claude --version 2>/dev/null)
  echo cron:    \$(systemctl is-active cron 2>/dev/null)
"' > "$DEST/versions.txt" 2>/dev/null && echo "  ✓ versions manifest"

# 5. prune old backups
ls -1dt "$HOME"/yourscore-backups/vps-* 2>/dev/null | tail -n +$((KEEP+1)) | while read -r old; do
  rm -rf "$old" && echo "  · pruned $(basename "$old")"
done

echo "✅ backup complete: $DEST"
echo "   restore guidance: docs/VPS-RUNBOOK.md §3"
