# PyStream

Real-time screen sharing built for classrooms. The teacher shares one or more monitors; students join through a browser with just a link — no installs, no accounts.

---

## Features

| Category | What it does |
|---|---|
| **Screen sharing** | Multi-monitor support, JPEG quality slider, live FPS counter, cursor overlay |
| **Access control** | Per-monitor privacy, allow-list specific students, global private mode |
| **Group chat** | Markdown, code snippets with syntax highlighting (10 languages), file sharing, emoji reactions, reply threads, link previews |
| **Voice chat** | Push-to-talk, per-speaker audio pipeline, admin force-mute, self-mute, device selection |
| **Admin tools** | Kick viewers, generate/revoke session links, display-name management |
| **Modern UI** | Dark theme, resizable sidebar and chat panel, unread badge, notification sound |

---

## Requirements

- **Python 3.11+**
- **Windows** (uses `mss` + `pyautogui` for screen/cursor capture; Linux/macOS may need small changes)
- A modern browser on students' devices (Chrome or Edge recommended for full voice-chat support)

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Mcoder9/pystream.git
cd pystream

# 2. Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux / macOS

# 3. Install dependencies
pip install -e .

# 4. Run
python main.py
```

On first run PyStream prints its address and creates a default admin account:

```
  ──────────────────────────────────────────────────────
  PyStream is live!
  ──────────────────────────────────────────────────────
  Admin URL    →  http://192.168.x.x:8000/?host=admin
  Student URL  →  http://192.168.x.x:8000/?join=<token>
  ──────────────────────────────────────────────────────
  ⚠  First run — default login: admin / admin123
  ⚠  Change the password in the Admin panel!
  ──────────────────────────────────────────────────────
```

> **Security note** — change the default password immediately. The database (`pystream.db`) is created locally and is not committed to git.

---

## Usage Guide

### For the Teacher (Admin)

1. Open the **Admin URL** printed in the terminal.
2. Log in with your credentials (default: `admin` / `admin123`).
3. The sidebar shows all connected monitors — click one to focus it.
4. Under **Admin Controls**:
   - Set a display name that students will see.
   - Generate a **session link** and share it with your students.
   - Copy or regenerate the link at any time.
5. Under **Screen Access** you can lock individual monitors or switch to a global private mode that hides all screens.
6. Use the **Voice Chat** section to connect your microphone, pick input/output devices, and mute individual students.

**Keyboard shortcuts**

| Key | Action |
|---|---|
| `Space` | Pause / Resume stream |
| `F` | Toggle fullscreen |
| `S` | Save screenshot |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom |
| `B` | Toggle sidebar |
| `C` | Toggle chat panel |
| `V` *(hold)* | Push to Talk (voice) |

---

### For Students

1. Open the **Student URL** the teacher shared (no login or install required).
2. Enter your display name when prompted.
3. Watch the teacher's screen. You can:
   - Chat with the group (text, code snippets, files, emoji).
   - Join **Voice Chat** → **Connect Voice**, then hold **V** (or the Talk button) to speak.
   - Zoom in/out, pause the stream, or take a screenshot.

---

## Voice Chat

Voice uses browser-native **MediaRecorder + WebSockets** — no external STUN/TURN server needed on a LAN.

| Feature | Detail |
|---|---|
| Push-to-talk | Hold the **Talk** button or the **V** key |
| Mic selection | Dropdown in the Voice section of the sidebar |
| Speaker selection | Same section (Chrome/Edge only — others use system default) |
| Speaking indicator | Green pulsing ring on avatar + animated equalizer bars |
| Self-mute | Click **Mute** in the Voice section |
| Admin mute | Admin clicks 🔇 next to any participant; they cannot unmute until released |

---

## Configuration

All runtime settings are adjustable live from the admin panel — no server restart needed.

| Setting | Default | Notes |
|---|---|---|
| JPEG quality | 70 | 20–95 range, lower = less bandwidth |
| Target FPS | 30 | Actual FPS depends on host CPU |
| Show cursor | On | Draws an arrow cursor overlay on frames |
| Session name | "Python Live Session" | Shown in the browser tab and topbar |

The database (`pystream.db`) is created automatically and stores admin accounts and session tokens. It is excluded from git by `.gitignore` — back it up manually if you want to preserve your admin password across reinstalls.

---

## Project Structure

```
pystream/
├── main.py                  # Entry point (uvicorn launcher)
├── app/
│   ├── main.py              # FastAPI app, router wiring, startup
│   ├── capture.py           # Screen capture loop (mss + OpenCV)
│   ├── config.py            # Runtime settings dataclass
│   ├── database.py          # SQLite helpers (admins, sessions)
│   ├── manager.py           # WebSocket connection manager
│   ├── state.py             # Global singletons shared across routers
│   ├── routers/
│   │   ├── api.py           # REST API (auth, permissions, upload, link-preview)
│   │   ├── stream.py        # Screen-share WebSocket (/ws/{monitor_id})
│   │   ├── voice.py         # Voice-chat WebSocket (/voice/ws)
│   │   └── frontend.py      # Serves index.html
│   ├── static/
│   │   ├── css/
│   │   │   ├── style.css    # Main layout and component styles
│   │   │   ├── chat.css     # Chat panel, code blocks, syntax colours
│   │   │   └── voice.css    # Voice participant list, PTT button
│   │   ├── js/
│   │   │   ├── main.js      # Composition root — wires all modules
│   │   │   ├── state.js     # Shared client state singleton
│   │   │   ├── config.js    # URL-param helpers
│   │   │   ├── stream.js    # WebSocket + frame rendering
│   │   │   ├── viewers.js   # Viewer list, server-message routing
│   │   │   ├── auth.js      # Login modals, token persistence
│   │   │   ├── sidebar.js   # Monitor list, permissions UI
│   │   │   ├── controls.js  # Keyboard shortcuts, zoom, sidebar resize
│   │   │   ├── api.js       # fetch() wrappers
│   │   │   ├── chat.js      # Group chat — render, send, reactions
│   │   │   └── voice.js     # Voice chat — capture, playback, UI
│   │   ├── sounds/
│   │   │   └── notify.wav   # Chat notification sound
│   │   └── uploads/         # User-uploaded files (gitignored)
│   └── templates/
│       └── index.html       # Single-page app shell
├── pyproject.toml
├── LICENSE
└── README.md
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

Short version:

```bash
# Fork → clone → branch
git checkout -b feature/my-feature

# Make changes, then run and test manually
python main.py

# Commit and open a PR
```

---

## License

[MIT](LICENSE) — use it, modify it, ship it.
