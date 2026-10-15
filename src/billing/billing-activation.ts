import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient } from './asaas.client';
import { assertPlatformOwner } from '../owner/owner-access';
import { firstCalendarMonth, nextMonth, saoPauloDate } from './billing-calendar';

export class ActivateContractDto {
  @IsString() @MinLength(1) @MaxLength(4096) currentPassword: string;
  @IsIn(['ACTIVATE']) confirmation: string;
}

@Injectable()
export class BillingActivation {
  constructor(private prisma: PrismaService, private asaas: AsaasClient) {}
  async activate(tenantId: string, actorId: string, dto: ActivateContractDto) {
    if (dto.confirmation !== 'ACTIVATE') throw new BadRequestException('Confirme com ACTIVATE.');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    assertPlatformOwner(actor || undefined);
    if (!actor || !await bcrypt.compare(dto.currentPassword, actor.passwordHash)) throw new ForbiddenException('Senha incorreta.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const currentActor = await tx.user.findUnique({ where: { id: actorId } });
      assertPlatformOwner(currentActor || undefined);
      if (currentActor?.passwordHash !== actor.passwordHash || currentActor.tokenVersion !== actor.tokenVersion) throw new ForbiddenException('Entre novamente.');
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const sub = await tx.subscription.findUnique({ where: { tenantId }, include: { billingCycles: true } });
      if (!tenant || !sub) throw new NotFoundException('Empresa sem contrato. Cadastre a assinatura antes de ativar.');
      if (sub.cancellationPending) throw new ConflictException('Conclua o cancelamento pendente antes de reativar.');
      if (sub.status === 'ACTIVE' && tenant.status === 'ACTIVE') return { ok: true, alreadyActive: true };
      if (process.env.BILLING_CALENDAR_ENABLED !== 'true') throw new ConflictException('Ative o calendario mensal no servidor antes de reativar contratos.');
      if (sub.billingCycles.some(c => c.state === 'SENDING')) throw new ConflictException('Concilie a emissao pendente antes de reativar.');
      let price = sub.billingPriceCents;
      let options: any = sub.billingOptions;
      if (!sub.calendarEnabled) {
        if (!sub.asaasSubscriptionId) throw new ConflictException('Contrato sem configuracao de cobranca.');
        const remote = await this.asaas.getSubscription(sub.asaasSubscriptionId);
        if (remote.id !== sub.asaasSubscriptionId || remote.customer !== sub.asaasCustomerId || remote.cycle !== 'MONTHLY' ||
          !['UNDEFINED','BOLETO','PIX'].includes(remote.billingType) || remote.split?.length || remote.endDate || remote.maxPayments || remote.deleted ||
          !['ACTIVE','INACTIVE'].includes(remote.status)) throw new ConflictException('Condicoes do contrato exigem revisao no Asaas.');
        price = Math.round(remote.value * 100);
        options = JSON.parse(JSON.stringify({ billingType: remote.billingType, ...(remote.discount ? {discount:remote.discount}:{}), ...(remote.fine ? {fine:remote.fine}:{}), ...(remote.interest ? {interest:remote.interest}:{}) }));
      }
      if (!price || !Number.isSafeInteger(price) || price < 500) throw new ConflictException('Valor contratual invalido.');
      const owned = (payments: Awaited<ReturnType<AsaasClient['allPayments']>>) => payments.filter(p => !p.deleted &&
        ((!!sub.asaasSubscriptionId && p.subscription === sub.asaasSubscriptionId) || sub.billingCycles.some(c => c.paymentId === p.id)));
      let payments = owned(await this.asaas.allPayments({ customer: sub.asaasCustomerId }));
      if (payments.some(p => p.status === 'OVERDUE')) throw new ConflictException('Existem mensalidades vencidas. Regularize no Asaas antes de ativar.');
      // Never restart the native recurring stream: Nodus owns day 1/day 10 scheduling.
      if (sub.asaasSubscriptionId) {
        await this.asaas.stopRecurrence(sub.asaasSubscriptionId);
        payments = owned(await this.asaas.allPayments({ customer: sub.asaasCustomerId }));
        if (payments.some(p => p.status === 'OVERDUE')) throw new ConflictException('Existem mensalidades vencidas. Regularize antes de ativar.');
      }
      let start = firstCalendarMonth(saoPauloDate());
      if (sub.billingStartMonth && sub.billingStartMonth > start) start = sub.billingStartMonth;
      for (const payment of payments) {
        if (['REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS'].includes(payment.status)) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)) throw new ConflictException('Vencimento inconsistente.');
        const after = nextMonth(payment.dueDate.slice(0,7));
        if (after > start) start = after;
      }
      // Completed/cancelled cycles are immutable. Never replay scheduled work that was cancelled.
      for (const cycle of sub.billingCycles) {
        const after = nextMonth(cycle.month);
        if (after > start) start = after;
      }
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', canceledAt: null,
        cancellationPending: false, calendarEnabled: true, billingPriceCents: price, billingOptions: options,
        billingStartMonth: start, calendarError: null } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
      await tx.auditEvent.create({ data: { tenantId, actorId, action: `billing.owner_activated:${sub.status}:${start}` } });
      return { ok: true, tenantStatus: 'ACTIVE', subscriptionStatus: 'ACTIVE', firstIssueDate: `${start}-01`,
        firstDueDate: `${start}-10`, existingPaymentsPreserved: true, campaignsResumed: false };
    }, { timeout: 120000, maxWait: 5000 });
  }
}
