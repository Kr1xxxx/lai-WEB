'use strict';
// Permit only explicit IPv4 loopback connections for isolated fake servers.
// Fail closed for DNS names, external IPs, TLS, fetch, and Unix sockets.
const net = require('node:net');
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = first && typeof first === 'object' ? first.host : args[1];
  if (host !== '127.0.0.1') throw new Error('Deep mail review permits only explicit 127.0.0.1 connections');
  return originalConnect.apply(this, args);
};
require('node:tls').connect = () => { throw new Error('TLS network access is disabled for this review'); };
globalThis.fetch = () => { throw new Error('External fetch is disabled for this review'); };
