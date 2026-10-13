import { isIP } from 'net';
import * as ipaddr from 'ipaddr.js';
import { Request } from 'express';

export function clientIpSource(): 'express' | 'render-true-client-ip' {
  const source = process.env.CLIENT_IP_SOURCE || 'express';
  if (source !== 'express' && source !== 'render-true-client-ip') {
    throw new Error('CLIENT_IP_SOURCE deve ser express ou render-true-client-ip.');
  }
  return source;
}

function normalize(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 45 || value.includes('%') || !isIP(value)) return null;
  return ipaddr.process(value).toString();
}

// Opt-in deployment trust: Render must overwrite this header on every public path.
// This does not authenticate private-network callers. Do not enable on an exposed origin.
export function resolveClientIp(req: Pick<Request, 'ip' | 'socket' | 'headers' | 'rawHeaders'>) {
  const socketIp = normalize(req.socket?.remoteAddress) || 'unknown';
  if (clientIpSource() === 'express') {
    return { ip: normalize(req.ip) || socketIp, source: 'express' };
  }
  const occurrences = (req.rawHeaders || []).filter((name, index) =>
    index % 2 === 0 && name.toLowerCase() === 'true-client-ip').length;
  const ip = occurrences === 1 ? normalize(req.headers?.['true-client-ip']) : null;
  // Missing/invalid/duplicate headers share the socket bucket: never use XFF or CF as fallback.
  return ip ? { ip, source: 'true-client-ip' } : { ip: socketIp, source: 'socket-fallback' };
}
