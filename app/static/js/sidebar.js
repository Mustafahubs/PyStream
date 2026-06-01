/** Sidebar UI: monitor list, quality/settings controls, admin host panel,
 *  and screen access control (admin only).
 */

import { state }                                                    from './state.js';
import { updateSettings, updateDisplayName, newSession,
         getPermissions, setMonitorPermission, setPrivateMode }     from './api.js';
import { selectMonitor, selectAllGrid, reRegisterAll }              from './stream.js';

// ── Monitor list ──────────────────────────────────────────────

export function buildMonitorList(monitors) {
  const c = document.getElementById('monitor-list');
  c.innerHTML = '';
  monitors.forEach(m => {
    const btn = document.createElement('button');
    btn.className  = 'mon-btn';
    btn.dataset.id = m.id;

    const iAll = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="3" width="9" height="6" rx="1"/><rect x="13" y="3" width="9" height="6" rx="1"/>
      <rect x="2" y="13" width="9" height="6" rx="1"/><rect x="13" y="13" width="9" height="6" rx="1"/></svg>`;
    const iMon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;

    btn.innerHTML = `${m.id === 0 ? iAll : iMon}
      <span>${m.label}</span>
      <span class="res">${m.id === 0 ? 'Grid' : `${m.width}×${m.height}`}</span>`;

    btn.onclick = () => m.id === 0 ? selectAllGrid() : selectMonitor(m.id);
    c.appendChild(btn);
  });
}

// ── Quality ───────────────────────────────────────────────────

export function onQualityChange(value) {
  document.getElementById('q-val').textContent = value;
  document.getElementById('q-bar').textContent = value;
  updateSettings({ quality: parseInt(value) });
}

export function onCursorToggle(checked) {
  updateSettings({ show_cursor: checked });
}

// ── Admin: display name ───────────────────────────────────────

export async function saveDisplayName() {
  const name = document.getElementById('admin-display-name-input').value.trim();
  if (!name) return;
  const d = await updateDisplayName(name);
  if (d.ok) {
    state.myName = name;
    localStorage.setItem('pystream_name', name);
    reRegisterAll();   // update name in viewer list immediately
  }
}

// ── Admin: session management ─────────────────────────────────

export async function generateNewSession() {
  const nameInput = document.getElementById('session-name-input');
  const name      = nameInput.value.trim() || 'Python Live Session';
  const d         = await newSession(name);
  if (!d.ok) return;

  const url = `${location.protocol}//${location.host}/?join=${d.token}`;
  document.getElementById('link-modal-url').textContent = url;
  document.getElementById('link-modal').classList.remove('hidden');
  document.getElementById('session-name').textContent = d.name;
  document.getElementById('current-session-link').textContent = url;
}

export function closeLinkModal() {
  document.getElementById('link-modal').classList.add('hidden');
}

export function copySessionLink() {
  const url  = document.getElementById('link-modal-url').textContent;
  const btn  = document.getElementById('copy-link-btn');
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = 'Copy Link', 2500);
  });
}

export function copyCurrentLink() {
  const url = document.getElementById('current-session-link').textContent;
  if (!url || url === 'No active session') return;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copy-current-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

// ── Screen access control ─────────────────────────────────────

export async function loadPermissions() {
  const d = await getPermissions();
  if (!d.ok) return;

  state.privateMode       = d.private_mode;
  state.screenPermissions = d.monitors || {};

  const cb = document.getElementById('private-mode-cb');
  if (cb) cb.checked = d.private_mode;

  _rebuildPermissionRows();
}

/** Called whenever the viewer list changes so "Specific" checklists stay fresh. */
export function refreshPermissionRows() {
  _rebuildPermissionRows();
}

function _rebuildPermissionRows() {
  const container = document.getElementById('monitor-permissions');
  if (!container) return;

  const real = state.monitors.filter(m => m.id !== 0);
  container.innerHTML = '';

  real.forEach(m => {
    const saved  = state.screenPermissions[String(m.id)] || { access: 'all' };
    const access = saved.access || 'all';

    const row = document.createElement('div');
    row.className     = 'perm-row';
    row.dataset.monId = m.id;

    // Select dropdown
    const sel = document.createElement('select');
    sel.className = 'perm-select';
    sel.innerHTML = `
      <option value="all"      ${access === 'all'      ? 'selected' : ''}>👁 All Students</option>
      <option value="private"  ${access === 'private'  ? 'selected' : ''}>🔒 Private</option>
      <option value="specific" ${access === 'specific' ? 'selected' : ''}>👤 Specific…</option>`;

    // Viewer checklist (shown only for "specific")
    const list = document.createElement('div');
    list.className = 'viewer-checklist';
    list.style.display = access === 'specific' ? 'block' : 'none';

    _populateChecklist(list, saved.viewer_ids || []);

    const applyBtn = document.createElement('button');
    applyBtn.className   = 'host-btn';
    applyBtn.style.marginTop = '5px';
    applyBtn.textContent = 'Apply';
    applyBtn.onclick     = () => _applySpecific(m.id, list);

    list.appendChild(applyBtn);

    sel.onchange = async () => {
      if (sel.value === 'specific') {
        _populateChecklist(list, saved.viewer_ids || []);
        list.style.display = 'block';
      } else {
        list.style.display = 'none';
        const d = await setMonitorPermission(m.id, sel.value);
        if (d.ok) state.screenPermissions = d.monitors || {};
      }
    };

    const label = document.createElement('div');
    label.className = 'perm-label';
    label.textContent = m.label;

    const header = document.createElement('div');
    header.className = 'perm-header';
    header.append(label, sel);

    row.append(header, list);
    container.appendChild(row);
  });
}

function _populateChecklist(listEl, selectedIds) {
  // Remove old checkboxes (keep the Apply button if present)
  listEl.querySelectorAll('.viewer-check-row').forEach(el => el.remove());
  listEl.querySelector('.no-viewers')?.remove();

  const viewers = state.viewerList.filter(v => v.role !== 'host');

  if (!viewers.length) {
    const empty = document.createElement('div');
    empty.className   = 'no-viewers';
    empty.textContent = 'No students connected yet';
    listEl.prepend(empty);
    return;
  }

  viewers.forEach(v => {
    const row = document.createElement('label');
    row.className = 'viewer-check-row';

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.value   = v.id;
    cb.checked = selectedIds.includes(v.id);

    row.append(cb, document.createTextNode(' ' + v.name));
    listEl.prepend(row);
  });
}

async function _applySpecific(monitorId, listEl) {
  const checked = [...listEl.querySelectorAll('input[type=checkbox]:checked')]
    .map(cb => parseInt(cb.value));
  const d = await setMonitorPermission(monitorId, 'specific', checked);
  if (d.ok) state.screenPermissions = d.monitors || {};
}

export async function onPrivateModeToggle(enabled) {
  const d = await setPrivateMode(enabled);
  if (d.ok) state.privateMode = d.private_mode;
}

/** Keep the viewer list in state and refresh any open "Specific" checklists. */
export function cacheViewerList(list) {
  state.viewerList = list;
  document.querySelectorAll('.perm-row').forEach(row => {
    const monId = parseInt(row.dataset.monId);
    const saved  = state.screenPermissions[String(monId)] || { access: 'all' };
    const listEl = row.querySelector('.viewer-checklist');
    if (listEl && listEl.style.display !== 'none') {
      _populateChecklist(listEl, saved.viewer_ids || []);
    }
  });
}
