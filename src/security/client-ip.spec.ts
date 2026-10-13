import { resolveClientIp, clientIpSource } from './client-ip';
import { validateSecurityConfig } from './config';

const req = (value?: unknown) => ({ ip: '192.0.2.9', socket: { remoteAddress: '::1' },
  headers: { 'true-client-ip': value, 'x-forwarded-for': '192.0.2.10', 'cf-connecting-ip': '192.0.2.11' },
  rawHeaders: value === undefined ? [] : ['True-Client-IP', value] } as any);

describe('Client IP trust mode', () => {
  const previous = { ...process.env };
  beforeEach(() => { process.env.CLIENT_IP_SOURCE = 'render-true-client-ip'; });
  afterEach(() => { process.env = { ...previous }; });
  it('requires explicit opt-in and rejects unknown modes', () => {
    delete process.env.CLIENT_IP_SOURCE;
    expect(resolveClientIp(req('203.0.113.1'))).toEqual({ ip: '192.0.2.9', source: 'express' });
    process.env.CLIENT_IP_SOURCE = 'true';
    expect(clientIpSource).toThrow('CLIENT_IP_SOURCE');
  });
  it.each([undefined, '', 'garbage', '1.2.3.4, 5.6.7.8', ['1.2.3.4'], '1.2.3.4:80', 'fe80::1%eth0', 'a'.repeat(129), ' 1.2.3.4'])('falls back to socket for %p', value => {
    expect(resolveClientIp(req(value))).toEqual({ ip: '::1', source: 'socket-fallback' });
  });
  it('rejects duplicate occurrences even when normalized headers hide duplication', () => {
    const r = req('1.2.3.4'); r.rawHeaders.push('true-client-ip', '1.2.3.4');
    expect(resolveClientIp(r).source).toBe('socket-fallback');
  });
  it('canonicalizes mapped IPv4 and equivalent IPv6', () => {
    expect(resolveClientIp(req('::ffff:203.0.113.1')).ip).toBe('203.0.113.1');
    expect(resolveClientIp(req('2001:0db8:0:0:0:0:0:1')).ip).toBe(resolveClientIp(req('2001:db8::1')).ip);
  });
  it('rejects conflicting proxy configuration at startup', () => {
    Object.assign(process.env, { META_APP_SECRET: 'test-only-meta-secret', EVOLUTION_WEBHOOK_TOKEN: 'test-only-evolution-token', ASAAS_WEBHOOK_TOKEN: 'test-only-asaas-token', CORS_ORIGINS: 'https://app.example.com', TRUSTED_PROXY_CIDRS: 'true' });
    expect(validateSecurityConfig).toThrow('TRUSTED_PROXY_CIDRS');
  });
});
