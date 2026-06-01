"""Global singletons shared across the application."""

import json
from typing import Any

from app.config import StreamSettings
from app.manager import ConnectionManager

settings: StreamSettings = StreamSettings()
manager: ConnectionManager = ConnectionManager()
monitor_list: list[dict] = []

# Admin auth tokens (in-memory; cleared on server restart).
# Maps random token string -> {username, display_name}
admin_tokens: dict[str, dict] = {}

# Viewer session_ids that have been kicked by admin.
kicked_sessions: set[str] = set()

# ── Screen access control ──────────────────────────────────────
# Blocks ALL non-admin viewers from every monitor when True.
private_mode: bool = False

# Per-monitor permissions.
# Key   = monitor_id (int)
# Value = "all"       → every viewer may watch
#         "private"   → admin only
#         set[str]    → only these session_ids may watch
screen_permissions: dict[int, Any] = {}


async def push_viewer_update() -> None:
    """Broadcast the current viewer list to every connected client."""
    msg = json.dumps({
        "type": "viewers",
        "list": manager.get_viewer_list(),
        "count": manager.total_viewers,
    })
    await manager.broadcast_all_monitors(msg)
