"""Compatibility endpoints for legacy frontend contracts."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select

from psetw_platform.core.config import get_settings
from psetw_platform.core.security import create_access_token, decode_access_token, verify_password
from psetw_platform.dependencies import DBSession
from psetw_platform.models import PlatformState, User

STATE_KEY = "industrial_planning_intelligence_state_v1"
settings = get_settings()
router = APIRouter(prefix="/api", tags=["legacy-compat"])


class LegacyLoginRequest(BaseModel):
    username: str
    password: str
    rememberMe: bool = False


def _default_legacy_state() -> dict[str, Any]:
    return {
        "projects": [{"id": "PRJ-0001", "name": "Project 1", "activities": [], "baselines": [], "actions": []}],
        "activeProjectId": "PRJ-0001",
        "settings": {"tableColumnVisibility": {}, "defaultEditor": "Planner"},
    }


@router.get("/state")
def get_legacy_state(db: DBSession) -> dict[str, Any]:
    """Return persisted full JSON state for legacy frontend."""

    state = db.scalar(select(PlatformState).where(PlatformState.key == STATE_KEY))
    if state is None:
        return _default_legacy_state()
    return state.value


@router.put("/state")
@router.post("/state")
def put_legacy_state(payload: dict[str, Any], db: DBSession) -> dict[str, bool]:
    """Persist full JSON state payload for legacy frontend."""

    state = db.scalar(select(PlatformState).where(PlatformState.key == STATE_KEY))
    if state is None:
        db.add(PlatformState(key=STATE_KEY, value=payload))
    else:
        state.value = payload
    db.commit()
    return {"ok": True}


@router.post("/auth/login")
def legacy_auth_login(payload: LegacyLoginRequest, db: DBSession) -> dict[str, Any]:
    """Legacy login contract returning `{ok, user, token, expiresAt}`."""

    username = payload.username.strip().lower()
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not verify_password(payload.password, user.password_hash):
        return {"ok": False, "error": "Invalid credentials"}

    expires_minutes = 60 * 24 * 30 if payload.rememberMe else 60 * 8
    expires_delta = timedelta(minutes=expires_minutes)
    token = create_access_token(subject=user.username, expires_minutes=expires_minutes)
    expires_at = (datetime.now(UTC) + expires_delta).isoformat()
    return {
        "ok": True,
        "user": {"username": user.username, "displayName": user.display_name, "role": user.role.value},
        "token": token,
        "expiresAt": expires_at,
    }


@router.post("/auth/logout")
def legacy_auth_logout() -> dict[str, bool]:
    """Legacy logout contract (JWT is stateless; client should discard token)."""

    return {"ok": True}


def _extract_token_from_request(request: Request, payload: dict[str, Any] | None) -> str | None:
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:]
    query_token = request.query_params.get("token")
    if query_token:
        return query_token
    body_token = payload.get("token") if payload else None
    if isinstance(body_token, str) and body_token:
        return body_token
    return None


@router.get("/auth/me")
@router.post("/auth/me")
async def legacy_auth_me(request: Request, db: DBSession) -> dict[str, Any]:
    """Legacy auth/me contract returning `{ok, user}`."""

    payload: dict[str, Any] | None = None
    try:
        maybe_payload = await request.json()
        if isinstance(maybe_payload, dict):
            payload = maybe_payload
    except Exception:
        payload = None

    token = _extract_token_from_request(request, payload)
    if not token:
        return {"ok": False}

    username = decode_access_token(token)
    if username is None:
        return {"ok": False}
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return {
        "ok": True,
        "user": {"id": user.id, "username": user.username, "displayName": user.display_name, "role": user.role.value},
    }
