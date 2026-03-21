#!/usr/bin/env bash
# Serve ATLAS static files so cloud / port-preview URLs work.
# python3 -m http.server defaults to 127.0.0.1 — previews then get HTTP 502.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8080}"
echo "[ATLAS] Static files — bind 0.0.0.0:${PORT} (use this URL in the Ports / preview panel)"
echo "[ATLAS] Login: /login.html"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
