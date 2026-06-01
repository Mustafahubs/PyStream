/** Group chat — rendering, send, reactions, file upload, link preview. */

import { state }                      from './state.js';
import { sendChatMsg }                from './stream.js';
import { uploadChatFile, getLinkPreview } from './api.js';

// ── Internal state ────────────────────────────────────────────
let _replyTo    = null;          // {id, text, sender} | null
const _seenIds  = new Set();     // dedupe in grid mode (multiple WS)
let _unread     = 0;             // messages received while panel hidden

// ── Notification sound ────────────────────────────────────────
const _notifyAudio = new Audio('/static/sounds/notify.wav');
_notifyAudio.volume = 0.6;

function _playNotify() {
  // Clone so overlapping messages each get their own playback instance
  const clip = _notifyAudio.cloneNode();
  clip.volume = _notifyAudio.volume;
  clip.play().catch(() => {}); // silently ignore if browser blocks autoplay
}

// ── Emoji data ────────────────────────────────────────────────
const REACTION_EMOJIS = ['👍','👎','❤️','😂','😮','😢','🔥','👏','🎉','💯','😍','💪'];

const EMOJI_GROUPS = [
  ['😀','😂','🥹','😍','🤔','😎','🥺','😊','😅','🤣','😇','🙄','😤','🤯','🥳','😏','😴','🤗','😢','😡'],
  ['👍','👎','👏','🙌','🤝','✌️','👋','🤞','💪','🤙','🫰','🙏','✋','👌','🤌','☝️'],
  ['❤️','🧡','💛','💚','💙','💜','🖤','💕','💔','❤️‍🔥','💖','💗','💓','💞'],
  ['🔥','⭐','💯','🎉','🎊','✅','❌','⚠️','💡','🚀','🎯','💻','📚','🏆','🎁','💎','🌈','⚡'],
];
const EMOJI_LABELS = ['Smileys','Gestures','Hearts','Objects'];

// ── Init ──────────────────────────────────────────────────────

function _initChatResize() {
  const handle = document.getElementById('chat-resize-handle');
  const panel  = document.getElementById('chat-panel');
  if (!handle || !panel) return;

  const MIN_W = 240, MAX_W = 600, STORE = 'chat-panel-width';

  const saved = localStorage.getItem(STORE);
  if (saved) panel.style.width = parseInt(saved) + 'px';

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');

    const onMove = ev => {
      const newW = Math.min(MAX_W, Math.max(MIN_W, startW + (startX - ev.clientX)));
      panel.style.width = newW + 'px';
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      localStorage.setItem(STORE, parseInt(panel.style.width));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

export function initChat() {
  _buildEmojiPicker();
  _initChatResize();

  // Unlock the browser's audio context on the first user gesture.
  // Guests who return via a saved name never click a modal, so without
  // this priming step their audio context stays locked and play() silently fails.
  function _unlockAudio() {
    const primer = _notifyAudio.cloneNode();
    primer.volume = 0;
    primer.play().then(() => { primer.pause(); primer.src = ''; }).catch(() => {});
    document.removeEventListener('click',      _unlockAudio);
    document.removeEventListener('keydown',    _unlockAudio);
    document.removeEventListener('touchstart', _unlockAudio);
  }
  document.addEventListener('click',      _unlockAudio);
  document.addEventListener('keydown',    _unlockAudio);
  document.addEventListener('touchstart', _unlockAudio);

  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', _autoResize);

  document.getElementById('chat-send-btn').addEventListener('click', sendMessage);
  document.getElementById('chat-emoji-btn').addEventListener('click', _toggleEmojiPicker);
  document.getElementById('chat-file-btn').addEventListener('click',
    () => document.getElementById('chat-file-input').click());
  document.getElementById('chat-file-input').addEventListener('change', _onFileSelect);
  document.getElementById('chat-reply-cancel').addEventListener('click', clearReply);
  document.getElementById('chat-code-btn').addEventListener('click', _toggleCodePanel);
  document.getElementById('chat-code-close').addEventListener('click', _toggleCodePanel);
  document.getElementById('chat-code-send').addEventListener('click', _sendCodeSnippet);

  // Tab → 4 spaces + Ctrl/Cmd+Enter → send in code textarea
  document.getElementById('chat-code-input').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.target, s = el.selectionStart, en = el.selectionEnd;
      el.value = el.value.slice(0, s) + '    ' + el.value.slice(en);
      el.selectionStart = el.selectionEnd = s + 4;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      _sendCodeSnippet();
    }
  });

  // Copy button delegation on the messages list (code blocks)
  document.getElementById('chat-messages').addEventListener('click', e => {
    const btn = e.target.closest('.cb-copy');
    if (!btn) return;
    const raw = decodeURIComponent(btn.closest('.md-code-block')?.dataset.raw || '');
    navigator.clipboard.writeText(raw).then(() => {
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }).catch(() => {});
  });

  // Close emoji picker on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#chat-emoji-picker') && !e.target.closest('#chat-emoji-btn')) {
      document.getElementById('chat-emoji-picker').classList.add('hidden');
    }
    if (!e.target.closest('#chat-reaction-picker') && !e.target.closest('.act-react')) {
      document.getElementById('chat-reaction-picker').classList.add('hidden');
    }
  });
}

export function toggleChat() {
  const panel  = document.getElementById('chat-panel');
  const handle = document.getElementById('chat-resize-handle');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  if (handle) handle.classList.toggle('hidden', isOpen);
  document.getElementById('chat-toggle-btn').classList.toggle('active', !isOpen);
  if (!isOpen) {
    _unread = 0;
    _updateUnreadBadge();
    _scrollToBottom();
  }
}

// ── Incoming message handler ──────────────────────────────────

export function handleChatMsg(data) {
  switch (data.type) {
    case 'chat:history':  return _loadHistory(data.messages || []);
    case 'chat:message':  return _onMessage(data);
    case 'chat:deleted':  return _deleteMessage(data.msg_id);
    case 'chat:reaction': return _updateReactions(data.msg_id, data.reactions);
  }
}

// ── Send ──────────────────────────────────────────────────────

export function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  sendChatMsg({
    type:        'chat:send',
    id:          _uuid(),
    text,
    reply_to_id: _replyTo?.id ?? null,
  });
  input.value = '';
  _autoResize({ target: input });
  clearReply();
}

// ── Reply ─────────────────────────────────────────────────────

export function setReply(msg) {
  _replyTo = msg;
  document.getElementById('chat-reply-sender').textContent = msg.sender;
  document.getElementById('chat-reply-text').textContent   = (msg.text || '').substring(0, 80);
  document.getElementById('chat-reply-bar').classList.remove('hidden');
  document.getElementById('chat-input').focus();
}

export function clearReply() {
  _replyTo = null;
  document.getElementById('chat-reply-bar').classList.add('hidden');
}

// ── History ───────────────────────────────────────────────────

function _loadHistory(messages) {
  const list = document.getElementById('chat-messages');
  list.innerHTML = '';
  _seenIds.clear();
  messages.forEach(m => _appendMessage(m, false));
  _scrollToBottom();
}

function _onMessage(msg) {
  const wasAtBottom = _isAtBottom();
  _appendMessage(msg, true);
  if (wasAtBottom) _scrollToBottom();

  if (msg.sender !== state.myName) {
    const panel = document.getElementById('chat-panel');
    if (panel.classList.contains('hidden')) {
      _unread++;
      _updateUnreadBadge();
      _playNotify();
    }
  }
}

function _appendMessage(msg, withLinkPreview = true) {
  if (_seenIds.has(msg.id)) return;
  _seenIds.add(msg.id);
  const list = document.getElementById('chat-messages');
  list.appendChild(_renderMessage(msg));
  if (withLinkPreview && msg.text) _fetchLinkPreview(msg.id, msg.text);
}

// ── Render ────────────────────────────────────────────────────

function _renderMessage(msg) {
  const isMe   = (msg.sender === state.myName);
  const isHost = (msg.role   === 'host');

  const wrap = document.createElement('div');
  wrap.className = `chat-msg${isMe ? ' is-me' : ''}`;
  wrap.dataset.msgId = msg.id;

  // Avatar
  const av = document.createElement('div');
  av.className   = `msg-avatar${isHost ? ' host-av' : ''}`;
  av.textContent = (msg.sender || '?').charAt(0).toUpperCase();

  // Body
  const body = document.createElement('div');
  body.className = 'msg-body';

  // Meta row
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML =
    `<span class="msg-sender${isHost ? ' is-host' : ''}">${_esc(msg.sender)}</span>` +
    `<span class="msg-time">${_fmtTime(msg.timestamp)}</span>`;

  body.appendChild(meta);

  // Reply quote
  if (msg.reply_to) {
    const q = document.createElement('div');
    q.className = 'msg-reply-quote';
    q.innerHTML = `<span class="rq-sender">${_esc(msg.reply_to.sender)}</span> ${_esc((msg.reply_to.text || '').substring(0, 80))}`;
    body.appendChild(q);
  }

  // Text content
  if (msg.text) {
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = _md(msg.text);
    // Make links open in new tab safely
    content.querySelectorAll('a').forEach(a => {
      a.target = '_blank'; a.rel = 'noopener noreferrer';
    });
    body.appendChild(content);
  }

  // File card
  if (msg.file) {
    body.appendChild(_renderFileCard(msg.file));
  }

  // Link preview placeholder (filled by _fetchLinkPreview)
  const lpEl = document.createElement('div');
  lpEl.className = 'msg-link-preview';
  body.appendChild(lpEl);

  // Reactions
  const reactEl = document.createElement('div');
  reactEl.className = 'msg-reactions';
  _paintReactions(reactEl, msg.reactions || {}, msg.id);
  body.appendChild(reactEl);

  // Action bar
  body.appendChild(_buildActions(msg, isMe));

  wrap.append(av, body);
  return wrap;
}

function _renderFileCard(file) {
  const isImg = /^image\//i.test(file.mime || '');
  const ext   = (file.filename || '').split('.').pop().toLowerCase();
  const icons = { py:'🐍', zip:'📦', mp4:'🎬', mp3:'🎵', wav:'🎵',
                  pdf:'📄', txt:'📝', md:'📝', json:'📋', csv:'📊' };

  const card = document.createElement('div');
  card.className = 'msg-file-card';

  if (isImg) {
    card.innerHTML =
      `<img class="file-thumb" src="${_esc(file.url)}" alt="${_esc(file.filename)}" loading="lazy">` +
      `<div class="file-meta"><span class="file-name">${_esc(file.filename)}</span>` +
      `<a class="file-dl" href="${_esc(file.url)}" download="${_esc(file.filename)}" target="_blank">↓ Download</a></div>`;
    card.querySelector('img').addEventListener('click', () => window.open(file.url, '_blank'));
  } else {
    card.innerHTML =
      `<span class="file-icon">${icons[ext] || '📎'}</span>` +
      `<div class="file-meta">` +
      `  <span class="file-name">${_esc(file.filename)}</span>` +
      `  <span class="file-size">${_fmtSize(file.size)}</span>` +
      `</div>` +
      `<a class="file-dl" href="${_esc(file.url)}" download="${_esc(file.filename)}" target="_blank">↓</a>`;
  }
  return card;
}

function _buildActions(msg, isMe) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';

  const reactBtn = document.createElement('button');
  reactBtn.className   = 'act-btn act-react';
  reactBtn.title       = 'React';
  reactBtn.textContent = '😊';
  reactBtn.addEventListener('click', e => { e.stopPropagation(); _openReactionPicker(msg.id, reactBtn); });

  const replyBtn = document.createElement('button');
  replyBtn.className   = 'act-btn act-reply';
  replyBtn.title       = 'Reply';
  replyBtn.innerHTML   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';
  replyBtn.addEventListener('click', () => setReply(msg));

  const copyBtn = document.createElement('button');
  copyBtn.className   = 'act-btn act-copy';
  copyBtn.title       = 'Copy text';
  copyBtn.innerHTML   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(msg.text || '').then(() => {
      copyBtn.textContent = '✓';
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      }, 1500);
    });
  });

  bar.append(reactBtn, replyBtn, copyBtn);

  if (isMe || state.myRole === 'host') {
    const delBtn = document.createElement('button');
    delBtn.className   = 'act-btn act-delete';
    delBtn.title       = 'Delete';
    delBtn.innerHTML   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    delBtn.addEventListener('click', () => {
      sendChatMsg({ type: 'chat:delete', msg_id: msg.id });
    });
    bar.appendChild(delBtn);
  }

  return bar;
}

// ── Reactions ─────────────────────────────────────────────────

function _openReactionPicker(msgId, anchorBtn) {
  const picker = document.getElementById('chat-reaction-picker');
  picker.innerHTML = '';
  REACTION_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className   = 'rp-emoji';
    btn.textContent = emoji;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      sendChatMsg({ type: 'chat:react', msg_id: msgId, emoji });
      picker.classList.add('hidden');
    });
    picker.appendChild(btn);
  });

  const rect = anchorBtn.getBoundingClientRect();
  picker.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  picker.style.right  = `${window.innerWidth  - rect.right}px`;
  picker.classList.remove('hidden');
}

function _updateReactions(msgId, reactions) {
  const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  const el = msgEl.querySelector('.msg-reactions');
  if (el) _paintReactions(el, reactions, msgId);

  // Update in-memory history too
  for (const m of state.viewerList) {
    if (m.id === msgId) { m.reactions = reactions; break; }
  }
}

function _paintReactions(el, reactions, msgId) {
  el.innerHTML = '';
  Object.entries(reactions).forEach(([emoji, names]) => {
    if (!names.length) return;
    const pill = document.createElement('button');
    pill.className = 'reaction-pill' + (names.includes(state.myName) ? ' mine' : '');
    pill.title     = names.join(', ');
    pill.innerHTML = `${emoji}<span class="reaction-count">${names.length}</span>`;
    pill.addEventListener('click', () => sendChatMsg({ type: 'chat:react', msg_id: msgId, emoji }));
    el.appendChild(pill);
  });
}

function _deleteMessage(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) {
    el.classList.add('msg-deleting');
    setTimeout(() => el.remove(), 250);
  }
  _seenIds.delete(msgId);
}

// ── Link preview ──────────────────────────────────────────────

const _URL_RE = /https?:\/\/[^\s<>"']+/;

function _fetchLinkPreview(msgId, text) {
  const m = _URL_RE.exec(text);
  if (!m) return;
  const url = m[0];
  getLinkPreview(url).then(data => {
    if (!data?.ok || !data.title) return;
    const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgEl) return;
    const lpEl = msgEl.querySelector('.msg-link-preview');
    if (!lpEl) return;

    const card = document.createElement('div');
    card.className = 'lp-card';
    if (data.image) {
      const img = document.createElement('img');
      img.src = data.image; img.className = 'lp-img'; img.alt = '';
      card.appendChild(img);
    }
    const info = document.createElement('div');
    info.className = 'lp-info';
    info.innerHTML =
      `<div class="lp-domain">${_esc(data.domain)}</div>` +
      `<div class="lp-title">${_esc(data.title)}</div>` +
      (data.description ? `<div class="lp-desc">${_esc(data.description.substring(0, 120))}</div>` : '');
    card.appendChild(info);
    card.addEventListener('click', () => window.open(url, '_blank'));
    lpEl.appendChild(card);
  }).catch(() => {});
}

// ── File handling ─────────────────────────────────────────────

function _onFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  _uploadAndSend(file);
}

async function _uploadAndSend(file) {
  const sendBtn = document.getElementById('chat-send-btn');
  sendBtn.disabled = true;
  sendBtn.textContent = '…';

  const data = await uploadChatFile(file).catch(() => null);

  sendBtn.disabled = false;
  sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  if (!data?.ok) {
    alert(data?.reason || 'Upload failed');
    return;
  }

  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  sendChatMsg({
    type:        'chat:send',
    id:          _uuid(),
    text,
    file:        { url: data.url, filename: data.filename, size: data.size, mime: data.mime },
    reply_to_id: _replyTo?.id ?? null,
  });
  input.value = '';
  _autoResize({ target: input });
  clearReply();
}

// ── Emoji picker ──────────────────────────────────────────────

function _buildEmojiPicker() {
  const picker = document.getElementById('chat-emoji-picker');
  EMOJI_GROUPS.forEach((group, gi) => {
    const label = document.createElement('div');
    label.className = 'ep-label';
    label.textContent = EMOJI_LABELS[gi];
    picker.appendChild(label);
    const row = document.createElement('div');
    row.className = 'ep-row';
    group.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className   = 'ep-emoji';
      btn.textContent = emoji;
      btn.addEventListener('click', () => _insertEmoji(emoji));
      row.appendChild(btn);
    });
    picker.appendChild(row);
  });
}

function _toggleEmojiPicker() {
  document.getElementById('chat-emoji-picker').classList.toggle('hidden');
}

function _insertEmoji(emoji) {
  const input = document.getElementById('chat-input');
  const start = input.selectionStart;
  const end   = input.selectionEnd;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();
  _autoResize({ target: input });
}

// ── Syntax highlighter ────────────────────────────────────────

const _ALIAS = {
  py:'python', js:'javascript', ts:'javascript', jsx:'javascript',
  tsx:'javascript', typescript:'javascript', xml:'html', sh:'bash',
  shell:'bash', 'c++':'cpp', cc:'cpp', c:'cpp', rs:'rust',
};

// Protected tokens (strings, comments) — extracted BEFORE HTML-escaping
const _PROTECTED = {
  python:     [
    [/f?r?"""[\s\S]*?"""/g, 'str'], [/f?r?'''[\s\S]*?'''/g, 'str'],
    [/f?"(?:[^"\\]|\\.)*"/g,'str'], [/f?'(?:[^'\\]|\\.)*'/g,'str'],
    [/#[^\n]*/g,             'cm' ],
  ],
  javascript: [
    [/`(?:[^`\\]|\\.)*`/gs,'str'],
    [/"(?:[^"\\]|\\.)*"/g, 'str'], [/'(?:[^'\\]|\\.)*'/g, 'str'],
    [/\/\*[\s\S]*?\*\//g,  'cm' ], [/\/\/[^\n]*/g,        'cm' ],
  ],
  html:  [[/<!--[\s\S]*?-->/g,'cm']],
  css:   [[/"[^"]*"/g,'str'],[/'[^']*'/g,'str'],[/\/\*[\s\S]*?\*\//g,'cm']],
  json:  [[/"(?:[^"\\]|\\.)*"/g,'str']],
  sql:   [[/'(?:[^'\\]|\\.)*'/g,'str'],[/--[^\n]*/g,'cm'],[/\/\*[\s\S]*?\*\//g,'cm']],
  bash:  [[/"(?:[^"\\]|\\.)*"/g,'str'],[/'[^']*'/g,'str'],[/#[^\n]*/g,'cm']],
  cpp:   [
    [/"(?:[^"\\]|\\.)*"/g,'str'],[/'(?:[^'\\]|\\.)*'/g,'str'],
    [/\/\*[\s\S]*?\*\//g,'cm'],[/\/\/[^\n]*/g,'cm'],
    [/#\s*\w+[^\n]*/g,'dc'],
  ],
  rust:  [[/"(?:[^"\\]|\\.)*"/g,'str'],[/\/\*[\s\S]*?\*\//g,'cm'],[/\/\/[^\n]*/g,'cm']],
  java:  [[/"(?:[^"\\]|\\.)*"/g,'str'],[/'(?:[^'\\]|\\.)*'/g,'str'],[/\/\*[\s\S]*?\*\//g,'cm'],[/\/\/[^\n]*/g,'cm']],
};

// Patterns applied AFTER HTML-escaping (second element: class suffix or replacer fn)
const _PATTERNS = {
  python: [
    [/\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g,'kw'],
    [/\b(abs|all|any|ascii|bin|bool|bytearray|bytes|callable|chr|classmethod|compile|complex|delattr|dict|dir|divmod|enumerate|eval|exec|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|isinstance|issubclass|iter|len|list|locals|map|max|memoryview|min|next|object|oct|open|ord|pow|print|property|range|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|vars|zip)\b/g,'bi'],
    [/@[\w.]+/g,'dc'],
    [/\b\d[\d_]*\.?[\d_]*([eEjJ][\d_]*|[eE][+-]?\d+)?\b/g,'num'],
  ],
  javascript: [
    [/\b(async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|with|yield)\b/g,'kw'],
    [/\b(Array|Boolean|Date|Error|Function|JSON|Map|Math|Number|Object|Promise|Proxy|RegExp|Set|String|Symbol|WeakMap|WeakSet|console|document|globalThis|module|process|require|window|Infinity|NaN)\b/g,'bi'],
    [/\b(0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*([eE][+-]?\d+)?)\b/g,'num'],
  ],
  html: [
    [/(&lt;\/?)([\w][\w-]*)/g, (_, b, t) => `${b}<span class="hl-tag">${t}</span>`],
    [/([\w-]+)(?==)/g,'at'],
    [/(&amp;[\w#\d]+;)/g,'num'],
  ],
  css: [
    [/\.([\w-]+)/g,'dc'], [/#[\w-]+(?=\s*[\{,\s])/g,'dc'],
    [/([\w-]+)\s*(?=:(?!:))/g,'kw'],
    [/#[0-9a-fA-F]{3,8}\b/g,'num'],
    [/\b\d+\.?\d*(px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cm|mm|pt|pc|fr|s|ms|deg|rad|turn)\b/g,'num'],
    [/\b(var|calc|rgb|rgba|hsl|hsla|linear-gradient|radial-gradient|url|env|min|max|clamp)\b/g,'bi'],
  ],
  json: [
    [/\b(true|false|null)\b/g,'kw'],
    [/-?\b\d+\.?\d*([eE][+-]?\d+)?\b/g,'num'],
  ],
  sql: [
    [/\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AS|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|DEFAULT|NOT|NULL|AND|OR|IN|LIKE|BETWEEN|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|DISTINCT|COUNT|SUM|AVG|MAX|MIN|CASE|WHEN|THEN|ELSE|END|EXISTS|UNION|ALL|WITH|VIEW|RETURNS|BEGIN|COMMIT|ROLLBACK)\b/gi,
      m => `<span class="hl-kw">${m.toUpperCase()}</span>`],
    [/\b\d+\.?\d*\b/g,'num'],
  ],
  bash: [
    [/\b(if|then|else|elif|fi|for|while|until|do|done|case|esac|function|in|return|exit|break|continue|export|local|readonly|source|echo|printf|read|true|false|test)\b/g,'kw'],
    [/\b(ls|cd|pwd|cat|grep|find|sed|awk|cut|sort|uniq|wc|head|tail|mv|cp|rm|mkdir|rmdir|touch|chmod|chown|curl|wget|git|ssh|tar|zip|unzip|python|python3|pip|node|npm)\b/g,'bi'],
    [/\$\{?[\w@*#?$!0-9-]+\}?/g,'dc'],
    [/\b\d+\b/g,'num'],
  ],
  cpp: [
    [/\b(auto|bool|break|case|catch|char|class|const|constexpr|continue|default|delete|do|double|else|enum|explicit|extern|false|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|noexcept|nullptr|operator|private|protected|public|return|short|signed|sizeof|static|struct|switch|template|this|throw|true|try|typedef|typename|union|unsigned|using|virtual|void|volatile|while|override|final)\b/g,'kw'],
    [/\b(std|string|vector|map|set|list|queue|stack|pair|array|cout|cin|cerr|endl|size_t|nullptr|int8_t|int16_t|int32_t|int64_t|uint32_t|uint64_t)\b/g,'bi'],
    [/\b(0x[\da-fA-F]+[lLuU]*|\d+\.?\d*[fFlLuU]*)\b/g,'num'],
  ],
  rust: [
    [/\b(as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\b/g,'kw'],
    [/\b(bool|char|f32|f64|i8|i16|i32|i64|i128|isize|str|u8|u16|u32|u64|u128|usize|String|Vec|Option|Result|Box|Rc|Arc|HashMap|HashSet|println|print|format|panic|assert|unreachable|todo)\b/g,'bi'],
    [/'[a-zA-Z_]\w*/g,'dc'], [/#\[[\s\S]*?\]/g,'dc'],
    [/\b\d[\d_]*\.?[\d_]*([eE][+-]?[\d_]+)?(_[a-z0-9]+)?\b/g,'num'],
  ],
  java: [
    [/\b(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|null|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|true|false|record|sealed|yield)\b/g,'kw'],
    [/\b(System|String|Integer|Double|Float|Long|Short|Boolean|Object|Class|Math|Arrays|Collections|ArrayList|HashMap|HashSet|Optional|List|Map|Set|Thread|Exception)\b/g,'bi'],
    [/@\w+/g,'dc'],
    [/\b\d+\.?\d*[fFdDlL]?\b/g,'num'],
  ],
};

function _highlight(raw, langRaw) {
  const lang = _ALIAS[langRaw] || langRaw || '';
  const protected_ = _PROTECTED[lang] || [];
  const patterns   = _PATTERNS[lang]  || [];

  const tokens = [];
  let code = raw;

  // Step 1 — extract protected tokens (strings, comments)
  for (const [re, cls] of protected_) {
    code = code.replace(re, m => {
      tokens.push(`<span class="hl-${cls}">${_esc(m)}</span>`);
      return `\x00T${tokens.length - 1}\x00`;
    });
  }

  // Step 2 — HTML-escape remaining text
  code = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Step 3 — apply inline patterns
  for (const [re, clsOrFn] of patterns) {
    if (typeof clsOrFn === 'function') {
      code = code.replace(re, clsOrFn);
    } else {
      code = code.replace(re, m => `<span class="hl-${clsOrFn}">${m}</span>`);
    }
  }

  // Step 4 — restore protected tokens
  code = code.replace(/\x00T(\d+)\x00/g, (_, i) => tokens[i]);
  return code;
}

function _buildCodeBlock(code, lang) {
  const normLang    = _ALIAS[lang] || lang || '';
  const highlighted = _highlight(code, normLang);
  const lineCount   = (code.match(/\n/g) || []).length + 1;
  const lineNums    = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  const encoded     = encodeURIComponent(code);
  const dispLang    = lang || 'code';

  return `<div class="md-code-block" data-raw="${encoded}">` +
    `<div class="cb-head">` +
      `<span class="cb-lang">${_esc(dispLang)}</span>` +
      `<button class="cb-copy">Copy</button>` +
    `</div>` +
    `<div class="cb-body">` +
      `<div class="cb-nums" aria-hidden="true">${lineNums}</div>` +
      `<pre class="cb-pre"><code>${highlighted}</code></pre>` +
    `</div>` +
  `</div>`;
}

// ── Code snippet panel ────────────────────────────────────────

function _toggleCodePanel() {
  const panel = document.getElementById('chat-code-panel');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  if (!isOpen) document.getElementById('chat-code-input').focus();
}

function _sendCodeSnippet() {
  const ta   = document.getElementById('chat-code-input');
  const lang = document.getElementById('chat-code-lang').value;
  const code = ta.value;
  if (!code.trim()) return;

  sendChatMsg({
    type:        'chat:send',
    id:          _uuid(),
    text:        '```' + lang + '\n' + code + '\n```',
    reply_to_id: _replyTo?.id ?? null,
  });

  ta.value = '';
  ta.style.height = '';
  document.getElementById('chat-code-panel').classList.add('hidden');
  clearReply();
}

// ── Markdown renderer ─────────────────────────────────────────

function _md(raw) {
  if (!raw) return '';

  // Extract fenced code blocks — render as rich highlighted blocks
  const codeBlocks = [];
  let s = raw.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(_buildCodeBlock(code.trimEnd(), lang));
    return `\x00B${codeBlocks.length - 1}\x00`;
  });

  // Extract inline code
  const inlineCodes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(`<code class="md-code">${_esc(code)}</code>`);
    return `\x00I${inlineCodes.length - 1}\x00`;
  });

  // HTML-escape remaining text
  s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Inline formatting
  s = s.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/gs,     '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/gs,          '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g,       '<em>$1</em>');
  s = s.replace(/_([^_\n]+)_/g,         '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/gs,          '<del>$1</del>');

  // Named links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, url) =>
    `<a href="${url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener noreferrer">${text}</a>`);

  // Auto-links (bare URLs — after escaping & is &amp; in query strings)
  s = s.replace(/(https?:\/\/[^\s<>"]+(?:&amp;[^\s<>"]+)*)/g, url =>
    `<a href="${url.replace(/&amp;/g,'&')}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  // Block elements (operate per-line)
  s = s.replace(/^&gt; (.+)$/gm,  '<blockquote class="md-bq">$1</blockquote>');
  s = s.replace(/^### (.+)$/gm,   '<span class="md-h3">$1</span>');
  s = s.replace(/^## (.+)$/gm,    '<span class="md-h2">$1</span>');
  s = s.replace(/^# (.+)$/gm,     '<span class="md-h1">$1</span>');
  s = s.replace(/^[*-] (.+)$/gm,  '<span class="md-li">•&nbsp;$1</span>');

  // Newlines → <br>
  s = s.replace(/\n/g, '<br>');

  // Restore stored elements
  s = s.replace(/\x00B(\d+)\x00/g, (_, i) => codeBlocks[i]);
  s = s.replace(/\x00I(\d+)\x00/g, (_, i) => inlineCodes[i]);

  return s;
}

// ── Helpers ───────────────────────────────────────────────────

function _scrollToBottom() {
  const list = document.getElementById('chat-messages');
  list.scrollTop = list.scrollHeight;
}

function _isAtBottom() {
  const list = document.getElementById('chat-messages');
  return list.scrollHeight - list.scrollTop - list.clientHeight < 60;
}

function _updateUnreadBadge() {
  const badge = document.getElementById('chat-unread-badge');
  if (!badge) return;
  badge.textContent  = _unread > 99 ? '99+' : _unread;
  badge.style.display = _unread ? 'flex' : 'none';
}

function _autoResize(e) {
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function _fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function _fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _uuid() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}
