"""
ATLAS - Python Backend
Serves the frontend and provides a REST API for persistent data storage (SQLite).
Run in Codespace: pip install -r requirements.txt && python app.py
"""
import json
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

# SQLite database path - in workspace so it persists
DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", "/workspace/atlas_data.db"))

# In-memory fallback if DB isn't ready (bootstrap)
_DEFAULT_STATE = {
    "projects": [
        {
            "id": "PRJ-0001",
            "name": "Project 1",
            "activities": [],
            "baselines": [],
            "actions": [],
        }
    ],
    "activeProjectId": "PRJ-0001",
    "settings": {
        "tableColumnVisibility": {},
        "defaultEditor": "Planner",
    },
}


def _get_db_path():
    return str(DB_PATH)


def _init_db():
    """Initialize SQLite and create the state table if needed."""
    import sqlite3

    conn = sqlite3.connect(_get_db_path())
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS atlas_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT
        )
        """
    )
    conn.commit()
    conn.close()


def _load_state():
    """Load full state from SQLite."""
    import sqlite3

    try:
        conn = sqlite3.connect(_get_db_path())
        row = conn.execute(
            "SELECT value FROM atlas_state WHERE key = ?", ("industrial_planning_intelligence_state_v1",)
        ).fetchone()
        conn.close()
        if row:
            return json.loads(row[0])
    except Exception:
        pass
    return _DEFAULT_STATE


def _save_state(state):
    """Save full state to SQLite."""
    import sqlite3
    from datetime import datetime

    try:
        conn = sqlite3.connect(_get_db_path())
        conn.execute(
            """
            INSERT OR REPLACE INTO atlas_state (key, value, updated_at)
            VALUES (?, ?, ?)
            """,
            ("industrial_planning_intelligence_state_v1", json.dumps(state), datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[ATLAS] Save failed: {e}")
        return False


# Ensure DB exists on first import
try:
    _init_db()
except Exception as e:
    print(f"[ATLAS] DB init warning: {e}")


@app.route("/api/health")
def health():
    """Health check for backend detection."""
    return jsonify({"status": "ok", "backend": "python"})


@app.route("/api/state", methods=["GET"])
def get_state():
    """Return the full ATLAS state (projects, activities, baselines, actions, settings)."""
    state = _load_state()
    return jsonify(state)


@app.route("/api/state", methods=["PUT", "POST"])
def save_state():
    """Save the full ATLAS state."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        if _save_state(data):
            return jsonify({"ok": True})
        return jsonify({"ok": False, "error": "save failed"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


# Serve static files (HTML, JS, CSS)
@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def serve_static(path):
    """Serve static files from workspace root."""
    if ".." in path or path.startswith("."):
        return "", 404
    full = Path(".") / path
    if full.is_file():
        return send_from_directory(".", path)
    # Bare path e.g. /activities -> activities.html
    if path in ("activities", "gantt", "materials", "intelligence", "anomaly-center", "login"):
        return send_from_directory(".", f"{path}.html")
    return "", 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[ATLAS] Backend starting at http://0.0.0.0:{port}")
    print(f"[ATLAS] Data stored in: {DB_PATH}")
    app.run(host="0.0.0.0", port=port, debug=True)
