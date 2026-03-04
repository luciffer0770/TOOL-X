#!/usr/bin/env bash
# Start ATLAS with Python backend - run this in Codespace
set -e
cd "$(dirname "$0")"
echo "[ATLAS] Installing Python dependencies (if needed)..."
pip install --quiet -r requirements.txt
echo "[ATLAS] Starting backend at http://0.0.0.0:5000"
echo "[ATLAS] Open the forwarded port URL from the Ports panel"
exec python3 app.py
