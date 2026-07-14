#!/bin/zsh
# Sequentially generate any MISSING club cover (resumable). One at a time — no
# concurrency (concurrent gpt-image-1 calls trigger header timeouts).
cd ~/yourscore
D="$1"
clubs=(
  "Arsenal" "Aston Villa" "Bournemouth" "Brentford" "Brighton" "Burnley" "Chelsea"
  "Crystal Palace" "Everton" "Fulham" "Leeds United" "Liverpool"
  "Manchester City" "Manchester United" "Newcastle United" "Nottingham Forest"
  "Sunderland" "Tottenham Hotspur" "West Ham United" "Wolverhampton Wanderers"
)
i=0
for c in "${clubs[@]}"; do
  i=$((i+1))
  slug=$(echo "$c" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | sed 's/  */-/g')
  if [[ -f "$D/${slug}-cover.png" ]]; then
    echo "[$i/20] $c — already done, skip"
    continue
  fi
  echo "[$i/20] $c — generating..."
  node --env-file=.env.local scripts/gen-club-cover.mjs --club "$c" --out "$D" --quality high
  if [[ -f "$D/${slug}-cover.png" ]]; then echo "[$i/20] $c ✓"; else echo "[$i/20] $c ✗ FAILED"; fi
done
echo "CLUB_DRIVER_DONE"
