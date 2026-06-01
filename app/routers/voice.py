import json
import struct

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import app.state as state
from app import database

router = APIRouter(tags=["voice"])

# ws_id → {ws, voice_id, name, is_admin, muted}
_conns: dict[int, dict] = {}
_next_id:     int       = 1
_force_muted: set[int]  = set()   # voice_ids admin-muted; server drops their audio


@router.websocket("/voice/ws")
async def ws_voice(ws: WebSocket):
    global _next_id

    params      = ws.query_params
    session_id  = params.get("session_id", "")
    join_token  = params.get("join", "")
    admin_token = params.get("admin_token", "")

    is_admin = bool(admin_token and state.admin_tokens.get(admin_token))

    if not is_admin:
        if not join_token or not database.is_valid_token(join_token):
            await ws.accept()
            await ws.send_text(json.dumps({"type": "error", "reason": "invalid_session"}))
            await ws.close(code=4001)
            return
        if not state.manager.has_admin_connected():
            await ws.accept()
            await ws.send_text(json.dumps({"type": "error", "reason": "host_disconnected"}))
            await ws.close(code=4000)
            return

    await ws.accept()
    ws_id    = id(ws)
    voice_id = _next_id
    _next_id += 1

    name = state.manager._session_name.get(session_id, "Guest")
    _conns[ws_id] = {
        "ws":       ws,
        "voice_id": voice_id,
        "name":     name,
        "is_admin": is_admin,
        "muted":    False,
    }

    # Tell the joiner their own ID and current room state
    await ws.send_text(json.dumps({
        "type":  "voice:init",
        "my_id": voice_id,
        "participants": [
            {
                "id":          c["voice_id"],
                "name":        c["name"],
                "is_admin":    c["is_admin"],
                "muted":       c["muted"],
                "force_muted": c["voice_id"] in _force_muted,
            }
            for c in _conns.values()
            if c["voice_id"] != voice_id
        ],
    }))

    # Announce arrival to everyone else
    await _bcast_text(ws_id, {
        "type":     "voice:join",
        "id":       voice_id,
        "name":     name,
        "is_admin": is_admin,
    })

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            # ── Binary: audio chunk ──────────────────────────────
            if raw := msg.get("bytes"):
                # Server enforces admin-mute: drop audio silently
                if voice_id not in _force_muted:
                    await _bcast_bytes(ws_id, struct.pack(">H", voice_id) + raw)

            # ── Text messages ────────────────────────────────────
            if text := msg.get("text"):
                try:
                    d = json.loads(text)
                    mtype = d.get("type", "")

                    # ── Self-mute status (user toggled their own mute) ──
                    if mtype == "voice:mute_status":
                        _conns[ws_id]["muted"] = bool(d.get("muted"))
                        await _bcast_text(ws_id, {
                            "type":        "voice:mute_status",
                            "id":          voice_id,
                            "muted":       _conns[ws_id]["muted"],
                            "force_muted": voice_id in _force_muted,
                        })

                    # ── Speaking indicator ──────────────────────────────
                    elif mtype == "voice:speaking":
                        # Silently block speaking events for force-muted clients
                        if voice_id not in _force_muted:
                            await _bcast_text(ws_id, {
                                "type":   "voice:speaking",
                                "id":     voice_id,
                                "name":   name,
                                "active": bool(d.get("active")),
                            })

                    # ── Admin: force-mute a participant ─────────────────
                    elif mtype == "voice:admin_mute" and is_admin:
                        target_id = int(d.get("target_id", 0))
                        # Never mute other admins
                        target_is_admin = any(
                            c["is_admin"] for c in _conns.values()
                            if c["voice_id"] == target_id
                        )
                        if not target_is_admin:
                            _force_muted.add(target_id)
                            await _notify_target(target_id, {"type": "voice:force_muted"})
                            await _bcast_all({
                                "type":        "voice:mute_status",
                                "id":          target_id,
                                "muted":       True,
                                "force_muted": True,
                            })

                    # ── Admin: lift force-mute ──────────────────────────
                    elif mtype == "voice:admin_unmute" and is_admin:
                        target_id = int(d.get("target_id", 0))
                        _force_muted.discard(target_id)
                        await _notify_target(target_id, {"type": "voice:force_unmuted"})
                        await _bcast_all({
                            "type":        "voice:mute_status",
                            "id":          target_id,
                            "muted":       False,
                            "force_muted": False,
                        })

                except Exception:
                    pass

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        _conns.pop(ws_id, None)
        _force_muted.discard(voice_id)
        await _bcast_text(-1, {"type": "voice:leave", "id": voice_id, "name": name})


# ── Broadcast helpers ─────────────────────────────────────────

async def _bcast_text(skip_ws_id: int, data: dict) -> None:
    msg  = json.dumps(data)
    dead = []
    for wid, c in list(_conns.items()):
        if wid == skip_ws_id:
            continue
        try:
            await c["ws"].send_text(msg)
        except Exception:
            dead.append(wid)
    for d in dead:
        _conns.pop(d, None)


async def _bcast_all(data: dict) -> None:
    """Send to every connected client including the sender."""
    msg  = json.dumps(data)
    dead = []
    for wid, c in list(_conns.items()):
        try:
            await c["ws"].send_text(msg)
        except Exception:
            dead.append(wid)
    for d in dead:
        _conns.pop(d, None)


async def _bcast_bytes(skip_ws_id: int, data: bytes) -> None:
    dead = []
    for wid, c in list(_conns.items()):
        if wid == skip_ws_id:
            continue
        try:
            await c["ws"].send_bytes(data)
        except Exception:
            dead.append(wid)
    for d in dead:
        _conns.pop(d, None)


async def _notify_target(target_voice_id: int, data: dict) -> None:
    """Send a message to one specific participant by voice_id."""
    msg = json.dumps(data)
    for c in list(_conns.values()):
        if c["voice_id"] == target_voice_id:
            try:
                await c["ws"].send_text(msg)
            except Exception:
                pass
            break
