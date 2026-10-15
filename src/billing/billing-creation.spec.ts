import 'reflect-metadata';
import { validate } from 'class-validator';
import { BillingActivation } from './billing-activation';
import { CreateOwnerContractDto } from './dto/create-owner-contract.dto';
import * as bcrypt from 'bcryptjs';

describe('Owner first contract', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const priorOwner = process.env.PLATFORM_OWNER_USER_ID, priorEnabled = process.env.BILLING_CALENDAR_ENABLED;
  let prisma: any, asaas: any, service: BillingActivation, actor: any, tenant: any;
  const dto = () => ({ cpfCnpj: '12345678909', email: 'financeiro@example.com', currentPassword: 'password',
    confirmation: 'CREATE_CONTRACT', expectedPlanId: planId, expectedPriceCents: 9900, expectedStartMonth: '2026-11' });
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(new Date('2026-10-15T01:00:00Z'));
    process.env.PLATFORM_OWNER_USER_ID = owner; process.env.BILLING_CALENDAR_ENABLED = 'true';
    actor = { id: owner, role: 'ADMIN', passwordHash: bcrypt.hashSync('password', 4), tokenVersion: 1 };
    tenant = { id: 'tenant', name: 'Empresa', status: 'SUSPENDED', planId, plan: { name: 'Starter', priceCents: 9900 }, subscription: null };
    prisma = { user: { findUnique: jest.fn().mockImplementation(() => actor) },
      tenant: { findUnique: jest.fn().mockImplementation(() => tenant), update: jest.fn() },
      subscription: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'contract' }) },
      auditEvent: { create: jest.fn() }, $queryRaw: jest.fn() };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    asaas = { createCustomer: jest.fn().mockResolvedValue({ id: 'cus' }), createCalendarPayment: jest.fn(), createSubscription: jest.fn() };
    service = new BillingActivation(prisma, asaas);

  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  afterAll(() => {
    if (priorOwner === undefined) delete process.env.PLATFORM_OWNER_USER_ID; else process.env.PLATFORM_OWNER_USER_ID = priorOwner;
    if (priorEnabled === undefined) delete process.env.BILLING_CALENDAR_ENABLED; else process.env.BILLING_CALENDAR_ENABLED = priorEnabled;
  });
  it('previews server price and next month without modifying anything', async () => {
    expect(await service.previewCreation('tenant', owner)).toMatchObject({ priceCents: 9900, firstIssueDate: '2026-11-01', firstDueDate: '2026-11-10' });
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it('creates an active scheduled contract, releases access and audits without issuing or marking payment paid', async () => {
    expect(await service.createContract('tenant', owner, dto())).toMatchObject({ subscriptionStatus: 'ACTIVE', invoiceUrl: null, firstDueDate: '2026-11-10' });
    expect(prisma.subscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant', status: 'ACTIVE', billingPriceCents: 9900, billingStartMonth: '2026-11', calendarEnabled: true }) });
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 'tenant' }, data: { status: 'ACTIVE' } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: { tenantId: 'tenant', actorId: owner, action: `billing.owner_created:${planId}:9900:2026-11` } });
    expect(asaas.createCalendarPayment).not.toHaveBeenCalled(); expect(asaas.createSubscription).not.toHaveBeenCalled();
  });
  it('rejects other administrators, wrong password and wrong confirmation before remote effects', async () => {
    await expect(service.createContract('tenant', owner, { ...dto(), currentPassword: 'wrong' })).rejects.toThrow();
    await expect(service.createContract('tenant', owner, { ...dto(), confirmation: 'ACTIVATE' })).rejects.toThrow();
    actor.id = 'other';
    await expect(service.createContract('tenant', 'other', dto())).rejects.toThrow();
    await expect(service.previewCreation('tenant', 'other')).rejects.toThrow();
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it('rejects revoked session under lock', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ ...actor }).mockResolvedValueOnce({ ...actor, tokenVersion: 2 });
    await expect(service.createContract('tenant', owner, dto())).rejects.toThrow('Entre novamente');
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it('rejects any existing subscription including canceled ones before creating another customer', async () => {
    for (const status of ['ACTIVE', 'CANCELED', 'PENDING', 'OVERDUE']) {
      prisma.subscription.findUnique.mockResolvedValue({ status });
      await expect(service.createContract('tenant', owner, dto())).rejects.toThrow('ja possui contrato');
    }
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it('rejects disabled scheduler, missing tenant and invalid price without remote calls', async () => {
    process.env.BILLING_CALENDAR_ENABLED = 'false';
    await expect(service.createContract('tenant', owner, dto())).rejects.toThrow('calendario');
    process.env.BILLING_CALENDAR_ENABLED = 'true'; tenant.plan.priceCents = 0;
    await expect(service.createContract('tenant', owner, dto())).rejects.toThrow('valor valido');
    tenant = null; await expect(service.createContract('tenant', owner, dto())).rejects.toThrow('nao encontrada');
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it('requires renewed consent after price, plan or start month changes', async () => {
    for (const patch of [{ expectedPriceCents: 9990 }, { expectedPlanId: owner }, { expectedStartMonth: '2026-10' }]) {
      await expect(service.createContract('tenant', owner, { ...dto(), ...patch })).rejects.toThrow('mudou');
    }
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it('remote error or incomplete response does not activate locally', async () => {
    asaas.createCustomer.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({});
    await expect(service.createContract('tenant', owner, dto())).rejects.toThrow('timeout');
    await expect(service.createContract('tenant', owner, dto())).rejects.toThrow('nao confirmado');
    expect(prisma.subscription.create).not.toHaveBeenCalled(); expect(prisma.tenant.update).not.toHaveBeenCalled();
  });
  it('DTO rejects malformed documents, missing billing email, and injected fields', async () => {
    expect(await validate(Object.assign(new CreateOwnerContractDto(), dto()), { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    for (const patch of [{ cpfCnpj: '123456789012' }, { cpfCnpj: 'abcdefghijk' }, { email: '' }, { expectedPriceCents: 9900.5 }, { status: 'PAID' }]) {
      expect((await validate(Object.assign(new CreateOwnerContractDto(), dto(), patch), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    }
  });
});
