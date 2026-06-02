<div align="center">
  <img src="https://raw.githubusercontent.com/Mustafahubs/Classtream/main/assets/logo.svg" alt="Classtream" width="380"/>
  <br/>
  <strong>Real-time multi-monitor screen sharing for classrooms.</strong><br/>
  The teacher shares their screen — students join in any browser with just a link. No installs, no accounts.
  <br/><br/>

  ![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
  ![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)
  ![License](https://img.shields.io/badge/License-MIT-7209b7)
  ![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)
</div>

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

## Install

### From PyPI

```bash
pip install classtream
classtream
```

### From source

```bash
git clone https://github.com/Mustafahubs/Classtream.git
cd Classtream
pip install .
classtream
```

### For development (auto-reload on code changes)

```bash
pip install -e .
python main.py        # equivalent to: classtream --dev
```

### CLI options

```
classtream [options]

  --host HOST        Bind address (default: 0.0.0.0)
  --port PORT        Port (default: 8000)
  --data-dir PATH    Override data directory (default: ~/.classtream)
  --dev              Enable auto-reload
  --version          Show version and exit
```

On first run Classtream prints its address and creates a default admin account:

```
  ──────────────────────────────────────────────────────────
  Classtream 1.0.0 is live!
  ──────────────────────────────────────────────────────────
  Admin URL    →  http://192.168.x.x:8000/?host=admin
  Student URL  →  http://192.168.x.x:8000/?join=<token>
  Data dir     →  C:\Users\you\.classtream
  ──────────────────────────────────────────────────────────
  ⚠  First run — default login: admin / admin123
  ⚠  Change the password in the Admin panel!
  ──────────────────────────────────────────────────────────
```

> **Security note** — change the default password immediately. The database (`classtream.db`) lives in `~/.classtream/` and is never committed to git.

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

The database (`classtream.db`) is stored in `~/.classtream/` and is never committed to git. Back it up manually if you want to preserve your admin password across reinstalls.

---

## Project Structure

```
Classtream/
├── main.py                  # Dev launcher (equivalent to classtream --dev)
├── app/
│   ├── main.py              # FastAPI app, router wiring, startup
│   ├── cli.py               # classtream command entry point
│   ├── paths.py             # Package vs user-data path resolution
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
│   │   ├── css/             # style.css · chat.css · voice.css
│   │   ├── js/              # main.js · stream.js · chat.js · voice.js …
│   │   └── sounds/          # notify.wav
│   └── templates/
│       └── index.html       # Single-page app shell
├── assets/
│   └── logo.svg
├── pyproject.toml
├── LICENSE
└── README.md
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

```bash
# Fork → clone → branch
git clone https://github.com/Mustafahubs/Classtream.git
git checkout -b feature/my-feature

# Run locally
pip install -e .
classtream --dev

# Open a PR against main
```

---

## License

[MIT](LICENSE) — use it, modify it, ship it.
