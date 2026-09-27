import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request = require('supertest');
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { configureHttp } from '../security/bootstrap';

describe('Proxy diagnostics HTTP access', () => {
  let app: NestExpressApplication;
  let token: string;
  let role = 'ADMIN';
  const previous = { ...process.env };
  const rateBucket = { upsert: jest.fn().mockResolvedValue({ hits: 1 }) };

  beforeAll(async () => {
    process.env.META_APP_SECRET = 'test-only-meta-secret';
    process.env.EVOLUTION_WEBHOOK_TOKEN = 'test-only-evolution-token';
    process.env.ASAAS_WEBHOOK_TOKEN = 'test-only-asaas-token';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    delete process.env.TRUSTED_PROXY_CIDRS;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({
        user: { findFirst: jest.fn(async () => ({ role, tokenVersion: 0, mustChangePassword: false })) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
        rateBucket,
      }).compile();
    token = module.get(JwtService).sign({ sub: 'test-admin', tenantId: 'test-tenant', ver: 0 });
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttp(app);
    await app.init();
  });
  beforeEach(() => { role = 'ADMIN'; process.env.ENABLE_PROXY_DIAGNOSTICS = 'true'; });
  afterAll(async () => { await app?.close(); process.env = previous; });
  const get = () => request(app.getHttpServer()).get('/auth/proxy-diagnostics');

  it('requires a valid JWT', async () => {
    await get().expect(401);
    await get().auth('invalid-token', { type: 'bearer' }).expect(401);
  });
  it('rejects an authenticated agent using the current database role', async () => {
    role = 'AGENT';
    await get().auth(token, { type: 'bearer' }).expect(403);
  });
  it.each([undefined, 'false', 'TRUE'])('is disabled for flag %s', async flag => {
    if (flag === undefined) delete process.env.ENABLE_PROXY_DIAGNOSTICS;
    else process.env.ENABLE_PROXY_DIAGNOSTICS = flag;
    await get().auth(token, { type: 'bearer' }).expect(404);
  });
  it('shows only diagnostic fields and does not trust a spoofed forwarding header', async () => {
    const res = await get().auth(token, { type: 'bearer' })
      .set('X-Forwarded-For', '203.0.113.123').set('Cookie', 'private=secret').expect(200);
    expect(res.body).toEqual({
      effectiveIp: expect.any(String), socketIp: expect.any(String),
      forwardedFor: '203.0.113.123', forwardedForTruncated: false,
      trustedChain: [], trustedChainTruncated: false,
    });
    expect(res.body.effectiveIp).toBe(res.body.socketIp);
    expect(res.body.effectiveIp).not.toBe('203.0.113.123');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rateBucket.upsert).toHaveBeenCalled();
  });
  it('bounds attacker-controlled header output', async () => {
    const res = await get().auth(token, { type: 'bearer' })
      .set('X-Forwarded-For', 'a'.repeat(2000)).expect(200);
    expect(res.body.forwardedFor).toHaveLength(1024);
    expect(res.body.forwardedForTruncated).toBe(true);
  });
});
