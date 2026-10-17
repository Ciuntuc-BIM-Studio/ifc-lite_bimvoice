#!/usr/bin/env bash
set -euo pipefail

# Deploy Lapin to the Hetzner server (beside BubbleBIM):
#   1) build the app on this machine (FULL=1: WASM and packages too)
#   2) rsync it to /opt/lapin/www — the hashed assets first, index.html last,
#      old assets kept so open tabs still find theirs (pruned after 30 days)
#   3) docker compose up (one nginx on 127.0.0.1:3461, behind the Cloudflare tunnel)

SERVER="${DEPLOY_SERVER:-root@23.88.107.11}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/lapin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
DIST="${ROOT}/apps/viewer/dist"

cd "${ROOT}"
if [[ "${FULL:-0}" == "1" ]]; then
  echo "→ Full build (WASM, packages, app)"
  pnpm turbo run build --filter='@ifc-lite/viewer...'
else
  echo "→ Build the app"
  (cd apps/viewer && NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" npx vite build)
fi
[[ -f "${DIST}/index.html" ]] || { echo "No build in ${DIST}"; exit 1; }

echo "→ Sync to ${SERVER}:${REMOTE_DIR}"
ssh "${SERVER}" "mkdir -p ${REMOTE_DIR}/www/assets"
rsync -az "${HERE}/docker-compose.yml" "${SERVER}:${REMOTE_DIR}/"
rsync -az --delete "${HERE}/nginx/" "${SERVER}:${REMOTE_DIR}/nginx/"
rsync -az "${DIST}/assets/" "${SERVER}:${REMOTE_DIR}/www/assets/"
rsync -az --delete --exclude assets --exclude index.html "${DIST}/" "${SERVER}:${REMOTE_DIR}/www/"
rsync -az "${DIST}/index.html" "${SERVER}:${REMOTE_DIR}/www/index.html"

echo "→ Start / reload nginx, prune assets older than 30 days"
ssh "${SERVER}" "cd ${REMOTE_DIR} && docker compose up -d --force-recreate && docker exec lapin-web nginx -s reload && \
  find ${REMOTE_DIR}/www/assets -type f -mtime +30 -delete"

echo "✓ https://lapin.ciuntucbimstudio.ro"
