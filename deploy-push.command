#!/bin/bash
cd "$HOME/yourscore" || { echo "repo not found"; exit 1; }
echo "Pushing YourScore main (deploys league mock-up images)..."
git push origin main
echo "git push exit: $?"
# remove this temporary helper so it doesn't linger in the repo
git rm -f deploy-push.command >/dev/null 2>&1
git commit -m "chore: remove temp deploy helper" >/dev/null 2>&1
git push origin main >/dev/null 2>&1
echo "----------------------------------------"
echo "Done. Images deploying. You can close this window."
