import * as bcrypt from 'bcryptjs';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, ConflictException, UnprocessableEntityException, Injectable, Logger } from '@nestjs/common';
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

  async cancel(tenantId: string, actorId: string, dto: CancelSubscriptionDto) {
    if (dto.confirmation !== 'CANCEL') throw new BadRequestException('Confirme com CANCEL.');
    const actor = await this.prisma.user.findFirst({ where: { id: actorId, tenantId } });
    if (!actor || actor.role !== 'ADMIN' || !await bcrypt.compare(dto.currentPassword, actor.passwordHash)) {
      throw new ForbiddenException('Confirmacao de identidade invalida.');
    }
    // Persist the intent BEFORE the remote call. Timeouts cannot reopen local access.
    const subscription = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const currentActor = await tx.user.findFirst({ where: { id: actorId, tenantId } });
      if (!currentActor || currentActor.role !== 'ADMIN' || currentActor.passwordHash !== actor.passwordHash) {
        throw new ForbiddenException('Credenciais alteradas. Entre novamente.');
      }
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId} FOR UPDATE`;
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      if (!sub) throw new NotFoundException('Empresa sem assinatura para encerrar.');
      await tx.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
      await tx.campaign.updateMany({ where: { tenantId, state: { not: 'CANCELLED' } }, data: { state: 'CANCELLED' } });
      await tx.campaignDelivery.updateMany({
        where: { campaign: { tenantId }, status: 'QUEUED' },
        data: { status: 'CANCELLED', payload: {}, finishedAt: new Date() },
      });
      if (sub.status === 'CANCELED') return sub;
      const updated = await tx.subscription.update({ where: { id: sub.id }, data: {
        status: 'CANCELED', cancellationPending: true, canceledAt: new Date(),
      } });
      await tx.auditEvent.create({ data: { tenantId, actorId, action: 'billing.cancellation_requested' } });
      return updated;
    });
    if (subscription.cancellationPending) {
      try {
        // Setting INACTIVE repeatedly is safe and preserves existing receivables.
        await this.asaas.stopRecurrence(subscription.asaasSubscriptionId);
      } catch {
        throw new ServiceUnavailableException({
          statusCode: 503, code: 'CANCELLATION_PENDING',
          message: 'Acesso bloqueado. Asaas ainda nao confirmou a interrupcao. Repita POST /billing/cancel com a mesma confirmacao.',
          tenantStatus: 'SUSPENDED', subscriptionStatus: 'CANCELED', cancellationPending: true,
        });
      }
      await this.prisma.$transaction(async tx => {
        const updated = await tx.subscription.updateMany({
          where: { id: subscription.id, status: 'CANCELED', cancellationPending: true },
          data: { cancellationPending: false },
        });
        if (updated.count) await tx.auditEvent.create({ data: { tenantId, actorId, action: 'billing.canceled' } });
      });
    }
    return { tenantStatus: 'SUSPENDED', subscriptionStatus: 'CANCELED',
      cancellationPending: false, existingPaymentsPreserved: true, historyPreserved: true };
  }

  async payments(tenantId: string, offset: number) {
    const subscription = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!subscription) return { data: [], hasMore: false, totalCount: 0 };
    const result = await this.asaas.listCustomerPayments(subscription.asaasCustomerId, offset);
    return { hasMore: result.hasMore, totalCount: result.totalCount, data: result.data.map(p => ({
      id: p.id, value: p.value, status: p.status, dueDate: p.dueDate,
      paymentDate: p.paymentDate || null, invoiceUrl: p.invoiceUrl || null, description: p.description || null,
    })) };
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
        ? { status: subscription.status, createdAt: subscription.createdAt, canceledAt: subscription.canceledAt, cancellationPending: subscription.cancellationPending }
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

    if (!['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE'].includes(event)) return { ok: true };
    // Reconciliacao autoritativa: um payload manual/antigo nao decide o saldo.
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${subscription.tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscription.id} FOR UPDATE`;
      // Re-read under the same locks used by cancellation; the pre-lock snapshot may be stale.
      const current = await tx.subscription.findUnique({ where: { id: subscription.id } });
      if (!current || current.status === 'CANCELED') return;
      const eventId = typeof payload?.id === 'string' ? `asaas:${payload.id}` : null;
      if (eventId && await tx.providerEvent.findUnique({ where: { id: eventId } })) return;
      const overdue = await this.asaas.getSubscriptionPayments(asaasSubscriptionId, 'OVERDUE');
      const confirmed = await this.asaas.getSubscriptionPayments(asaasSubscriptionId, 'CONFIRMED');
      const received = await this.asaas.getSubscriptionPayments(asaasSubscriptionId, 'RECEIVED');
      const status = overdue.data.length ? 'OVERDUE' : confirmed.data.length || received.data.length ? 'ACTIVE' : 'PENDING';
      await tx.subscription.update({ where: { id: subscription.id }, data: { status } });
      if (status !== 'PENDING') await tx.tenant.update({ where: { id: subscription.tenantId }, data: { status: status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED' } });
      if (eventId) await tx.providerEvent.create({ data: { id: eventId } });
      await tx.auditEvent.create({ data: { tenantId: subscription.tenantId, action: `billing.${status.toLowerCase()}` } });
    }, { timeout: 40000, maxWait: 5000 });
    return { ok: true };
  }
}
