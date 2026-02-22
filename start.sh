#!/usr/bin/env bash
# ATLAS platform startup tool – serves the app on port 8080

set -e
cd "$(dirname "$0")"
PORT="${PORT:-8080}"

echo "Starting ATLAS – Digital Twin Engineering Preparation Platform"
echo "Serving on http://localhost:${PORT}/"
echo ""
echo "  Login:  http://localhost:${PORT}/login.html"
echo "  Demo:   http://localhost:${PORT}/index.html?dev=1"
echo ""
echo "Press Ctrl+C to stop."
echo "---"

exec python3 -m http.server "$PORT"
