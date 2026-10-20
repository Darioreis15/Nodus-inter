import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { assertPlatformOwner } from '../owner/owner-access';
import { AsaasClient, CalendarPayment } from './asaas.client';
import { billingReference, saoPauloDate } from './billing-calendar';
import { BillingDelivery, safeBillingLink, verifiedPayment } from './billing-delivery';
import { sandboxBillingAvailable } from './sandbox-config';

export class SandboxBillingDto {
  @IsString() @MinLength(1) @MaxLength(4096) currentPassword: string;
  @IsIn(['SANDBOX_EMAIL']) confirmation: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsEmail() @MaxLength(254) expectedEmail: string;
}

@Injectable()
export class BillingSandbox {
  constructor(private prisma: PrismaService, private asaas: AsaasClient, private delivery: BillingDelivery) {}

  async issue(tenantId: string, actorId: string, dto: SandboxBillingDto) {
    this.assertEnabled();
    if (dto.confirmation !== 'SANDBOX_EMAIL') throw new BadRequestException('Confirme o teste de e-mail Sandbox.');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
    assertPlatformOwner(actor || undefined);
    if (!actor || !await bcrypt.compare(dto.currentPassword, actor.passwordHash)) throw new ForbiddenException('Senha incorreta.');
    const month = `test-${dto.date}`;
    // A committed reservation survives crashes and uncertain provider responses.
    const reserved = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      this.assertEnabled();
      const currentActor = await tx.user.findUnique({ where: { id: actorId } });
      assertPlatformOwner(currentActor || undefined);
      if (currentActor?.passwordHash !== actor.passwordHash || currentActor.tokenVersion !== actor.tokenVersion) throw new ForbiddenException('Entre novamente.');
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      if (!sub) throw new NotFoundException('Contrato nao encontrado.');
      this.assertSettings(sub, dto.expectedEmail);
      const previous = await tx.billingCycle.findUnique({ where: { subscriptionId_month: { subscriptionId: sub.id, month } } });
      if (previous) {
        if (!previous.isTest || previous.state === 'CANCELLED') throw new ConflictException('Teste cancelado ou registro incompativel.');
        return { cycle: previous, sub, create: false };
      }
      if (dto.date !== saoPauloDate()) throw new ConflictException('Atualize os avisos antes de iniciar um novo teste.');
      if (await tx.billingCycle.findFirst({ where: { subscriptionId: sub.id, isTest: true, state: 'SENDING' } })) throw new ConflictException('Existe teste sem confirmacao. Concilie antes de criar outro.');
      const due = new Date(`${dto.date}T12:00:00Z`); due.setUTCDate(due.getUTCDate() + 3);
      const cycle = await tx.billingCycle.create({ data: { subscriptionId: sub.id, month, isTest: true, dueDate: due.toISOString().slice(0, 10), valueCents: 500, state: 'SENDING', attemptedAt: new Date() } });
      await tx.auditEvent.create({ data: { tenantId, actorId, action: `billing.sandbox.reserved:${cycle.id}` } });
      return { cycle, sub, create: true };
    });
    let cycle = reserved.cycle;
    const sub = reserved.sub, reference = billingReference(sub.id, month);
    let payment: CalendarPayment;
    try {
      if (cycle.paymentId) payment = await this.asaas.getPayment(cycle.paymentId);
      else if (!reserved.create) {
        const matches = (await this.asaas.allPayments({ customer: sub.asaasCustomerId, externalReference: reference }))
          .filter(p => !p.deleted && p.customer === sub.asaasCustomerId && p.externalReference === reference);
        if (matches.length !== 1) throw new ConflictException('Emissao em processamento ou sem confirmacao. Confira no Asaas; nao crie outra cobranca.');
        payment = matches[0];
      } else {
        payment = await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
          this.assertEnabled();
          const current = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id } });
          this.assertSettings(current, dto.expectedEmail);
          const currentActor = await tx.user.findUnique({ where: { id: actorId } });
          assertPlatformOwner(currentActor || undefined);
          if (currentActor?.passwordHash !== actor.passwordHash || currentActor.tokenVersion !== actor.tokenVersion) throw new ForbiddenException('Entre novamente.');
          return this.asaas.createCalendarPayment({ customer: current.asaasCustomerId, billingType: 'BOLETO', value: 5, dueDate: cycle.dueDate,
            externalReference: reference, description: 'TESTE NODUS - Sandbox - sem valor de mensalidade' });
        }, { timeout: 20000 });
      }
      if (!payment?.id) throw new Error('PAYMENT_MISMATCH');
      verifiedPayment(payment, { ...cycle, paymentId: payment.id }, sub);
      const invoiceUrl = safeBillingLink(payment.invoiceUrl);
      cycle = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        const updated = await tx.billingCycle.update({ where: { id: cycle.id }, data: { state: 'CREATED', paymentId: payment.id, error: null } });
        await tx.billingDelivery.createMany({ skipDuplicates: true, data: [
          { cycleId: cycle.id, kind: 'EMAIL', state: 'QUEUED' },
          { cycleId: cycle.id, kind: 'WHATSAPP', state: 'SKIPPED', error: 'SANDBOX_EMAIL_ONLY' },
        ] });
        await tx.auditEvent.create({ data: { tenantId, actorId, action: `billing.sandbox.confirmed:${cycle.id}` } });
        return updated;
      });
      const email = await this.prisma.billingDelivery.findUniqueOrThrow({ where: { cycleId_kind: { cycleId: cycle.id, kind: 'EMAIL' } } });
      await this.delivery.process(email.id);
      const result = await this.prisma.billingDelivery.findUniqueOrThrow({ where: { id: email.id } });
      return { test: true, cycleId: cycle.id, paymentId: cycle.paymentId, invoiceUrl, valueCents: cycle.valueCents, dueDate: cycle.dueDate, emailState: result.state, error: result.error };
    } catch (error) {
      await this.prisma.billingCycle.updateMany({ where: { id: cycle.id, state: 'SENDING' }, data: { error: 'RECONCILIATION_REQUIRED' } });
      if (error instanceof ConflictException) throw error;
      throw new ConflictException('Teste sem confirmacao. Consulte o historico e repita o mesmo teste para conciliar, sem criar outra cobranca.');
    }
  }
  private assertEnabled() {
    if (!sandboxBillingAvailable()) throw new ForbiddenException('Teste disponivel apenas no Asaas Sandbox com BILLING_SANDBOX_TEST_ENABLED=true.');
    if (process.env.BILLING_DELIVERY_ENABLED !== 'true' || !process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new ConflictException('Configure e ative o envio de e-mail antes do teste.');
  }
  private assertSettings(sub: any, email: string) {
    const prefs = sub.deliverySettings;
    if (sub.status === 'CANCELED' || sub.cancellationPending || !sub.deliveryEnabled || !prefs?.emailEnabled || !prefs.email || prefs.email !== email) throw new ConflictException('Salve os avisos por e-mail e atualize a tela. O contrato deve estar ativo.');
  }
}
