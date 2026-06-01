import json

from fastapi import WebSocket


class ConnectionManager:
    """Manages per-monitor WebSocket connections, viewer sessions, and broadcasts.

    Session model
    ─────────────
    Each browser tab generates a UUID (session_id) stored in localStorage.
    Grid-mode opens one WebSocket per monitor — all share the same session_id.
    The viewer appears once in the list regardless of socket count, and
    disappears only when *all* their sockets close.

    Viewer IDs
    ──────────
    Each unique session_id receives a sequential integer viewer_id (1, 2, 3 …)
    that the admin uses to target kicks. IDs are stable within a server session.
    """

    def __init__(self) -> None:
        self.connections: dict[int, list[WebSocket]] = {}

        self._ws_session: dict[int, str] = {}    # id(ws)     -> session_id
        self._session_name: dict[str, str] = {}  # session_id -> display name
        self._session_role: dict[str, str] = {}  # session_id -> "host"|"guest"
        self._session_refs: dict[str, int] = {}  # session_id -> open socket count
        self._viewer_id: dict[str, int] = {}     # session_id -> sequential int ID
        self._next_id: int = 1

        self.chat_history: list[dict] = []       # last 200 messages

    # ── Viewer info ────────────────────────────────────────────────
    @property
    def total_viewers(self) -> int:
        return len(self._session_name)

    def get_viewer_list(self) -> list[dict]:
        """Hosts first, then alphabetical. Includes sequential viewer_id for kick targeting."""
        entries = [
            {
                "id":   self._viewer_id.get(sid, 0),
                "name": name,
                "role": self._session_role.get(sid, "guest"),
            }
            for sid, name in self._session_name.items()
        ]
        return sorted(entries, key=lambda e: (0 if e["role"] == "host" else 1, e["name"].lower()))

    def get_session_id_by_viewer_id(self, viewer_id: int) -> str | None:
        for sid, vid in self._viewer_id.items():
            if vid == viewer_id and sid in self._session_name:
                return sid
        return None

    # ── Connection lifecycle ───────────────────────────────────────
    async def connect(self, ws: WebSocket, monitor_id: int) -> None:
        await ws.accept()
        self.connections.setdefault(monitor_id, []).append(ws)

    def register_viewer(self, ws: WebSocket, session_id: str, name: str, role: str = "guest") -> None:
        old_sid = self._ws_session.get(id(ws))
        if old_sid == session_id:
            self._session_name[session_id] = name
            self._session_role[session_id] = role
            return
        if old_sid and old_sid != session_id:
            self._decrement(old_sid)

        self._ws_session[id(ws)] = session_id
        self._session_refs[session_id] = self._session_refs.get(session_id, 0) + 1
        self._session_name[session_id] = name
        self._session_role[session_id] = role
        if session_id not in self._viewer_id:
            self._viewer_id[session_id] = self._next_id
            self._next_id += 1

    def disconnect(self, ws: WebSocket, monitor_id: int) -> None:
        lst = self.connections.get(monitor_id, [])
        if ws in lst:
            lst.remove(ws)
        sid = self._ws_session.pop(id(ws), None)
        if sid:
            self._decrement(sid)

    def _decrement(self, session_id: str) -> None:
        count = self._session_refs.get(session_id, 1) - 1
        if count <= 0:
            self._session_refs.pop(session_id, None)
            self._session_name.pop(session_id, None)
            self._session_role.pop(session_id, None)
            # _viewer_id kept so IDs never reuse within a server run
        else:
            self._session_refs[session_id] = count

    def has_admin_connected(self) -> bool:
        """True if at least one active session has role 'host'."""
        return any(
            self._session_role.get(sid) == "host"
            for sid in self._session_name        # only sessions still active
        )

    # ── Chat ───────────────────────────────────────────────────────
    def add_chat_message(self, msg: dict) -> None:
        self.chat_history.append(msg)
        if len(self.chat_history) > 200:
            self.chat_history = self.chat_history[-200:]

    def get_chat_history(self) -> list[dict]:
        return list(self.chat_history)

    def delete_chat_message(self, msg_id: str, sender_id: int, role: str) -> bool:
        for i, msg in enumerate(self.chat_history):
            if msg.get("id") == msg_id:
                if role == "host" or msg.get("sender_id") == sender_id:
                    del self.chat_history[i]
                    return True
                return False
        return False

    def react_chat_message(self, msg_id: str, reactor_name: str, emoji: str) -> dict | None:
        for msg in self.chat_history:
            if msg.get("id") == msg_id:
                reactions: dict = msg.setdefault("reactions", {})
                reactors: list  = reactions.setdefault(emoji, [])
                if reactor_name in reactors:
                    reactors.remove(reactor_name)
                    if not reactors:
                        del reactions[emoji]
                else:
                    reactors.append(reactor_name)
                return dict(reactions)
        return None

    # ── Kick ───────────────────────────────────────────────────────
    async def kick_session(self, session_id: str) -> None:
        """Notify and close every socket belonging to session_id."""
        msg = json.dumps({"type": "kicked"})
        to_close: list[tuple[WebSocket, int]] = []

        for monitor_id, sockets in self.connections.items():
            for ws in list(sockets):
                if self._ws_session.get(id(ws)) == session_id:
                    to_close.append((ws, monitor_id))

        for ws, monitor_id in to_close:
            try:
                await ws.send_text(msg)
                await ws.close(code=4003)
            except Exception:
                pass
            self.disconnect(ws, monitor_id)

    # ── Broadcast ─────────────────────────────────────────────────
    async def broadcast(self, monitor_id: int, data: bytes | str) -> None:
        sockets = list(self.connections.get(monitor_id, []))
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                if isinstance(data, bytes):
                    await ws.send_bytes(data)
                else:
                    await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, monitor_id)

    async def broadcast_all_monitors(self, data: str) -> None:
        for monitor_id in list(self.connections.keys()):
            await self.broadcast(monitor_id, data)
