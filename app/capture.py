import asyncio
import json
import time

import cv2
import numpy as np
import pyautogui
from mss import mss

from app.config import StreamSettings
from app.manager import ConnectionManager

_STREAM_WIDTH = 1280  # output width; height scales proportionally


async def capture_loop(
    monitor_id: int,
    rect: dict,
    manager: ConnectionManager,
    settings: StreamSettings,
) -> None:
    """Continuously capture a monitor and broadcast JPEG frames to viewers.

    Two WebSocket message types are pushed:
      - bytes : JPEG-encoded video frame
      - str   : JSON metadata (fps, viewers, quality, session, viewer_list)
    """
    frame_count = 0
    fps_timer = time.time()
    actual_fps = 0.0

    with mss() as sct:
        while True:
            try:
                if not manager.connections.get(monitor_id):
                    await asyncio.sleep(0.1)
                    continue

                t0 = time.time()
                frame_budget = 1.0 / max(1, settings.fps)

                # ── Capture & resize ──────────────────────────────────
                raw = sct.grab(rect)
                frame = cv2.cvtColor(np.array(raw), cv2.COLOR_BGRA2BGR)

                h, w = frame.shape[:2]
                target_h = int(h * _STREAM_WIDTH / w)
                frame = cv2.resize(
                    frame, (_STREAM_WIDTH, target_h), interpolation=cv2.INTER_LINEAR
                )

                # ── Cursor overlay ────────────────────────────────────
                if settings.show_cursor:
                    _draw_cursor(frame, rect, _STREAM_WIDTH, target_h)

                # ── Encode & broadcast ────────────────────────────────
                _, buf = cv2.imencode(
                    ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), settings.quality]
                )
                await manager.broadcast(monitor_id, buf.tobytes())

                # ── Metadata ~once per second ─────────────────────────
                frame_count += 1
                now = time.time()
                if now - fps_timer >= 1.0:
                    actual_fps = round(frame_count / (now - fps_timer), 1)
                    frame_count = 0
                    fps_timer = now
                    await manager.broadcast(
                        monitor_id,
                        json.dumps({
                            "type": "meta",
                            "fps": actual_fps,
                            "viewers": manager.total_viewers,
                            "quality": settings.quality,
                            "session": settings.session_name,
                            "viewer_list": manager.get_viewer_list(),  # list[{name, role}]
                        }),
                    )

                await asyncio.sleep(max(0.0, frame_budget - (time.time() - t0)))

            except Exception as exc:
                print(f"[capture monitor={monitor_id}] {exc}")
                await asyncio.sleep(1)


# ── Cursor drawing ─────────────────────────────────────────────────────────────

def _draw_cursor(
    frame: np.ndarray,
    rect: dict,
    frame_w: int,
    frame_h: int,
) -> None:
    """Draw the system mouse cursor position onto the frame in-place."""
    try:
        cx, cy = pyautogui.position()
        sx = int((cx - rect["left"]) * frame_w / rect["width"])
        sy = int((cy - rect["top"]) * frame_h / rect["height"])
        if 0 <= sx < frame_w and 0 <= sy < frame_h:
            _draw_arrow(frame, sx, sy)
    except Exception:
        pass


def _draw_arrow(frame: np.ndarray, x: int, y: int, size: int = 22) -> None:
    """Draw a standard OS-style arrow cursor (hotspot = tip at x, y).

    White fill with dark anti-aliased outline and a 1-px drop-shadow so
    the cursor is readable on any background colour.
    """
    s = size
    pts = np.array([
        [x,                y            ],  # tip (hotspot)
        [x,                y + s        ],  # bottom-left
        [x + s * 4 // 10, y + s * 7 // 10],  # inner-left notch
        [x + s * 6 // 10, y + s        ],  # tail bottom
        [x + s * 8 // 10, y + s * 9 // 10],  # tail-right corner
        [x + s * 5 // 10, y + s * 6 // 10],  # inner-right notch
        [x + s * 6 // 10, y            ],  # top-right of arrowhead
    ], dtype=np.int32)

    shadow = (pts + np.array([[1, 1]])).astype(np.int32)
    cv2.fillPoly(frame, [shadow], (20, 20, 20))
    cv2.fillPoly(frame, [pts], (255, 255, 255))
    cv2.polylines(frame, [pts], isClosed=True, color=(30, 30, 30),
                  thickness=1, lineType=cv2.LINE_AA)
