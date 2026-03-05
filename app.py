"""
ATLAS - Python Backend
Serves the full frontend (HTML, CSS, JS) and provides a REST API for persistent data storage (SQLite).
Run in Codespace: pip install -r requirements.txt && python3 app.py
"""
import json
import os
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__)
app.secret_key = os.environ.get("ATLAS_SECRET_KEY", secrets.token_hex(32))
CORS(app, supports_credentials=True)

DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", str(BASE_DIR / "atlas_data.db")))

_DEFAULT_STATE = {
    "projects": [{"id": "PRJ-0001", "name": "Project 1", "activities": [], "baselines": [], "actions": []}],
    "activeProjectId": "PRJ-0001",
    "settings": {"tableColumnVisibility": {}, "defaultEditor": "Planner"},
}

DEFAULT_USERS = [
    ("planner", "planner123", "Planner", "planner"),
    ("management", "management123", "Management", "management"),
    ("technician", "technician123", "Technician", "technician"),
]


def get_conn():
    return sqlite3.connect(str(DB_PATH))


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS atlas_state (
            key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS atlas_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS atlas_sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT,
            FOREIGN KEY (user_id) REFERENCES atlas_users(id)
        );
    """)
    conn.commit()
    # Seed demo users if empty
    cursor = conn.execute("SELECT COUNT(*) FROM atlas_users")
    if cursor.fetchone()[0] == 0:
        for username, password, display_name, role in DEFAULT_USERS:
            conn.execute(
                "INSERT INTO atlas_users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (username.lower(), generate_password_hash(password), display_name, role, datetime.utcnow().isoformat()),
            )
    conn.commit()
    conn.close()


def load_state():
    try:
        conn = get_conn()
        row = conn.execute(
            "SELECT value FROM atlas_state WHERE key = ?",
            ("industrial_planning_intelligence_state_v1",),
        ).fetchone()
        conn.close()
        return json.loads(row[0]) if row else _DEFAULT_STATE
    except Exception:
        return _DEFAULT_STATE


def save_state(state):
    try:
        conn = get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO atlas_state (key, value, updated_at) VALUES (?, ?, ?)",
            ("industrial_planning_intelligence_state_v1", json.dumps(state), datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[ATLAS] Save failed: {e}")
        return False


def verify_token(token):
    if not token:
        return None
    try:
        conn = get_conn()
        row = conn.execute(
            "SELECT u.id, u.username, u.display_name, u.role FROM atlas_users u JOIN atlas_sessions s ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')",
            (token,),
        ).fetchone()
        conn.close()
        return {"id": row[0], "username": row[1], "displayName": row[2], "role": row[3]} if row else None
    except Exception:
        return None


try:
    init_db()
except Exception as e:
    print(f"[ATLAS] DB init warning: {e}")


# --- API ---
@app.route("/api")
def api_info():
    return jsonify({"message": "ATLAS API", "endpoints": ["/api/health", "/api/state", "/api/auth/login", "/api/auth/me", "/api/backup", "/api/restore"]})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "backend": "python"})


@app.route("/api/state", methods=["GET"])
def get_state():
    return jsonify(load_state())


@app.route("/api/state", methods=["PUT", "POST"])
def put_state():
    try:
        data = request.get_json(force=True, silent=True) or {}
        return jsonify({"ok": True}) if save_state(data) else (jsonify({"ok": False}), 500)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


# --- Auth API ---
@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    try:
        data = request.get_json(force=True, silent=True) or {}
        username = (data.get("username") or "").strip().lower()
        password = data.get("password") or ""
        remember = bool(data.get("rememberMe"))
        if not username:
            return jsonify({"ok": False, "error": "Username required"}), 400
        conn = get_conn()
        row = conn.execute("SELECT id, password_hash, display_name, role FROM atlas_users WHERE username = ?", (username,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"ok": False, "error": "Invalid credentials"}), 401
        user_id, pw_hash, display_name, role = row
        if not check_password_hash(pw_hash, password):
            conn.close()
            return jsonify({"ok": False, "error": "Invalid credentials"}), 401
        token = secrets.token_urlsafe(32)
        expires_hours = 24 * 30 if remember else 8
        expires_at = datetime.utcnow()
        from datetime import timedelta
        expires_at = (expires_at + timedelta(hours=expires_hours)).isoformat()
        conn.execute(
            "INSERT INTO atlas_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, expires_at, datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()
        return jsonify({
            "ok": True,
            "user": {"username": username, "displayName": display_name, "role": role},
            "token": token,
            "expiresAt": expires_at,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/auth/me", methods=["GET", "POST"])
def auth_me():
    token = request.headers.get("Authorization") or request.args.get("token") or (request.get_json(silent=True) or {}).get("token")
    if token and token.startswith("Bearer "):
        token = token[7:]
    user = verify_token(token)
    if not user:
        return jsonify({"ok": False}), 401
    return jsonify({"ok": True, "user": user})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    token = request.headers.get("Authorization") or (request.get_json(silent=True) or {}).get("token")
    if token and token.startswith("Bearer "):
        token = token[7:]
    if token:
        try:
            conn = get_conn()
            conn.execute("DELETE FROM atlas_sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    return jsonify({"ok": True})


# --- Backup / Restore ---
@app.route("/api/backup")
def backup():
    try:
        return send_file(DB_PATH, as_attachment=True, download_name="atlas_backup.db")
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/restore", methods=["POST"])
def restore():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400
    f = request.files["file"]
    if not f.filename or not f.filename.endswith(".db"):
        return jsonify({"ok": False, "error": "Invalid file. Use .db backup"}), 400
    try:
        backup_path = BASE_DIR / "atlas_data_restore_temp.db"
        f.save(str(backup_path))
        # Validate: try to read state
        conn = sqlite3.connect(str(backup_path))
        row = conn.execute("SELECT value FROM atlas_state WHERE key = ?", ("industrial_planning_intelligence_state_v1",)).fetchone()
        conn.close()
        if not row:
            backup_path.unlink(missing_ok=True)
            return jsonify({"ok": False, "error": "Invalid backup file"}), 400
        import shutil
        shutil.copy(str(backup_path), str(DB_PATH))
        backup_path.unlink(missing_ok=True)
        return jsonify({"ok": True})
    except Exception as e:
        (BASE_DIR / "atlas_data_restore_temp.db").unlink(missing_ok=True)
        return jsonify({"ok": False, "error": str(e)}), 500


# --- Static files ---
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/login")
def login_redirect():
    return send_from_directory(BASE_DIR, "login.html")


@app.route("/<path:path>")
def serve_static(path):
    if ".." in path or path.startswith("."):
        return "", 404
    full = BASE_DIR / path
    if full.is_file():
        return send_from_directory(BASE_DIR, path)
    if path in ("activities", "gantt", "materials", "intelligence", "anomaly-center", "login", "calendar", "risk-register", "network"):
        return send_from_directory(BASE_DIR, f"{path}.html")
    return "", 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[ATLAS] Backend at http://0.0.0.0:{port}")
    print(f"[ATLAS] Data: {DB_PATH}")
    app.run(host="0.0.0.0", port=port, debug=True)
