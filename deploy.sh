#!/usr/bin/env bash
#
# Deploy WC26 Bracket Lab to https://wc.galen.ca (Funio).
# Pushes main to GitHub, then updates the server checkout and
# syncs the static site into the subdomain docroot.
#
# One-time server setup lives in MyTools/AGENTS.md under
# "Deploying a Python web app to Funio" (static-site variant:
# subdomain docroot = ~/wc-app/public, no Passenger app).

set -euo pipefail
cd "$(dirname "$0")"

git push origin main
ssh funio '
  set -e
  cd ~/wc-app
  git pull --ff-only
  rsync -a index.html styles.css app.js engine.js data.js live.js live.php odds.php public/
'
# Upload the untracked odds API key straight into the docroot (never in git;
# rsync above has no --delete, so it survives future deploys).
if [ -f odds.key.php ]; then
  scp -q odds.key.php funio:~/wc-app/public/odds.key.php \
    && echo "odds.key.php -> uploaded" \
    || echo "odds.key.php -> upload FAILED (Market mode will use Elo fallback)"
else
  echo "odds.key.php not found locally — Market mode will use Elo fallback"
fi
curl -s -o /dev/null -w "https://wc.galen.ca/ -> %{http_code}\n" https://wc.galen.ca/
