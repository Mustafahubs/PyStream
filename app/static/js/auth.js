/** Authentication flows for admin and student.
 *
 *  Three entry points called by main.js depending on the URL:
 *    initAdminFlow()   — ?host=<username>
 *    initStudentFlow() — ?join=<token>
 *    showNoSessionOverlay() — no params
 */

import { HOST_PARAM }              from './config.js';
import { state }                   from './state.js';
import { adminLogin, adminVerify } from './api.js';
import { reRegisterAll }           from './stream.js';

// ── Admin flow ────────────────────────────────────────────────

export async function initAdminFlow() {
  // Try restoring a saved token first (avoids re-login on refresh)
  const saved = localStorage.getItem('pystream_admin_token');
  if (saved) {
    try {
      const d = await adminVerify(saved);
      if (d.ok) {
        _applyAdminSession(saved, d.display_name);
        return true;   // caller should start stream
      }
    } catch { /* fall through */ }
    localStorage.removeItem('pystream_admin_token');
  }

  // Token missing or expired — show password modal
  _showAdminModal();
  return false;
}

function _showAdminModal() {
  document.getElementById('admin-username-label').textContent = HOST_PARAM || 'admin';
  document.getElementById('admin-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('admin-password').focus(), 60);
}

export async function submitAdminLogin() {
  const username = HOST_PARAM || 'admin';
  const password = document.getElementById('admin-password').value;
  const errEl    = document.getElementById('admin-login-error');
  errEl.textContent = '';

  try {
    const d = await adminLogin(username, password);
    if (d.ok) {
      localStorage.setItem('pystream_admin_token', d.token);
      document.getElementById('admin-modal').classList.add('hidden');
      _applyAdminSession(d.token, d.display_name);
      // Trigger stream start (main.js is listening for this event)
      document.dispatchEvent(new CustomEvent('pystream:admin-ready'));
    } else {
      errEl.textContent = d.reason || 'Wrong password';
    }
  } catch {
    errEl.textContent = 'Server error — check console';
  }
}

function _applyAdminSession(token, displayName) {
  state.myAdminToken = token;
  state.myRole       = 'host';
  state.myName       = displayName;
  localStorage.setItem('pystream_name', displayName);

  document.getElementById('host-topbar-badge').style.display    = 'flex';
  document.getElementById('host-panel').style.display            = 'block';
  document.getElementById('screen-access-panel').style.display  = 'block';
  document.getElementById('admin-display-name-input').value      = displayName;
}

// ── Student flow ──────────────────────────────────────────────

export async function initStudentFlow() {
  try {
    const d = await fetch('/api/status').then(r => r.json());
    if (d.session_token !== state.myJoinToken) {
      showSessionExpiredOverlay();
      return false;
    }
  } catch {
    showSessionExpiredOverlay();
    return false;
  }
  return true;   // caller should start stream, then decide on name modal
}

/** Show name modal — only called when localStorage has no stored name. */
export function showNameModal() {
  document.getElementById('name-modal').classList.remove('hidden');
  const input = document.getElementById('name-input');
  input.focus();
  input.onkeydown = e => { if (e.key === 'Enter') submitName(); };
}

export function submitName() {
  const input = document.getElementById('name-input');
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  state.myName = name;
  localStorage.setItem('pystream_name', name);
  document.getElementById('name-modal').classList.add('hidden');
  reRegisterAll();
}

// ── Full-page overlays ────────────────────────────────────────

export function showNoSessionOverlay() {
  document.getElementById('no-session-overlay').classList.remove('hidden');
}

export function showSessionExpiredOverlay() {
  document.getElementById('session-expired-overlay').classList.remove('hidden');
}
