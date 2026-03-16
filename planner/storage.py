"""
ATLAS Planner - Storage layer.
SQLite-backed state for projects, activities, baselines, actions.
Logic ported from js/storage.js - same data model.
"""
import json
import os
import re
from pathlib import Path

from .schema import create_empty_activity, sanitize_activity

CONFIG_DIR = Path(__file__).resolve().parent
WORKSPACE_ROOT = CONFIG_DIR.parent
DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", str(WORKSPACE_ROOT / "atlas_data.db")))
STATE_KEY = "industrial_planning_intelligence_state_v1"
PROJECT_ID_PATTERN = re.compile(r"^PRJ-(\d{4,})$")
BASELINE_ID_PATTERN = re.compile(r"^BL-(\d{4,})$")
ACTION_ID_PATTERN = re.compile(r"^ACTN-(\d{4,})$")


def _to_iso_date(value):
    if not value:
        return ""
    try:
        from datetime import datetime
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return d.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return ""


def _to_iso_timestamp(value):
    if not value:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()
    try:
        from datetime import datetime
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return d.isoformat()
    except (ValueError, TypeError):
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()


def _sanitize_action(raw):
    raw = raw or {}
    status = str(raw.get("status") or "Open").strip()
    priority = str(raw.get("priority") or "Medium").strip()
    allowed_status = {"Open", "In Review", "Closed"}
    allowed_priority = {"Low", "Medium", "High", "Critical"}
    return {
        "id": str(raw.get("id") or "").strip(),
        "activityId": str(raw.get("activityId") or "").strip(),
        "title": str(raw.get("title") or "").strip(),
        "owner": str(raw.get("owner") or "").strip(),
        "dueDate": _to_iso_date(raw.get("dueDate")),
        "status": status if status in allowed_status else "Open",
        "priority": priority if priority in allowed_priority else "Medium",
        "notes": str(raw.get("notes") or "").strip(),
        "createdBy": str(raw.get("createdBy") or "Planner").strip(),
        "createdAt": _to_iso_timestamp(raw.get("createdAt")),
        "updatedAt": _to_iso_timestamp(raw.get("updatedAt")),
    }


def _sanitize_baseline(raw, fallback_name):
    raw = raw or {}
    name = str(raw.get("name") or "").strip() or fallback_name
    activities = raw.get("activities") or []
    return {
        "id": str(raw.get("id") or "").strip(),
        "name": name,
        "activities": [sanitize_activity(a) for a in activities],
        "createdBy": str(raw.get("createdBy") or "Planner").strip(),
        "createdAt": _to_iso_timestamp(raw.get("createdAt")),
    }


def _create_default_visibility():
    from .schema import COLUMN_SCHEMA
    return {col["key"]: True for col in COLUMN_SCHEMA}


def _create_project(pid, name, activities=None, baselines=None, actions=None):
    activities = activities or []
    baselines = baselines or []
    actions = actions or []
    return {
        "id": pid,
        "name": name,
        "activities": [sanitize_activity(a) for a in activities],
        "baselines": [_sanitize_baseline(b, f"Baseline v{i+1}") for i, b in enumerate(baselines)],
        "actions": [_sanitize_action(a) for a in actions],
    }


def _base_state():
    return {
        "projects": [_create_project("PRJ-0001", "Project 1", [])],
        "activeProjectId": "PRJ-0001",
        "settings": {
            "tableColumnVisibility": _create_default_visibility(),
            "defaultEditor": "Planner",
            "activityTemplates": [],
            "savedFilters": [],
        },
    }


def _get_next_project_id(projects):
    max_n = 0
    for p in projects:
        m = PROJECT_ID_PATTERN.match(str(p.get("id", "")))
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"PRJ-{max_n + 1:04d}"


def _get_next_baseline_id(baselines):
    max_n = 0
    for b in baselines:
        m = BASELINE_ID_PATTERN.match(str(b.get("id", "")))
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"BL-{max_n + 1:04d}"


def _get_next_action_id(actions):
    max_n = 0
    for a in actions:
        m = ACTION_ID_PATTERN.match(str(a.get("id", "")))
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"ACTN-{max_n + 1:04d}"


def _normalize_project_name(name, index):
    return (name or "").strip() or f"Project {index + 1}"


def _read_state():
    import sqlite3
    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            "SELECT value FROM atlas_state WHERE key = ?", (STATE_KEY,)
        )
        row = cur.fetchone()
        conn.close()
        if row:
            data = json.loads(row["value"])
            return _normalize_state(data)
    except Exception:
        pass
    return _base_state()


def _normalize_state(state):
    defaults = _base_state()
    projects = []
    if state.get("projects"):
        for i, p in enumerate(state["projects"]):
            pid = str(p.get("id") or "").strip()
            if not pid or any(pr["id"] == pid for pr in projects):
                pid = _get_next_project_id(projects)
            name = _normalize_project_name(p.get("name"), i)
            activities = p.get("activities") or p.get("items") or []
            baselines = p.get("baselines") or []
            actions = p.get("actions") or []
            projects.append(_create_project(pid, name, activities, baselines, actions))
    else:
        projects = defaults["projects"]

    active_id = str(state.get("activeProjectId") or "").strip()
    if not any(p["id"] == active_id for p in projects):
        active_id = projects[0]["id"] if projects else "PRJ-0001"

    settings = {**defaults["settings"], **(state.get("settings") or {})}
    settings["tableColumnVisibility"] = {**_create_default_visibility(), **(settings.get("tableColumnVisibility") or {})}
    settings.setdefault("activityTemplates", [])
    settings.setdefault("savedFilters", [])

    return {"projects": projects, "activeProjectId": active_id, "settings": settings}


def _write_state(state):
    import sqlite3
    norm = _normalize_state(state)
    payload = json.dumps(norm)
    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.execute(
            """CREATE TABLE IF NOT EXISTS atlas_state (
                key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
            )"""
        )
        conn.execute(
            "INSERT OR REPLACE INTO atlas_state (key, value, updated_at) VALUES (?, ?, datetime('now'))",
            (STATE_KEY, payload),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        raise RuntimeError(f"Failed to save state: {e}") from e


def get_state():
    return _read_state()


def save_state(state):
    _write_state(state)


def get_active_project():
    state = get_state()
    active_id = state["activeProjectId"]
    for p in state["projects"]:
        if p["id"] == active_id:
            return p
    return state["projects"][0] if state["projects"] else _create_project("PRJ-0001", "Project 1", [])


def get_activities():
    return get_active_project()["activities"]


def save_activities(activities):
    state = get_state()
    for p in state["projects"]:
        if p["id"] == state["activeProjectId"]:
            p["activities"] = [sanitize_activity(a) for a in activities]
            break
    save_state(state)


def update_activity(activity_id, patch):
    state = get_state()
    for p in state["projects"]:
        if p["id"] != state["activeProjectId"]:
            continue
        for i, a in enumerate(p["activities"]):
            if a.get("activityId") == activity_id:
                from datetime import datetime, timezone
                patch = patch.copy()
                patch.setdefault("lastModifiedDate", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
                merged = {**a, **patch, "activityId": activity_id}
                p["activities"][i] = sanitize_activity(merged)
                save_state(state)
                return p["activities"][i]
    return None


def add_activity(activity):
    from .schema import generate_activity_id
    state = get_state()
    for p in state["projects"]:
        if p["id"] != state["activeProjectId"]:
            continue
        sanitized = sanitize_activity(activity)
        sanitized["activityId"] = generate_activity_id(p["activities"])
        p["activities"].append(sanitized)
        save_state(state)
        return sanitized
    return None


def delete_activity(activity_id):
    state = get_state()
    for p in state["projects"]:
        if p["id"] == state["activeProjectId"]:
            p["activities"] = [a for a in p["activities"] if a.get("activityId") != activity_id]
            save_state(state)
            return
    raise ValueError(f"Activity {activity_id} not found")


def set_active_project(project_id):
    state = get_state()
    if any(p["id"] == project_id for p in state["projects"]):
        state["activeProjectId"] = project_id
        save_state(state)
        return True
    return False


def get_project_baselines():
    return get_active_project().get("baselines", [])


def add_project_baseline(name="", created_by="Planner"):
    from datetime import datetime, timezone
    state = get_state()
    for p in state["projects"]:
        if p["id"] != state["activeProjectId"]:
            continue
        baselines = p.get("baselines") or []
        bname = (name or "").strip() or f"Baseline v{len(baselines) + 1}"
        bl = _sanitize_baseline({
            "id": _get_next_baseline_id(baselines),
            "name": bname,
            "activities": [dict(a) for a in p["activities"]],
            "createdBy": created_by,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }, bname)
        baselines.append(bl)
        p["baselines"] = baselines
        save_state(state)
        return bl
    return None


def get_project_actions():
    return get_active_project().get("actions", [])


def add_project_action(action_input):
    from datetime import datetime, timezone
    state = get_state()
    for p in state["projects"]:
        if p["id"] != state["activeProjectId"]:
            continue
        actions = p.get("actions") or []
        act = _sanitize_action({
            **action_input,
            "id": _get_next_action_id(actions),
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
        actions.append(act)
        p["actions"] = actions
        save_state(state)
        return act
    return None


def update_project_action(action_id, patch):
    from datetime import datetime, timezone
    state = get_state()
    for p in state["projects"]:
        if p["id"] != state["activeProjectId"]:
            continue
        actions = p.get("actions") or []
        for i, a in enumerate(actions):
            if a.get("id") == action_id:
                merged = {**a, **patch, "id": action_id, "updatedAt": datetime.now(timezone.utc).isoformat()}
                actions[i] = _sanitize_action(merged)
                p["actions"] = actions
                save_state(state)
                return actions[i]
    return None


def init_db():
    import sqlite3
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        """CREATE TABLE IF NOT EXISTS atlas_state (
            key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
        )"""
    )
    conn.commit()
    conn.close()
    state = get_state()
    if not state.get("projects"):
        save_state(_base_state())
