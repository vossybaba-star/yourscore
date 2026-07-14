#!/bin/bash
# Shell wrapper for daily-brief.mjs — called by launchd.
# Pass --weekly as argument for the Monday job.
set -e
cd "$(dirname "$0")/../.." || exit 1
exec node --env-file=.env.local scripts/social/daily-brief.mjs "$@"
