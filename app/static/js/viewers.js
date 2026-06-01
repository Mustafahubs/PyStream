/** Viewer list rendering and incoming server-message routing.
 *
 *  handleServerMsg() is the single entry point for all text messages
 *  from the WebSocket. stream.js calls it via the callback set in main.js.
 */

import { state }             from './state.js';
import { kickViewer }        from './api.js';
import { cacheViewerList }   from './sidebar.js';
import { handleChatMsg }     from './chat.js';

// ── Message router ────────────────────────────────────────────

export function handleServerMsg(data) {
  if (data.type?.startsWith('chat:')) return handleChatMsg(data);
  switch (data.type) {
    case 'meta':    return _handleMeta(data);
    case 'viewers': return _handleViewers(data);
    case 'kicked':  return _handleKicked();
    case 'error':   return _handleError(data);
  }
}

function _handleMeta(d) {
  _setText('stat-fps',     d.fps);
  _setText('fps-val',      d.fps);
  _setText('session-name', d.session);
  _setText('q-bar',        d.quality);
  document.getElementById('conn-state').style.color = 'var(--green)';
  document.getElementById('conn-state').textContent = '● Connected';
  if (d.viewer_list) _handleViewers({ list: d.viewer_list, count: d.viewers });
}

function _handleViewers(d) {
  const list  = d.list  || [];
  const count = d.count ?? list.length;
  cacheViewerList(list);   // keep sidebar permission checklists in sync

  ['viewer-count', 'stat-viewers', 'vl-count'].forEach(id => _setText(id, count));

  // Pulse the eye badge
  const badge = document.getElementById('viewer-badge');
  badge.classList.remove('bump');
  void badge.offsetWidth;
  badge.classList.add('bump');
  setTimeout(() => badge.classList.remove('bump'), 400);

  _renderViewerList(list);
}

function _handleKicked() {
  document.getElementById('kicked-overlay').classList.remove('hidden');
}

function _handleError(d) {
  if (d.reason === 'invalid_session') {
    document.getElementById('session-expired-overlay').classList.remove('hidden');
  } else if (d.reason === 'host_disconnected') {
    document.getElementById('host-disconnected-overlay').classList.remove('hidden');
  }
}

// ── Viewer list DOM ───────────────────────────────────────────

function _renderViewerList(list) {
  const panel = document.getElementById('viewer-list-panel');

  if (!list.length) {
    panel.innerHTML = '<div class="no-viewers">No viewers yet</div>';
    return;
  }

  panel.innerHTML = list.map(v => {
    const isMe   = (v.name === state.myName);
    const isHost = (v.role === 'host');
    const init   = v.name.charAt(0).toUpperCase();

    const hostTag = isHost ? `<span class="tag host-tag">👑 Host</span>` : '';
    const youTag  = isMe   ? `<span class="tag you-tag">You</span>`      : '';
    const kickBtn = (state.myRole === 'host' && !isHost)
      ? `<button class="kick-btn" data-id="${v.id}" data-name="${_esc(v.name)}" title="Remove from session">✕</button>`
      : '';

    return `
      <div class="viewer-entry${isHost ? ' is-host' : ''}">
        <div class="v-avatar${isHost ? ' host-av' : ''}">${init}</div>
        <span class="v-name">${_esc(v.name)}</span>
        ${hostTag}${youTag}${kickBtn}
      </div>`;
  }).join('');

  // Wire kick buttons
  panel.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id   = parseInt(btn.dataset.id);
      const name = btn.dataset.name;
      if (!confirm(`Remove "${name}" from the session?`)) return;
      await kickViewer(id);
    });
  });
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
