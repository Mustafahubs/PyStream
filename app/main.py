import asyncio
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from mss import mss

import app.state as state
from app import database
from app.capture import capture_loop
from app.paths import STATIC_DIR, UPLOADS_DIR, init_data_dir
from app.routers import api, frontend, stream, voice

# Ensure user data directories exist before mounting
init_data_dir()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await _startup()
    yield


app = FastAPI(
    title="Classtream — Live Screen Share",
    description="Low-latency multi-monitor screen streaming for teaching.",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(frontend.router)
app.include_router(api.router)
app.include_router(stream.router)
app.include_router(voice.router)

# Package static files (CSS, JS, sounds …)
app.mount("/static",  StaticFiles(directory=str(STATIC_DIR)),  name="static")
# User-generated uploads (chat file attachments)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


def _local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


async def _startup() -> None:
    # ── Database ───────────────────────────────────────────────
    database.init_db()

    first_run = not database.admin_exists("admin")
    if first_run:
        database.create_admin("admin", "admin123", "Teacher")

    # ── Monitors ───────────────────────────────────────────────
    with mss() as sct:
        state.monitor_list[:] = [
            {
                "id":     i,
                "label":  "All Screens" if i == 0 else f"Monitor {i}",
                "width":  m["width"],
                "height": m["height"],
                "left":   m["left"],
                "top":    m["top"],
            }
            for i, m in enumerate(sct.monitors)
        ]

    for m in state.monitor_list:
        if m["id"] >= 1:
            rect = {k: m[k] for k in ("left", "top", "width", "height")}
            asyncio.create_task(capture_loop(m["id"], rect, state.manager, state.settings))

    # ── Print startup info ─────────────────────────────────────
    from app import __version__
    ip      = _local_ip()
    session = database.get_active_session()
    port    = 8000   # default; overridden by CLI when passed explicitly
    sep     = "─" * 56

    print(f"\n  {sep}")
    print(f"  Classtream {__version__} is live!")
    print(f"  {sep}")
    print(f"  Admin URL    →  http://{ip}:{port}/?host=admin")
    if session:
        print(f"  Student URL  →  http://{ip}:{port}/?join={session['token']}")
    else:
        print(f"  Student URL  →  (Admin panel → New Link)")
    print(f"  Data dir     →  {UPLOADS_DIR.parent}")
    print(f"  {sep}")
    if first_run:
        print(f"  ⚠  First run — default login: admin / admin123")
        print(f"  ⚠  Change the password in the Admin panel!")
    print(f"  {sep}\n")
