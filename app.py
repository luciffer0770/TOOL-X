"""
ATLAS - Python Backend
Serves the full frontend (HTML, CSS, JS) and provides a REST API for persistent data storage (SQLite).
Run in Codespace: pip install -r requirements.txt && python3 app.py
"""
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from flask import Flask, jsonify, make_response, request, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__)
app.secret_key = os.environ.get("ATLAS_SECRET_KEY", secrets.token_hex(32))

_cors_origins = os.environ.get("ATLAS_CORS_ORIGINS", "").strip()
if _cors_origins:
    _origins = [o.strip() for o in _cors_origins.split(",") if o.strip()]
    CORS(app, resources={r"/api/*": {"origins": _origins, "supports_credentials": True}})
else:
    CORS(app, supports_credentials=True)

DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", str(BASE_DIR / "atlas_data.db")))
STATE_KEY = "industrial_planning_intelligence_state_v1"


def state_api_open():
    """If true, /api/state GET/PUT work without Bearer (local demo only — do not expose to internet)."""
    return os.environ.get("ATLAS_OPEN_STATE_API", "").strip().lower() in ("1", "true", "yes")


def state_requires_auth():
    return not state_api_open()

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


def migrate_atlas_schema(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(atlas_state)").fetchall()}
    if "version" not in cols:
        conn.execute("ALTER TABLE atlas_state ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS atlas_audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            action TEXT NOT NULL,
            details_json TEXT,
            username TEXT,
            user_id INTEGER,
            client_ip TEXT,
            state_version_after INTEGER
        )
        """
    )


def _client_ip():
    try:
        xff = request.headers.get("X-Forwarded-For") or ""
        if xff:
            return xff.split(",")[0].strip()[:128]
        return (request.remote_addr or "")[:128]
    except RuntimeError:
        return ""


def append_audit_event_conn(conn, action, details=None, user=None, state_version_after=None):
    now = datetime.now(timezone.utc).isoformat()
    uid = int(user["user_id"]) if user and user.get("user_id") is not None else None
    uname = (user.get("username") if user else None) or None
    djson = json.dumps(details, default=str) if details is not None else None
    conn.execute(
        """INSERT INTO atlas_audit_events (created_at, action, details_json, username, user_id, client_ip, state_version_after)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (now, action, djson, uname, uid, _client_ip() or None, state_version_after),
    )


def append_audit_event(action, details=None, user=None, state_version_after=None):
    conn = get_conn()
    append_audit_event_conn(conn, action, details, user, state_version_after)
    conn.commit()
    conn.close()


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
    migrate_atlas_schema(conn)
    conn.commit()
    # Seed demo users if empty (set ATLAS_SEED_DEMO_USERS=0 in production)
    seed_demo = os.environ.get("ATLAS_SEED_DEMO_USERS", "1").strip().lower() not in ("0", "false", "no")
    cursor = conn.execute("SELECT COUNT(*) FROM atlas_users")
    if seed_demo and cursor.fetchone()[0] == 0:
        for username, password, display_name, role in DEFAULT_USERS:
            conn.execute(
                "INSERT INTO atlas_users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (username.lower(), generate_password_hash(password), display_name, role, datetime.now(timezone.utc).isoformat()),
            )
    conn.commit()
    conn.close()


def ensure_engine_blobs_table():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS atlas_engine_blobs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            filename TEXT,
            mime TEXT,
            data BLOB,
            created_at TEXT
        );
        """
    )
    conn.commit()
    conn.close()


def get_state_row(conn):
    return conn.execute(
        "SELECT value, COALESCE(version, 1) FROM atlas_state WHERE key = ?",
        (STATE_KEY,),
    ).fetchone()


def load_state_bundle():
    try:
        conn = get_conn()
        row = get_state_row(conn)
        conn.close()
        if not row:
            return _DEFAULT_STATE, 0
        return json.loads(row[0]), int(row[1])
    except Exception:
        return _DEFAULT_STATE, 0


def load_state():
    s, _ = load_state_bundle()
    return s


def persist_state_with_version(state_dict, expected_version, user_for_audit=None, open_mode=False):
    payload = json.dumps(state_dict)
    now = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = get_state_row(conn)
        audit_user = None
        if user_for_audit:
            audit_user = {"user_id": user_for_audit.get("id"), "username": user_for_audit.get("username")}

        if open_mode:
            if not row:
                new_v = 1
                conn.execute(
                    "INSERT INTO atlas_state (key, value, updated_at, version) VALUES (?, ?, ?, ?)",
                    (STATE_KEY, payload, now, new_v),
                )
            else:
                new_v = int(row[1]) + 1
                conn.execute(
                    "UPDATE atlas_state SET value = ?, updated_at = ?, version = ? WHERE key = ?",
                    (payload, now, new_v, STATE_KEY),
                )
            append_audit_event_conn(
                conn,
                "state.save",
                {"projectCount": len(state_dict.get("projects") or []), "activeProjectId": state_dict.get("activeProjectId"), "openMode": True},
                user=audit_user,
                state_version_after=new_v,
            )
            conn.commit()
            conn.close()
            return True, new_v, None, None

        if not row:
            exp = 0 if expected_version is None else int(expected_version)
            if exp != 0:
                conn.rollback()
                conn.close()
                return False, None, "version_conflict", None
            new_v = 1
            conn.execute(
                "INSERT INTO atlas_state (key, value, updated_at, version) VALUES (?, ?, ?, ?)",
                (STATE_KEY, payload, now, new_v),
            )
        else:
            cur_v = int(row[1])
            if expected_version is None:
                conn.rollback()
                conn.close()
                return False, cur_v, "missing_if_match", None
            if int(expected_version) != cur_v:
                conn.rollback()
                conn.close()
                return False, cur_v, "version_conflict", None
            new_v = cur_v + 1
            conn.execute(
                "UPDATE atlas_state SET value = ?, updated_at = ?, version = ? WHERE key = ?",
                (payload, now, new_v, STATE_KEY),
            )

        append_audit_event_conn(
            conn,
            "state.save",
            {"projectCount": len(state_dict.get("projects") or []), "activeProjectId": state_dict.get("activeProjectId")},
            user=audit_user,
            state_version_after=new_v,
        )
        conn.commit()
        conn.close()
        return True, new_v, None, None
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        print(f"[ATLAS] persist_state failed: {e}")
        return False, None, "error", str(e)


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
    ensure_engine_blobs_table()
except Exception as e:
    print(f"[ATLAS] DB init warning: {e}")


# --- API ---
def bearer_token():
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return (request.args.get("token") or "").strip()


@app.route("/api")
def api_info():
    return jsonify(
        {
            "message": "ATLAS API",
            "endpoints": [
                "/api/health",
                "/api/state",
                "/api/auth/login",
                "/api/auth/me",
                "/api/backup",
                "/api/restore",
                "/api/engine-docs",
                "/api/audit",
                "/api/audit/log",
            ],
        }
    )


@app.route("/api/engine-docs", methods=["POST"])
def engine_docs_upload():
    user = verify_token(bearer_token())
    if not user:
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    project_id = (request.form.get("project_id") or "").strip()
    if not project_id or ".." in project_id or "/" in project_id or "\\" in project_id:
        return jsonify({"ok": False, "error": "Invalid project"}), 400
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "Empty filename"}), 400
    raw = f.read()
    max_bytes = 50 * 1024 * 1024
    if len(raw) > max_bytes:
        return jsonify({"ok": False, "error": "File too large (max 50MB)"}), 400
    doc_id = secrets.token_urlsafe(18)
    now = datetime.now(timezone.utc).isoformat()
    mime = (f.mimetype or "application/octet-stream")[:120]
    filename = f.filename[:240]
    conn = get_conn()
    conn.execute(
        "INSERT INTO atlas_engine_blobs (id, project_id, filename, mime, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (doc_id, project_id[:64], filename, mime, raw, now),
    )
    append_audit_event_conn(
        conn,
        "engine.upload",
        {"docId": doc_id, "projectId": project_id[:64], "fileName": filename, "size": len(raw)},
        user={"user_id": user["id"], "username": user["username"]},
    )
    conn.commit()
    conn.close()
    return jsonify(
        {
            "ok": True,
            "id": doc_id,
            "fileName": f.filename,
            "mimeType": mime,
            "size": len(raw),
        }
    )


@app.route("/api/engine-docs/<doc_id>", methods=["GET"])
def engine_docs_download(doc_id):
    user = verify_token(bearer_token())
    if not user:
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    doc_id = (doc_id or "").strip()
    if not doc_id:
        return "", 404
    conn = get_conn()
    row = conn.execute("SELECT filename, mime, data FROM atlas_engine_blobs WHERE id = ?", (doc_id,)).fetchone()
    conn.close()
    if not row:
        return "", 404
    filename, mime, data = row
    return send_file(
        BytesIO(data),
        mimetype=mime or "application/octet-stream",
        as_attachment=True,
        download_name=filename or "document",
    )


@app.route("/api/engine-docs/<doc_id>", methods=["DELETE"])
def engine_docs_delete(doc_id):
    user = verify_token(bearer_token())
    if not user:
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    doc_id = (doc_id or "").strip()
    if not doc_id:
        return jsonify({"ok": False}), 400
    conn = get_conn()
    conn.execute("DELETE FROM atlas_engine_blobs WHERE id = ?", (doc_id,))
    conn.commit()
    deleted = conn.execute("SELECT changes()").fetchone()[0] > 0
    conn.close()
    return jsonify({"ok": True, "deleted": deleted})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "backend": "python"})


@app.route("/api/state", methods=["GET"])
def get_state():
    if state_requires_auth() and not verify_token(bearer_token()):
        return jsonify({"error": "Unauthorized"}), 401
    s, ver = load_state_bundle()
    resp = make_response(jsonify(s))
    resp.headers["X-Atlas-State-Version"] = str(ver)
    return resp


@app.route("/api/state", methods=["PUT", "POST"])
def put_state():
    if state_requires_auth() and not verify_token(bearer_token()):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    try:
        data = request.get_json(force=True, silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"ok": False, "error": "invalid_body"}), 400
        raw_if_match = request.headers.get("If-Match")
        if raw_if_match:
            raw_if_match = raw_if_match.strip().strip('"')
        if state_api_open():
            expected_version = None
        else:
            try:
                expected_version = int(raw_if_match) if raw_if_match not in (None, "") else None
            except ValueError:
                return jsonify({"ok": False, "error": "invalid_if_match"}), 400

        user = verify_token(bearer_token()) if bearer_token() else None
        ok, new_v, err_code, err_msg = persist_state_with_version(
            data,
            expected_version,
            user_for_audit=user,
            open_mode=state_api_open(),
        )
        if not ok:
            if err_code == "version_conflict":
                _, cur_v = load_state_bundle()
                return jsonify({"ok": False, "error": "version_conflict", "serverVersion": cur_v}), 409
            if err_code == "missing_if_match":
                _, cur_v = load_state_bundle()
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "missing_if_match",
                            "serverVersion": cur_v,
                            "hint": "Send If-Match header from GET /api/state (X-Atlas-State-Version)",
                        }
                    ),
                    428,
                )
            return jsonify({"ok": False, "error": err_code or "save_failed", "message": err_msg}), 500
        resp = make_response(jsonify({"ok": True, "version": new_v}))
        resp.headers["X-Atlas-State-Version"] = str(new_v)
        return resp
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/audit", methods=["GET"])
def list_audit():
    if not verify_token(bearer_token()):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    try:
        limit = min(int(request.args.get("limit", 500)), 5000)
        offset = max(int(request.args.get("offset", 0)), 0)
    except ValueError:
        return jsonify({"ok": False, "error": "invalid_pagination"}), 400
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM atlas_audit_events").fetchone()[0]
    rows = conn.execute(
        """SELECT id, created_at, action, details_json, username, user_id, client_ip, state_version_after
           FROM atlas_audit_events ORDER BY id DESC LIMIT ? OFFSET ?""",
        (limit, offset),
    ).fetchall()
    conn.close()
    events = []
    for r in rows:
        details = None
        if r[3]:
            try:
                details = json.loads(r[3])
            except Exception:
                details = {"_raw": r[3]}
        events.append(
            {
                "id": r[0],
                "at": r[1],
                "action": r[2],
                "details": details or {},
                "username": r[4],
                "userId": r[5],
                "clientIp": r[6],
                "stateVersionAfter": r[7],
                "source": "server",
            }
        )
    return jsonify({"ok": True, "events": events, "total": total, "limit": limit, "offset": offset})


@app.route("/api/audit/log", methods=["POST"])
def append_client_audit():
    user = verify_token(bearer_token())
    if not user:
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    data = request.get_json(force=True, silent=True) or {}
    action = (data.get("action") or "").strip()
    if not action or len(action) > 500:
        return jsonify({"ok": False, "error": "action required"}), 400
    details = data.get("details")
    if details is not None and not isinstance(details, dict):
        details = {"value": str(details)[:2000]}
    append_audit_event(
        action,
        details,
        user={"user_id": user["id"], "username": user["username"]},
    )
    return jsonify({"ok": True})


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
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        expires_at = (now + timedelta(hours=expires_hours)).isoformat()
        conn.execute(
            "INSERT INTO atlas_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, expires_at, now.isoformat()),
        )
        append_audit_event_conn(
            conn,
            "auth.login",
            {"username": username, "displayName": display_name, "role": role},
            user={"user_id": user_id, "username": username},
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
            u = verify_token(token)
            conn = get_conn()
            if u:
                append_audit_event_conn(
                    conn,
                    "auth.logout",
                    {"username": u["username"]},
                    user={"user_id": u["id"], "username": u["username"]},
                )
            conn.execute("DELETE FROM atlas_sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    return jsonify({"ok": True})


# --- Backup / Restore ---
@app.route("/api/backup")
def backup():
    if not verify_token(bearer_token()):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
    try:
        return send_file(DB_PATH, as_attachment=True, download_name="atlas_backup.db")
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/restore", methods=["POST"])
def restore():
    if not verify_token(bearer_token()):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401
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
        row = conn.execute("SELECT value FROM atlas_state WHERE key = ?", (STATE_KEY,)).fetchone()
        conn.close()
        if not row:
            backup_path.unlink(missing_ok=True)
            return jsonify({"ok": False, "error": "Invalid backup file"}), 400
        import shutil
        # Create backup of current DB before overwriting
        if DB_PATH.exists():
            pre_backup = BASE_DIR / "atlas_data_pre_restore_backup.db"
            shutil.copy(str(DB_PATH), str(pre_backup))
        shutil.copy(str(backup_path), str(DB_PATH))
        backup_path.unlink(missing_ok=True)
        u = verify_token(bearer_token())
        append_audit_event(
            "system.restore",
            {"source": "uploaded_db_backup"},
            user={"user_id": u["id"], "username": u["username"]} if u else None,
        )
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
    if path in (
        "activities",
        "gantt",
        "materials",
        "intelligence",
        "anomaly-center",
        "login",
        "calendar",
        "risk-register",
        "network",
        "project-setup",
        "engine-description",
        "audit-log",
        "audit",
    ):
        html_name = "audit-log.html" if path == "audit" else f"{path}.html"
        return send_from_directory(BASE_DIR, html_name)
    return "", 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[ATLAS] Backend at http://0.0.0.0:{port}")
    print(f"[ATLAS] Data: {DB_PATH}")
    app.run(host="0.0.0.0", port=port, debug=True)
