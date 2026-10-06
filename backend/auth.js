const crypto = require('node:crypto');
const { httpError } = require('./errors.js');
function createAuth({ port, token }) {
  const apiToken = token;
  const apiSessionCookie = 'lai_session';
  function tokenMatches(candidate = '') {
    const supplied = Buffer.from(String(candidate || ''));
    const expected = Buffer.from(apiToken);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }

  function cookieValue(req, name) {
    const cookies = String(req.headers.cookie || '').split(';');
    for (const item of cookies) {
      const separator = item.indexOf('=');
      if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
      try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch (_) { return ''; }
    }
    return '';
  }

  function requestToken(req) {
    const headerToken = String(req.headers['x-trade-token'] || '').trim();
    if (headerToken) return headerToken;
    const authorization = String(req.headers.authorization || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
    return cookieValue(req, apiSessionCookie);
  }

  function requestIsAuthorized(req) {
    return tokenMatches(requestToken(req));
  }

  function requestIsLoopback(req) {
    const address = String(req.socket?.remoteAddress || '').toLowerCase();
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  }

  function validateHost(req) {
    if (!requestIsLoopback(req)) throw httpError(403, 'loopback access only');
    const host = String(req.headers.host || '').toLowerCase();
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowed.has(host)) throw httpError(421, 'unsupported host');
  }

  function validateOrigin(req) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return;
    const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    if (!allowed.has(origin.toLowerCase())) throw httpError(403, 'cross-origin request rejected');
  }

  function sessionCookieHeader() {
    return `${apiSessionCookie}=${encodeURIComponent(apiToken)}; HttpOnly; SameSite=Strict; Path=/`;
  }

  return { matches: tokenMatches, authorized: requestIsAuthorized, validateHost, validateOrigin, cookie: sessionCookieHeader };
}
module.exports = { createAuth };
