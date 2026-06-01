/** Entry point — wires all modules together and kicks off the init flow.
 *
 *  This is the only file that imports from multiple modules.
 *  It acts as the composition root, preventing circular imports elsewhere.
 */

import { HOST_PARAM, JOIN_PARAM }                        from './config.js';
import { state }                                          from './state.js';
import { setMessageHandler, selectMonitor, reRegisterAll } from './stream.js';
import { handleServerMsg }                               from './viewers.js';
import {
  initAdminFlow, initStudentFlow,
  showNoSessionOverlay, showNameModal, submitName, submitAdminLogin,
} from './auth.js';
import {
  togglePause, zoomIn, zoomOut, zoomReset,
  takeScreenshot, toggleFullscreen, toggleSidebar,
  setupKeyboard, initSidebarResize,
} from './controls.js';
import {
  buildMonitorList, onQualityChange, onCursorToggle,
  saveDisplayName, generateNewSession, closeLinkModal,
  copySessionLink, copyCurrentLink,
  loadPermissions, onPrivateModeToggle,
} from './sidebar.js';
import { getMonitors, getStatus } from './api.js';
import { initChat, toggleChat }   from './chat.js';
import { initVoice }              from './voice.js';

// ── Wire stream message handler ───────────────────────────────
setMessageHandler(handleServerMsg);

// ── Boot ──────────────────────────────────────────────────────
async function init() {
  setupKeyboard();
  initSidebarResize();
  initChat();
  initVoice();
  _wireButtons();

  if (HOST_PARAM !== null) {
    // Admin flow
    const alreadyLoggedIn = await initAdminFlow();
    if (alreadyLoggedIn) await _startStream();

    // submitAdminLogin() dispatches 'pystream:admin-ready' after modal submit
    document.addEventListener('pystream:admin-ready', () => _startStream());

  } else if (JOIN_PARAM !== null) {
    // Student flow
    const valid = await initStudentFlow();
    if (!valid) return;

    await _startStream();

    if (state.myName) {
      reRegisterAll();          // name already known → register immediately
    } else {
      showNameModal();          // first visit → ask for name
    }
  } else {
    showNoSessionOverlay();
  }
}

async function _startStream() {
  const [monitors, status] = await Promise.all([getMonitors(), getStatus()]);
  state.monitors = monitors;
  buildMonitorList(monitors);
  if (state.myRole === 'host') loadPermissions();

  if (status.session) {
    document.getElementById('session-name').textContent = status.session;
    document.getElementById('session-name-input').value = status.session;
  }
  if (status.session_token) {
    const url = `${location.protocol}//${location.host}/?join=${status.session_token}`;
    document.getElementById('current-session-link').textContent = url;
  }

  const real = monitors.filter(m => m.id !== 0);
  selectMonitor(real.length ? real[0].id : 1);
}

// ── Bind all onclick buttons declared in HTML ─────────────────
function _wireButtons() {
  // Admin modal
  _on('admin-submit-btn',   () => submitAdminLogin());
  _on('admin-password',     null, 'keydown', e => e.key === 'Enter' && submitAdminLogin());

  // Name modal
  _on('name-submit-btn',    () => submitName());

  // Link modal
  _on('copy-link-btn',      () => copySessionLink());
  _on('close-link-modal',   () => closeLinkModal());

  // Sidebar — controls
  _on('sidebar-toggle-btn', () => toggleSidebar());
  _on('q-slider',           null, 'input',  e => onQualityChange(e.target.value));
  _on('cursor-cb',          null, 'change', e => onCursorToggle(e.target.checked));

  // Sidebar — admin
  _on('save-display-name-btn', () => saveDisplayName());
  _on('new-session-btn',       () => generateNewSession());
  _on('copy-current-btn',      () => copyCurrentLink());
  _on('private-mode-cb',       null, 'change', e => onPrivateModeToggle(e.target.checked));

  // Chat
  _on('chat-toggle-btn', () => toggleChat());

  // Bottom bar
  _on('btn-pause',       () => togglePause());
  _on('btn-zoom-in',     () => zoomIn());
  _on('btn-zoom-out',    () => zoomOut());
  _on('btn-zoom-reset',  () => zoomReset());
  _on('btn-screenshot',  () => takeScreenshot());
  _on('btn-fullscreen',  () => toggleFullscreen());
}

function _on(id, fn, event = 'click', handler = fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

init();
