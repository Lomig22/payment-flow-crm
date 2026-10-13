#!/usr/bin/env bash
# Déploie le worker sur le VPS : ./deploy.sh root@IP_DU_VPS
# Copie le worker + pageAction.js (partagé avec l'extension), installe les dépendances
# et (re)démarre le service systemd. La 1re fois, voir README (Node, .env, state.json).
set -euo pipefail
HOST="${1:?Usage : ./deploy.sh root@IP_DU_VPS}"
HERE="$(cd "$(dirname "$0")" && pwd)"

rsync -av --exclude node_modules --exclude .env --exclude state.json \
  "$HERE/" "$HOST:/opt/linkedin-worker/"
rsync -av "$HERE/../linkedin-extension/pageAction.js" "$HOST:/opt/linkedin-worker/pageAction.js"

ssh "$HOST" 'set -e
  cd /opt/linkedin-worker
  npm install --omit=dev
  npx playwright install --with-deps chromium
  cp linkedin-worker.service /etc/systemd/system/linkedin-worker.service
  systemctl daemon-reload
  systemctl enable linkedin-worker
  systemctl restart linkedin-worker
  systemctl --no-pager status linkedin-worker | head -5'
