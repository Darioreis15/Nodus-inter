import { Injectable, Logger, OnModuleInit, OnModuleDestroy, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClient, CalendarPayment } from './asaas.client';

export function saoPauloDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function nextMonth(month: string) {
  const [year, m] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}
export function firstCalendarMonth(date: string) { return date.endsWith('-01') ? date.slice(0, 7) : nextMonth(date.slice(0, 7)); }
export function billingReference(subscriptionId: string, month: string) { return `nodus:${subscriptionId}:${month}`; }
const paid = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

@Injectable()
export class BillingCalendar implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private logger = new Logger(BillingCalendar.name);
  constructor(private prisma: PrismaService, private asaas: AsaasClient) {}
  onModuleInit() {
    if (process.env.BILLING_CALENDAR_ENABLED === 'true' && process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => void this.run().catch(() => this.logger.error('Falha no ciclo de cobranca.')), 15 * 60000);
      this.timer.unref();
      void this.run().catch(() => this.logger.error('Falha ao iniciar calendario.'));
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async run() {
    if (process.env.BILLING_CALENDAR_ENABLED !== 'true') return { enabled: false };
    if (this.running) return { running: true };
    this.running = true;
    const date = saoPauloDate(); let processed = 0, errors = 0, cursor: string | undefined;
    try {
      while (true) {
        const rows = await this.prisma.subscription.findMany({ where: {
          status: { not: 'CANCELED' }, OR: [{ calendarEnabled: true }, { status: 'ACTIVE', tenant: { status: 'ACTIVE' } }],
          ...(cursor ? { id: { gt: cursor } } : {}),
        }, orderBy: { id: 'asc' }, take: 50 });
        if (!rows.length) break;
        for (const sub of rows) {
          try {
            if (!sub.calendarEnabled) await this.migrate(sub.id, date);
            await this.issue(sub.id, date);
            processed++;
          } catch {
            errors++;
            await this.prisma.subscription.updateMany({ where: { id: sub.id, status: { not: 'CANCELED' } }, data: { calendarError: 'BILLING_REVIEW_REQUIRED' } });
            // No provider body, CPF, credentials or payment details in logs.
            this.logger.warn(`Calendario requer verificacao: ${sub.id}`);
          }
        }
        cursor = rows[rows.length - 1].id;
      }
      return { enabled: true, date, processed, errors };
    } finally { this.running = false; }
  }

  async migrate(id: string, date: string) {
    try {
      return await this.prisma.$transaction(async tx => {
        const snapshot = await tx.subscription.findUniqueOrThrow({ where: { id } });
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${snapshot.tenantId} FOR UPDATE`;
        const sub = await tx.subscription.findUniqueOrThrow({ where: { id }, include: { tenant: true } });
        if (sub.calendarEnabled || sub.status !== 'ACTIVE' || sub.tenant.status !== 'ACTIVE') return;
        if (!sub.asaasSubscriptionId) throw new ConflictException('Contrato sem recorrencia para migrar.');
        const remote = await this.asaas.getSubscription(sub.asaasSubscriptionId);
        if (remote.id !== sub.asaasSubscriptionId || remote.customer !== sub.asaasCustomerId || remote.cycle !== 'MONTHLY' ||
            !['UNDEFINED','BOLETO','PIX'].includes(remote.billingType) || remote.split?.length || remote.deleted || remote.endDate || remote.maxPayments ||
            !['ACTIVE','INACTIVE'].includes(remote.status)) throw new ConflictException('Revisao manual do contrato necessaria.');
        const cents = Math.round(remote.value * 100);
        if (!Number.isSafeInteger(cents) || cents < 500) throw new ConflictException('Valor contratual invalido.');
        // Idempotent remote stop first; rollback/retry cannot create a second recurring stream.
        await this.asaas.stopRecurrence(sub.asaasSubscriptionId);
        const existing = await this.asaas.allPayments({ subscription: sub.asaasSubscriptionId });
        let start = firstCalendarMonth(date);
        if (/^\d{4}-\d{2}-\d{2}$/.test(remote.nextDueDate || '') && remote.nextDueDate.slice(0, 7) > start) start = remote.nextDueDate.slice(0, 7);
        for (const payment of existing) {
          if (payment.deleted || ['REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS'].includes(payment.status)) continue;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)) throw new ConflictException('Vencimento invalido na conciliacao.');
          const after = nextMonth(payment.dueDate.slice(0, 7));
          if (after > start) start = after;
        }
        await tx.subscription.update({ where: { id }, data: { calendarEnabled: true, billingPriceCents: cents, billingStartMonth: start,
          billingOptions: JSON.parse(JSON.stringify({ billingType: remote.billingType, ...(remote.discount ? {discount:remote.discount}:{}), ...(remote.fine ? {fine:remote.fine}:{}), ...(remote.interest ? {interest:remote.interest}:{}) })), calendarError: null } });
        await tx.auditEvent.create({ data: { tenantId: sub.tenantId, action: `billing.calendar_enabled:${start}` } });
      }, { timeout: 120000, maxWait: 5000 });
    } catch (error) {
      await this.prisma.subscription.updateMany({ where: { id, calendarEnabled: false, status: { not: 'CANCELED' } }, data: { calendarError: 'MIGRATION_REVIEW_REQUIRED' } });
      throw error;
    }
  }

  async issue(id: string, date: string) {
    const month = date.slice(0, 7);
    const sub = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });
    if (!sub.calendarEnabled || sub.status === 'CANCELED' || !sub.billingStartMonth || month < sub.billingStartMonth) return;
    const previous = await this.prisma.billingCycle.findUnique({ where: { subscriptionId_month: { subscriptionId: id, month } } });
    // Reconcile uncertain attempts even after the due date, but never create late invoices silently.
    if (Number(date.slice(8)) > 10 && (!previous || previous.state === 'READY')) {
      await this.prisma.subscription.update({ where: { id }, data: { calendarError: `MISSED_CYCLE:${month}` } });
      return;
    }
    if (!sub.billingPriceCents || sub.billingPriceCents < 500) throw new ConflictException('Valor nao configurado.');
    const cycle = await this.prisma.billingCycle.upsert({ where: { subscriptionId_month: { subscriptionId: id, month } },
      create: { subscriptionId: id, month, dueDate: `${month}-10`, valueCents: sub.billingPriceCents }, update: {} });
    if (cycle.state === 'CREATED' || cycle.state === 'CANCELLED') return;
    const reference = billingReference(id, month);
    const existing = await this.asaas.allPayments({ customer: sub.asaasCustomerId, externalReference: reference });
    const matches = existing.filter(p => p.externalReference === reference && p.customer === sub.asaasCustomerId && !p.deleted);
    if (matches.length === 1) { await this.record(cycle.id, matches[0], sub.asaasCustomerId, reference); await this.reconcileStatus(id); return; }
    if (matches.length > 1) throw new ConflictException('Cobrancas duplicadas exigem revisao.');
    // externalReference is a lookup field, NOT an idempotency key. An ambiguous POST is never repeated.
    if (cycle.state !== 'READY') {
      await this.prisma.billingCycle.update({ where: { id: cycle.id }, data: { error: 'RECONCILIATION_REQUIRED' } });
      throw new ConflictException('Emissao aguarda conciliacao.');
    }
    const claimed = await this.prisma.billingCycle.updateMany({ where: { id: cycle.id, state: 'READY' }, data: { state: 'SENDING', attemptedAt: new Date() } });
    if (!claimed.count) return;
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${sub.tenantId} FOR UPDATE`;
        const current = await tx.subscription.findUniqueOrThrow({ where: { id } });
        if (current.status === 'CANCELED' || !current.calendarEnabled || process.env.BILLING_CALENDAR_ENABLED !== 'true') {
          await tx.billingCycle.update({ where: { id: cycle.id }, data: { state: 'CANCELLED' } }); return;
        }
        if (current.asaasSubscriptionId) {
          const remote = await this.asaas.getSubscription(current.asaasSubscriptionId);
          if (remote.status !== 'INACTIVE') throw new ConflictException('Recorrencia externa foi reativada; concilie antes de emitir.');
        }
        const payment = await this.asaas.createCalendarPayment({ ...(current.billingOptions as any), customer: current.asaasCustomerId,
          billingType: (current.billingOptions as any)?.billingType || 'UNDEFINED', value: cycle.valueCents / 100,
          dueDate: cycle.dueDate, externalReference: reference, description: `Nodus - mensalidade ${month}` });
        this.validatePayment(payment, current.asaasCustomerId, reference, cycle);
        await tx.billingCycle.update({ where: { id: cycle.id }, data: { state: 'CREATED', paymentId: payment.id, error: null } });
        if (!current.calendarError?.startsWith('MISSED_CYCLE:')) await tx.subscription.update({ where: { id }, data: { calendarError: null } });
        await tx.auditEvent.create({ data: { tenantId: sub.tenantId, action: `billing.issued:${month}` } });
      }, { timeout: 30000, maxWait: 5000 });
    } catch {
      await this.prisma.billingCycle.updateMany({ where: { id: cycle.id, state: 'SENDING' }, data: { error: 'RECONCILIATION_REQUIRED' } });
      throw new ConflictException('Confirmacao da emissao pendente; nao repita o POST no Asaas.');
    }
  }

  private validatePayment(payment: CalendarPayment, customer: string, reference: string, cycle: { valueCents: number; dueDate: string }) {
    if (!payment?.id || payment.customer !== customer || payment.externalReference !== reference ||
        Math.round(payment.value * 100) !== cycle.valueCents || payment.dueDate !== cycle.dueDate) throw new ConflictException('Cobranca divergente.');
  }
  private async record(cycleId: string, payment: CalendarPayment, customer: string, reference: string) {
    const cycle = await this.prisma.billingCycle.findUniqueOrThrow({ where: { id: cycleId } });
    this.validatePayment(payment, customer, reference, cycle);
    await this.prisma.billingCycle.update({ where: { id: cycleId }, data: { state: 'CREATED', paymentId: payment.id, error: null } });
    await this.prisma.subscription.updateMany({ where: { id: cycle.subscriptionId, calendarError: 'BILLING_REVIEW_REQUIRED' }, data: { calendarError: null } });
  }

  async reconcilePayment(paymentId: string) {
    const payment = await this.asaas.getPayment(paymentId);
    if (payment.deleted || !payment.externalReference?.startsWith('nodus:')) return { ok: true };
    const match = /^nodus:([0-9a-f-]{36}):(\d{4}-\d{2})$/.exec(payment.externalReference);
    if (!match) return { ok: true };
    const [, id, month] = match;
    const cycle = await this.prisma.billingCycle.findUnique({ where: { subscriptionId_month: { subscriptionId: id, month } }, include: { subscription: true } });
    if (!cycle || cycle.subscription.asaasCustomerId !== payment.customer) return { ok: true };
    await this.record(cycle.id, payment, payment.customer, payment.externalReference);
    await this.reconcileStatus(id);
    return { ok: true };
  }

  async reconcileStatus(id: string) {
    await this.prisma.$transaction(async tx => {
      const snap = await tx.subscription.findUniqueOrThrow({ where: { id } });
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${snap.tenantId} FOR UPDATE`;
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id }, include: { billingCycles: true } });
      if (sub.status === 'CANCELED') return;
      const all = await this.asaas.allPayments({ customer: sub.asaasCustomerId });
      const owned = all.filter(p => !p.deleted && ((sub.asaasSubscriptionId && p.subscription === sub.asaasSubscriptionId) || sub.billingCycles.some(c => c.paymentId === p.id)));
      const overdue = owned.some(p => p.status === 'OVERDUE');
      const hasPaid = owned.some(p => paid.has(p.status));
      const status = overdue ? 'OVERDUE' : hasPaid ? 'ACTIVE' : 'PENDING';
      await tx.subscription.update({ where: { id }, data: { status } });
      if (status !== 'PENDING') await tx.tenant.update({ where: { id: sub.tenantId }, data: { status: overdue ? 'SUSPENDED' : 'ACTIVE' } });
    }, { timeout: 120000, maxWait: 5000 });
  }
}
