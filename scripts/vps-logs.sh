#!/usr/bin/env bash
set -euo pipefail

sudo journalctl -u arc-poker-server -u arc-poker-web -n 100 -f
