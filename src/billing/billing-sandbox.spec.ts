import { BillingSandbox } from './billing-sandbox';
import { saoPauloDate } from './billing-calendar';
import { sandboxBillingAvailable } from './sandbox-config';
import * as bcrypt from 'bcryptjs';

describe('Owner sandbox billing', () => {
  const env = process.env;
  const actorId = '00000000-0000-4000-8000-000000000001';
  let prisma: any, asaas: any, delivery: any, service: BillingSandbox, sub: any, cycles: any[], rows: any[], dto: any;
  beforeEach(() => {
    process.env = { ...env, PLATFORM_OWNER_USER_ID: actorId, ASAAS_BASE_URL: 'https://api-sandbox.asaas.com/v3', BILLING_SANDBOX_TEST_ENABLED: 'true', BILLING_DELIVERY_ENABLED: 'true', RESEND_API_KEY: 'test', MAIL_FROM: 'test@example.com' };
    cycles = []; rows = [];
    sub = { id: 'sub', tenantId: 'tenant', asaasCustomerId: 'cus', status: 'ACTIVE', deliveryEnabled: true, deliverySettings: { emailEnabled: true, email: 'test@example.com' } };
    const actor = { id: actorId, role: 'ADMIN', passwordHash: bcrypt.hashSync('correct', 4), tokenVersion: 1, mustChangePassword: false };
    prisma = {
      user: { findUnique: jest.fn(async () => actor) },
      subscription: { findUnique: jest.fn(async () => sub), findUniqueOrThrow: jest.fn(async () => sub) },
      billingCycle: {
        findUnique: jest.fn(async ({ where }) => cycles.find(c => c.month === where.subscriptionId_month.month)),
        findFirst: jest.fn(async () => cycles.find(c => c.state === 'SENDING')),
        create: jest.fn(async ({ data }) => { const c = { ...data, id: 'cycle', paymentId: null }; cycles.push(c); return c; }),
        update: jest.fn(async ({ where, data }) => Object.assign(cycles.find(c => c.id === where.id), data)),
        updateMany: jest.fn(async ({ where, data }) => { const found = cycles.filter(c => c.id === where.id && c.state === where.state); found.forEach(c => Object.assign(c, data)); return { count: found.length }; }),
      },
      billingDelivery: {
        createMany: jest.fn(async ({ data }) => { for (const row of data) if (!rows.some(r => r.cycleId === row.cycleId && r.kind === row.kind)) rows.push({ ...row, id: row.kind, error: row.error || null }); }),
        findUniqueOrThrow: jest.fn(async ({ where }) => rows.find(r => where.id ? r.id === where.id : r.cycleId === where.cycleId_kind.cycleId && r.kind === where.cycleId_kind.kind)),
      },
      auditEvent: { create: jest.fn() }, $queryRaw: jest.fn(), $transaction: jest.fn(async fn => fn(prisma)),
    };
    let payment: any;
    asaas = { createCalendarPayment: jest.fn(async input => payment = { ...input, id: 'pay', status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/test' }),
      getPayment: jest.fn(async () => payment), allPayments: jest.fn(async () => payment ? [payment] : []) };
    delivery = { process: jest.fn(async id => { const row = rows.find(r => r.id === id); if (row.state === 'QUEUED') row.state = 'SENT'; }) };
    service = new BillingSandbox(prisma, asaas, delivery);
    dto = { currentPassword: 'correct', confirmation: 'SANDBOX_EMAIL', date: saoPauloDate(), expectedEmail: 'test@example.com' };
  });
  afterEach(() => { process.env = env; });
  it.each(['https://api.asaas.com/v3', 'https://api-sandbox.asaas.com.evil.test/v3', '', 'http://api-sandbox.asaas.com/v3'])('rejects non-sandbox URL %s before any provider call', async url => {
    process.env.ASAAS_BASE_URL = url;
    expect(sandboxBillingAvailable()).toBe(false);
    await expect(service.issue('tenant', actorId, dto)).rejects.toMatchObject({ status: 403 });
    expect(asaas.createCalendarPayment).not.toHaveBeenCalled();
  });
  it('requires feature flag, owner, password and saved recipient', async () => {
    process.env.BILLING_SANDBOX_TEST_ENABLED = 'false'; await expect(service.issue('tenant', actorId, dto)).rejects.toThrow();
    process.env.BILLING_SANDBOX_TEST_ENABLED = 'true';
    await expect(service.issue('tenant', actorId, { ...dto, currentPassword: 'wrong' })).rejects.toThrow('Senha');
    await expect(service.issue('tenant', actorId, { ...dto, expectedEmail: 'other@example.com' })).rejects.toThrow('Salve');
    prisma.user.findUnique.mockResolvedValue({ id: 'other', role: 'ADMIN' });
    await expect(service.issue('tenant', actorId, dto)).rejects.toThrow();
    expect(asaas.createCalendarPayment).not.toHaveBeenCalled();
  });
  it('creates one isolated charge and email; repeated requests reuse them', async () => {
    const a = await service.issue('tenant', actorId, dto), b = await service.issue('tenant', actorId, dto);
    expect(a).toEqual(b); expect(a).toMatchObject({ test: true, valueCents: 500, emailState: 'SENT' });
    expect(asaas.createCalendarPayment).toHaveBeenCalledTimes(1);
    expect(cycles[0]).toMatchObject({ isTest: true, month: `test-${dto.date}`, state: 'CREATED' });
    expect(rows).toHaveLength(2); expect(rows.find(r => r.kind === 'WHATSAPP').state).toBe('SKIPPED');
    expect(sub.status).toBe('ACTIVE'); expect(sub.billingStartMonth).toBeUndefined();
  });
  it('does not repeat an uncertain POST; reconciles the exact payment later', async () => {
    asaas.createCalendarPayment.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.issue('tenant', actorId, dto)).rejects.toMatchObject({ status: 409 });
    await expect(service.issue('tenant', actorId, dto)).rejects.toMatchObject({ status: 409 });
    expect(asaas.createCalendarPayment).toHaveBeenCalledTimes(1); expect(delivery.process).not.toHaveBeenCalled();
    const c = cycles[0];
    asaas.allPayments.mockResolvedValue([{ id: 'pay', customer: 'cus', externalReference: `nodus:sub:${c.month}`, dueDate: c.dueDate, value: 5, status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/test' }]);
    expect(await service.issue('tenant', actorId, dto)).toMatchObject({ paymentId: 'pay', emailState: 'SENT' });
    expect(asaas.createCalendarPayment).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched payments and leaves them for reconciliation', async () => {
    asaas.createCalendarPayment.mockResolvedValue({ id: 'foreign', customer: 'other' });
    await expect(service.issue('tenant', actorId, dto)).rejects.toMatchObject({ status: 409 });
    expect(delivery.process).not.toHaveBeenCalled(); expect(cycles[0].error).toBe('RECONCILIATION_REQUIRED');
  });
  it('blocks canceled contracts, disabled delivery and stale new-test dates', async () => {
    sub.status = 'CANCELED'; await expect(service.issue('tenant', actorId, dto)).rejects.toThrow(); sub.status = 'ACTIVE';
    process.env.BILLING_DELIVERY_ENABLED = 'false'; await expect(service.issue('tenant', actorId, dto)).rejects.toThrow(); process.env.BILLING_DELIVERY_ENABLED = 'true';
    await expect(service.issue('tenant', actorId, { ...dto, date: '2000-01-01' })).rejects.toThrow('Atualize');
    expect(asaas.createCalendarPayment).not.toHaveBeenCalled();
  });
});
