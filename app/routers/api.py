import asyncio
import json
import mimetypes
import os
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
import uuid as _uuid_mod
from pathlib import Path

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

import app.state as state
from app import database

_UPLOAD_DIR   = Path(__file__).parent.parent / "static" / "uploads"
_ALLOWED_EXT  = {'.py','.zip','.mp4','.png','.jpg','.jpeg','.gif','.webp',
                 '.pdf','.txt','.csv','.json','.md','.mp3','.wav'}
_MAX_UPLOAD   = 50 * 1024 * 1024   # 50 MB

router = APIRouter(prefix="/api", tags=["api"])


def _admin(token: str | None) -> dict | None:
    """Return admin info dict if token is valid, else None."""
    return state.admin_tokens.get(token or "")


# ── Public info ────────────────────────────────────────────────

@router.get("/monitors")
async def get_monitors():
    return JSONResponse(state.monitor_list)


@router.get("/status")
async def get_status():
    session = database.get_active_session()
    s = state.settings
    return JSONResponse({
        "viewers":       state.manager.total_viewers,
        "session":       session["name"]  if session else None,
        "session_token": session["token"] if session else None,
        "quality":       s.quality,
        "fps":           s.fps,
        "monitors":      len(state.monitor_list) - 1,
    })


# ── Admin auth ─────────────────────────────────────────────────

@router.post("/admin/login")
async def admin_login(request: Request):
    data     = await request.json()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    user = database.verify_admin(username, password)
    if not user:
        return JSONResponse({"ok": False, "reason": "Invalid credentials"}, status_code=401)

    token = secrets.token_urlsafe(32)
    state.admin_tokens[token] = user
    return JSONResponse({"ok": True, "token": token, "display_name": user["display_name"]})


@router.post("/admin/verify")
async def admin_verify(request: Request):
    data  = await request.json()
    token = str(data.get("token", ""))
    user  = state.admin_tokens.get(token)
    if not user:
        return JSONResponse({"ok": False}, status_code=401)
    return JSONResponse({"ok": True, "display_name": user["display_name"]})


@router.post("/admin/logout")
async def admin_logout(x_admin_token: str | None = Header(default=None)):
    state.admin_tokens.pop(x_admin_token or "", None)
    return JSONResponse({"ok": True})


@router.post("/admin/display-name")
async def update_display_name(
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    user = _admin(x_admin_token)
    if not user:
        return JSONResponse({"ok": False}, status_code=401)

    data = await request.json()
    name = str(data.get("display_name", "")).strip()[:50]
    if not name:
        return JSONResponse({"ok": False, "reason": "name cannot be empty"}, status_code=400)

    database.update_display_name(user["username"], name)
    # Update the in-memory token so future /verify calls return the new name
    user["display_name"] = name
    return JSONResponse({"ok": True})


# ── Stream settings (admin only) ───────────────────────────────

@router.post("/settings")
async def update_settings(
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    if not _admin(x_admin_token):
        return JSONResponse({"ok": False}, status_code=401)

    data = await request.json()
    s    = state.settings
    if "quality" in data:
        s.quality = max(1, min(100, int(data["quality"])))
    if "fps" in data:
        s.fps = max(1, min(60, int(data["fps"])))
    if "show_cursor" in data:
        s.show_cursor = bool(data["show_cursor"])
    return JSONResponse({"ok": True})


# ── Session management (admin only) ───────────────────────────

@router.post("/session/new")
async def new_session(
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    if not _admin(x_admin_token):
        return JSONResponse({"ok": False}, status_code=401)

    data  = await request.json()
    name  = str(data.get("name", state.settings.session_name))[:120].strip() or "Python Live Session"
    token = database.new_session(name)
    state.settings.session_name = name
    return JSONResponse({"ok": True, "token": token, "name": name})


# ── Kick (admin only) ──────────────────────────────────────────

@router.post("/session/kick")
async def kick_viewer(
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    if not _admin(x_admin_token):
        return JSONResponse({"ok": False}, status_code=401)

    data      = await request.json()
    viewer_id = int(data.get("viewer_id", -1))
    sid       = state.manager.get_session_id_by_viewer_id(viewer_id)
    if not sid:
        return JSONResponse({"ok": False, "reason": "viewer not found"}, status_code=404)

    state.kicked_sessions.add(sid)
    await state.manager.kick_session(sid)
    await state.push_viewer_update()
    return JSONResponse({"ok": True})


# ── Screen access control (admin only) ────────────────────────

def _serialize_permissions() -> dict:
    """Convert state.screen_permissions to a JSON-safe dict for the client."""
    result = {}
    for mid, perm in state.screen_permissions.items():
        if isinstance(perm, set):
            # Convert session_ids back to viewer_ids the frontend understands
            vids = [
                state.manager._viewer_id[sid]
                for sid in perm
                if sid in state.manager._viewer_id
            ]
            result[str(mid)] = {"access": "specific", "viewer_ids": vids}
        else:
            result[str(mid)] = {"access": perm}
    return result


async def _send_private(ws, reason: str = "permission_changed") -> None:
    try:
        await ws.send_text(json.dumps({"type": "private", "reason": reason}))
        await ws.close(code=4002)
    except Exception:
        pass


async def _enforce_monitor(monitor_id: int) -> None:
    """Close connections of viewers who no longer have access to a monitor."""
    perm = state.screen_permissions.get(monitor_id, "all")
    if perm == "all":
        return

    for ws in list(state.manager.connections.get(monitor_id, [])):
        sid  = state.manager._ws_session.get(id(ws))
        role = state.manager._session_role.get(sid or "", "guest")
        if role == "host":
            continue

        if perm == "private" or (isinstance(perm, set) and sid not in perm):
            await _send_private(ws)


async def _enforce_private_mode() -> None:
    """Close all non-admin connections across every monitor."""
    for monitor_id, conns in state.manager.connections.items():
        for ws in list(conns):
            sid  = state.manager._ws_session.get(id(ws))
            role = state.manager._session_role.get(sid or "", "guest")
            if role != "host":
                await _send_private(ws, "global_private")


@router.get("/screen/permissions")
async def get_permissions(x_admin_token: str | None = Header(default=None)):
    if not _admin(x_admin_token):
        return JSONResponse({"ok": False}, status_code=401)
    return JSONResponse({
        "ok":          True,
        "private_mode": state.private_mode,
        "monitors":    _serialize_permissions(),
    })


@router.post("/screen/permissions")
async def set_monitor_permission(
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    if not _admin(x_admin_token):
        return JSONResponse({"ok": False}, status_code=401)

    data       = await request.json()
    monitor_id = int(data["monitor_id"])
    access     = str(data.get("access", "all"))   # "all"|"private"|"specific"

    if access == "all":
        state.screen_permissions[monitor_id] = "all"
    elif access == "private":
        state.screen_permissions[monitor_id] = "private"
    elif access == "specific":
        viewer_ids = [int(v) for v in data.get("viewer_ids", [])]
        allowed_sids: set[str] = set()
        for vid in viewer_ids:
            sid = state.manager.get_session_id_by_viewer_id(vid)
            if sid:
                allowed_sids.add(sid)
        state.screen_permissions[monitor_id] = allowed_sids

    await _enforce_monitor(monitor_id)
    return JSONResponse({"ok": True, "monitors": _serialize_permissions()})


# ── Chat: file upload ──────────────────────────────────────────

@router.post("/chat/upload")
async def chat_upload(
    request: Request,
    x_filename: str | None = Header(default=None),
    x_join_token: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
):
    is_admin   = bool(_admin(x_admin_token))
    is_student = bool(x_join_token and database.is_valid_token(x_join_token))
    if not is_admin and not is_student:
        return JSONResponse({"ok": False, "reason": "Unauthorized"}, status_code=401)

    raw_name  = urllib.parse.unquote(x_filename or "file")
    safe_name = re.sub(r"[^\w.\- ]", "", os.path.basename(raw_name))[:120] or "file"
    ext       = Path(safe_name).suffix.lower()
    if ext not in _ALLOWED_EXT:
        return JSONResponse({"ok": False, "reason": f"File type {ext!r} not allowed"}, status_code=400)

    body = await request.body()
    if len(body) > _MAX_UPLOAD:
        return JSONResponse({"ok": False, "reason": "File too large (max 50 MB)"}, status_code=413)
    if not body:
        return JSONResponse({"ok": False, "reason": "Empty file"}, status_code=400)

    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored = f"{_uuid_mod.uuid4()}{ext}"
    dest = _UPLOAD_DIR / stored
    await asyncio.to_thread(dest.write_bytes, body)

    return JSONResponse({
        "ok":       True,
        "url":      f"/static/uploads/{stored}",
        "filename": safe_name,
        "size":     len(body),
        "mime":     mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
    })


# ── Chat: link preview ─────────────────────────────────────────

@router.get("/chat/link-preview")
async def chat_link_preview(url: str):
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return JSONResponse({"ok": False})
    except Exception:
        return JSONResponse({"ok": False})

    def _fetch() -> dict:
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                if "text/html" not in resp.headers.get("Content-Type", ""):
                    return {}
                html = resp.read(65536).decode("utf-8", errors="ignore")

            og: dict[str, str] = {}
            for m in re.finditer(
                r'<meta[^>]+(?:property|name)=["\']([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
                html, re.I,
            ):
                prop, val = m.group(1).lower(), m.group(2)
                key = prop.replace("twitter:", "og:")
                if key in ("og:title", "og:description", "og:image"):
                    og.setdefault(key, val)

            if "og:title" not in og:
                m2 = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
                if m2:
                    og["og:title"] = m2.group(1).strip()

            return {
                "title":       og.get("og:title", parsed.netloc),
                "description": og.get("og:description", ""),
                "image":       og.get("og:image", ""),
                "domain":      parsed.netloc,
            }
        except Exception:
            return {}

    result = await asyncio.to_thread(_fetch)
    if not result:
        return JSONResponse({"ok": False})
    return JSONResponse({"ok": True, **result})


@router.post("/screen/private")
async def set_private_mode(
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    if not _admin(x_admin_token):
        return JSONResponse({"ok": False}, status_code=401)

    data = await request.json()
    state.private_mode = bool(data.get("enabled", False))

    if state.private_mode:
        await _enforce_private_mode()

    return JSONResponse({"ok": True, "private_mode": state.private_mode})
