import { RateGuard } from '../../security/rate.guard';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import request = require('supertest');
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { ApiKeyGuard } from '../../public-api/guards/api-key.guard';
import { BillingController } from '../../billing/billing.controller';
import { BillingService } from '../../billing/billing.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('test-operations')
class OperationsController {
  @Get('jwt')
  @UseGuards(JwtAuthGuard)
  jwt() { return { ok: true }; }

  @Get('api-key')
  @UseGuards(ApiKeyGuard)
  apiKey() { return { ok: true }; }
}

describe('Acesso HTTP de tenants suspensos', () => {
  let app: INestApplication;
  let token: string;
  let status: string | null;
  const prisma = { user: { findFirst: jest.fn() }, tenant: { findUnique: jest.fn() } };
  const apiKeys = { resolveTenantId: jest.fn() };
  const billing = { getStatus: jest.fn(), subscribe: jest.fn() };
  const secret = process.env.JWT_SECRET!;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OperationsController, BillingController],
      providers: [
        JwtStrategy,
        { provide: RateGuard, useValue: { consume: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: ApiKeysService, useValue: apiKeys },
        { provide: BillingService, useValue: billing },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
    token = new JwtService({ secret }).sign({
      ver: 0, sub: 'user-1', tenantId: 'tenant-1', role: 'ADMIN', email: 'test@example.com',
    }, { expiresIn: '1h', issuer: 'nodus', audience: 'nodus-api' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    status = 'ACTIVE';
    prisma.user.findFirst.mockResolvedValue({ tokenVersion: 0, role: 'ADMIN', email: 'test@example.com', mustChangePassword: false });
    prisma.tenant.findUnique.mockImplementation(async () => status ? { status } : null);
    apiKeys.resolveTenantId.mockImplementation(async (key: string) => key === 'valid-key' ? 'tenant-1' : null);
    billing.getStatus.mockImplementation(async () => ({ tenantStatus: status }));
  });
  afterAll(async () => { await app.close(); });

  it('bloqueia JWT ja emitido ao suspender e libera o mesmo JWT ao reativar', async () => {
    const call = () => request(app.getHttpServer()).get('/test-operations/jwt').auth(token, { type: 'bearer' });
    await call().expect(200);
    status = 'SUSPENDED';
    const response = await call().expect(403);
    expect(response.body.code).toBe('TENANT_SUSPENDED');
    status = 'ACTIVE';
    await call().expect(200);
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 'tenant-1' }, select: { status: true } });
  });

  it('aplica a mesma suspensao e reativacao a chaves de API', async () => {
    const call = () => request(app.getHttpServer()).get('/test-operations/api-key').auth('valid-key', { type: 'bearer' });
    await call().expect(200);
    status = 'SUSPENDED';
    await call().expect(403);
    status = 'ACTIVE';
    await call().expect(200);
  });

  it('permite somente consultar billing durante suspensao, sem criar assinatura', async () => {
    status = 'SUSPENDED';
    await request(app.getHttpServer()).get('/billing/status').auth(token, { type: 'bearer' })
      .expect(200, { tenantStatus: 'SUSPENDED' });
    await request(app.getHttpServer()).post('/billing/subscribe').auth(token, { type: 'bearer' })
      .send({ cpfCnpj: '12345678909' }).expect(403);
    expect(billing.subscribe).not.toHaveBeenCalled();
  });

  it('a excecao de billing nao permite JWT ausente, invalido ou expirado', async () => {
    await request(app.getHttpServer()).get('/billing/status').expect(401);
    for (const invalid of ['invalid', new JwtService({ secret }).sign({ tenantId: 'tenant-1' }, { expiresIn: -1 })]) {
      await request(app.getHttpServer()).get('/billing/status').auth(invalid, { type: 'bearer' }).expect(401);
    }
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(billing.getStatus).not.toHaveBeenCalled();
  });

  it('rejeita chave de API invalida antes de consultar tenant', async () => {
    await request(app.getHttpServer()).get('/test-operations/api-key').auth('bad-key', { type: 'bearer' }).expect(401);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('rejeita tenant removido mesmo em billing', async () => {
    status = null;
    await request(app.getHttpServer()).get('/billing/status').auth(token, { type: 'bearer' }).expect(401);
    expect(billing.getStatus).not.toHaveBeenCalled();
  });

  it('nao libera operacoes quando o banco falha', async () => {
    prisma.tenant.findUnique.mockRejectedValueOnce(new Error('Database unavailable'));
    await request(app.getHttpServer()).get('/test-operations/jwt').auth(token, { type: 'bearer' }).expect(500);
  });
});
