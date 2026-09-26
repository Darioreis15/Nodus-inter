import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  let prisma: any;
  let asaas: any;
  let service: BillingService;

  beforeEach(() => {
    prisma = {
      subscription: { findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    prisma.$queryRaw = jest.fn();
    prisma.auditEvent = { create: jest.fn() };
    prisma.providerEvent = { findUnique: jest.fn(), create: jest.fn() };
    asaas = {
      createCustomer: jest.fn(),
      createSubscription: jest.fn(),
      getSubscriptionPayments: jest.fn(),
    };
    service = new BillingService(prisma, asaas);
  });

  describe('subscribe', () => {
    it('rejeita se o tenant ja tiver assinatura', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });

      await expect(
        service.subscribe('tenant-1', { cpfCnpj: '12345678900' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(asaas.createCustomer).not.toHaveBeenCalled();
    });

    it.each([0, -1, NaN, Infinity, undefined, 99.5])(
      'rejeita preco invalido %s antes de comunicar com o Asaas',
      async (priceCents) => {
        prisma.tenant.findUniqueOrThrow.mockResolvedValue({
          name: 'Empresa Demo', plan: { name: 'Starter', priceCents },
        });
        await expect(service.subscribe('tenant-1', { cpfCnpj: '12345678900' }))
          .rejects.toBeInstanceOf(UnprocessableEntityException);
        expect(asaas.createCustomer).not.toHaveBeenCalled();
        expect(asaas.createSubscription).not.toHaveBeenCalled();
        expect(prisma.subscription.create).not.toHaveBeenCalled();
      },
    );

    it('cria cliente e assinatura no Asaas usando o preco do plano do tenant', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({
        id: 'tenant-1',
        name: 'Empresa Demo',
        plan: { name: 'Starter', priceCents: 9900 },
      });
      asaas.createCustomer.mockResolvedValue({ id: 'cus_123' });
      asaas.createSubscription.mockResolvedValue({ id: 'sub_asaas_123' });
      asaas.getSubscriptionPayments.mockResolvedValue({
        data: [{ id: 'pay_1', invoiceUrl: 'https://asaas.com/i/pay_1', status: 'PENDING' }],
      });

      const result = await service.subscribe('tenant-1', { cpfCnpj: '12345678900' });

      expect(asaas.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_123', value: 99 }),
      );
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: 'tenant-1', asaasSubscriptionId: 'sub_asaas_123' }),
        }),
      );
      expect(result.invoiceUrl).toBe('https://asaas.com/i/pay_1');
    });
  });

  describe('handlePaymentEvent', () => {
    it('ativa o tenant quando o pagamento e confirmado', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', tenantId: 'tenant-1' });

      asaas.getSubscriptionPayments.mockImplementation((_id: string, status: string) => Promise.resolve({ data: status === 'CONFIRMED' ? [{ id: 'pay_test' }] : [] }));
      await service.handlePaymentEvent('PAYMENT_CONFIRMED', {
        payment: { subscription: 'sub_asaas_123' },
      });

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('suspende o tenant quando o pagamento vence', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', tenantId: 'tenant-1' });

      asaas.getSubscriptionPayments.mockImplementation((_id: string, status: string) => Promise.resolve({ data: status === 'OVERDUE' ? [{ id: 'pay_test' }] : [] }));
      await service.handlePaymentEvent('PAYMENT_OVERDUE', {
        payment: { subscription: 'sub_asaas_123' },
      });

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { status: 'SUSPENDED' },
      });
    });

    it('ignora evento sem assinatura local correspondente', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.handlePaymentEvent('PAYMENT_CONFIRMED', {
        payment: { subscription: 'sub_desconhecida' },
      });

      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });
  });
});
