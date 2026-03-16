"""
ATLAS - 100% Python Backend
Server-rendered pages (Jinja2) + REST API. All logic in Python.
Run: pip install -r requirements.txt && python3 app.py
"""
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Ensure workspace root is on path for planner package
sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Flask, flash, jsonify, redirect, render_template, request, send_file, send_from_directory, session, url_for
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

from planner import get_state, save_state, get_active_project, get_activities, add_activity, update_activity, delete_activity, set_active_project

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__, template_folder=str(BASE_DIR / "templates"))
app.secret_key = os.environ.get("ATLAS_SECRET_KEY", secrets.token_hex(32))
CORS(app, supports_credentials=True)

DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", str(BASE_DIR / "atlas_data.db")))

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
    cursor = conn.execute("SELECT COUNT(*) FROM atlas_users")
    if cursor.fetchone()[0] == 0:
        for username, password, display_name, role in DEFAULT_USERS:
            conn.execute(
                "INSERT INTO atlas_users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (username.lower(), generate_password_hash(password), display_name, role, datetime.now(timezone.utc).isoformat()),
            )
    conn.commit()
    conn.close()


def get_current_user():
    """Return session user dict or None."""
    u = session.get("user")
    if not u:
        return None
    return {
        "username": u.get("username", ""),
        "displayName": u.get("displayName", u.get("username", "")),
        "role": u.get("role", "planner"),
    }


def require_auth(f):
    """Decorator: redirect to login if not authenticated."""
    from functools import wraps
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not get_current_user():
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return wrapped


try:
    init_db()
except Exception as e:
    print(f"[ATLAS] DB init warning: {e}")


@app.context_processor
def inject_projects():
    """Inject projects and active_project_id for templates (when logged in)."""
    if not get_current_user():
        return {}
    try:
        state = get_state()
        projects = state.get("projects", [])
        active_id = state.get("activeProjectId", "")
        return {"projects": projects, "active_project_id": active_id}
    except Exception:
        return {"projects": [], "active_project_id": ""}


# --- CSS (for templates) ---
@app.route("/css/styles.css")
def static_css():
    return send_from_directory(BASE_DIR, "css/styles.css")


# --- Auth: Login (Python-rendered, form POST) ---
@app.route("/login", methods=["GET"])
def login_page():
    if get_current_user():
        return redirect(url_for("dashboard"))
    # Quick Demo: ?demo=planner auto-logs in
    demo = request.args.get("demo", "").strip().lower()
    if demo in ("planner", "management", "technician"):
        pw = {"planner": "planner123", "management": "management123", "technician": "technician123"}.get(demo)
        try:
            conn = get_conn()
            row = conn.execute(
                "SELECT display_name, role FROM atlas_users WHERE username = ?",
                (demo,),
            ).fetchone()
            conn.close()
            if row:
                session["user"] = {"username": demo, "displayName": row[0], "role": row[1]}
                return redirect(url_for("dashboard"))
        except Exception:
            pass
    return render_template("login.html", error=None)


@app.route("/login", methods=["POST"])
def login_post():
    username = (request.form.get("username") or "").strip().lower()
    password = request.form.get("password") or ""
    remember = bool(request.form.get("remember"))
    if not username:
        flash("Username required", "error")
        return render_template("login.html", error="Username required")
    try:
        conn = get_conn()
        row = conn.execute(
            "SELECT id, password_hash, display_name, role FROM atlas_users WHERE username = ?",
            (username,),
        ).fetchone()
        conn.close()
        if not row:
            flash("Invalid credentials", "error")
            return render_template("login.html", error="Invalid credentials")
        _, pw_hash, display_name, role = row
        if not check_password_hash(pw_hash, password):
            flash("Invalid credentials", "error")
            return render_template("login.html", error="Invalid credentials")
        session["user"] = {
            "username": username,
            "displayName": display_name,
            "role": role,
        }
        session.permanent = remember
        flash(f"Welcome, {display_name}!", "success")
        return redirect(url_for("dashboard"))
    except Exception as e:
        flash(str(e), "error")
        return render_template("login.html", error=str(e))


@app.route("/logout")
def logout():
    session.pop("user", None)
    return redirect(url_for("login_page"))


@app.route("/project/switch", methods=["POST"])
@require_auth
def project_switch():
    project_id = (request.form.get("project_id") or "").strip()
    if project_id and set_active_project(project_id):
        flash(f"Switched to project {project_id}.", "success")
    return redirect(request.referrer or url_for("dashboard"))


# --- Dashboard (Python-rendered) ---
@app.route("/")
@app.route("/dashboard")
@require_auth
def dashboard():
    state = get_state()
    project = get_active_project()
    activities = project.get("activities", [])
    user = get_current_user()
    total_effort = sum((a.get("baseEffortHours") or 0) for a in activities)
    in_progress = sum(1 for a in activities if (a.get("activityStatus") or "") == "In Progress")
    completed = sum(1 for a in activities if (a.get("activityStatus") or "") == "Completed")
    return render_template(
        "dashboard.html",
        user=user,
        project=project,
        activities=activities,
        total_effort=total_effort,
        in_progress=in_progress,
        completed=completed,
    )


# --- Activities (Python-rendered, form POST for add/delete) ---
@app.route("/activities", methods=["GET"])
@require_auth
def activities():
    project = get_active_project()
    activities_list = project.get("activities", [])
    user = get_current_user()
    return render_template(
        "activities.html",
        user=user,
        activities=activities_list,
    )


@app.route("/activities/add", methods=["POST"])
@require_auth
def activity_add():
    data = {}
    for key in ("phase", "activityName", "subActivity", "plannedStartDate", "plannedEndDate",
                "baseEffortHours", "requiredMaterials", "requiredTools", "priority", "activityStatus"):
        data[key] = request.form.get(key, "")
    try:
        add_activity(data)
        flash("Activity added successfully.", "success")
    except Exception as e:
        flash(f"Failed to add activity: {e}", "error")
    return redirect(url_for("activities"))


@app.route("/activities/<activity_id>/edit", methods=["GET"])
@require_auth
def activity_edit_page(activity_id):
    activities_list = get_activities()
    activity = next((a for a in activities_list if a.get("activityId") == activity_id), None)
    if not activity:
        return redirect(url_for("activities"))
    user = get_current_user()
    return render_template("activity_edit.html", user=user, activity=activity)


@app.route("/activities/<activity_id>/edit", methods=["POST"])
@require_auth
def activity_edit_post(activity_id):
    data = {}
    for key in ("phase", "activityName", "subActivity", "plannedStartDate", "plannedEndDate",
                "baseEffortHours", "requiredMaterials", "requiredTools", "priority", "activityStatus",
                "completionPercentage", "riskLevel", "materialStatus", "remarks"):
        data[key] = request.form.get(key, "")
    updated = update_activity(activity_id, data)
    if updated:
        flash("Activity updated successfully.", "success")
    else:
        flash("Activity not found or update failed.", "error")
    return redirect(url_for("activities"))


@app.route("/activities/<activity_id>/delete", methods=["POST"])
@require_auth
def activity_delete(activity_id):
    try:
        delete_activity(activity_id)
        flash("Activity deleted.", "success")
    except ValueError:
        flash("Activity not found.", "error")
    return redirect(url_for("activities"))


# --- API (for backward compatibility with existing JS if needed) ---
@app.route("/api")
def api_info():
    return jsonify({"message": "ATLAS API", "backend": "python", "endpoints": ["/api/health", "/api/state"]})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "backend": "python"})


@app.route("/api/state", methods=["GET"])
def api_get_state():
    return jsonify(get_state())


@app.route("/api/state", methods=["PUT", "POST"])
def api_put_state():
    try:
        data = request.get_json(force=True, silent=True) or {}
        save_state(data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    try:
        data = request.get_json(force=True, silent=True) or {}
        username = (data.get("username") or "").strip().lower()
        password = data.get("password") or ""
        if not username:
            return jsonify({"ok": False, "error": "Username required"}), 400
        conn = get_conn()
        row = conn.execute(
            "SELECT id, password_hash, display_name, role FROM atlas_users WHERE username = ?",
            (username,),
        ).fetchone()
        conn.close()
        if not row:
            return jsonify({"ok": False, "error": "Invalid credentials"}), 401
        user_id, pw_hash, display_name, role = row
        if not check_password_hash(pw_hash, password):
            return jsonify({"ok": False, "error": "Invalid credentials"}), 401
        token = secrets.token_urlsafe(32)
        remember = bool(data.get("rememberMe"))
        expires_hours = 24 * 30 if remember else 8
        now = datetime.now(timezone.utc)
        expires_at = (now + timedelta(hours=expires_hours)).isoformat()
        conn = get_conn()
        conn.execute(
            "INSERT INTO atlas_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, expires_at, now.isoformat()),
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


def verify_token(token):
    """Validate Bearer token and return user dict or None."""
    if not token or not isinstance(token, str):
        return None
    if token.startswith("Bearer "):
        token = token[7:]
    try:
        conn = get_conn()
        row = conn.execute(
            "SELECT u.id, u.username, u.display_name, u.role FROM atlas_users u "
            "JOIN atlas_sessions s ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')",
            (token,),
        ).fetchone()
        conn.close()
        return {"id": row[0], "username": row[1], "displayName": row[2], "role": row[3]} if row else None
    except Exception:
        return None


@app.route("/api/auth/me", methods=["GET", "POST"])
def api_auth_me():
    token = request.headers.get("Authorization") or request.args.get("token") or (request.get_json(silent=True) or {}).get("token")
    user = verify_token(token)
    if not user:
        return jsonify({"ok": False}), 401
    return jsonify({"ok": True, "user": user})


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    token = request.headers.get("Authorization") or (request.get_json(silent=True) or {}).get("token")
    if token and isinstance(token, str):
        if token.startswith("Bearer "):
            token = token[7:]
        try:
            conn = get_conn()
            conn.execute("DELETE FROM atlas_sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    return jsonify({"ok": True})


@app.route("/api/backup")
def backup():
    try:
        return send_file(DB_PATH, as_attachment=True, download_name="atlas_backup.db")
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/restore", methods=["POST"])
def api_restore():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400
    f = request.files["file"]
    if not f.filename or not f.filename.endswith(".db"):
        return jsonify({"ok": False, "error": "Invalid file. Use .db backup"}), 400
    import shutil
    backup_path = BASE_DIR / "atlas_data_restore_temp.db"
    try:
        f.save(str(backup_path))
        conn = sqlite3.connect(str(backup_path))
        row = conn.execute("SELECT value FROM atlas_state WHERE key = ?", ("industrial_planning_intelligence_state_v1",)).fetchone()
        conn.close()
        if not row:
            backup_path.unlink(missing_ok=True)
            return jsonify({"ok": False, "error": "Invalid backup file"}), 400
        shutil.copy(str(backup_path), str(DB_PATH))
        backup_path.unlink(missing_ok=True)
        return jsonify({"ok": True})
    except Exception as e:
        backup_path.unlink(missing_ok=True)
        return jsonify({"ok": False, "error": str(e)}), 500


# --- Redirect legacy index.html to dashboard ---
@app.route("/index.html")
def index_html_redirect():
    if get_current_user():
        return redirect(url_for("dashboard"))
    return redirect(url_for("login_page"))


# --- Static files (HTML, JS for other pages) ---
@app.route("/<path:path>")
def serve_static(path):
    if ".." in path or path.startswith("."):
        return "", 404
    full = BASE_DIR / path
    if full.is_file():
        return send_from_directory(BASE_DIR, path)
    if path in ("gantt", "materials", "intelligence", "anomaly-center", "calendar", "risk-register", "network"):
        return send_from_directory(BASE_DIR, f"{path}.html")
    return "", 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[ATLAS] Python Backend at http://0.0.0.0:{port}")
    print(f"[ATLAS] Data: {DB_PATH}")
    print(f"[ATLAS] Login: /login | Dashboard: / | Activities: /activities")
    app.run(host="0.0.0.0", port=port, debug=True)
