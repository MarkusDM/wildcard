#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/arc-poker}"
APP_USER="${APP_USER:-arc-poker}"
DOMAIN="${DOMAIN:-_}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This bootstrap script is intended for an Ubuntu/Debian VPS." >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx

NODE_MAJOR="0"
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
fi

if [[ "$NODE_MAJOR" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  sudo useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

sudo install -d "$APP_DIR"
sudo install -d -m 0750 -o root -g "$APP_USER" /etc/arc-poker

if [[ ! -f /etc/arc-poker/server.env ]]; then
  sudo install -m 0640 -o root -g "$APP_USER" "$ROOT_DIR/deploy/env/server.env.example" /etc/arc-poker/server.env
fi

if [[ ! -f /etc/arc-poker/web.env ]]; then
  sudo install -m 0640 -o root -g "$APP_USER" "$ROOT_DIR/deploy/env/web.env.example" /etc/arc-poker/web.env
fi

render_template() {
  local src="$1"
  local dest="$2"
  sed \
    -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__APP_USER__|$APP_USER|g" \
    -e "s|__DOMAIN__|$DOMAIN|g" \
    "$src" | sudo tee "$dest" >/dev/null
}

render_template "$ROOT_DIR/deploy/systemd/arc-poker-server.service.template" /etc/systemd/system/arc-poker-server.service
render_template "$ROOT_DIR/deploy/systemd/arc-poker-web.service.template" /etc/systemd/system/arc-poker-web.service
render_template "$ROOT_DIR/deploy/nginx/arc-poker.conf.template" /etc/nginx/sites-available/arc-poker

sudo ln -sfn /etc/nginx/sites-available/arc-poker /etc/nginx/sites-enabled/arc-poker
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable arc-poker-server arc-poker-web nginx
sudo systemctl reload nginx

echo "Bootstrap complete."
echo "Edit /etc/arc-poker/server.env and /etc/arc-poker/web.env, then run: bash scripts/vps-deploy.sh"
