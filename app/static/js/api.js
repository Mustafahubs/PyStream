/** All fetch() calls to the PyStream backend.
 *
 *  Functions return the parsed JSON response or throw on network error.
 *  Admin endpoints automatically attach the X-Admin-Token header.
 */

import { state } from './state.js';

const _json = (body) => ({
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify(body),
});

const _adminJson = (body) => ({
  ..._json(body),
  headers: {
    'Content-Type':  'application/json',
    'X-Admin-Token': state.myAdminToken,
  },
});

// ── Public ────────────────────────────────────────────────────

export const getStatus   = ()  => fetch('/api/status').then(r => r.json());
export const getMonitors = ()  => fetch('/api/monitors').then(r => r.json());

// ── Admin auth ────────────────────────────────────────────────

export const adminLogin = (username, password) =>
  fetch('/api/admin/login', _json({ username, password })).then(r => r.json());

export const adminVerify = (token) =>
  fetch('/api/admin/verify', _json({ token })).then(r => r.json());

export const adminLogout = () =>
  fetch('/api/admin/logout', { method: 'POST', headers: { 'X-Admin-Token': state.myAdminToken } })
    .then(r => r.json());

// ── Admin settings ────────────────────────────────────────────

export const updateDisplayName = (display_name) =>
  fetch('/api/admin/display-name', _adminJson({ display_name })).then(r => r.json());

export const changePassword = (new_password) =>
  fetch('/api/admin/password', _adminJson({ new_password })).then(r => r.json());

export const updateSettings = (data) =>
  fetch('/api/settings', _adminJson(data)).then(r => r.json());

// ── Session management ────────────────────────────────────────

export const newSession = (name) =>
  fetch('/api/session/new', _adminJson({ name })).then(r => r.json());

// ── Kick ─────────────────────────────────────────────────────

export const kickViewer = (viewer_id) =>
  fetch('/api/session/kick', _adminJson({ viewer_id })).then(r => r.json());

// ── Screen access control ─────────────────────────────────────

export const getPermissions = () =>
  fetch('/api/screen/permissions', {
    headers: { 'X-Admin-Token': state.myAdminToken },
  }).then(r => r.json());

export const setMonitorPermission = (monitor_id, access, viewer_ids = []) =>
  fetch('/api/screen/permissions', _adminJson({ monitor_id, access, viewer_ids })).then(r => r.json());

export const setPrivateMode = (enabled) =>
  fetch('/api/screen/private', _adminJson({ enabled })).then(r => r.json());

// ── Chat ──────────────────────────────────────────────────────

export function uploadChatFile(file) {
  const headers = { 'X-Filename': encodeURIComponent(file.name) };
  if (state.myAdminToken)  headers['X-Admin-Token']  = state.myAdminToken;
  if (state.myJoinToken)   headers['X-Join-Token']   = state.myJoinToken;
  return fetch('/api/chat/upload', { method: 'POST', headers, body: file }).then(r => r.json());
}

export const getLinkPreview = (url) =>
  fetch(`/api/chat/link-preview?url=${encodeURIComponent(url)}`).then(r => r.json());
