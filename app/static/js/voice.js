/**
 * Voice chat module.
 *
 * Binary protocol
 * ───────────────
 * Client → Server : [1 byte flags: bit0=isInit] [audio bytes…]
 * Server → Client : [2 bytes voiceId BE] [1 byte flags] [audio bytes…]
 *
 * Text protocol
 * ─────────────
 * voice:init        { my_id, participants:[{id,name,is_admin,muted,force_muted}] }
 * voice:join        { id, name, is_admin }
 * voice:leave       { id, name }
 * voice:speaking    { id, name, active }
 * voice:mute_status { id, muted, force_muted }   (self-mute or admin-mute broadcast)
 * voice:force_muted                               (YOU are admin-muted)
 * voice:force_unmuted                             (YOU are admin-unmuted)
 */

import { state }      from './state.js';
import { SESSION_ID } from './config.js';

// ── Module state ──────────────────────────────────────────────
let _ws         = null;
let _myId       = null;
let _recorder   = null;
let _micStream  = null;
let _talking    = false;
let _muted      = false;
let _adminMuted = false;   // force-muted by admin — cannot unmute self
let _connected  = false;

// voiceId → { name, muted, forceMuted, isAdmin }
const _pdata = {};

// voiceId → { audio, ms, sb, queue, busy }
const _pipes = {};

// ── Init ──────────────────────────────────────────────────────

export function initVoice() {
  _wireButtons();
  _populateDevices();
}

function _wireButtons() {
  _bind('voice-connect-btn', 'click', _toggleConnect);
  _bind('voice-mute-btn',    'click', _toggleMute);

  const ptt = document.getElementById('voice-ptt-btn');
  if (ptt) {
    ptt.addEventListener('mousedown',  e => { e.preventDefault(); _startTalk(); });
    ptt.addEventListener('mouseup',    ()  => _stopTalk());
    ptt.addEventListener('mouseleave', ()  => { if (_talking) _stopTalk(); });
    ptt.addEventListener('touchstart', e => { e.preventDefault(); _startTalk(); }, { passive: false });
    ptt.addEventListener('touchend',   e => { e.preventDefault(); _stopTalk(); },  { passive: false });
  }

  // V key = PTT (Space stays as Pause)
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyV' && !e.repeat &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      _startTalk();
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'KeyV' &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      _stopTalk();
    }
  });

  _bind('voice-output-select', 'change', _applyOutputDevice);
  _bind('voice-input-select',  'change', () => {
    if (_talking) { _stopCapture(); _startCapture(); }
  });
}

async function _populateDevices() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch { /* labels will be generic */ }

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);

  const inSel  = document.getElementById('voice-input-select');
  const outSel = document.getElementById('voice-output-select');

  if (inSel) {
    const inputs = devices.filter(d => d.kind === 'audioinput');
    if (inputs.length) {
      inSel.innerHTML = inputs.map((d, i) =>
        `<option value="${_esc(d.deviceId)}">${_esc(d.label || `Microphone ${i + 1}`)}</option>`
      ).join('');
    }
  }

  if (outSel) {
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    if (outputs.length) {
      outSel.innerHTML = outputs.map((d, i) =>
        `<option value="${_esc(d.deviceId)}">${_esc(d.label || `Speaker ${i + 1}`)}</option>`
      ).join('');
    } else {
      outSel.innerHTML = '<option value="">System Default</option>';
      outSel.disabled  = true;
    }
  }
}

// ── Connect / Disconnect ──────────────────────────────────────

async function _toggleConnect() {
  _connected ? _disconnect() : await _connect();
}

async function _connect() {
  const p = new URLSearchParams({ session_id: SESSION_ID });
  if (state.myRole === 'host') {
    p.set('admin_token', state.myAdminToken);
  } else {
    p.set('join', state.myJoinToken);
  }

  _ws            = new WebSocket(`ws://${location.host}/voice/ws?${p}`);
  _ws.binaryType = 'arraybuffer';

  _ws.onopen = () => {
    _connected = true;
    _setConnectBtn(true);
    _setPttEnabled(true);
  };

  _ws.onclose = () => {
    _connected  = false;
    _adminMuted = false;
    _talking    = false;
    _stopCapture();
    _setConnectBtn(false);
    _setPttEnabled(false);
    _setPttActive(false);
    _clearParticipants();
    _setAdminMutedBanner(false);
  };

  _ws.onerror = () => {};

  _ws.onmessage = e => {
    if (typeof e.data === 'string') {
      _handleText(JSON.parse(e.data));
    } else {
      _handleAudio(e.data);
    }
  };
}

function _disconnect() {
  _stopTalk();
  _stopCapture();
  _ws?.close();
  _ws         = null;
  _connected  = false;
  _adminMuted = false;
  _setConnectBtn(false);
  _setPttEnabled(false);
  _clearParticipants();
  _setAdminMutedBanner(false);
}

// ── Incoming text ─────────────────────────────────────────────

function _handleText(d) {
  switch (d.type) {

    case 'voice:init':
      _myId = d.my_id;
      _addParticipant(_myId, state.myName || 'You', true, false, false, state.myRole === 'host');
      (d.participants || []).forEach(p =>
        _addParticipant(p.id, p.name, false, p.muted, p.force_muted, p.is_admin)
      );
      break;

    case 'voice:join':
      _addParticipant(d.id, d.name, false, false, false, d.is_admin);
      break;

    case 'voice:leave':
      _removeParticipant(d.id);
      _destroyPipe(d.id);
      break;

    case 'voice:speaking':
      _setSpeaking(d.id, d.active);
      break;

    case 'voice:mute_status':
      _applyMuteStatus(d.id, d.muted, d.force_muted);
      break;

    // Server tells THIS client it has been admin-muted
    case 'voice:force_muted':
      _adminMuted = true;
      if (_talking) _stopTalk();
      _setPttEnabled(false);
      document.getElementById('voice-ptt-btn')?.setAttribute('title', 'Muted by admin');
      document.getElementById('voice-mute-btn')?.setAttribute('disabled', '');
      _setAdminMutedBanner(true);
      // Update own row
      _applyMuteStatus(_myId, true, true);
      break;

    // Server tells THIS client the admin lifted their mute
    case 'voice:force_unmuted':
      _adminMuted = false;
      _setPttEnabled(true);
      document.getElementById('voice-ptt-btn')?.setAttribute('title', 'Push to Talk — hold V key or button');
      document.getElementById('voice-mute-btn')?.removeAttribute('disabled');
      _setAdminMutedBanner(false);
      _applyMuteStatus(_myId, _muted, false);
      break;
  }
}

// ── PTT ───────────────────────────────────────────────────────

function _startTalk() {
  if (!_connected || _talking || _muted || _adminMuted) return;
  _talking = true;
  _setPttActive(true);
  _setSpeaking(_myId, true);
  _startCapture();
  _ws?.send(JSON.stringify({ type: 'voice:speaking', active: true }));
}

function _stopTalk() {
  if (!_talking) return;
  _talking = false;
  _setPttActive(false);
  _setSpeaking(_myId, false);
  _stopCapture();
  _ws?.send(JSON.stringify({ type: 'voice:speaking', active: false }));
}

// ── Audio capture ─────────────────────────────────────────────

async function _startCapture() {
  if (_recorder) return;

  const deviceId  = document.getElementById('voice-input-select')?.value;
  const audioOpts = {
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: 48000,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };

  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: audioOpts });
  } catch {
    _stopTalk();
    return;
  }

  const mime    = _pickMime();
  const options = mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 };
  _recorder     = new MediaRecorder(_micStream, options);
  let isFirst   = true;

  _recorder.ondataavailable = async e => {
    if (!e.data?.size || _ws?.readyState !== WebSocket.OPEN) return;
    const buf = await e.data.arrayBuffer();
    const pkt = new Uint8Array(1 + buf.byteLength);
    pkt[0]    = isFirst ? 1 : 0;
    pkt.set(new Uint8Array(buf), 1);
    isFirst   = false;
    _ws.send(pkt);
  };

  _recorder.start(200);
}

function _stopCapture() {
  if (_recorder) { try { _recorder.stop(); } catch {} _recorder = null; }
  if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
}

function _pickMime() {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find(m => MediaRecorder.isTypeSupported(m)) ?? '';
}

// ── Audio playback ────────────────────────────────────────────

function _handleAudio(buffer) {
  if (buffer.byteLength < 3) return;
  const view   = new DataView(buffer);
  const vid    = view.getUint16(0, false);
  const isInit = (view.getUint8(2) & 1) === 1;
  const audio  = buffer.slice(3);
  if (vid === _myId) return;
  if (isInit) { _destroyPipe(vid); _createPipe(vid); }
  _pipes[vid]?.push(audio);
}

function _createPipe(vid) {
  const audio = new Audio();
  audio.autoplay = true;
  const outSel = document.getElementById('voice-output-select');
  if (outSel?.value && typeof audio.setSinkId === 'function') {
    audio.setSinkId(outSel.value).catch(() => {});
  }
  const ms  = new MediaSource();
  audio.src = URL.createObjectURL(ms);
  const queue = [];
  let sb = null, busy = false;

  function flush() {
    if (!sb || busy || sb.updating || !queue.length) return;
    busy = true;
    try { sb.appendBuffer(queue.shift()); } catch { busy = false; }
  }

  ms.addEventListener('sourceopen', () => {
    const mime = _pickMime() || 'audio/webm;codecs=opus';
    try { sb = ms.addSourceBuffer(mime); }
    catch { try { sb = ms.addSourceBuffer('audio/webm'); } catch { return; } }
    sb.addEventListener('updateend', () => { busy = false; flush(); });
    flush();
  });

  _pipes[vid] = { audio, ms, queue, push(c) { queue.push(c); flush(); } };
}

function _destroyPipe(vid) {
  const p = _pipes[vid];
  if (!p) return;
  try { p.ms.endOfStream(); }    catch {}
  try { p.audio.pause(); p.audio.src = ''; } catch {}
  delete _pipes[vid];
}

// ── Output device ─────────────────────────────────────────────

function _applyOutputDevice() {
  const deviceId = document.getElementById('voice-output-select')?.value;
  if (!deviceId) return;
  Object.values(_pipes).forEach(p => {
    if (typeof p.audio.setSinkId === 'function') p.audio.setSinkId(deviceId).catch(() => {});
  });
}

// ── Mute (self) ───────────────────────────────────────────────

function _toggleMute() {
  if (_adminMuted) return;   // admin-muted clients cannot self-unmute
  _muted = !_muted;
  if (_muted && _talking) _stopTalk();
  _ws?.send(JSON.stringify({ type: 'voice:mute_status', muted: _muted }));
  const btn = document.getElementById('voice-mute-btn');
  if (btn) {
    btn.textContent = _muted ? '🔇 Unmute' : '🎙 Mute';
    btn.classList.toggle('voice-muted', _muted);
  }
  // Update own row immediately
  _applyMuteStatus(_myId, _muted, false);
}

// ── Admin mute action ─────────────────────────────────────────

function _adminToggleMute(vid) {
  const pd = _pdata[vid];
  if (!pd) return;
  const type = pd.forceMuted ? 'voice:admin_unmute' : 'voice:admin_mute';
  _ws?.send(JSON.stringify({ type, target_id: vid }));
}

// ── Participant list UI ───────────────────────────────────────

function _addParticipant(vid, name, isMe, muted, forceMuted, isAdmin) {
  const list = document.getElementById('voice-participants');
  if (!list || list.querySelector(`[data-vid="${vid}"]`)) return;

  _pdata[vid] = { name, muted: muted || forceMuted, forceMuted, isAdmin };

  const initial    = (name || '?').charAt(0).toUpperCase();
  const iAmAdmin   = state.myRole === 'host';
  const showMuteBtn = iAmAdmin && !isMe && !isAdmin;  // admins can't mute other admins or themselves

  const el = document.createElement('div');
  el.className   = 'vp-row'
    + (isMe         ? ' vp-me'         : '')
    + (muted || forceMuted ? ' muted'  : '')
    + (forceMuted   ? ' force-muted'   : '');
  el.dataset.vid = vid;

  el.innerHTML =
    `<div class="vp-avatar">${_esc(initial)}</div>` +
    `<span class="vp-name">${_esc(name)}</span>` +
    // Mic-off icon — visible when .muted
    `<svg class="vp-mute-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
       <line x1="1" y1="1" x2="23" y2="23"/>
       <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
       <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
       <line x1="12" y1="19" x2="12" y2="23"/>
       <line x1="8"  y1="23" x2="16" y2="23"/>
     </svg>` +
    // Equalizer bars — visible when .speaking
    `<div class="vp-bars"><b></b><b></b><b></b><b></b></div>` +
    // Admin mute button — only for admins, not for self or other admins
    (showMuteBtn
      ? `<button class="vp-admin-mute-btn${forceMuted ? ' is-muted' : ''}"
           title="${forceMuted ? 'Unmute participant' : 'Force mute participant'}"
           data-muted="${forceMuted}">
           ${forceMuted ? '🔊' : '🔇'}
         </button>`
      : '');

  const btn = el.querySelector('.vp-admin-mute-btn');
  if (btn) btn.addEventListener('click', () => _adminToggleMute(vid));

  list.appendChild(el);
}

function _removeParticipant(vid) {
  document.querySelector(`[data-vid="${vid}"]`)?.remove();
  delete _pdata[vid];
}

function _setSpeaking(vid, active) {
  document.querySelector(`[data-vid="${vid}"]`)?.classList.toggle('speaking', active);
}

function _applyMuteStatus(vid, muted, forceMuted) {
  const pd = _pdata[vid];
  if (pd) { pd.muted = muted; pd.forceMuted = forceMuted; }

  const row = document.querySelector(`[data-vid="${vid}"]`);
  if (!row) return;

  row.classList.toggle('muted',       muted || forceMuted);
  row.classList.toggle('force-muted', forceMuted);

  const adminBtn = row.querySelector('.vp-admin-mute-btn');
  if (adminBtn) {
    adminBtn.dataset.muted   = forceMuted;
    adminBtn.title           = forceMuted ? 'Unmute participant' : 'Force mute participant';
    adminBtn.textContent     = forceMuted ? '🔊' : '🔇';
    adminBtn.classList.toggle('is-muted', forceMuted);
  }
}

function _clearParticipants() {
  const list = document.getElementById('voice-participants');
  if (list) list.innerHTML = '';
  Object.keys(_pipes).forEach(vid => _destroyPipe(Number(vid)));
  Object.keys(_pdata).forEach(k => delete _pdata[k]);
  _myId = null;
}

// ── Admin-muted banner ────────────────────────────────────────

function _setAdminMutedBanner(show) {
  let banner = document.getElementById('voice-admin-muted-banner');
  if (!banner) return;
  banner.classList.toggle('hidden', !show);
}

// ── Button helpers ────────────────────────────────────────────

function _setConnectBtn(on) {
  const btn = document.getElementById('voice-connect-btn');
  if (!btn) return;
  btn.textContent = on ? 'Disconnect' : 'Connect Voice';
  btn.classList.toggle('voice-active', on);
}

function _setPttEnabled(on) {
  const btn = document.getElementById('voice-ptt-btn');
  if (btn) btn.disabled = !on;
}

function _setPttActive(on) {
  document.getElementById('voice-ptt-btn')?.classList.toggle('ptt-active', on);
  const lbl = document.getElementById('voice-ptt-label');
  if (lbl) lbl.textContent = on ? 'Talking…' : 'Talk';
}

// ── Helpers ───────────────────────────────────────────────────

function _bind(id, ev, fn) {
  document.getElementById(id)?.addEventListener(ev, fn);
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
