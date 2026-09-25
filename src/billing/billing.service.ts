import { ConflictException, UnprocessableEntityException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient } from './asaas.client';
import { SubscribeDto } from './dto/subscribe.dto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private asaas: AsaasClient,
  ) {}

  async subscribe(tenantId: string, dto: SubscribeDto) {
    const existing = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (existing) {
      throw new ConflictException('Esse tenant ja tem uma assinatura.');
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true },
    });

    const priceCents = tenant.plan.priceCents;
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
      throw new UnprocessableEntityException(
        'Plano sem preco valido. Execute npm run prisma:seed no banco usado pelo backend antes de assinar.',
      );
    }

    const customer = await this.asaas.createCustomer({
      name: tenant.name,
      cpfCnpj: dto.cpfCnpj,
      email: dto.email,
    });

    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 3); // 3 dias de prazo pro primeiro pagamento

    const subscription = await this.asaas.createSubscription({
      customer: customer.id,
      value: priceCents / 100,
      cycle: 'MONTHLY',
      description: `Nodus - plano ${tenant.plan.name}`,
      nextDueDate: nextDueDate.toISOString().slice(0, 10),
    });

    await this.prisma.subscription.create({
      data: {
        tenantId,
        asaasCustomerId: customer.id,
        asaasSubscriptionId: subscription.id,
        status: 'PENDING',
      },
    });

    // primeira cobranca gerada pela assinatura -- devolvemos o link de
    // pagamento pro admin poder pagar (ou mandar pro financeiro do cliente).
    const payments = await this.asaas.getSubscriptionPayments(subscription.id);
    const firstPayment = payments.data?.[0];

    return {
      subscriptionId: subscription.id,
      status: 'PENDING',
      invoiceUrl: firstPayment?.invoiceUrl ?? null,
    };
  }

  async getStatus(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { tenantId } });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true },
    });

    return {
      tenantStatus: tenant.status,
      plan: { name: tenant.plan.name, priceCents: tenant.plan.priceCents },
      subscription: subscription
        ? { status: subscription.status, createdAt: subscription.createdAt }
        : null,
    };
  }

  /**
   * Chamado pelo webhook do Asaas. Eventos que tratamos:
   * PAYMENT_CONFIRMED / PAYMENT_RECEIVED -> assinatura e tenant ficam ativos.
   * PAYMENT_OVERDUE -> tenant fica suspenso ate regularizar.
   */
  async handlePaymentEvent(event: string, payload: any) {
    const asaasSubscriptionId = payload?.payment?.subscription;
    if (!asaasSubscriptionId) {
      this.logger.debug(`Evento Asaas sem subscription vinculada: ${event}`);
      return { ok: true };
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { asaasSubscriptionId },
    });
    if (!subscription) {
      this.logger.warn(`Nenhuma assinatura local encontrada para ${asaasSubscriptionId}`);
      return { ok: true };
    }

    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'ACTIVE' },
      });
      await this.prisma.tenant.update({
        where: { id: subscription.tenantId },
        data: { status: 'ACTIVE' },
      });
      this.logger.log(`Assinatura ${asaasSubscriptionId} confirmada -- tenant reativado.`);
    } else if (event === 'PAYMENT_OVERDUE') {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'OVERDUE' },
      });
      await this.prisma.tenant.update({
        where: { id: subscription.tenantId },
        data: { status: 'SUSPENDED' },
      });
      this.logger.warn(`Assinatura ${asaasSubscriptionId} vencida -- tenant suspenso.`);
    } else {
      this.logger.debug(`Evento Asaas nao tratado: ${event}`);
    }

    return { ok: true };
  }
}
