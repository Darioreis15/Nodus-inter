import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request = require('supertest');
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { configureHttp } from '../security/bootstrap';
import { seal, unseal } from '../security/secrets';
import { MetaConnector } from './connectors/meta.connector';
import { metaRequest } from './connectors/meta-api';

// Exercise real JWT/role guards, tenant ownership, DTO validation and encryption.
describe('Meta token rotation HTTP', () => {
  let app: NestExpressApplication;
  let token: string;
  let role = 'ADMIN';
  let channel: any;
  let fetchMock: jest.SpyInstance;
  const previous = { ...process.env };
  const update = jest.fn();
  const prisma: any = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn((fn: any) => fn(prisma)),
    user: { findFirst: jest.fn(async () => ({ role, tokenVersion: 0, mustChangePassword: false })) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    rateBucket: { upsert: jest.fn().mockResolvedValue({ hits: 1 }) },
    channel: { findFirst: jest.fn(async ({ where }: any) => channel?.tenantId === where.tenantId ? channel : null), update },
  };
  beforeAll(async () => {
    process.env.META_APP_SECRET = 'test-only-meta-secret';
    process.env.EVOLUTION_WEBHOOK_TOKEN = 'test-only-evolution-token';
    process.env.ASAAS_WEBHOOK_TOKEN = 'test-only-asaas-token';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    token = module.get(JwtService).sign({ sub: 'admin', tenantId: 'tenant-a', ver: 0 });
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    configureHttp(app);
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    role = 'ADMIN';
    channel = { id: 'channel', tenantId: 'tenant-a', type: 'OFFICIAL_META', externalId: '123',
      config: { phoneNumberId: '123', wabaId: '456', accessToken: seal('old-secret', 'meta:123') } };
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: '123' }) } as any);
    update.mockResolvedValue({ id: 'channel' });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); process.env = previous; });
  const patch = (body: any = { accessToken: 'new-secret' }) => request(app.getHttpServer())
    .patch('/channels/channel/meta-token').auth(token, { type: 'bearer' }).send(body);

  it('requires authentication', async () => {
    await request(app.getHttpServer()).patch('/channels/channel/meta-token').send({ accessToken: 'secret' }).expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects agents before provider access', async () => {
    role = 'AGENT';
    await patch().expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects another tenant channel', async () => {
    channel.tenantId = 'tenant-b';
    await patch().expect(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects Evolution channels', async () => {
    channel.type = 'QR_EVOLUTION';
    await patch().expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{}, { accessToken: '' }, { accessToken: 'Bearer secret' }, { accessToken: 'x'.repeat(4097) },
    { accessToken: 'new-secret', phoneNumberId: 'attacker' }])('rejects invalid body %#', async body => {
    await patch(body).expect(400);
    expect(update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('validates, encrypts and preserves channel identity and other configuration', async () => {
    const res = await patch().expect(200);
    expect(res.body).toEqual({ id: 'channel', tokenUpdated: true });
    expect(res.headers['cache-control']).toBe('no-store');
    const args = update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'channel', tenantId: 'tenant-a' });
    expect(Object.keys(args.data)).toEqual(['config']);
    expect(args.data.config).toMatchObject({ phoneNumberId: '123', wabaId: '456' });
    expect(unseal(args.data.config.accessToken, 'meta:123')).toBe('new-secret');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
    await new MetaConnector().sendText({ ...channel, config: args.data.config }, { to: '5511999999999', text: 'test' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.facebook.com/v25.0/123/messages');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new-secret');
  });
  it('keeps old credentials if Meta rejects and never echoes provider secrets', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: {
      code: 190, error_subcode: 463, message: 'new-secret', error_data: { details: 'old-secret' },
    } }) });
    const res = await patch().expect(502);
    expect(res.body).toMatchObject({ provider: 'META', providerStatus: 401, providerCode: 190, providerSubcode: 463 });
    expect(JSON.stringify(res.body)).not.toMatch(/new-secret|old-secret/);
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps old credentials when identity does not match', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'other' }) });
    await patch().expect(502);
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps old credentials on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('sensitive-provider-details'));
    const res = await patch().expect(502);
    expect(JSON.stringify(res.body)).not.toContain('sensitive-provider-details');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('Meta error diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());
  it('reports numeric country restriction without raw provider data', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403,
      json: async () => ({ error: { code: 130497, message: 'private payload' } }) } as any);
    try { await metaRequest('123/messages', 'secret', {}); throw new Error('expected rejection'); }
    catch (error: any) {
      expect(error.getResponse()).toMatchObject({ providerCode: 130497, providerStatus: 403 });
      expect(JSON.stringify(error.getResponse())).not.toContain('private payload');
    }
  });
  it('handles non-JSON provider failures', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 502,
      json: async () => { throw new Error('secret'); } } as any);
    await expect(metaRequest('123', 'secret')).rejects.toThrow('Falha informada pela Meta');
  });
  it('does not invent a message id for malformed successful responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as any);
    await expect(new MetaConnector().sendText({ config: {
      phoneNumberId: '123', accessToken: seal('secret', 'meta:123'),
    } } as any, { to: '5511999999999', text: 'test' })).rejects.toThrow('sem identificador');
  });
});
