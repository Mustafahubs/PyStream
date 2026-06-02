"""Central path configuration.

Package paths  — resolved relative to this file (works after `pip install`).
User data paths — resolved from $CLASSTREAM_DATA or ~/.classtream (writable).
"""

import os
from pathlib import Path

# ── Package paths (read-only; installed into site-packages) ──────────────────
APP_DIR       = Path(__file__).parent
STATIC_DIR    = APP_DIR / "static"
TEMPLATES_DIR = APP_DIR / "templates"

# ── User data directory (writable; survives reinstalls) ──────────────────────
DATA_DIR    = Path(os.environ.get("CLASSTREAM_DATA", Path.home() / ".classtream"))
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH     = DATA_DIR / "classtream.db"


def init_data_dir() -> None:
    """Create user data directories on first run (idempotent)."""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
