import json
import time
import uuid as _uuid_mod

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import app.state as state
from app import database

router = APIRouter(tags=["stream"])


async def _expire_all_viewers() -> None:
    """Close every non-admin WebSocket with a 'host_disconnected' error."""
    msg = json.dumps({"type": "error", "reason": "host_disconnected"})
    for sockets in list(state.manager.connections.values()):
        for ws in list(sockets):
            sid  = state.manager._ws_session.get(id(ws))
            role = state.manager._session_role.get(sid or "", "guest")
            if role != "host":
                try:
                    await ws.send_text(msg)
                    await ws.close(code=4000)
                except Exception:
                    pass


@router.websocket("/ws/{monitor_id}")
async def ws_stream(ws: WebSocket, monitor_id: int):
    """WebSocket stream for a single monitor.

    Expected query params
    ─────────────────────
    session_id   : viewer's persistent UUID (from localStorage)
    join         : active session token  (students)
    admin_token  : admin auth token      (host)

    Server → client message types (text JSON)
    ──────────────────────────────────────────
    meta       — fps / quality / session / viewer_list   (~every 1 s)
    viewers    — immediate push on join / leave / kick
    kicked     — sent to a kicked viewer before closing
    error      — reason: "invalid_session" | "kicked"

    Client → server message (text JSON)
    ─────────────────────────────────────
    register   — {type, name, session_id}
    """
    params      = ws.query_params
    session_id  = params.get("session_id", "")
    join_token  = params.get("join", "")
    admin_token = params.get("admin_token", "")

    # ── Determine role / validate access ──────────────────────
    is_admin = bool(admin_token and state.admin_tokens.get(admin_token))

    if not is_admin:
        if not join_token or not database.is_valid_token(join_token):
            await ws.accept()
            await ws.send_text(json.dumps({"type": "error", "reason": "invalid_session"}))
            await ws.close(code=4001)
            return

    # ── Check kick list ───────────────────────────────────────
    if session_id and session_id in state.kicked_sessions:
        await ws.accept()
        await ws.send_text(json.dumps({"type": "kicked"}))
        await ws.close(code=4003)
        return

    # ── Reject viewers when no admin is online ────────────────
    if not is_admin and not state.manager.has_admin_connected():
        await ws.accept()
        await ws.send_text(json.dumps({"type": "error", "reason": "host_disconnected"}))
        await ws.close(code=4000)
        return

    # ── Screen access control ─────────────────────────────────
    if not is_admin:
        # Global private mode
        if state.private_mode:
            await ws.accept()
            await ws.send_text(json.dumps({"type": "private", "reason": "global"}))
            await ws.close(code=4002)
            return

        # Per-monitor permission
        perm = state.screen_permissions.get(monitor_id, "all")
        if perm == "private":
            await ws.accept()
            await ws.send_text(json.dumps({"type": "private", "reason": "monitor"}))
            await ws.close(code=4002)
            return
        if isinstance(perm, set) and session_id not in perm:
            await ws.accept()
            await ws.send_text(json.dumps({"type": "private", "reason": "restricted"}))
            await ws.close(code=4002)
            return

    await state.manager.connect(ws, monitor_id)
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            text = msg.get("text")
            if not text:
                continue
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                continue

            if data.get("type") == "register":
                name = str(data.get("name", "")).strip()[:50] or "Anonymous"
                sid  = str(data.get("session_id", ""))[:64]
                if not sid:
                    continue
                if sid in state.kicked_sessions:
                    await ws.send_text(json.dumps({"type": "kicked"}))
                    await ws.close(code=4003)
                    break
                role = "host" if is_admin else "guest"
                state.manager.register_viewer(ws, sid, name, role)
                await state.push_viewer_update()
                # Deliver chat history to the newly registered viewer
                await ws.send_text(json.dumps({
                    "type":     "chat:history",
                    "messages": state.manager.get_chat_history(),
                }))

            elif data.get("type") == "chat:send":
                sid = state.manager._ws_session.get(id(ws))
                if not sid or sid not in state.manager._session_name:
                    continue
                text      = str(data.get("text", "")).strip()[:2000]
                file_info = data.get("file") if isinstance(data.get("file"), dict) else None
                if not text and not file_info:
                    continue
                sender    = state.manager._session_name[sid]
                sender_id = state.manager._viewer_id.get(sid, 0)
                role      = state.manager._session_role.get(sid, "guest")
                # Resolve optional reply context
                reply_to_id = data.get("reply_to_id")
                reply_to    = None
                if reply_to_id:
                    for m in state.manager.chat_history:
                        if m.get("id") == reply_to_id:
                            reply_to = {
                                "id":     m["id"],
                                "text":   (m.get("text") or "")[:100],
                                "sender": m.get("sender", ""),
                            }
                            break
                msg = {
                    "type":      "chat:message",
                    "id":        str(data.get("id") or _uuid_mod.uuid4()),
                    "sender":    sender,
                    "sender_id": sender_id,
                    "role":      role,
                    "text":      text,
                    "file":      file_info,
                    "reply_to":  reply_to,
                    "reactions": {},
                    "timestamp": int(time.time()),
                }
                state.manager.add_chat_message(msg)
                await state.manager.broadcast_all_monitors(json.dumps(msg))

            elif data.get("type") == "chat:delete":
                sid = state.manager._ws_session.get(id(ws))
                if not sid:
                    continue
                msg_id    = str(data.get("msg_id", ""))
                sender_id = state.manager._viewer_id.get(sid, -1)
                role      = state.manager._session_role.get(sid, "guest")
                if state.manager.delete_chat_message(msg_id, sender_id, role):
                    await state.manager.broadcast_all_monitors(json.dumps({
                        "type":   "chat:deleted",
                        "msg_id": msg_id,
                    }))

            elif data.get("type") == "chat:react":
                sid = state.manager._ws_session.get(id(ws))
                if not sid or sid not in state.manager._session_name:
                    continue
                msg_id   = str(data.get("msg_id", ""))
                emoji    = str(data.get("emoji", ""))[:8]
                reactor  = state.manager._session_name[sid]
                reactions = state.manager.react_chat_message(msg_id, reactor, emoji)
                if reactions is not None:
                    await state.manager.broadcast_all_monitors(json.dumps({
                        "type":      "chat:reaction",
                        "msg_id":    msg_id,
                        "reactions": reactions,
                    }))

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        state.manager.disconnect(ws, monitor_id)
        await state.push_viewer_update()
        # When the last admin connection closes, expire every remaining session
        if is_admin and not state.manager.has_admin_connected():
            await _expire_all_viewers()
