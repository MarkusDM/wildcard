#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ENV="${WEB_ENV:-/etc/arc-poker/web.env}"
SERVER_ENV="${SERVER_ENV:-/etc/arc-poker/server.env}"

if [[ ! -f "$WEB_ENV" ]]; then
  echo "Missing $WEB_ENV. Run scripts/vps-bootstrap.sh first." >&2
  exit 1
fi

if [[ ! -f "$SERVER_ENV" ]]; then
  echo "Missing $SERVER_ENV. Run scripts/vps-bootstrap.sh first." >&2
  exit 1
fi

cd "$ROOT_DIR"

set -a
# shellcheck disable=SC1090
. "$WEB_ENV"
set +a

if [[ -z "${NEXT_PUBLIC_SERVER_URL:-}" ]]; then
  echo "NEXT_PUBLIC_SERVER_URL must be set in $WEB_ENV before building the web app." >&2
  exit 1
fi

npm ci
npm run build:server
npm run build:web

sudo systemctl restart arc-poker-server arc-poker-web
sudo systemctl reload nginx

sleep 2
sudo systemctl --no-pager --full status arc-poker-server arc-poker-web
curl -fsS http://127.0.0.1:4000/health
echo
echo "Deploy complete."
