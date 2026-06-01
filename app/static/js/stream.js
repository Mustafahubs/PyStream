/** WebSocket management and JPEG frame rendering.
 *
 *  This module knows nothing about viewers or auth — it only manages
 *  connections and pipes binary frames into the <img> element.
 *  Text (JSON) messages are forwarded to whatever handler main.js registers
 *  via setMessageHandler().
 */

import { SESSION_ID } from './config.js';
import { state }      from './state.js';

let _onMessage = (_data) => {};   // set by main.js

export function setMessageHandler(fn) { _onMessage = fn; }

// ── URL builder ───────────────────────────────────────────────

export function makeWsUrl(monitorId) {
  const p = new URLSearchParams({ session_id: SESSION_ID });
  if (state.myRole === 'host') {
    p.set('admin_token', state.myAdminToken);
  } else {
    p.set('join', state.myJoinToken);
  }
  return `ws://${location.host}/ws/${monitorId}?${p}`;
}

// ── Register helper ───────────────────────────────────────────

export function sendRegister(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.myName) return;
  ws.send(JSON.stringify({ type: 'register', name: state.myName, session_id: SESSION_ID }));
}

export function reRegisterAll() {
  Object.values(state.wsMap).forEach(sendRegister);
}

export function sendChatMsg(data) {
  const ws = state.wsMap['single'] ?? Object.values(state.wsMap).find(w => w.readyState === WebSocket.OPEN);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── Intentional-close guard ───────────────────────────────────
// Mark a socket before closing it so its onclose handler
// knows not to trigger an automatic reconnect.

function _kill(ws) {
  if (!ws) return;
  ws._dead = true;
  ws.close();
}

function _isDead(ws) {
  return ws._dead === true;
}

// ── Single-monitor mode ───────────────────────────────────────

export function selectMonitor(id) {
  closeAll();
  state.currentMode = 'single';
  document.getElementById('single-view').style.display = 'flex';
  document.getElementById('grid-view').style.display   = 'none';
  _setActiveMonitorBtn(id);
  _connectSingle(id);
}

function _connectSingle(id) {
  showOverlay('Connecting…');
  const ws = new WebSocket(makeWsUrl(id));
  ws.binaryType = 'blob';
  state.wsMap['single'] = ws;

  const img = document.getElementById('screen-img');

  ws.onopen = () => { hideOverlay(); sendRegister(ws); };

  ws.onclose = () => {
    if (_isDead(ws) || state.wsMap['single'] !== ws) return;
    setConnState(false);
    showOverlay('Reconnecting…');
    setTimeout(() => state.currentMode === 'single' && _connectSingle(id), 2000);
  };

  ws.onmessage = (e) => {
    // Always process text (control/error) messages regardless of pause state.
    if (typeof e.data === 'string') {
      const data = JSON.parse(e.data);
      if (data.type === 'error' || data.type === 'kicked') ws._dead = true;
      if (data.type === 'private') {
        ws._dead = true;        // stop onclose auto-retry loop
        ws._private = true;
        data._monitorId = id;
        _showSinglePrivate(() => { _hideSinglePrivate(); _connectSingle(id); });
      }
      _onMessage(data);
      return;
    }
    // Binary frame — skip rendering while paused but don't block control messages.
    if (state.paused) return;
    // Live frame arrived — hide private overlay if it was showing
    _hideSinglePrivate();
    const url = URL.createObjectURL(e.data);
    const old = img.src;
    img.src = url;
    if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
  };
}

// ── Grid / all-screens mode ───────────────────────────────────

export function selectAllGrid() {
  closeAll();
  state.currentMode = 'grid';
  document.getElementById('single-view').style.display = 'none';
  document.getElementById('grid-view').style.display   = 'grid';
  _setActiveMonitorBtn(0);
  _buildGrid();
}

function _buildGrid() {
  const grid = document.getElementById('grid-view');
  grid.innerHTML = '';
  const real = state.monitors.filter(m => m.id !== 0);
  grid.style.gridTemplateColumns = real.length === 1 ? '1fr' : 'repeat(2,1fr)';
  showOverlay('Connecting to all screens…');
  let ready = 0;

  real.forEach(m => {
    const cell  = document.createElement('div');  cell.className  = 'gcell'; cell.title = 'Double-click to focus';
    const label = document.createElement('div');  label.className = 'gcell-label'; label.textContent = m.label;
    const hint  = document.createElement('div');  hint.className  = 'gcell-hint';  hint.textContent  = 'dbl-click to focus';
    const gimg  = document.createElement('img');  gimg.className  = 'grid-img';    gimg.alt          = m.label;
    cell.append(label, hint, gimg);
    cell.ondblclick = () => selectMonitor(m.id);
    grid.appendChild(cell);

    const ws = new WebSocket(makeWsUrl(m.id));
    ws.binaryType = 'blob';
    state.wsMap[`grid-${m.id}`] = ws;
    let prev = null;

    ws.onopen = () => { sendRegister(ws); if (++ready === real.length) hideOverlay(); };

    ws.onclose = () => {
      if (_isDead(ws) || state.wsMap[`grid-${m.id}`] !== ws || state.currentMode !== 'grid') return;
      setTimeout(() => _reconnectGridCell(m.id, gimg, cell), 2000);
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const data = JSON.parse(e.data);
        if (data.type === 'error' || data.type === 'kicked') ws._dead = true;
        if (data.type === 'private') {
          ws._dead = true;
          ws._private = true;
          data._monitorId = m.id;
          _showCellPrivate(cell, gimg, () => { _hideCellPrivate(cell, gimg); _reconnectGridCell(m.id, gimg, cell); });
        }
        _onMessage(data);
        return;
      }
      if (state.paused) return;
      _hideCellPrivate(cell, gimg);
      const url = URL.createObjectURL(e.data); gimg.src = url;
      if (prev) URL.revokeObjectURL(prev); prev = url;
    };
  });
}

function _reconnectGridCell(id, gimg, cell) {
  const ws = new WebSocket(makeWsUrl(id));
  ws.binaryType = 'blob';
  state.wsMap[`grid-${id}`] = ws;
  let prev = null;

  ws.onopen = () => sendRegister(ws);

  ws.onclose = () => {
    if (_isDead(ws) || state.wsMap[`grid-${id}`] !== ws || state.currentMode !== 'grid') return;
    setTimeout(() => _reconnectGridCell(id, gimg, cell), 2000);
  };

  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const data = JSON.parse(e.data);
      if (data.type === 'error' || data.type === 'kicked') ws._dead = true;
      if (data.type === 'private') {
        ws._dead = true;
        ws._private = true;
        data._monitorId = id;
        _showCellPrivate(cell, gimg, () => { _hideCellPrivate(cell, gimg); _reconnectGridCell(id, gimg, cell); });
      }
      _onMessage(data);
      return;
    }
    if (state.paused) return;
    _hideCellPrivate(cell, gimg);
    const url = URL.createObjectURL(e.data); gimg.src = url;
    if (prev) URL.revokeObjectURL(prev); prev = url;
  };
}

export function closeAll() {
  // Mark all sockets as dead BEFORE closing so their onclose
  // handlers don't trigger reconnect logic.
  Object.values(state.wsMap).forEach(_kill);
  state.wsMap = {};
}

// ── Overlay / status helpers ──────────────────────────────────

export function showOverlay(msg) {
  document.getElementById('stream-overlay').classList.remove('hidden');
  document.getElementById('overlay-msg').textContent = msg;
}
export function hideOverlay() {
  document.getElementById('stream-overlay').classList.add('hidden');
  setConnState(true);
}
export function setConnState(ok) {
  const el = document.getElementById('conn-state');
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.textContent = ok ? '● Connected'  : '● Disconnected';
}

function _setActiveMonitorBtn(id) {
  document.querySelectorAll('.mon-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.id) === id));
}

// ── Private screen overlays ───────────────────────────────────

function _showSinglePrivate(onRetry) {
  const ov = document.getElementById('single-private-overlay');
  ov.classList.remove('hidden');
  document.getElementById('stream-overlay').classList.add('hidden');

  let btn = ov.querySelector('.priv-retry-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'priv-retry-btn';
    btn.textContent = 'Check Access';
    btn.style.cssText = 'margin-top:12px;padding:6px 16px;cursor:pointer;';
    ov.appendChild(btn);
  }
  btn.onclick = onRetry || null;
}
function _hideSinglePrivate() {
  document.getElementById('single-private-overlay').classList.add('hidden');
}

function _showCellPrivate(cell, gimg, onRetry) {
  gimg.style.opacity = '0';
  let ov = cell.querySelector('.cell-private-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'cell-private-overlay';
    ov.innerHTML = '<div class="priv-icon">🔒</div><div>Private</div>';
    cell.appendChild(ov);
  }
  ov.classList.remove('hidden');

  let btn = ov.querySelector('.priv-retry-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'priv-retry-btn';
    btn.textContent = 'Check';
    btn.style.cssText = 'margin-top:8px;padding:3px 10px;cursor:pointer;font-size:11px;';
    ov.appendChild(btn);
  }
  btn.onclick = onRetry || null;
}
function _hideCellPrivate(cell, gimg) {
  gimg.style.opacity = '1';
  const ov = cell.querySelector('.cell-private-overlay');
  if (ov) ov.classList.add('hidden');
}
