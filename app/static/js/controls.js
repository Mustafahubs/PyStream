/** Viewer controls: zoom, pause, screenshot, fullscreen, sidebar toggle.
 *
 *  All functions operate on the DOM directly.
 *  Call setupKeyboard() once from main.js to activate shortcuts.
 */

import { state }       from './state.js';
import { toggleChat } from './chat.js';

// ── Pause ─────────────────────────────────────────────────────

export function togglePause() {
  state.paused = !state.paused;
  document.getElementById('btn-pause').classList.toggle('active', state.paused);
  document.getElementById('pause-label').textContent = state.paused ? 'Resume' : 'Pause';
  document.getElementById('pause-icon').innerHTML    = state.paused
    ? '<polygon points="5,3 19,12 5,21" fill="currentColor"/>'
    : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
}

// ── Zoom ──────────────────────────────────────────────────────

export function zoomIn()    { state.zoom = Math.min(4.0, state.zoom + 0.25); _applyZoom(); }
export function zoomOut()   { state.zoom = Math.max(0.25, state.zoom - 0.25); _applyZoom(); }
export function zoomReset() { state.zoom = 1.0; _applyZoom(); }

function _applyZoom() {
  document.getElementById('screen-img').style.transform = `scale(${state.zoom})`;
}

// ── Screenshot ────────────────────────────────────────────────

export function takeScreenshot() {
  const img = document.getElementById('screen-img');
  const c   = document.createElement('canvas');
  c.width   = img.naturalWidth;
  c.height  = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const a      = document.createElement('a');
  a.download   = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  a.href       = c.toDataURL('image/png');
  a.click();
}

// ── Fullscreen ────────────────────────────────────────────────

export function toggleFullscreen() {
  document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
}

// ── Sidebar ───────────────────────────────────────────────────

export function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ── Sidebar resize ────────────────────────────────────────────

const _SIDEBAR_MIN = 180;
const _SIDEBAR_MAX = 600;
const _SIDEBAR_KEY = 'pystream_sidebar_w';

export function initSidebarResize() {
  const sidebar = document.getElementById('sidebar');
  const handle  = document.getElementById('sidebar-resize-handle');

  // Restore persisted width
  const saved = parseInt(localStorage.getItem(_SIDEBAR_KEY) || '0');
  if (saved >= _SIDEBAR_MIN && saved <= _SIDEBAR_MAX) {
    sidebar.style.width = saved + 'px';
  }

  handle.addEventListener('mousedown', e => {
    if (sidebar.classList.contains('collapsed')) return;
    e.preventDefault();

    const startX = e.clientX;
    const startW = sidebar.getBoundingClientRect().width;

    // Disable smooth transition while dragging
    sidebar.style.transition = 'none';
    handle.classList.add('dragging');
    document.body.style.cursor      = 'col-resize';
    document.body.style.userSelect  = 'none';

    function onMove(e) {
      const w = Math.max(_SIDEBAR_MIN, Math.min(_SIDEBAR_MAX, startW + e.clientX - startX));
      sidebar.style.width = w + 'px';
    }

    function onUp() {
      sidebar.style.transition = '';
      handle.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      localStorage.setItem(_SIDEBAR_KEY, Math.round(sidebar.getBoundingClientRect().width));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────

export function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    switch (e.key) {
      case ' ':   e.preventDefault(); togglePause();      break;
      case 'f':
      case 'F11': e.preventDefault(); toggleFullscreen(); break;
      case 's':
      case 'S':   takeScreenshot();                       break;
      case '+':
      case '=':   zoomIn();                               break;
      case '-':   zoomOut();                              break;
      case '0':   zoomReset();                            break;
      case 'b':
      case 'B':   toggleSidebar();                        break;
      case 'c':
      case 'C':   toggleChat();                           break;
    }
  });
}
