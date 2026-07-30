#!/usr/bin/env bash
# FPL Raptor daily fetch — pulls the transcript of his latest TEAM/PICKS video so
# the Scout routine can extract his XI/captain and cross-check it against our
# published picks + the live FPL feed. Transcript = YouTube auto-captions (text),
# so no video is watched. Prints: VIDEO_ID / TITLE / URL, then the clean prose.
#
# Usage: bash scripts/fantasy/raptor-fetch.sh
# Requires: yt-dlp on PATH.
set -euo pipefail
CH="https://www.youtube.com/@FPLRaptor/videos"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Latest videos; prefer one whose title reads like a team/picks/transfers video.
LATEST="$(yt-dlp --flat-playlist --playlist-end 8 --print "%(id)s	%(title)s" "$CH" 2>/dev/null)"
VID="$(printf '%s\n' "$LATEST" | grep -iE "team|draft|transfer|GW[0-9]|game ?week|wildcard|selection|captain" | head -1 | cut -f1)"
[ -z "${VID:-}" ] && VID="$(printf '%s\n' "$LATEST" | head -1 | cut -f1)"
TITLE="$(printf '%s\n' "$LATEST" | awk -F'\t' -v v="$VID" '$1==v{print $2; exit}')"

echo "VIDEO_ID=$VID"
echo "TITLE=$TITLE"
echo "URL=https://www.youtube.com/watch?v=$VID"
echo "FETCHED_AT=$(date -u +%FT%TZ)"
echo "----TRANSCRIPT----"

yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt \
  -o "$TMP/r.%(ext)s" "https://www.youtube.com/watch?v=$VID" >/dev/null 2>&1 || true
if [ -f "$TMP/r.en.vtt" ]; then
  sed -e '/-->/d' -e '/^WEBVTT/d' -e '/^Kind:/d' -e '/^Language:/d' \
      -e 's/<[^>]*>//g' -e 's/^[[:space:]]*//' "$TMP/r.en.vtt" \
    | grep -v '^$' | awk '!seen[$0]++' | tr '\n' ' ' | sed 's/  */ /g'
else
  echo "(no english auto-captions available for this video)"
fi
