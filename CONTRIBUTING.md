# Contributing to PyStream

Thank you for wanting to improve PyStream. This document covers everything you need to get from zero to a merged pull request.

---

## Table of Contents

1. [Setting up the dev environment](#1-setting-up-the-dev-environment)
2. [Running the app locally](#2-running-the-app-locally)
3. [Project structure quick-reference](#3-project-structure-quick-reference)
4. [How the pieces fit together](#4-how-the-pieces-fit-together)
5. [Code style guidelines](#5-code-style-guidelines)
6. [Submitting a pull request](#6-submitting-a-pull-request)
7. [Reporting bugs](#7-reporting-bugs)
8. [Feature requests](#8-feature-requests)

---

## 1. Setting up the dev environment

**Requirements**: Python 3.11 or newer, Git.

```bash
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/pystream.git
cd pystream

# Create a virtual environment
python -m venv .venv

# Activate it
.venv\Scripts\activate          # Windows PowerShell / CMD
# source .venv/bin/activate     # Linux / macOS

# Install the project in editable mode
pip install -e .
```

The database (`pystream.db`) is created automatically on first run and is gitignored — you will never accidentally commit credentials.

---

## 2. Running the app locally

```bash
python main.py
```

Uvicorn starts with `--reload` so the server restarts whenever you save a Python file. Browser JS/CSS changes take effect on the next hard-refresh (`Ctrl+Shift+R`).

**Default credentials** (first run only):

| Field | Value |
|---|---|
| Admin URL | `http://localhost:8000/?host=admin` |
| Username | `admin` |
Password | `admin123` |

To test the student side, generate a session link from the Admin Controls panel, then open it in a second browser tab or a different browser.

---

## 3. Project structure quick-reference

```
app/
├── main.py          FastAPI app factory, router registration, startup tasks
├── capture.py       Screen-capture loop per monitor (mss + OpenCV + asyncio)
├── config.py        StreamSettings dataclass — quality, fps, cursor
├── database.py      SQLite helpers — admin accounts, session tokens
├── manager.py       WebSocket connection manager — connect/disconnect/broadcast
├── state.py         Module-level singletons shared by all routers
│
└── routers/
    ├── api.py       REST endpoints — auth, settings, permissions, upload, chat
    ├── stream.py    /ws/{monitor_id} — screen-share WebSocket
    ├── voice.py     /voice/ws — voice-chat WebSocket
    └── frontend.py  GET / → serves index.html

app/static/
├── css/
│   ├── style.css    Layout, topbar, sidebar, bottombar, modals
│   ├── chat.css     Chat panel, message bubbles, code blocks, syntax colours
│   └── voice.css    Voice section, participant rows, PTT button
│
└── js/              ES-module browser JavaScript (no build step)
    ├── main.js      Composition root — imports everything, calls init()
    ├── state.js     Shared mutable singleton (myName, myRole, wsMap, …)
    ├── config.js    URL-param helpers (HOST_PARAM, JOIN_PARAM, SESSION_ID)
    ├── stream.js    WebSocket lifecycle, frame rendering, reconnect logic
    ├── viewers.js   Incoming message router, viewer-list DOM
    ├── auth.js      Admin login, name modal, token persistence
    ├── sidebar.js   Monitor list, access-control UI, quality/cursor toggles
    ├── controls.js  Keyboard shortcuts, zoom, sidebar drag-resize
    ├── api.js       fetch() wrappers for every REST endpoint
    ├── chat.js      Group chat — markdown renderer, syntax highlighter, file upload
    └── voice.js     Voice chat — MediaRecorder capture, MediaSource playback
```

---

## 4. How the pieces fit together

### WebSocket message flow

```
Browser (stream.js)
  │── binary frames ──▶ /ws/{monitor_id}
  │                        │── JPEG frames ──▶ all viewers on that monitor
  │── JSON text ──────▶ /ws/{monitor_id}
  │   register / chat:send / chat:react / chat:delete
  │                        │── broadcasts ──▶ all connected monitors
  │
  │── binary audio ──▶ /voice/ws
  │   [1-byte flags][opus/webm bytes]
  │                        │── [2-byte voice_id][flags][audio] ──▶ all others
  └── voice JSON ──────▶ /voice/ws
      voice:speaking / voice:mute_status / voice:admin_mute …
```

### State model

- Each browser tab has a UUID (`SESSION_ID`) stored in `localStorage`.
- Grid mode opens **one WebSocket per monitor** — all share the same `SESSION_ID`.
- `ConnectionManager` deduplicates viewers: a viewer appears once in the list even with multiple sockets, and is removed only when **all** their sockets close (`_session_refs` counter).

### Chat history

The last 200 chat messages are kept in `manager.chat_history` (in-memory). New viewers receive the history on `register`. History is lost on server restart.

### Voice audio pipeline

**Sender**: `getUserMedia` → `MediaRecorder` (200 ms timeslices, Opus) → WebSocket binary with `is_init` flag on first chunk.

**Receiver**: Per-speaker `MediaSource` + `SourceBuffer`. When `is_init=1` arrives, the old pipeline is torn down and a new one is created (handles PTT re-press). The server enforces admin-mute by dropping audio packets before forwarding.

---

## 5. Code style guidelines

### Python

- PEP 8 formatting; docstrings only on public functions where the name isn't self-explanatory.
- Type annotations for all function signatures.
- No external linter config is enforced yet — keep it readable.

### JavaScript

- ES2022 modules (`import`/`export`), no transpiler, no bundler.
- Prefer `const` and `let`. Arrow functions for callbacks.
- No comments that repeat what the code already says. Comments only for non-obvious constraints or workarounds.
- Keep each module's public surface small — export only what `main.js` needs.

### CSS

- CSS custom properties (`var(--name)`) for every colour and size — no hardcoded hex in component rules.
- BEM-ish naming: `block-element`, `block--modifier`.
- No `!important` except to override third-party defaults.

### General

- No dead code, no console.log left in production paths.
- Prefer editing existing files over creating new ones.
- One concern per module — don't let `main.js` grow business logic.

---

## 6. Submitting a pull request

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b fix/issue-42-reconnect-loop
   ```
2. Make your changes. If you're adding a feature, update the relevant section of `README.md`.
3. Test manually — open admin + at least one student tab, exercise the affected feature.
4. **Commit** with a clear message:
   ```
   fix: stop viewer reconnect loop when host disconnects
   ```
5. Push and open a PR against `main`. Fill in the PR template:
   - What changed and why.
   - How to test it.
   - Screenshot / recording for UI changes.

PRs that change Python dependencies must update `pyproject.toml`. PRs that change the WebSocket protocol must update the protocol comments at the top of `stream.py` or `voice.py`.

---

## 7. Reporting bugs

Open an issue at [github.com/Mcoder9/pystream/issues](https://github.com/Mcoder9/pystream/issues) and include:

- OS and Python version.
- Browser name and version.
- Steps to reproduce.
- What you expected vs. what happened.
- Browser console errors (F12 → Console) and server terminal output.

---

## 8. Feature requests

Open an issue with the label **enhancement** and describe:

- The use case / classroom scenario.
- What the feature should look like from the user's perspective.
- Any constraints (LAN-only, no external services, etc.).

Ideas that align with the project's goal — **zero-install, LAN-first classroom tool** — are most likely to be accepted.
