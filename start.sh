#!/usr/bin/env bash
# Start PS-ETW with Python backend - run this in Codespace
set -e
cd "$(dirname "$0")"
echo "[PS-ETW] Installing Python dependencies (if needed)..."
pip install --quiet -r requirements.txt
echo "[PS-ETW] Starting backend at http://0.0.0.0:5000"
echo "[PS-ETW] Open the forwarded port URL from the Ports panel"
exec python3 app.py
