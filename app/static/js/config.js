/** Immutable boot-time constants. Import these everywhere instead of
 *  reading localStorage / location directly in each module. */

export const SESSION_ID = (() => {
  let sid = localStorage.getItem('pystream_sid');
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem('pystream_sid', sid);
  }
  return sid;
})();

const _p = new URLSearchParams(location.search);

/** URL ?host=<username>  →  admin login flow */
export const HOST_PARAM = _p.get('host');

/** URL ?join=<token>     →  student join flow */
export const JOIN_PARAM = _p.get('join');
