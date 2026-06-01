from dataclasses import dataclass


@dataclass
class StreamSettings:
    """Runtime-configurable stream parameters.

    Updated at runtime via POST /api/settings (admin only).
    Host password and session tokens are managed separately in the database.
    """

    quality: int = 70        # JPEG encode quality 1–100
    fps: int = 30            # target capture frames per second
    show_cursor: bool = True # draw the teacher's mouse cursor on frames
    session_name: str = "Python Live Session"
