/** Shared mutable client state.
 *
 *  Every module imports this object and mutates it in place.
 *  Using a single object (not individual exports) means all modules always
 *  see the latest values without re-importing.
 */

import { JOIN_PARAM } from './config.js';

export const state = {
  // Identity
  myName:       localStorage.getItem('pystream_name') || '',
  myRole:       'guest',   // 'guest' | 'host'
  myAdminToken: '',        // set after successful admin login
  myJoinToken:  JOIN_PARAM || '',

  // Stream
  monitors:    [],
  wsMap:       {},         // 'single' | 'grid-<id>' -> WebSocket
  currentMode: 'single',

  // Viewer UI
  zoom:   1.0,
  paused: false,

  // Live viewer list — written by viewers.js, read by sidebar.js
  viewerList: [],

  // Screen access (admin only — mirrors server state)
  privateMode:        false,
  screenPermissions:  {},  // monitor_id -> "all"|"private"|{viewer_ids:[...]}
};
