"""SQLite persistence layer.

Stores two things that survive server restarts:
  - admin accounts  (username / hashed password / display name)
  - stream sessions (join token / session name / active flag)

Admin auth tokens and kicked-viewer sets are intentionally in-memory
(state.py) so they reset when the server restarts.
"""

import hashlib
import secrets
import sqlite3
from datetime import datetime

from app.paths import DB_PATH as _DB


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS admins (
                username      TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                salt          TEXT NOT NULL,
                display_name  TEXT NOT NULL DEFAULT 'Admin'
            );
            CREATE TABLE IF NOT EXISTS stream_sessions (
                token      TEXT PRIMARY KEY,
                name       TEXT NOT NULL DEFAULT 'Python Live Session',
                created_at TEXT NOT NULL,
                is_active  INTEGER NOT NULL DEFAULT 1
            );
        """)


# ── Helpers ────────────────────────────────────────────────────

def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000).hex()


# ── Admin CRUD ─────────────────────────────────────────────────

def admin_exists(username: str) -> bool:
    with _conn() as c:
        return bool(c.execute("SELECT 1 FROM admins WHERE username=?", (username,)).fetchone())


def create_admin(username: str, password: str, display_name: str = "Admin") -> None:
    salt = secrets.token_hex(16)
    with _conn() as c:
        c.execute(
            "INSERT OR IGNORE INTO admins (username,password_hash,salt,display_name) VALUES(?,?,?,?)",
            (username, _hash(password, salt), salt, display_name),
        )


def verify_admin(username: str, password: str) -> dict | None:
    """Return admin info dict on success, None on wrong credentials."""
    with _conn() as c:
        row = c.execute("SELECT * FROM admins WHERE username=?", (username,)).fetchone()
    if not row:
        return None
    if secrets.compare_digest(_hash(password, row["salt"]), row["password_hash"]):
        return {"username": row["username"], "display_name": row["display_name"]}
    return None


def update_display_name(username: str, display_name: str) -> None:
    with _conn() as c:
        c.execute("UPDATE admins SET display_name=? WHERE username=?", (display_name, username))


def update_password(username: str, new_password: str) -> None:
    salt = secrets.token_hex(16)
    with _conn() as c:
        c.execute(
            "UPDATE admins SET password_hash=?,salt=? WHERE username=?",
            (_hash(new_password, salt), salt, username),
        )


# ── Session CRUD ───────────────────────────────────────────────

def new_session(name: str) -> str:
    """Deactivate all existing sessions and create a fresh one. Returns new token."""
    token = secrets.token_urlsafe(16)
    with _conn() as c:
        c.execute("UPDATE stream_sessions SET is_active=0")
        c.execute(
            "INSERT INTO stream_sessions (token,name,created_at,is_active) VALUES(?,?,?,1)",
            (token, name, datetime.now().isoformat()),
        )
    return token


def get_active_session() -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM stream_sessions WHERE is_active=1 ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def is_valid_token(token: str) -> bool:
    with _conn() as c:
        return bool(c.execute(
            "SELECT 1 FROM stream_sessions WHERE token=? AND is_active=1", (token,)
        ).fetchone())
